import { APP_ORIGIN } from "@/lib/app-origin";
import { Check, Clock, Link2, Mail, MessageSquare, Send } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildContactInviteLink,
  canInviteVia,
  declinedInvite,
  draftInvite,
  inviteDayMonth,
  inviteHref,
  inviteMessage,
  inviteSubject,
  pendingInvite,
  pendingInviteLabel,
  type Contact,
  type ContactInvite,
  type InviteMethod,
} from "@/lib/contacts";
import { INVITE_NOTE_MAX, inviteRefusal, reinviteNoteProblem } from "@/lib/contact-invites";
import { useContactInvites, useInviteActions } from "@/lib/use-contacts";

/** The question asked after Avora handed the invitation over (KT-07a). */
type Asking = { inviteId: string; method: InviteMethod };

/**
 * Inviting someone you have written down to join you on AVORA.
 *
 * AVORA prepares and hands over; it does not send on someone's behalf. Each channel opens the
 * person's own messages app with the text already written, so the last read and the send are
 * theirs — the same rule that keeps the app out of calendars and phone calls.
 *
 * KT-07a: handing over is not sending. The server keeps a draft, and only `Đã gửi` turns it into
 * "Đã mời"; `Chưa gửi` throws the draft away. Someone who said "Không, cảm ơn" can be invited
 * again, but only from here, one person at a time, deliberately, with a few words of your own.
 *
 * A channel is only offered when there is somewhere for it to go: no number written down means
 * no message button. Copying a link is always offered, since the sender chooses how to pass it on.
 */
export function InvitePanel({ contact, inviterName }: { contact: Contact; inviterName: string }) {
  const [copied, setCopied] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [mustReinvite, setMustReinvite] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");

  const invitesQuery = useContactInvites(contact.id);
  const { prepare, confirmSent, discardDraft, isWorking } = useInviteActions();

  const invites: ContactInvite[] = invitesQuery.data ?? [];
  const waiting: ContactInvite | null = pendingInvite(invites);
  const draft: ContactInvite | null = draftInvite(invites);
  const declined: ContactInvite | null = declinedInvite(invites);
  const reinvite: boolean = mustReinvite || declined !== null;
  const draftId = draft?.id ?? null;
  const draftMethod = draft?.method ?? null;
  const question: Asking | null = useMemo(
    () => asking ?? (draftId !== null && draftMethod !== null ? { inviteId: draftId, method: draftMethod } : null),
    [asking, draftId, draftMethod],
  );

  const send = useCallback(
    async (method: InviteMethod): Promise<void> => {
      setNotice(null);
      setCopied(false);
      if (reinvite) {
        const problem = reinviteNoteProblem(note);
        if (problem !== null) {
          setNotice(problem);
          return;
        }
      }
      try {
        const prepared = await prepare(contact.id, method, reinvite ? { note, reinvite: true } : {});
        if (prepared.status === "pending") {
          // Already waiting (another tab, another device): nothing new is made.
          void invitesQuery.refetch?.();
          return;
        }
        const link = buildContactInviteLink(APP_ORIGIN, prepared.token);
        const body = inviteMessage(inviterName, link, { note: reinvite ? note : null, expiresAt: prepared.expiresAt });

        if (method === "link") {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setAsking({ inviteId: prepared.inviteId, method });
          return;
        }

        const href = inviteHref(method, contact, body, inviteSubject(inviterName));
        if (href === null) {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setNotice(
            method === "sms"
              ? "Liên hệ này chưa có số điện thoại — đã sao chép liên kết để bạn gửi theo cách khác."
              : "Liên hệ này chưa có email — đã sao chép liên kết để bạn gửi theo cách khác.",
          );
          setAsking({ inviteId: prepared.inviteId, method: "link" });
          return;
        }
        setAsking({ inviteId: prepared.inviteId, method });
        window.location.href = href;
      } catch (error) {
        const refusal = inviteRefusal(error);
        if (refusal === "avora_invite_declined") setMustReinvite(true);
        setNotice((error as Error).message);
      }
    },
    [contact, prepare, inviterName, invitesQuery, reinvite, note],
  );

  const answer = useCallback(
    async (sent: boolean): Promise<void> => {
      if (question === null) return;
      setNotice(null);
      try {
        if (sent) await confirmSent(question.inviteId);
        else await discardDraft(question.inviteId);
        setAsking(null);
        setCopied(false);
        if (sent) {
          setMustReinvite(false);
          setNote("");
        }
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
    [question, confirmSent, discardDraft],
  );

  if (waiting !== null && asking === null) {
    return (
      <section className="rounded-card border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
            <Clock className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{pendingInviteLabel(waiting)}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Khi {contact.name} mở liên kết và vào AVORA, hai bên sẽ tự có nhau trong danh bạ.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (question !== null) {
    const where = question.method === "email" ? "email" : question.method === "sms" ? "tin nhắn" : "liên kết";
    return (
      <section className="rounded-card border border-border bg-card p-5" data-invite-ask="">
        <p className="text-[15px] font-semibold text-foreground">Bạn đã gửi lời mời cho {contact.name} chưa?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {copied && question.method === "link"
            ? "Liên kết đã được sao chép. Khi bạn gửi xong, Avora mới ghi là đã mời."
            : `Avora đã mở ${where} với lời mời soạn sẵn. Khi bạn gửi xong, Avora mới ghi là đã mời.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void answer(true)}>
            <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Đã gửi
          </Button>
          <Button variant="outline" className="press h-10 px-4" disabled={isWorking} onClick={() => void answer(false)}>
            Chưa gửi
          </Button>
        </div>
        {notice !== null ? (
          <p role="alert" className="mt-3 text-[13px] text-primary">
            {notice}
          </p>
        ) : null}
      </section>
    );
  }

  const declinedDay = declined?.declinedAt ? inviteDayMonth(declined.declinedAt) : null;

  return (
    <section className="rounded-card border border-border bg-card p-5">
      {reinvite ? (
        <>
          <p className="text-[15px] font-semibold text-foreground">
            {declinedDay !== null
              ? `${contact.name} đã từ chối lời mời ngày ${declinedDay}.`
              : `${contact.name} đã từ chối lời mời trước đây.`}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Có thể {contact.name} bấm nhầm. Nếu bạn muốn mời lại, hãy viết vài lời cho {contact.name}.
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Lời nhắn của bạn</span>
            <Textarea
              value={note}
              maxLength={INVITE_NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
              placeholder={`Vài lời của bạn cho ${contact.name} (ít nhất 10 ký tự)`}
              className="min-h-[76px] text-[16px] md:text-[14px]"
            />
          </label>
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold text-foreground">Mời {contact.name} dùng AVORA</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            AVORA soạn sẵn lời mời, bạn là người bấm gửi.
          </p>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2.5">
        {canInviteVia(contact, "sms") ? (
          <Button variant="outline" className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void send("sms")}>
            {reinvite ? <Send className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> : <MessageSquare className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
            {reinvite ? "Mời lại qua Tin nhắn" : "Tin nhắn"}
          </Button>
        ) : null}
        {canInviteVia(contact, "email") ? (
          <Button variant="outline" className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void send("email")}>
            <Mail className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {reinvite ? "Mời lại qua Email" : "Email"}
          </Button>
        ) : null}
        <Button variant="outline" className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void send("link")}>
          {copied ? (
            <Check className="h-4 w-4 text-money-in" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Link2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          )}
          {copied ? "Đã sao chép" : "Sao chép liên kết"}
        </Button>
      </div>

      {notice !== null ? (
        <p role="alert" className="mt-3 text-[13px] text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
