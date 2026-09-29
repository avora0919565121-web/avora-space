import { Clock, ListPlus, Mic, Paperclip, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The one "+" left of the message box: attach a file, record a voice note, or turn the talk into
 * a task. Folded together so the composer keeps its width for the words; the calendar stays
 * outside this menu on purpose, because it is looked at, not chosen.
 */
export function ComposerPlusMenu({
  onPickFiles,
  onStartRecording,
  canRecord,
  onCreateTask,
  createTaskLabel,
  disabled,
  schedule,
}: {
  /** "Gửi hẹn giờ" (B2). Absent in the journal and a verification frame. `note` dims it with a reason. */
  schedule?: { onSelect: () => void; note: string | null };
  onPickFiles: () => void;
  onStartRecording: () => void;
  canRecord: boolean;
  onCreateTask: () => void;
  createTaskLabel: string;
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Thêm: đính kèm, ghi âm, tạo nhiệm vụ"
          title="Đính kèm, ghi âm hoặc tạo nhiệm vụ"
          className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent/50 disabled:opacity-45 data-[state=open]:bg-accent/60"
        >
          <Plus className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[220px]">
        <DropdownMenuItem onSelect={onPickFiles} className="min-h-11 gap-2.5 text-[14px]">
          <Paperclip className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Đính kèm ảnh hoặc tệp
        </DropdownMenuItem>
        {canRecord ? (
          <DropdownMenuItem onSelect={onStartRecording} className="min-h-11 gap-2.5 text-[14px]">
            <Mic className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Ghi âm tin nhắn thoại
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onCreateTask} className="min-h-11 gap-2.5 text-[14px]">
          <ListPlus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {createTaskLabel}
        </DropdownMenuItem>
        {schedule !== undefined ? (
          <DropdownMenuItem
            onSelect={schedule.note === null ? schedule.onSelect : (event) => event.preventDefault()}
            aria-disabled={schedule.note !== null}
            className={`min-h-11 gap-2.5 text-[14px] ${schedule.note !== null ? "opacity-50" : ""}`}
          >
            <Clock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            <span className="flex flex-col">
              Gửi hẹn giờ
              {schedule.note !== null ? <span className="text-[11.5px] text-muted-foreground">{schedule.note}</span> : null}
            </span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
