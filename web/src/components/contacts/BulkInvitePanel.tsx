import { Check, Mail, MessageSquare, Send } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_ORIGIN } from "@/lib/app-origin";
import { useAuth } from "@/lib/auth";
import { buildInviteCandidates, type InviteCandidate } from "@/lib/contact-import";
import {
  buildContactInviteLink,
  inviteHref,
  inviteMessage,
  inviteSubject,
  type Contact,
  type InviteMethod,
} from "@/lib/contacts";
import { peerLabel } from "@/lib/initials";
import { useInviteActions } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

export type BulkInviteOutcome = {
  sent: number;
  failed: { name: string; reason: string }[];
};

type BulkInvitePanelProps = {
  /** The contacts just written down. Companies and linked people are filtered out here. */
  contacts: readonly Contact[];
  onDone: (outcome: BulkInviteOutcome) => void;
};

type Target = { contactId: string; name: string; method: InviteMethod; contact: Contact };

/** Where the queue is: picking, or at person `index`, maybe waiting for "Bạn đã gửi chưa?". */
type Queue = { index: number; asking: string | null; sent: number; failed: BulkInviteOutcome["failed"]; notice: string | null };

/**
 * Inviting the people an import just created.
 *
 * KT-07a (SP-03 lỗi 2): this used to make tokens for everyone and say "Đã gửi N lời mời" without
 * opening anything — the address book then showed "Đã mời" for people who never got a message.
 * Now it is a queue: Avora opens Tin nhắn / Mail for **one person at a time** (never one message to
 * many numbers — that would show everyone's number to everyone), asks "Bạn đã gửi chưa?", and only
 * `Đã gửi` counts. People who declined before are refused by the server here: they can only be
 * invited again from their own page, one by one, with a note.
 */
export function BulkInvitePanel({ contacts, onDone }: BulkInvitePanelProps) {
  const candidates: InviteCandidate[] = useMemo(() => buildInviteCandidates(contacts), [contacts]);
  const byId = useMemo(() => new Map(contacts.map((entry) => [entry.id, entry])), [contacts]);
  const { user } = useAuth();
  const inviterName = peerLabel((user?.user_metadata?.display_name as string | undefined) ?? null);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((entry) => entry.contactId)));
  const [channels, setChannels] = useState<Record<string, InviteCandidate["method"]>>(() =>
    Object.fromEntries(candidates.map((entry) => [entry.contactId, entry.method])),
  );
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);

  const { prepare, confirmSent, discardDraft, isWorking } = useInviteActions();

  const toggle = useCallback((contactId: string): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }, []);

  const start = useCallback((): void => {
    const list: Target[] = candidates
      .filter((entry) => picked.has(entry.contactId) && byId.has(entry.contactId))
      .map((entry) => ({
        contactId: entry.contactId,
        name: entry.name,
        method: channels[entry.contactId] ?? entry.method,
        contact: byId.get(entry.contactId) as Contact,
      }));
    setTargets(list);
    setQueue({ index: 0, asking: null, sent: 0, failed: [], notice: null });
  }, [candidates, picked, channels, byId]);

  const advance = useCallback(
    (next: Queue): void => {
      if (targets !== null && next.index >= targets.length) {
        setQueue(null);
        onDone({ sent: next.sent, failed: next.failed });
        return;
      }
      setQueue(next);
    },
    [targets, onDone],
  );

  const openFor = useCallback(async (): Promise<void> => {
    if (queue === null || targets === null) return;
    const target = targets[queue.index];
    try {
      const prepared = await prepare(target.contactId, target.method, { batch: true });
      if (prepared.status === "pending") {
        // Already invited and waiting: not invited twice.
        advance({ ...queue, index: queue.index + 1, notice: `${target.name} đã được mời từ trước — đang chờ.` });
        return;
      }
      const link = buildContactInviteLink(APP_ORIGIN, prepared.token);
      const href = inviteHref(
        target.method,
        target.contact,
        inviteMessage(inviterName, link, { expiresAt: prepared.expiresAt }),
        inviteSubject(inviterName),
      );
      setQueue({ ...queue, asking: prepared.inviteId, notice: null });
      if (href !== null) window.location.href = href;
    } catch (error) {
      advance({
        ...queue,
        index: queue.index + 1,
        failed: [...queue.failed, { name: target.name, reason: (error as Error).message }],
        notice: `Chưa mời ${target.name}: ${(error as Error).message}`,
      });
    }
  }, [queue, targets, prepare, inviterName, advance]);

  const answer = useCallback(
    async (sent: boolean): Promise<void> => {
      if (queue === null || queue.asking === null || targets === null) return;
      const target = targets[queue.index];
      try {
        if (sent) await confirmSent(queue.asking);
        else await discardDraft(queue.asking);
        advance({ ...queue, index: queue.index + 1, asking: null, sent: queue.sent + (sent ? 1 : 0), notice: null });
      } catch (error) {
        advance({
          ...queue,
          index: queue.index + 1,
          asking: null,
          failed: [...queue.failed, { name: target.name, reason: (error as Error).message }],
          notice: `Chưa mời ${target.name}: ${(error as Error).message}`,
        });
      }
    },
    [queue, targets, confirmSent, discardDraft, advance],
  );

  if (candidates.length === 0) {
    return (
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Không có ai để mời trong lần nhập này — những liên hệ vừa thêm đều là doanh nghiệp, đã dùng
        AVORA, hoặc chưa có số điện thoại và email.
      </p>
    );
  }

  if (queue !== null && targets !== null && targets[queue.index] !== undefined) {
    const target = targets[queue.index];
    const app = target.method === "email" ? "Mail" : "Tin nhắn";
    return (
      <div data-invite-queue="">
        <p className="text-[13px] font-medium text-muted-foreground">
          Mời {targets.length} người · Người {queue.index + 1}/{targets.length}
        </p>
        <p className="mt-1 text-[16px] font-semibold text-foreground">{target.name}</p>
        {queue.notice !== null ? (
          <p role="status" className="mt-2 text-[13px] text-primary">
            {queue.notice}
          </p>
        ) : null}
        {queue.asking === null ? (
          <>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              Avora mở {app} với lời mời soạn sẵn cho riêng {target.name}. Bạn là người bấm gửi.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void openFor()}>
                {target.method === "email" ? (
                  <Mail className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <MessageSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                )}
                Mở {app} cho {target.name}
              </Button>
              <Button
                variant="outline"
                className="press h-10 px-4"
                disabled={isWorking}
                onClick={() => advance({ ...queue, index: queue.index + 1, notice: null })}
              >
                Bỏ qua người này
              </Button>
              <button
                type="button"
                onClick={() => {
                  setQueue(null);
                  onDone({ sent: queue.sent, failed: queue.failed });
                }}
                className="press min-h-11 px-2 text-[13.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Dừng lại
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-[14px] font-medium text-foreground">Bạn đã gửi lời mời cho {target.name} chưa?</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Button className="press h-10 gap-2 px-4" disabled={isWorking} onClick={() => void answer(true)}>
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Đã gửi
              </Button>
              <Button variant="outline" className="press h-10 px-4" disabled={isWorking} onClick={() => void answer(false)}>
                Chưa gửi
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {candidates.length} người chưa dùng AVORA. Avora mở Tin nhắn hoặc Mail cho từng người một — bạn bấm gửi
        từng tin. Bỏ tick những ai bạn chưa muốn mời.
      </p>

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {candidates.map((entry) => {
          const isPicked = picked.has(entry.contactId);
          const channel = channels[entry.contactId] ?? entry.method;

          return (
            <li key={entry.contactId} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={isPicked}
                onCheckedChange={() => toggle(entry.contactId)}
                aria-label={`Mời ${entry.name}`}
              />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{entry.name}</span>

              {/* Only the channels this person actually has an address for are drawn. */}
              <span className="flex shrink-0 items-center gap-1">
                {entry.methods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={!isPicked}
                    aria-pressed={channel === method}
                    onClick={() => setChannels((current) => ({ ...current, [entry.contactId]: method }))}
                    className={cn(
                      "press inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-45",
                      channel === method
                        ? "border-personal bg-personal-soft text-personal-soft-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/30",
                    )}
                  >
                    {method === "email" ? (
                      <Mail className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    )}
                    {method === "email" ? "Email" : "Tin nhắn"}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onDone({ sent: 0, failed: [] })}
          className="press text-[13.5px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Để sau
        </button>
        <Button className="press h-10 px-5" disabled={picked.size === 0} onClick={start}>
          <Send className="mr-1.5 h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          Mời {picked.size} người
        </Button>
      </div>
    </div>
  );
}
