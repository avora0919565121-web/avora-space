import {
  ChevronRight,
  ClipboardPaste,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { formatClock, formatDayLabel } from "@/lib/chat";
import {
  DIARY_VIEW_PARAM,
  DIARY_VIEWS,
  diaryFileSourceLabel,
  diaryViewSlug,
  type DiaryFileNote,
  type DiaryView,
} from "@/lib/diary-views";
import type { SavedMeetingNote } from "@/lib/meeting-notes";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** What each Diary row holds, in one line under its name. */
const DIARY_HINTS: Readonly<Record<DiaryView, string>> = {
  journal: "Ghi chú chỉ mình bạn đọc được",
  files: "Ảnh và tệp đã lưu vào Diary",
  sources: "Việc tạo từ nội dung bạn dán vào",
};

const DIARY_ICONS: Readonly<Record<DiaryView, LucideIcon>> = {
  journal: NotebookPen,
  files: Paperclip,
  sources: ClipboardPaste,
};

/** The icon a Diary view is shown with, in its row and in the header once it is open. */
export function diaryViewIcon(view: DiaryView): LucideIcon {
  return DIARY_ICONS[view];
}

/** The open Diary reading's icon, in the header beside its name. */
export function DiaryHeaderIcon({ view }: { view: DiaryView }) {
  const Icon = DIARY_ICONS[view];
  return <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />;
}

/**
 * The Nhật ký tab's list: the three readings of Diary as three rows, plus the one way in for
 * outside content.
 *
 * It takes the list column's place on a computer (the open view sits beside it) and is the
 * first screen on a phone, where a row opens its view and the header steps back here.
 * `journalId` is null while the journal is still being created on a first visit.
 */
export function DiaryList({
  journalId,
  active,
  counts,
  isWide,
  onPaste,
  isPasting,
}: {
  journalId: string | null;
  /** The view open beside the list on a computer; nothing is marked on a phone. */
  active: DiaryView | null;
  counts: Readonly<Record<DiaryView, number | null>>;
  isWide: boolean;
  onPaste: () => void;
  isPasting: boolean;
}) {
  return (
    <div className="px-3 pb-6">
      <ul aria-label="Nhật ký">
        {DIARY_VIEWS.map((view) => {
          const Icon = DIARY_ICONS[view.id];
          const count = counts[view.id];
          const isActive = isWide && view.id === active;
          return (
            <li key={view.id}>
              {journalId === null ? (
                <span className="flex items-center gap-3 px-3 py-3" aria-hidden="true">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-secondary" />
                  <span className="block h-3.5 w-2/5 animate-pulse rounded bg-secondary" />
                </span>
              ) : (
                <Link
                  to={`/tin-nhan/${journalId}?${DIARY_VIEW_PARAM}=${diaryViewSlug(view.id)}`}
                  // A computer swaps the view beside the list; a phone steps into it, so back returns here.
                  replace={isWide}
                  state={{ fromDiaryList: true }}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 transition-colors",
                    isActive ? "bg-accent/70" : "hover:bg-accent/35",
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <Icon className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      {view.label}
                      {count !== null ? (
                        <span className="tabular ml-1.5 text-[13px] font-medium text-muted-foreground">({count})</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{DIARY_HINTS[view.id]}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" strokeWidth={1.8} aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onPaste}
          disabled={isPasting || journalId === null}
          className="press flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary/35 bg-primary/[0.07] px-4 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[0.13] disabled:opacity-50"
        >
          {isPasting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardPaste className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          Tạo việc từ nội dung vừa copy
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
  meetingNotes = [],
  urlOf,
  isLoading,
  onOpenNote,
}: {
  notes: readonly DiaryFileNote[];
  /** Diary notes posted by "Lưu vào Nhật ký" — a finalized meeting note, by link, never a copy. */
  meetingNotes?: readonly (SavedMeetingNote & { messageId: string; createdAt: string })[];
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
  if (notes.length === 0 && meetingNotes.length === 0) {
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
      {meetingNotes.map((ref) => (
        <li key={ref.messageId} className="rounded-[14px] border border-border bg-card p-3.5 animate-bubble-in">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground/80">
              Từ Sổ quyết định
            </span>
            <span className="tabular">{stamp(ref.createdAt)}</span>
            <button
              type="button"
              onClick={() => onOpenNote(ref.messageId)}
              className="press ml-auto rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              Xem trong Nhật ký
            </button>
          </div>
          <div className="mt-2.5 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-primary/30 bg-primary/10 text-primary">
              <ScrollText className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold text-foreground">{ref.title}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                {[ref.groupLine, ref.fileName === null ? null : `Mẫu riêng: ${ref.fileName}`]
                  .filter((part): part is string => part !== null && part !== "")
                  .join(" · ")}
              </p>
            </div>
            <Link
              to={ref.href}
              className="press flex h-9 shrink-0 items-center rounded-[9px] border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Mở biên bản
            </Link>
          </div>
        </li>
      ))}
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

