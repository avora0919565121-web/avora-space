import { Check, Clock, Link2, Mail, MessageSquare } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  buildContactInviteLink,
  canInviteVia,
  inviteHref,
  inviteMessage,
  pendingInvite,
  pendingInviteLabel,
  type Contact,
  type ContactInvite,
  type InviteMethod,
} from "@/lib/contacts";
import { useContactActions, useContactInvites } from "@/lib/use-contacts";

/**
 * Inviting someone you have written down to join you on AVORA.
 *
 * AVORA prepares and hands over; it does not send on someone's behalf. Each channel opens the
 * person's own messages app with the text already written, so the last read and the send are
 * theirs — the same rule that keeps the app out of calendars and phone calls.
 *
 * Once an invitation is waiting, the buttons are replaced by its status rather than sitting
 * next to it. A second invitation would create a second token for the same person, and the
 * first one they tapped would be the wrong one.
 *
 * A channel is only offered when there is somewhere for it to go: no number written down means
 * no message button, the same way the phone-book import button stays away when there is nothing
 * to import. Copying a link is always offered, since the sender chooses how to pass it on.
 */
export function InvitePanel({ contact, inviterName }: { contact: Contact; inviterName: string }) {
  const [copied, setCopied] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const invitesQuery = useContactInvites(contact.id);
  const { invite, isWorking } = useContactActions();

  const waiting: ContactInvite | null = pendingInvite(invitesQuery.data ?? []);

  const send = useCallback(
    async (method: InviteMethod): Promise<void> => {
      setNotice(null);
      setCopied(false);
      try {
        const token = await invite(contact.id, method);
        const link = buildContactInviteLink(window.location.origin, token);
        const body = inviteMessage(inviterName, link);

        if (method === "link") {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          return;
        }

        const href = inviteHref(method, contact, body);
        if (href === null) {
          // The channel has no address. The button for it is not drawn, and the database refuses
          // too, so reaching here means the contact changed under an open page: the token is
          // already issued, so the link stays the way through.
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setNotice(
            method === "sms"
              ? "Liên hệ này chưa có số điện thoại — đã sao chép liên kết để bạn gửi theo cách khác."
              : "Liên hệ này chưa có email — đã sao chép liên kết để bạn gửi theo cách khác.",
          );
          return;
        }
        window.location.href = href;
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
    [contact, invite, inviterName],
  );

  if (waiting !== null) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
            <Clock className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{pendingInviteLabel(waiting)}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Khi {contact.name} mở liên kết và đăng nhập, hai bên sẽ tự có nhau trong danh bạ.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="text-[15px] font-semibold text-foreground">Mời {contact.name} dùng AVORA</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        AVORA soạn sẵn lời mời, bạn là người bấm gửi.
      </p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        {canInviteVia(contact, "sms") ? (
          <Button
            variant="outline"
            className="press h-10 gap-2 px-4"
            disabled={isWorking}
            onClick={() => void send("sms")}
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            Tin nhắn
          </Button>
        ) : null}
        {canInviteVia(contact, "email") ? (
          <Button
            variant="outline"
            className="press h-10 gap-2 px-4"
            disabled={isWorking}
            onClick={() => void send("email")}
          >
            <Mail className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            Email
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="press h-10 gap-2 px-4"
          disabled={isWorking}
          onClick={() => void send("link")}
        >
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
