import { FileText, Mic, Paperclip, Square, X } from "lucide-react";

import {
  formatDuration,
  formatFileSize,
  MAX_ATTACHMENTS_PER_MESSAGE,
  permissionLabel,
  type AttachmentPermission,
  type StagedAttachment,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";

/** The three rungs, in the order they widen. */
const PERMISSIONS: readonly AttachmentPermission[] = ["view", "forward", "export"];

export type StagedAttachmentBarProps = {
  items: readonly StagedAttachment[];
  onRemove: (localId: string) => void;
  onPermissionChange: (localId: string, permission: AttachmentPermission) => void;
  isSending: boolean;
};

/**
 * Files chosen but not yet sent.
 *
 * Shown as real thumbnails rather than a count, because "3 tệp" is not enough to notice you
 * attached the wrong screenshot. Each one carries its own permission: the decision belongs to
 * the file, not to the message, and it is made here — before sending — while it still costs
 * nothing to change.
 */
export function StagedAttachmentBar({
  items,
  onRemove,
  onPermissionChange,
  isSending,
}: StagedAttachmentBarProps) {
  if (items.length === 0) return null;

  return (
    <div className="mx-auto mb-2 max-w-2xl">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item.localId}
            className="relative flex w-[172px] flex-col gap-1.5 rounded-[10px] border border-border bg-card p-2"
          >
            <div className="flex items-center gap-2">
              {item.kind === "image" && item.previewUrl !== null ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-[7px] object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[7px] bg-secondary text-muted-foreground">
                  {item.kind === "voice" ? (
                    <Mic className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground" title={item.fileName}>
                  {item.kind === "voice" ? "Tin nhắn thoại" : item.fileName}
                </p>
                <p className="text-[10.5px] text-muted-foreground">
                  {item.kind === "voice"
                    ? formatDuration(item.durationSeconds)
                    : formatFileSize(item.byteSize)}
                </p>
              </div>
            </div>

            {/*
              Set before sending, because afterwards it is too late to mean anything — the
              other person already has the file.
            */}
            <div className="flex overflow-hidden rounded-[7px] border border-border">
              {PERMISSIONS.map((permission) => (
                <button
                  key={permission}
                  type="button"
                  disabled={isSending}
                  onClick={() => onPermissionChange(item.localId, permission)}
                  aria-pressed={item.permission === permission}
                  title={permissionLabel(permission)}
                  className={cn(
                    "flex-1 px-1 py-1 text-[10px] font-medium transition-colors",
                    item.permission === permission
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {permissionLabel(permission)}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.localId)}
              disabled={isSending}
              aria-label={`Bỏ ${item.fileName}`}
              className="press absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {items.length >= MAX_ATTACHMENTS_PER_MESSAGE ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Đã đủ {MAX_ATTACHMENTS_PER_MESSAGE} tệp cho một tin nhắn.
        </p>
      ) : null}
    </div>
  );
}

export type AttachActionsProps = {
  onPickFiles: () => void;
  isRecording: boolean;
  elapsedSeconds: number;
  canRecord: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  disabled: boolean;
};

/**
 * The paperclip and the microphone.
 *
 * While recording, both are replaced by a stop button and a running clock — a recording that
 * looks the same as not-recording is how people send thirty seconds of a room they thought
 * was private.
 */
export function AttachActions({
  onPickFiles,
  isRecording,
  elapsedSeconds,
  canRecord,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  disabled,
}: AttachActionsProps) {
  if (isRecording) {
    return (
      <div className="flex h-12 shrink-0 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
        <span className="text-[13px] tabular-nums text-foreground" aria-live="polite">
          {formatDuration(elapsedSeconds)}
        </span>
        <button
          type="button"
          onClick={onStopRecording}
          aria-label="Dừng và đính kèm bản ghi"
          className="press ml-0.5 rounded-[7px] bg-primary p-1.5 text-primary-foreground"
        >
          <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onCancelRecording}
          aria-label="Huỷ bản ghi"
          className="press rounded-[7px] p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPickFiles}
        disabled={disabled}
        aria-label="Đính kèm ảnh hoặc tệp"
        title="Đính kèm ảnh hoặc tệp"
        className="press flex h-12 w-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-45"
      >
        <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
      </button>
      {canRecord ? (
        <button
          type="button"
          onClick={onStartRecording}
          disabled={disabled}
          aria-label="Ghi âm tin nhắn thoại"
          title="Ghi âm tin nhắn thoại"
          className="press flex h-12 w-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-45"
        >
          <Mic className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
