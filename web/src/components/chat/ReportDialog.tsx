import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import {
  REPORT_CONSENT_TEXT,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  reportPreview,
  type ReportReason,
} from "@/lib/reports";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

export type ReportTarget = {
  userId: string;
  name: string;
  conversationId: string | null;
  /** Present when one message is being reported. */
  message: { id: string; content: string } | null;
};

/**
 * Báo cáo a person, or one of their messages.
 *
 * When a message is reported its first lines are shown next to the consent sentence, so the
 * reporter sees exactly what leaves the conversation. Only that one message travels, and the
 * server copies it itself. "Chặn luôn" starts on: someone reporting harm usually wants it to stop.
 */
export function ReportDialog({
  target,
  open,
  onOpenChange,
  isBlockedAlready,
  onSubmit,
  isWorking,
}: {
  target: ReportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the viewer already blocked this person: the switch is then pointless. */
  isBlockedAlready: boolean;
  onSubmit: (input: { reason: ReportReason; note: string; alsoBlock: boolean }) => void;
  isWorking: boolean;
}) {
  const isOnline = useOnline();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState<string>("");
  const [alsoBlock, setAlsoBlock] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    setAlsoBlock(true);
  }, [open]);

  if (target === null) return null;

  const canSubmit = reason !== null && note.length <= REPORT_NOTE_MAX && isOnline && !isWorking;
  const preview = target.message !== null ? reportPreview(target.message.content) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[460px] gap-0 overflow-y-auto rounded-xl border-border bg-card p-0">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            {target.message !== null ? "Báo cáo tin nhắn" : `Báo cáo ${target.name}`}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
            AVORA sẽ xem xét. {target.name} không nhận thông báo nào.
          </DialogDescription>
        </div>

        <fieldset className="space-y-1.5 px-5">
          <legend className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lý do
          </legend>
          {REPORT_REASONS.map((option) => {
            const active = reason === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "press flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 transition-colors",
                  active ? "border-primary/60 bg-primary/5" : "border-border bg-background/50 hover:bg-accent/30",
                )}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={option.value}
                  checked={active}
                  onChange={() => setReason(option.value)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-[14px] text-foreground">{option.label}</span>
              </label>
            );
          })}
        </fieldset>

        <div className="px-5 pt-4">
          <label htmlFor="report-note" className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ghi chú <span className="font-normal normal-case">(không bắt buộc)</span>
          </label>
          <textarea
            id="report-note"
            value={note}
            rows={2}
            maxLength={REPORT_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Điều gì đã xảy ra?"
            className="mt-1.5 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
        </div>

        {target.message !== null ? (
          <div className="mx-5 mt-3 rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-foreground">{REPORT_CONSENT_TEXT}</p>
            <p className="mt-1.5 line-clamp-2 whitespace-pre-line border-l-2 border-primary/50 pl-2 text-[13px] leading-5 text-muted-foreground">
              {preview === "" ? "(tin chỉ có tệp đính kèm)" : preview}
            </p>
          </div>
        ) : null}

        {isBlockedAlready ? null : (
          <label className="mx-5 mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="text-[14px] font-medium text-foreground">Chặn {target.name}</span>
            <Switch checked={alsoBlock} onCheckedChange={setAlsoBlock} aria-label={`Chặn ${target.name}`} />
          </label>
        )}

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
          {!isOnline ? <span className="mr-auto text-[12.5px] text-muted-foreground">{NEEDS_NETWORK_MESSAGE}</span> : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="press h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
          >
            Huỷ
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (reason === null) return;
              onSubmit({ reason, note, alsoBlock: !isBlockedAlready && alsoBlock });
            }}
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Gửi báo cáo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
