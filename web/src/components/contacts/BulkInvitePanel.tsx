import { Mail, MessageSquare, Send } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildInviteCandidates, type InviteCandidate } from "@/lib/contact-import";
import type { Contact } from "@/lib/contacts";
import { useBulkInvite, type BulkInviteOutcome } from "@/lib/use-contact-import";
import { cn } from "@/lib/utils";

type BulkInvitePanelProps = {
  /** The contacts just written down. Companies and linked people are filtered out here. */
  contacts: readonly Contact[];
  onDone: (outcome: BulkInviteOutcome) => void;
};

/**
 * Inviting the people an import just created, in one pass.
 *
 * Shared by every bulk route into the address book — a file today, the phone book next — because
 * the decision is the same one each time: which of these new people should be asked to join, and
 * by which channel. Everyone is ticked by default here, unlike the import table: these are
 * people the user has already deliberately added, so asking them to tick the same names twice
 * would be ceremony. Untick is one click away.
 */
export function BulkInvitePanel({ contacts, onDone }: BulkInvitePanelProps) {
  const candidates: InviteCandidate[] = useMemo(() => buildInviteCandidates(contacts), [contacts]);

  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(candidates.map((entry) => entry.contactId)),
  );
  const [channels, setChannels] = useState<Record<string, InviteCandidate["method"]>>(() =>
    Object.fromEntries(candidates.map((entry) => [entry.contactId, entry.method])),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const { send, progress, isSending } = useBulkInvite();

  const toggle = useCallback((contactId: string): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    setNotice(null);
    const targets = candidates
      .filter((entry) => picked.has(entry.contactId))
      .map((entry) => ({
        contactId: entry.contactId,
        name: entry.name,
        method: channels[entry.contactId] ?? entry.method,
      }));

    const outcome = await send(targets);
    if (outcome.failed.length > 0) {
      const first = outcome.failed[0];
      setNotice(
        outcome.failed.length === 1
          ? `Không mời được ${first.name}: ${first.reason}`
          : `Đã gửi ${outcome.sent} lời mời. ${outcome.failed.length} người chưa gửi được — mở từng liên hệ để thử lại.`,
      );
      if (outcome.sent === 0) return;
    }
    onDone(outcome);
  }, [candidates, picked, channels, send, onDone]);

  if (candidates.length === 0) {
    return (
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Không có ai để mời trong lần nhập này — những liên hệ vừa thêm đều là doanh nghiệp, đã dùng
        AVORA, hoặc chưa có số điện thoại và email.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {candidates.length} người chưa dùng AVORA. Bỏ tick những ai bạn chưa muốn mời.
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
                disabled={isSending}
                aria-label={`Mời ${entry.name}`}
              />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                {entry.name}
              </span>

              {/* Only the channels this person actually has an address for are drawn. */}
              <span className="flex shrink-0 items-center gap-1">
                {entry.methods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={isSending || !isPicked}
                    aria-pressed={channel === method}
                    onClick={() =>
                      setChannels((current) => ({ ...current, [entry.contactId]: method }))
                    }
                    className={cn(
                      "press inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-45",
                      channel === method
                        ? "border-primary/60 bg-accent/60 text-accent-foreground"
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

      {notice !== null ? (
        <p role="alert" className="mt-3 text-[13px] text-primary">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onDone({ sent: 0, failed: [] })}
          className="press text-[13.5px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Để sau
        </button>
        <Button className="press h-10 px-5" disabled={picked.size === 0 || isSending} onClick={() => void submit()}>
          <Send className="mr-1.5 h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          {isSending && progress !== null
            ? `Đang gửi ${progress.done}/${progress.total}…`
            : `Gửi lời mời cho ${picked.size} người`}
        </Button>
      </div>
    </div>
  );
}
