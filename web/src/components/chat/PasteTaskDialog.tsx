import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, FileText, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";

import { TaskCard } from "@/components/tasks/TaskCard";
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
import { buildPasteSnapshot, isPasteEmpty, pasteFromDataTransfer, type PastedContent } from "@/lib/paste-intake";
import type { ContextMessage } from "@/lib/task-context";
import { useComposerActions } from "@/lib/use-task-composer";
import { cn } from "@/lib/utils";

type PasteTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journalId: string;
  journalName: string;
  /** What the clipboard held when the button was pressed; null when it could not be read. */
  initialPaste: PastedContent | null;
};

function releasePreviews(items: readonly StagedAttachment[]): void {
  for (const item of items) if (item.previewUrl !== null) URL.revokeObjectURL(item.previewUrl);
}

/**
 * Tạo việc from something copied outside AVORA — the one task form (ADR-030) with a paste Nguồn.
 *
 * Only "Cho tôi". Words go into Ghi chú; photos and files are kept once as a Nhật ký note that the
 * task points at. The paste area (drop more in, remove a file) lives in the Nguồn line.
 */
export function PasteTaskDialog({ open, onOpenChange, journalId, journalName, initialPaste }: PasteTaskDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { createPersonal } = useComposerActions();
  const [pastedText, setPastedText] = useState<string>("");
  const [files, setFiles] = useState<StagedAttachment[]>([]);
  const filesRef = useRef<StagedAttachment[]>([]);
  filesRef.current = files;
  const appendRef = useRef<((text: string) => void) | null>(null);
  const pendingTextRef = useRef<string>("");

  const takePaste = async (paste: PastedContent): Promise<void> => {
    if (paste.text.trim() !== "") {
      setPastedText((current) => (current === "" ? paste.text : `${current}\n\n${paste.text}`));
      if (appendRef.current !== null) appendRef.current(paste.text);
      else pendingTextRef.current = pendingTextRef.current === "" ? paste.text : `${pendingTextRef.current}\n\n${paste.text}`;
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
      pendingTextRef.current = "";
      appendRef.current = null;
      return;
    }
    if (initialPaste !== null && !isPasteEmpty(initialPaste)) void takePaste(initialPaste);
    // Only on opening: the paste handed over by the button is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const removeFile = (localId: string): void => {
    setFiles((current) => {
      releasePreviews(current.filter((item) => item.localId === localId));
      return current.filter((item) => item.localId !== localId);
    });
  };

  const images = files.filter((item) => item.kind === "image").length;
  const others = files.length - images;
  const counts = [images > 0 ? `${images} ảnh` : null, others > 0 ? `${others} tệp` : null].filter(Boolean).join(", ");

  return (
    <TaskCard
      open={open}
      onOpenChange={onOpenChange}
      place="personal"
      source={{
        label: `Từ nội dung dán${counts === "" ? "" : ` · ${counts}`}`,
        defaultOpen: true,
        render: ({ appendNote }) => {
          appendRef.current = appendNote;
          if (pendingTextRef.current !== "") {
            const text = pendingTextRef.current;
            pendingTextRef.current = "";
            queueMicrotask(() => appendNote(text));
          }
          return (
            <PasteZone
              hasPaste={pastedText.trim() !== "" || files.length > 0}
              textLength={pastedText.trim().length}
              files={files}
              onPaste={(event) => {
                event.preventDefault();
                void takePaste(pasteFromDataTransfer(event.clipboardData));
              }}
              onRemove={removeFile}
            />
          );
        },
      }}
      onCreateMine={async (values) => {
        if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
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
        const snapshot = buildPasteSnapshot({
          journalId,
          journalName,
          text: pastedText,
          fileNames: files.map((item) => item.fileName),
          fileNote,
          description: values.description,
        });
        return createPersonal(user.id, values, snapshot);
      }}
    />
  );
}

function PasteZone({
  hasPaste,
  textLength,
  files,
  onPaste,
  onRemove,
}: {
  hasPaste: boolean;
  textLength: number;
  files: readonly StagedAttachment[];
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemove: (localId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {/* A real text box, so a phone offers its own "Dán" on a long press. Nothing is typed into it. */}
      <textarea
        aria-label="Dán nội dung vào đây"
        value=""
        onChange={() => undefined}
        onPaste={onPaste}
        rows={hasPaste ? 1 : 2}
        placeholder={hasPaste ? "Dán thêm vào đây" : "Dán vào đây — ⌘V / Ctrl+V, hoặc giữ để dán trên điện thoại"}
        className="w-full resize-none rounded-[10px] border border-dashed border-input bg-card px-3 py-2.5 text-center text-[16px] md:text-[13px] leading-5 text-foreground caret-transparent outline-none placeholder:text-muted-foreground"
      />
      {textLength > 0 ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <ClipboardPaste className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          {textLength.toLocaleString("vi-VN")} ký tự — đã điền vào Ghi chú
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Ảnh và tệp dán vào">
          {files.map((item) => (
            <li key={item.localId} className="flex w-[160px] max-w-full items-center gap-2 rounded-[10px] border border-border bg-card p-1.5 pr-1">
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
                onClick={() => onRemove(item.localId)}
                className={cn("press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50")}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[12px] text-muted-foreground">Ảnh và tệp được giữ trong Nhật ký, gắn với việc này.</p>
    </div>
  );
}
