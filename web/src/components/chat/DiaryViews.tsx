import {
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  NotebookPen,
  NotebookText,
  Paperclip,
  ScrollText,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { MessageAttachments } from "@/components/chat/MessageAttachments";
import type { MessageAttachment } from "@/lib/attachments";
import { formatClock, formatDayLabel } from "@/lib/chat";
import {
  DIARY_VIEW_PARAM,
  DIARY_VIEWS,
  diaryFileSourceLabel,
  diaryViewSlug,
  type DiaryFileNote,
  type DiaryLink,
  type DiaryView,
} from "@/lib/diary-views";
import type { SavedMeetingNote } from "@/lib/meeting-notes";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** What each Nhật ký view holds, in one line under its name. */
const DIARY_HINTS: Readonly<Record<DiaryView, string>> = {
  journal: "Ý nghĩ, thu nhanh, tin chuyển tiếp — chỉ mình bạn đọc",
  notes: "Bài bạn tự viết, xếp theo thư mục",
  files: "Mọi ảnh và tệp trong Nhật ký và Ghi chép",
  links: "Mọi đường link bạn đã lưu",
  sources: "Việc tạo từ Nhật ký",
};

const DIARY_ICONS: Readonly<Record<DiaryView, LucideIcon>> = {
  journal: NotebookPen,
  notes: NotebookText,
  files: Paperclip,
  links: Link2,
  sources: ClipboardPaste,
};

export function diaryViewIcon(view: DiaryView): LucideIcon {
  return DIARY_ICONS[view];
}

export function DiaryHeaderIcon({ view }: { view: DiaryView }) {
  const Icon = DIARY_ICONS[view];
  return <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />;
}

export type DiaryCounts = Readonly<Record<DiaryView, number | null>>;
export type DiaryDots = Readonly<Partial<Record<DiaryView, boolean>>>;

/**
 * The count row (A.2): always on top, and the one way to switch view. On a phone it scrolls
 * sideways and keeps the open view in sight.
 */
export function DiaryCountRow({
  journalId,
  active,
  counts,
  dots,
}: {
  journalId: string;
  active: DiaryView;
  counts: DiaryCounts;
  dots: DiaryDots;
}) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <nav aria-label="Các mục Nhật ký" className="border-b border-border bg-card/80">
      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2 md:px-8">
        {DIARY_VIEWS.map((view) => {
          const isActive = view.id === active;
          const count = counts[view.id];
          const Icon = DIARY_ICONS[view.id];
          return (
            <li key={view.id} className="shrink-0">
              <Link
                ref={isActive ? activeRef : undefined}
                to={`/tin-nhan/${journalId}?${DIARY_VIEW_PARAM}=${diaryViewSlug(view.id)}`}
                replace
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "press relative flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-accent/40",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                <span>{view.short}</span>
                {count !== null ? (
                  <span className={cn("tabular text-[12px]", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {count}
                  </span>
                ) : null}
                {dots[view.id] === true && !isActive ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="có mục mới" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The Nhật ký tab's list on a computer: the five views as rows, with counts. A phone never rests
 * here — it opens the view used last, with the count row on top.
 */
export function DiaryList({
  journalId,
  active,
  counts,
  dots = {},
  isWide,
  onPaste,
  isPasting,
}: {
  journalId: string | null;
  active: DiaryView | null;
  counts: DiaryCounts;
  dots?: DiaryDots;
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
                  replace={isWide}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 transition-colors",
                    isActive ? "bg-accent/70" : "hover:bg-accent/35",
                  )}
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <Icon className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
                    {dots[view.id] === true && !isActive ? (
                      <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" aria-label="có mục mới" />
                    ) : null}
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

function SourceTag({ children }: { children: string }) {
  return <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground/80">{children}</span>;
}

function RowAction({ onClick, children, danger = false, label }: { onClick: () => void; children: React.ReactNode; danger?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "press inline-flex min-h-8 items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
        danger ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A file kept in a Ghi chép: shown here, deleted only inside the note (A.5). */
export type NoteFileRow = {
  id: string;
  noteId: string;
  noteTitle: string;
  attachment: MessageAttachment;
  createdAt: string;
};

/** File của tôi: every photo and file, newest first, each with its caption and where it lives. */
export function DiaryFilesView({
  notes,
  meetingNotes = [],
  noteFiles = [],
  urlOf,
  noteUrlOf,
  isLoading,
  onOpenNote,
  onOpenWriting,
  onDelete,
}: {
  notes: readonly DiaryFileNote[];
  meetingNotes?: readonly (SavedMeetingNote & { messageId: string; createdAt: string })[];
  noteFiles?: readonly NoteFileRow[];
  urlOf: (storagePath: string) => string | null;
  noteUrlOf?: (storagePath: string) => string | null;
  isLoading: boolean;
  onOpenNote: (messageId: string) => void;
  onOpenWriting?: (noteId: string) => void;
  onDelete: (entry: DiaryFileNote) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-14" role="status" aria-label="Đang tải tệp">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  type Row =
    | { kind: "journal"; at: string; entry: DiaryFileNote }
    | { kind: "meeting"; at: string; ref: SavedMeetingNote & { messageId: string; createdAt: string } }
    | { kind: "note"; at: string; file: NoteFileRow };
  const rows: Row[] = [
    ...notes.map((entry): Row => ({ kind: "journal", at: entry.createdAt, entry })),
    ...meetingNotes.map((ref): Row => ({ kind: "meeting", at: ref.createdAt, ref })),
    ...noteFiles.map((file): Row => ({ kind: "note", at: file.createdAt, file })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  if (rows.length === 0) {
    return (
      <EmptyView
        icon={Paperclip}
        title="Chưa có file nào"
        body="Ảnh và tệp bạn tải lên, chuyển tiếp vào Nhật ký hoặc đính kèm trong Ghi chép sẽ nằm ở đây, theo thời gian."
      />
    );
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-3">
      {rows.map((row) => {
        if (row.kind === "meeting") {
          const ref = row.ref;
          return (
            <li key={`m-${ref.messageId}`} className="rounded-[14px] border border-border bg-card p-3.5 animate-bubble-in">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                <SourceTag>Từ Sổ quyết định</SourceTag>
                <span className="tabular">{stamp(ref.createdAt)}</span>
                <span className="ml-auto">
                  <RowAction onClick={() => onOpenNote(ref.messageId)}>Mở mục gốc</RowAction>
                </span>
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
          );
        }
        if (row.kind === "note") {
          const file = row.file;
          return (
            <li key={`n-${file.id}`} className="rounded-[14px] border border-border bg-card p-3.5 animate-bubble-in">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                <SourceTag>{`Ghi chép: ${file.noteTitle}`}</SourceTag>
                <span className="tabular">{stamp(file.createdAt)}</span>
                {onOpenWriting !== undefined ? (
                  <span className="ml-auto">
                    <RowAction onClick={() => onOpenWriting(file.noteId)}>Mở trong ghi chép</RowAction>
                  </span>
                ) : null}
              </div>
              <div className="mt-2.5 max-w-full overflow-hidden">
                <MessageAttachments attachments={[file.attachment]} urlOf={noteUrlOf ?? urlOf} outgoing={false} />
              </div>
            </li>
          );
        }
        const entry = row.entry;
        return (
          <li key={entry.messageId} className="rounded-[14px] border border-border bg-card p-3.5 animate-bubble-in">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
              <SourceTag>Nhật ký</SourceTag>
              <span>{diaryFileSourceLabel(entry.source)}</span>
              <span className="tabular">{stamp(entry.createdAt)}</span>
              <span className="ml-auto flex items-center">
                <RowAction onClick={() => onOpenNote(entry.messageId)}>Mở mục gốc</RowAction>
                <RowAction danger label="Xoá mục Nhật ký này" onClick={() => onDelete(entry)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </RowAction>
              </span>
            </div>
            <div className="mt-2.5 max-w-full overflow-hidden">
              <MessageAttachments attachments={entry.attachments} urlOf={urlOf} outgoing={false} />
            </div>
            {entry.note !== "" ? (
              <p className="mt-2.5 line-clamp-2 whitespace-pre-wrap break-words text-[13.5px] leading-6 text-foreground">{entry.note}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Liên kết: a reading, not a new store. Domain, caption, date; the tap opens the link in a new
 * tab. Nothing is fetched from the linked site — no preview, no request, no IP handed over.
 */
export function DiaryLinksView({
  links,
  onOpenNote,
  onOpenWriting,
  onDelete,
}: {
  links: readonly DiaryLink[];
  onOpenNote: (messageId: string) => void;
  onOpenWriting?: (noteId: string) => void;
  onDelete: (link: DiaryLink) => void;
}) {
  if (links.length === 0) {
    return (
      <EmptyView
        icon={Link2}
        title="Chưa có liên kết nào"
        body="Ghi một đường link vào Nhật ký hoặc Ghi chép — mọi link sẽ tự gom về đây, kèm chú thích."
      />
    );
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-2">
      {links.map((link) => (
        <li key={link.key} className="rounded-[14px] border border-border bg-card px-3.5 py-3 animate-bubble-in">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="group flex items-start gap-3"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-muted-foreground group-hover:text-primary">
              <ExternalLink className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold text-foreground group-hover:underline">{link.domain}</span>
              <span className="mt-0.5 block line-clamp-2 break-words text-[13px] text-muted-foreground">
                {link.caption === "" ? link.url : link.caption}
              </span>
            </span>
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
            <SourceTag>{link.from.kind === "note" ? `Ghi chép: ${link.from.title}` : "Nhật ký"}</SourceTag>
            <span className="tabular">{stamp(link.createdAt)}</span>
            <span className="ml-auto flex items-center">
              {link.from.kind === "journal" ? (
                <>
                  <RowAction onClick={() => onOpenNote((link.from as { messageId: string }).messageId)}>Mở mục gốc</RowAction>
                  <RowAction danger label="Xoá mục Nhật ký này" onClick={() => onDelete(link)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </RowAction>
                </>
              ) : onOpenWriting !== undefined ? (
                <RowAction onClick={() => onOpenWriting((link.from as { noteId: string }).noteId)}>Mở trong ghi chép</RowAction>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Nguồn tạo việc: my tasks that came from Nhật ký — pasted in, or raised from an entry. */
export function DiarySourcesView({
  tasks,
  contextOf,
  onOpenTask,
  onOpenEntry,
  onPaste,
}: {
  tasks: readonly TaskItem[];
  /** The entry's words (the task's context), or null when the entry is gone. */
  contextOf: (task: TaskItem) => { text: string; messageId: string | null };
  onOpenTask: (task: TaskItem) => void;
  onOpenEntry: (messageId: string) => void;
  onPaste: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div>
        <EmptyView
          icon={ClipboardPaste}
          title="Chưa có việc nào tạo từ Nhật ký"
          body="Tạo việc từ một mục Nhật ký, hoặc copy một đoạn chữ, ảnh hay tệp rồi dán vào — việc tạo ra sẽ nằm ở đây kèm bối cảnh."
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
        const context = contextOf(task);
        const fileNames = task.contextSnapshot?.origin?.fileNames ?? [];
        const isDone = task.status === "done";
        return (
          <li key={task.id} className="rounded-[14px] border border-border bg-card px-4 py-3 animate-bubble-in">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[14.5px] font-semibold", isDone ? "text-muted-foreground line-through" : "text-foreground")}>
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
            {context.text !== "" ? (
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-2.5 text-[13px] leading-5 text-foreground/80">
                {context.text}
              </p>
            ) : null}
            <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
              {fileNames.length > 0 ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  <span className="truncate">{fileNames.join(" · ")}</span>
                </span>
              ) : null}
              {context.messageId !== null ? (
                <span className="ml-auto">
                  <RowAction onClick={() => onOpenEntry(context.messageId as string)}>Mở mục gốc</RowAction>
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
