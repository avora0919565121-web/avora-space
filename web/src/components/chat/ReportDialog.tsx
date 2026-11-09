import { Ban, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import {
  REPORT_CONSENT_TEXT,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  reportPreview,
  submitReport,
  type ReportKind,
  type ReportReason,
} from "@/lib/reports";
import { useBlocks } from "@/lib/use-blocks";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

export type ReportTarget = {
  /** 111-B · defaults to "message" when `message` is set, else "user". */
  kind?: ReportKind;
  /** Null for a group (no single person is reported). */
  userId: string | null;
  name: string;
  conversationId: string | null;
  /** Present when one message is being reported. */
  message: { id: string; content: string } | null;
  /** Files the sender attached to that message: each can be reported on its own. */
  files?: { id: string; name: string }[];
  /** Kind "group": the group's conversation. */
  groupId?: string | null;
};

/**
 * Báo cáo a person, one of their messages or files, their picture, or a whole group (111-B).
 *
 * When a message is reported its first lines are shown next to the consent sentence, so the
 * reporter sees exactly what leaves the conversation. Only that one message travels, and the
 * server copies it itself. After sending, "Đã nhận báo cáo" offers to block the person too.
 */
export function ReportDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ReportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isOnline = useOnline();
  const { isBlocked, block, isWorking: isBlocking } = useBlocks();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState<string>("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSent, setIsSent] = useState<boolean>(false);
  const [didBlock, setDidBlock] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    setFileId(null);
    setIsSending(false);
    setIsSent(false);
    setDidBlock(false);
  }, [open]);

  if (target === null) return null;

  const baseKind: ReportKind = target.kind ?? (target.message !== null ? "message" : "user");
  const kind: ReportKind = fileId !== null ? "file" : baseKind;
  const files = target.files ?? [];
  const canSubmit = reason !== null && note.length <= REPORT_NOTE_MAX && isOnline && !isSending;
  const preview = target.message !== null ? reportPreview(target.message.content) : "";
  const title =
    baseKind === "group"
      ? `Báo cáo nhóm ${target.name}`
      : baseKind === "avatar"
        ? "Báo cáo ảnh đại diện"
        : target.message !== null
          ? "Báo cáo tin nhắn"
          : `Báo cáo ${target.name}`;
  const canOfferBlock = target.userId !== null && !isBlocked(target.userId);

  const send = async (): Promise<void> => {
    if (reason === null) return;
    setIsSending(true);
    try {
      await submitReport({
        kind,
        reportedUserId: baseKind === "group" ? null : target.userId,
        groupId: baseKind === "group" ? target.groupId ?? target.conversationId : null,
        fileId,
        reason,
        note,
        conversationId: baseKind === "avatar" ? null : target.conversationId,
        messageId: kind === "message" ? target.message?.id ?? null : null,
        includeMessage: kind === "message" && target.message !== null,
        alsoBlock: false,
      });
      setIsSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa gửi được báo cáo. Vui lòng thử lại.");
    } finally {
      setIsSending(false);
    }
  };

  if (isSent) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[420px] gap-0 rounded-card border-border bg-card p-0" data-report-received="">
          <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <DialogTitle className="mt-3 text-[18px] font-semibold tracking-tight text-foreground">Đã nhận báo cáo</DialogTitle>
            <DialogDescription className="mt-1.5 text-[13.5px] leading-5 text-muted-foreground">
              Cảm ơn bạn. Avora sẽ xem xét và báo lại khi đã xử lý.
              {target.userId !== null ? ` ${target.name} không biết ai đã báo cáo.` : ""}
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
            {didBlock ? (
              <p className="text-center text-[13px] text-muted-foreground">Đã chặn {target.name}.</p>
            ) : canOfferBlock && target.userId !== null ? (
              <button
                type="button"
                disabled={isBlocking || !isOnline}
                onClick={() => {
                  const id = target.userId;
                  if (id === null) return;
                  void block(id)
                    .then(() => setDidBlock(true))
                    .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa chặn được."));
                }}
                className="press flex h-11 items-center justify-center gap-2 rounded-[10px] border border-destructive/40 px-4 text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
              >
                {isBlocking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
                Chặn {target.name}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="press h-11 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Xong
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[460px] gap-0 overflow-y-auto rounded-card border-border bg-card p-0">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {baseKind === "group"
              ? "Avora sẽ xem xét nhóm này. Các thành viên không được biết ai báo cáo."
              : `Avora sẽ xem xét. ${target.name} không nhận thông báo nào.`}
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
                  className="h-4 w-4 accent-personal"
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
            className="mt-1.5 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[16px] md:text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-personal/60"
          />
        </div>

        {files.length > 0 ? (
          <fieldset className="mx-5 mt-3 space-y-1" data-report-file-choice="">
            <legend className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Báo cáo phần nào</legend>
            {[{ id: null as string | null, name: "Cả tin nhắn" }, ...files].map((file) => (
              <label key={file.id ?? "message"} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[14px] text-foreground">
                <input
                  type="radio"
                  name="report-file"
                  checked={fileId === file.id}
                  onChange={() => setFileId(file.id)}
                  className="h-4 w-4 accent-personal"
                />
                <span className="min-w-0 truncate">{file.id === null ? file.name : `Tệp: ${file.name}`}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {target.message !== null && kind === "message" ? (
          <div className="mx-5 mt-3 rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-foreground">{REPORT_CONSENT_TEXT}</p>
            <p className="mt-1.5 line-clamp-2 whitespace-pre-line border-l-2 border-primary/50 pl-2 text-[13px] leading-5 text-muted-foreground">
              {preview === "" ? "(tin chỉ có tệp đính kèm)" : preview}
            </p>
          </div>
        ) : null}

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
            onClick={() => void send()}
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Gửi báo cáo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
