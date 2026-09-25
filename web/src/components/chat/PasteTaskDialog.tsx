import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, FileText, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { CalendarPeekButton } from "@/components/tasks/CalendarPeekSheet";
import { TimeField } from "@/components/tasks/TimeField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAutoList } from "@/hooks/use-auto-list";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import {
  attachmentKeys,
  MAX_ATTACHMENTS_PER_MESSAGE,
  sendMessageWithAttachments,
  stageAttachment,
  uploadStagedAttachment,
  type StagedAttachment,
} from "@/lib/attachments";
import { useAuth } from "@/lib/auth";
import { chatKeys } from "@/lib/chat";
import {
  buildPasteSnapshot,
  descriptionFromPaste,
  isPasteEmpty,
  pasteFromDataTransfer,
  type PastedContent,
} from "@/lib/paste-intake";
import type { ContextMessage } from "@/lib/task-context";
import { isTaskDraftComplete, todayIso, validateTaskDraft, type TaskDraft } from "@/lib/tasks";
import { useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground";

const EMPTY_DRAFT: TaskDraft = { title: "", description: "", deadline: "" };

type PasteTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journalId: string;
  journalName: string;
  /** What the clipboard held when the button was pressed; null when it could not be read. */
  initialPaste: PastedContent | null;
};

/**
 * A personal task from something copied outside AVORA.
 *
 * AVORA only sorts what was pasted: words go into Mô tả, photos and files are kept once as a
 * Diary note. The title and deadline stay empty for the person to write, and nothing is saved
 * until they press the button.
 */
export function PasteTaskDialog({ open, onOpenChange, journalId, journalName, initialPaste }: PasteTaskDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addPersonal } = useTaskActions();
  const today = todayIso();
  const { isSubmitting, guard } = useSubmitGuard();

  const [pastedText, setPastedText] = useState<string>("");
  const [files, setFiles] = useState<StagedAttachment[]>([]);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [deadlineTime, setDeadlineTime] = useState<string>("");
  const [isTrimmed, setIsTrimmed] = useState<boolean>(false);
  const filesRef = useRef<StagedAttachment[]>([]);
  filesRef.current = files;
  const descriptionRef = useRef<string>("");
  descriptionRef.current = draft.description;

  const descriptionKeyDown = useAutoList((next) => setDraft((current) => ({ ...current, description: next })));

  const releasePreviews = (items: readonly StagedAttachment[]): void => {
    for (const item of items) if (item.previewUrl !== null) URL.revokeObjectURL(item.previewUrl);
  };

  const takePaste = async (paste: PastedContent): Promise<void> => {
    if (paste.text.trim() !== "") {
      setPastedText((current) => (current === "" ? paste.text : `${current}\n\n${paste.text}`));
      // A second paste is added below whatever the description already says, edits included.
      const existing = descriptionRef.current.trim();
      const filled = descriptionFromPaste(existing === "" ? paste.text : `${existing}\n\n${paste.text}`);
      setIsTrimmed(filled.isTrimmed);
      setDraft((current) => ({ ...current, description: filled.description }));
    }
    const room = MAX_ATTACHMENTS_PER_MESSAGE - filesRef.current.length;
    if (paste.files.length > room) toast.error(`Chỉ giữ được tối đa ${MAX_ATTACHMENTS_PER_MESSAGE} tệp cho một việc.`);
    for (const file of paste.files.slice(0, Math.max(0, room))) {
      try {
        const staged = await stageAttachment(file);
        setFiles((current) => [...current, staged]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không giữ được tệp này.");
      }
    }
  };

  useEffect(() => {
    if (!open) {
      releasePreviews(filesRef.current);
      setFiles([]);
      setPastedText("");
      setDraft(EMPTY_DRAFT);
      setDeadlineTime("");
      setIsTrimmed(false);
      return;
    }
    if (initialPaste !== null && !isPasteEmpty(initialPaste)) void takePaste(initialPaste);
    // Only on opening: the paste handed over by the button is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPasteZone = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    event.preventDefault();
    void takePaste(pasteFromDataTransfer(event.clipboardData));
  };

  const removeFile = (localId: string): void => {
    setFiles((current) => {
      releasePreviews(current.filter((item) => item.localId === localId));
      return current.filter((item) => item.localId !== localId);
    });
  };

  const hasPaste = pastedText.trim() !== "" || files.length > 0;
  const isWorking = isSubmitting || addPersonal.isPending;
  const complete = hasPaste && isTaskDraftComplete(draft);

  const save = async (): Promise<void> => {
    if (user?.id === undefined) {
      toast.error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      return;
    }
    const clean = validateTaskDraft({ ...draft, deadlineTime }, today);
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return;
    }

    try {
      // Files are kept once, as one Diary note, and the task points at that note.
      let fileNote: ContextMessage | null = null;
      if (files.length > 0) {
        const uploaded = [];
        for (const item of files) uploaded.push(await uploadStagedAttachment(journalId, item));
        const sent = await sendMessageWithAttachments({ conversationId: journalId, content: "", attachments: uploaded });
        fileNote = { id: sent.id, senderId: user.id, content: "", createdAt: sent.createdAt };
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(journalId) });
        void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(journalId) });
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      }

      const contextSnapshot = buildPasteSnapshot({
        journalId,
        journalName,
        text: pastedText,
        fileNames: files.map((item) => item.fileName),
        fileNote,
        description: clean.value.description,
      });

      await addPersonal.mutateAsync({
        userId: user.id,
        draft: {
          title: clean.value.title,
          description: clean.value.description,
          deadline: clean.value.deadline,
          deadlineTime: clean.value.deadlineTime,
        },
        contextSnapshot,
      });
      toast.success("Đã tạo việc từ nội dung bạn dán.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tạo được việc. Thử lại nhé.");
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // A fast double tap would otherwise upload the files and create the task twice.
    void guard(save);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isWorking ? undefined : onOpenChange(next))}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] max-w-[540px] gap-0 overflow-y-auto rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              Tạo việc từ nội dung vừa copy
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Chữ vào Mô tả, ảnh và tệp được giữ trong Diary. Phần còn lại bạn tự điền.
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            disabled={isWorking}
            onClick={() => onOpenChange(false)}
            className="press -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 pb-5 pt-1 sm:px-6 sm:pb-6">
          <div>
            <label htmlFor="paste-zone" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Nội dung dán vào
            </label>
            {/* A real text box, so a phone offers its own "Dán" on a long press. Nothing is typed into it. */}
            <textarea
              id="paste-zone"
              value=""
              onChange={() => undefined}
              onPaste={onPasteZone}
              rows={hasPaste ? 1 : 3}
              placeholder={hasPaste ? "Dán thêm vào đây" : "Dán vào đây — ⌘V / Ctrl+V, hoặc giữ để dán trên điện thoại"}
              className={cn(
                FIELD_CLASS,
                "resize-none border-dashed bg-secondary/30 py-3 text-center leading-6 caret-transparent",
              )}
            />
            {hasPaste ? (
              <div className="mt-2 space-y-2">
                {pastedText.trim() !== "" ? (
                  <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <ClipboardPaste className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                    {pastedText.trim().length.toLocaleString("vi-VN")} ký tự — đã điền vào Mô tả
                    {isTrimmed ? " (phần quá dài được giữ trong nguồn gốc của việc)" : ""}
                  </p>
                ) : null}
                {files.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Ảnh và tệp dán vào">
                    {files.map((item) => (
                      <li
                        key={item.localId}
                        className="flex w-[160px] max-w-full items-center gap-2 rounded-[10px] border border-border bg-card p-1.5 pr-1"
                      >
                        {item.kind === "image" && item.previewUrl !== null ? (
                          <img src={item.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded-[7px] object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-secondary text-muted-foreground">
                            <FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{item.fileName}</span>
                        <button
                          type="button"
                          aria-label={`Bỏ ${item.fileName}`}
                          onClick={() => removeFile(item.localId)}
                          disabled={isWorking}
                          className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="paste-task-title" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Tiêu đề
            </label>
            <input
              id="paste-task-title"
              value={draft.title}
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Việc cần làm là gì?"
              className={cn(FIELD_CLASS, "h-12")}
            />
          </div>

          <div>
            <label htmlFor="paste-task-description" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Mô tả cụ thể
            </label>
            <textarea
              id="paste-task-description"
              value={draft.description}
              rows={4}
              maxLength={2000}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              onKeyDown={descriptionKeyDown}
              placeholder="Bạn cần gì? Kết quả dự kiến là gì?"
              className={cn(FIELD_CLASS, "resize-y py-2.5 leading-6")}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label htmlFor="paste-task-deadline" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Hạn hoàn thành
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="paste-task-deadline"
                  type="date"
                  value={draft.deadline}
                  min={today}
                  onChange={(event) => setDraft((current) => ({ ...current, deadline: event.target.value }))}
                  className={cn(FIELD_CLASS, "h-12 min-w-0 flex-1 text-[14px]")}
                />
                <CalendarPeekButton
                  label="Xem lịch để chọn ngày hạn"
                  className="h-12 w-12"
                  initialDay={draft.deadline === "" ? null : draft.deadline}
                  onPickDay={(day) => setDraft((current) => ({ ...current, deadline: day }))}
                />
              </div>
            </div>
            <div>
              <label htmlFor="paste-task-time" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Giờ (không bắt buộc)
              </label>
              <TimeField id="paste-task-time" value={deadlineTime} onChange={setDeadlineTime} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={isWorking}
              onClick={() => onOpenChange(false)}
              className="press h-12 rounded-[10px] border border-border px-5 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={!complete || isWorking}
              title={
                complete ? undefined : hasPaste ? "Cần đủ tiêu đề, mô tả và hạn hoàn thành" : "Dán nội dung vào trước đã"
              }
              className="press flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isWorking ? "Đang tạo…" : "Tạo việc"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
