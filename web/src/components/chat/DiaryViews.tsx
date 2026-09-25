import { ClipboardPaste, FileText, Loader2, Paperclip } from "lucide-react";

import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { formatClock, formatDayLabel } from "@/lib/chat";
import { DIARY_VIEWS, diaryFileSourceLabel, type DiaryFileNote, type DiaryView } from "@/lib/diary-views";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/**
 * The three readings of Diary, plus the one way in for outside content.
 *
 * Sits below the fixed 📊 Bảng strip and never replaces it: tables are a place, these are views.
 */
export function DiaryViewTabs({
  active,
  onChange,
  counts,
  onPaste,
  isPasting,
}: {
  active: DiaryView;
  onChange: (view: DiaryView) => void;
  counts: Readonly<Record<DiaryView, number | null>>;
  onPaste: () => void;
  isPasting: boolean;
}) {
  return (
    <div className="border-b border-border bg-card px-5 md:px-10">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <div role="tablist" aria-label="Cách đọc Diary" className="-mb-px flex min-w-0 flex-1 overflow-x-auto">
          {DIARY_VIEWS.map((view) => {
            const isActive = view.id === active;
            const count = counts[view.id];
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(view.id)}
                className={cn(
                  "press relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] transition-colors",
                  isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {view.label}
                {count !== null && count > 0 ? (
                  <span className="tabular text-[11px] font-medium text-muted-foreground">{count}</span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-primary transition-opacity",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onPaste}
          disabled={isPasting}
          aria-label="Tạo việc từ nội dung vừa copy"
          title="Tạo việc từ nội dung vừa copy"
          className="press my-1.5 flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/35 bg-primary/[0.07] px-3 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.13] disabled:opacity-50"
        >
          {isPasting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardPaste className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Tạo việc từ nội dung vừa copy</span>
          <span className="sm:hidden">Tạo việc từ bản copy</span>
        </button>
      </div>
    </div>
  );
}

function stamp(iso: string): string {
  return `${formatDayLabel(iso)} · ${formatClock(iso)}`;
}

function EmptyView({ icon: Icon, title, body }: { icon: typeof FileText; title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <p className="mt-4 text-[15px] font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** File của bạn: every photo and file kept in Diary, newest first, each with its note and source. */
export function DiaryFilesView({
  notes,
  urlOf,
  isLoading,
  onOpenNote,
}: {
  notes: readonly DiaryFileNote[];
  urlOf: (storagePath: string) => string | null;
  isLoading: boolean;
  onOpenNote: (messageId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-14" role="status" aria-label="Đang tải tệp">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notes.length === 0) {
    return (
      <EmptyView
        icon={Paperclip}
        title="Chưa có file nào trong Diary"
        body="Ảnh và tệp bạn tải lên, chuyển tiếp vào hoặc dán vào để tạo việc sẽ nằm ở đây, theo thời gian."
      />
    );
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-3">
      {notes.map((entry) => (
        <li key={entry.messageId} className="rounded-[14px] border border-border bg-card p-3.5 animate-bubble-in">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground/80">
              {diaryFileSourceLabel(entry.source)}
            </span>
            <span className="tabular">{stamp(entry.createdAt)}</span>
            {/* A note with words sits in the written timeline too; a bare file lives only here. */}
            {entry.note !== "" ? (
              <button
                type="button"
                onClick={() => onOpenNote(entry.messageId)}
                className="press ml-auto rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                Xem trong Nhật ký
              </button>
            ) : null}
          </div>
          <div className="mt-2.5 max-w-full overflow-hidden">
            <MessageAttachments attachments={entry.attachments} urlOf={urlOf} outgoing={false} />
          </div>
          <p
            className={cn(
              "mt-2.5 whitespace-pre-wrap break-words text-[13.5px] leading-6",
              entry.note === "" ? "italic text-muted-foreground" : "text-foreground",
            )}
          >
            {entry.note === "" ? "Không có ghi chú kèm theo" : entry.note}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Nguồn tạo việc: each personal task made from pasted content, newest first. */
export function DiarySourcesView({
  tasks,
  onOpenTask,
  onPaste,
}: {
  tasks: readonly TaskItem[];
  onOpenTask: (task: TaskItem) => void;
  onPaste: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div>
        <EmptyView
          icon={ClipboardPaste}
          title="Chưa có việc nào tạo từ nội dung dán"
          body="Copy một đoạn chữ, ảnh hay tệp ở bất kỳ đâu rồi dán vào AVORA — việc tạo ra sẽ được ghi lại ở đây kèm nội dung gốc."
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onPaste}
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ClipboardPaste className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Tạo việc từ nội dung vừa copy
          </button>
        </div>
      </div>
    );
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-2.5">
      {tasks.map((task) => {
        const origin = task.contextSnapshot?.origin;
        const preview = origin?.content.trim() ?? "";
        const fileNames = origin?.fileNames ?? [];
        const isDone = task.status === "done";
        return (
          <li key={task.id} className="rounded-[14px] border border-border bg-card px-4 py-3 animate-bubble-in">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-[14.5px] font-semibold",
                    isDone ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {task.title}
                </p>
                <p className="tabular mt-0.5 text-[11.5px] text-muted-foreground">Tạo lúc {stamp(task.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenTask(task)}
                className="press flex h-9 shrink-0 items-center rounded-[9px] border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                Xem việc
              </button>
            </div>
            {preview !== "" ? (
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-2.5 text-[13px] leading-5 text-foreground/80">
                {preview}
              </p>
            ) : null}
            {fileNames.length > 0 ? (
              <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                <span className="truncate">{fileNames.join(" · ")}</span>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

