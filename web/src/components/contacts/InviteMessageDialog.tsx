import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  cleanInviteMessage,
  INVITE_MESSAGE_HINT,
  INVITE_MESSAGE_MAX,
  inviteMessageProblem,
} from "@/lib/invite-message";
import { cn } from "@/lib/utils";

type InviteMessageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who the request goes to, as the viewer knows them (a PIN or a name). */
  recipientLabel: string;
  /** Sends the request; rejects with a Vietnamese sentence. */
  onSend: (message: string) => Promise<void>;
};

/**
 * The one step every friend request goes through (AVORA-56 · A): PIN, QR and "Từ nhóm".
 *
 * Without a message the request does not open — the server refuses it too. The message becomes
 * the first line of the pending frame, so the person asked knows who is knocking before
 * deciding anything.
 */
export function InviteMessageDialog({ open, onOpenChange, recipientLabel, onSend }: InviteMessageDialogProps) {
  const [message, setMessage] = useState<string>("");
  const [problem, setProblem] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  useEffect(() => {
    if (open) return;
    setMessage("");
    setProblem(null);
    setIsSending(false);
  }, [open]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const found = inviteMessageProblem(message);
      if (found !== null) {
        setProblem(found);
        return;
      }
      setIsSending(true);
      try {
        await onSend(cleanInviteMessage(message));
      } catch (error) {
        setProblem(error instanceof Error ? error.message : "Chưa gửi được. Thử lại nhé.");
      } finally {
        setIsSending(false);
      }
    },
    [message, onSend],
  );

  const length = cleanInviteMessage(message).length;

  return (
    <Dialog open={open} onOpenChange={(next) => (isSending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-[440px] gap-0 rounded-xl border-border bg-card p-0">
        <form onSubmit={(event) => void handleSubmit(event)} className="px-5 pb-5 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight">Lời mời kết bạn</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-relaxed">
            Gửi tới <span className="font-medium text-foreground">{recipientLabel}</span>. Lời nhắn là tin đầu tiên họ thấy.
          </DialogDescription>
          <label className="mt-4 block">
            <span className="text-[13px] font-medium text-foreground">Lời nhắn</span>
            <textarea
              value={message}
              autoFocus
              rows={3}
              lang="vi"
              spellCheck
              maxLength={INVITE_MESSAGE_MAX + 40}
              onChange={(event) => {
                setMessage(event.target.value);
                setProblem(null);
              }}
              placeholder={INVITE_MESSAGE_HINT}
              className="mt-1.5 block w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[15px] leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
          <div className="mt-1.5 flex items-start justify-between gap-3 text-[12px]">
            <span role="status" className={cn("min-w-0", problem !== null ? "text-destructive" : "text-muted-foreground")}>
              {problem ?? "Từ 10 đến 200 ký tự, không kèm đường link."}
            </span>
            <span className={cn("tabular shrink-0", length > INVITE_MESSAGE_MAX ? "text-destructive" : "text-muted-foreground")}>
              {length}/{INVITE_MESSAGE_MAX}
            </span>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSending}
              onClick={() => onOpenChange(false)}
              className="press h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="press inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/92 disabled:opacity-60"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              )}
              Gửi lời mời
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
