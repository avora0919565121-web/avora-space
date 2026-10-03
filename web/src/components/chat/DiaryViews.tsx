import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  NotebookPen,
  NotebookText,
  Paperclip,
  ScrollText,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { DayLineList, type DayLine } from "@/components/chat/DayLineList";
import { fileIconOf } from "@/components/chat/file-icon";
import { FileChipRow } from "@/components/chat/FileChipRow";
import { matchesFileChip, readFileChip, writeFileChip, type CategorizableFile, type FileChip } from "@/lib/file-category";
import { normalizeSearch } from "@/lib/normalize-search";
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
import { fileSizeLabel } from "@/lib/journal-lines";
import type { SavedMeetingNote } from "@/lib/meeting-notes";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** What each Nhật ký view holds, in one line under its name. */
export const DIARY_HINTS: Readonly<Record<DiaryView, string>> = {
  journal: "Ý nghĩ, thu nhanh, tin chuyển tiếp — chỉ mình bạn xem",
  notes: "Bài bạn tự viết, xếp theo thư mục",
  files: "Mọi ảnh và tệp trong Nhật ký và Ghi chép",
  links: "Mọi đường link bạn đã lưu",
  sources: "Việc tạo từ Nhật ký",
};

export const DIARY_ICONS: Readonly<Record<DiaryView, LucideIcon>> = {
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
 * The Nhật ký tab's list on a computer: the five views as rows, with counts and the "mới" dot —
 * the one place to switch views there (44b · A). A phone never rests here — it opens the view
 * used last, with the count row on top. Creating a task from what was copied lives only in
 * Nguồn tạo việc (AVORA-49 · chặng 5).
 */
export function DiaryList({
  journalId,
  active,
  counts,
  dots = {},
  isWide,
  onPaste,
  isPasting,
  notesTree,
}: {
  journalId: string | null;
  active: DiaryView | null;
  counts: DiaryCounts;
  dots?: DiaryDots;
  isWide: boolean;
  onPaste: () => void;
  isPasting: boolean;
  /** AVORA-52 · A: on a computer, the Ghi chép tree unfolds right under its row. */
  notesTree?: ReactNode;
}) {
  const [isTreeOpen, setIsTreeOpen] = useState<boolean>(() => readNotesTreeOpen());
  const toggleTree = (): void =>
    setIsTreeOpen((current) => {
      rememberNotesTreeOpen(!current);
      return !current;
    });
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
                <div className="flex items-center">
                {/* AVORA-61 · B: on a computer the Ghi chép row folds its tree away, remembered per device. */}
                {view.id === "notes" && notesTree !== undefined ? (
                  <button
                    type="button"
                    onClick={toggleTree}
                    aria-expanded={isTreeOpen}
                    aria-label={isTreeOpen ? "Thu gọn cây Ghi chép" : "Mở rộng cây Ghi chép"}
                    data-notes-tree-toggle=""
                    className="press -ml-1 flex h-9 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    {isTreeOpen ? (
                      <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                <Link
                  to={`/tin-nhan/${journalId}?${DIARY_VIEW_PARAM}=${diaryViewSlug(view.id)}`}
                  replace={isWide}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 transition-colors",
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
                  {dots[view.id] === true && !isActive ? <span className="tabular shrink-0 text-[11px] font-semibold text-primary">mới</span> : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" strokeWidth={1.8} aria-hidden="true" />
                </Link>
                </div>
              )}
              {view.id === "notes" && notesTree !== undefined && isTreeOpen ? (
                <div className="ml-4 border-l border-border/70 pl-1">{notesTree}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const NOTES_TREE_OPEN_KEY = "avora.notes-tree-open";

/** Whether the Ghi chép tree is unfolded on this device. Open unless it was folded away. */
export function readNotesTreeOpen(): boolean {
  try {
    return window.localStorage.getItem(NOTES_TREE_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function rememberNotesTreeOpen(isOpen: boolean): void {
  try {
    window.localStorage.setItem(NOTES_TREE_OPEN_KEY, isOpen ? "1" : "0");
  } catch {
    // Remembering is a courtesy.
  }
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

/** File của tôi (AVORA-70 · B): one line per file — type icon, name, size, time — grouped by day. */
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
  const [openId, setOpenId] = useState<string | null>(null);
  // AVORA-73: one chip at a time, remembered per device; search by file name, combined with the chip.
  const [chip, setChipState] = useState<FileChip>(() => readFileChip(FILE_CHIP_KEY));
  const setChip = (next: FileChip): void => {
    setChipState(next);
    writeFileChip(FILE_CHIP_KEY, next);
  };
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  if (isLoading) {
    return (
      <div className="flex justify-center py-14" role="status" aria-label="Đang tải tệp">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  type Row =
    | { kind: "journal"; entry: DiaryFileNote }
    | { kind: "meeting"; ref: SavedMeetingNote & { messageId: string; createdAt: string } }
    | { kind: "note"; file: NoteFileRow };
  const rows = new Map<string, Row>();
  const lines: DayLine[] = [];
  const asFile = (a: MessageAttachment): CategorizableFile => ({ kind: a.kind, mimeType: a.mimeType, fileName: a.fileName, captureSource: a.captureSource ?? null });
  const meetingFile = (title: string): CategorizableFile => ({ kind: "file", mimeType: "application/pdf", fileName: `${title}.pdf` });
  // Every file counts once for the chips, whatever line it sits on.
  const allFiles: CategorizableFile[] = [
    ...notes.flatMap((entry) => entry.attachments.map(asFile)),
    ...meetingNotes.map((ref) => meetingFile(ref.title)),
    ...noteFiles.map((file) => asFile(file.attachment)),
  ];
  const needle = normalizeSearch(query);
  const keep = (files: readonly CategorizableFile[]): boolean =>
    files.some((file) => matchesFileChip(file, chip) && (needle === "" || normalizeSearch(file.fileName).includes(needle)));
  for (const entry of notes) {
    if (!keep(entry.attachments.map(asFile))) continue;
    const first = entry.attachments[0];
    const id = `j-${entry.messageId}`;
    rows.set(id, { kind: "journal", entry });
    lines.push({
      id,
      at: entry.createdAt,
      icon: first === undefined ? FileText : fileIconOf(asFile(first)),
      thumbUrl: first?.kind === "image" ? urlOf(first.storagePath) : null,
      title: first === undefined ? "Tệp" : entry.attachments.length > 1 ? `${first.fileName} và ${entry.attachments.length - 1} tệp khác` : first.fileName,
      meta: fileSizeLabel(entry.attachments.reduce((sum, item) => sum + item.byteSize, 0)),
      entryId: entry.messageId,
      isLong: entry.attachments.some((item) => item.kind === "image" || item.mimeType === "application/pdf"),
    });
  }
  for (const ref of meetingNotes) {
    if (!keep([meetingFile(ref.title)])) continue;
    const id = `m-${ref.messageId}`;
    rows.set(id, { kind: "meeting", ref });
    lines.push({ id, at: ref.createdAt, icon: ScrollText, title: ref.title, meta: "Sổ quyết định", entryId: null });
  }
  for (const file of noteFiles) {
    if (!keep([asFile(file.attachment)])) continue;
    const id = `n-${file.id}`;
    rows.set(id, { kind: "note", file });
    lines.push({
      id,
      at: file.createdAt,
      icon: fileIconOf(asFile(file.attachment)),
      title: file.attachment.fileName,
      meta: fileSizeLabel(file.attachment.byteSize),
      entryId: null,
      isLong: file.attachment.kind === "image" || file.attachment.mimeType === "application/pdf",
    });
  }
  lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const detail = (line: DayLine) => {
    const row = rows.get(line.id);
    if (row === undefined) return null;
    if (row.kind === "meeting") {
      return (
        <div className="space-y-2">
          <p className="text-[13.5px] text-muted-foreground">
            {[row.ref.groupLine, row.ref.fileName === null ? null : `Mẫu riêng: ${row.ref.fileName}`].filter((part): part is string => part !== null && part !== "").join(" · ")}
          </p>
          <div className="flex flex-wrap gap-1 text-[13px]">
            <Link to={row.ref.href} className="press inline-flex min-h-10 items-center rounded-md border border-border bg-card px-2.5 font-medium">
              Mở biên bản
            </Link>
            <RowAction onClick={() => onOpenNote(row.ref.messageId)}>Tới tin gốc</RowAction>
          </div>
        </div>
      );
    }
    if (row.kind === "note") {
      return (
        <div className="space-y-2">
          <div className="max-w-full overflow-hidden">
            <MessageAttachments attachments={[row.file.attachment]} urlOf={noteUrlOf ?? urlOf} outgoing={false} />
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[13px]">
            <SourceTag>{`Ghi chép: ${row.file.noteTitle}`}</SourceTag>
            {onOpenWriting !== undefined ? <RowAction onClick={() => onOpenWriting(row.file.noteId)}>Mở trong ghi chép</RowAction> : null}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="max-w-full overflow-hidden">
          <MessageAttachments attachments={row.entry.attachments} urlOf={urlOf} outgoing={false} />
        </div>
        {row.entry.note !== "" ? <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">{row.entry.note}</p> : null}
        <div className="flex flex-wrap items-center gap-1 text-[13px]">
          <span className="text-muted-foreground">{diaryFileSourceLabel(row.entry.source)}</span>
          <RowAction onClick={() => onOpenNote(row.entry.messageId)}>Tới tin gốc</RowAction>
          <RowAction danger onClick={() => onDelete(row.entry)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Xoá
          </RowAction>
        </div>
      </div>
    );
  };

  return (
    <div data-diary-files="">
      {/* ② One row of chips, the same on phone and computer; 🔍 opens a name search beside it. */}
      {allFiles.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-border pr-2">
          <div className="min-w-0 flex-1 [&>[data-file-chips]]:border-b-0">
            <FileChipRow files={allFiles} chip={chip} onChip={setChip} />
          </div>
          <button type="button" onClick={() => { setIsSearching((v) => !v); setQuery(""); }} aria-label="Tìm theo tên tệp" aria-pressed={isSearching} className="icon-btn h-10 w-10 shrink-0">
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {isSearching ? (
        <div className="border-b border-border px-3 py-2">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên tệp…" aria-label="Tìm theo tên tệp" className="h-10 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-personal md:text-[14px]" />
        </div>
      ) : null}
      {allFiles.length > 0 && lines.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13.5px] text-muted-foreground" data-files-none="">Không có tệp nào khớp.</p>
      ) : null}
    <DayLineList
      lines={lines}
      foldKey="avora.diary-files.folded-days"
      label="File của tôi"
      openId={openId}
      onOpenChange={setOpenId}
      renderDetail={detail}
      onSwipeDelete={(line) => {
        const row = rows.get(line.id);
        if (row?.kind === "journal") onDelete(row.entry);
      }}
      empty={
        <EmptyView
          icon={Paperclip}
          title="Chưa có file nào"
          body="Ảnh và tệp bạn tải lên, chuyển tiếp vào Nhật ký hoặc đính kèm trong Ghi chép sẽ nằm ở đây, theo thời gian."
        />
      }
    />
    </div>
  );
}

const FILE_CHIP_KEY = "avora.diary-files.chip";

/**
 * Liên kết (AVORA-70 · B): one line per link — 🔗, its caption or domain, the time. Nothing is
 * fetched from the linked site — no preview, no request, no IP handed over.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const byKey = new Map(links.map((link) => [link.key, link] as const));
  const lines: DayLine[] = links.map((link) => ({
    id: link.key,
    at: link.createdAt,
    icon: Link2,
    title: link.caption === "" ? link.domain : link.caption,
    meta: link.caption === "" ? undefined : link.domain,
    entryId: link.from.kind === "journal" ? link.from.messageId : null,
  }));
  return (
    <DayLineList
      lines={lines}
      foldKey="avora.diary-links.folded-days"
      label="Liên kết"
      openId={openId}
      onOpenChange={setOpenId}
      onSwipeDelete={(line) => {
        const link = byKey.get(line.id);
        if (link !== undefined && link.from.kind === "journal") onDelete(link);
      }}
      renderDetail={(line) => {
        const link = byKey.get(line.id);
        if (link === undefined) return null;
        return (
          <div className="space-y-2">
            <p className="break-all text-[13.5px] text-foreground">{link.url}</p>
            <div className="flex flex-wrap items-center gap-1 text-[13px]">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                className="press inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-medium"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Mở
              </a>
              {link.from.kind === "journal" ? (
                <>
                  <RowAction onClick={() => onOpenNote((link.from as { messageId: string }).messageId)}>Tới tin gốc</RowAction>
                  <RowAction danger onClick={() => onDelete(link)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Xoá
                  </RowAction>
                </>
              ) : (
                <>
                  <SourceTag>{`Ghi chép: ${link.from.title}`}</SourceTag>
                  {onOpenWriting !== undefined ? <RowAction onClick={() => onOpenWriting((link.from as { noteId: string }).noteId)}>Mở trong ghi chép</RowAction> : null}
                </>
              )}
            </div>
          </div>
        );
      }}
      empty={
        <EmptyView icon={Link2} title="Chưa có liên kết nào" body="Ghi một đường link vào Nhật ký hoặc Ghi chép — mọi link sẽ tự gom về đây, kèm chú thích." />
      }
    />
  );
}

/** Nguồn tạo việc (AVORA-70 · B): my tasks from Nhật ký, one line each — ✓, name, status, time. */
export function DiarySourcesView({
  tasks,
  contextOf,
  onOpenTask,
  onOpenEntry,
  onPaste,
  isPasting = false,
}: {
  tasks: readonly TaskItem[];
  /** The entry's words (the task's context), or null when the entry is gone. */
  contextOf: (task: TaskItem) => { text: string; messageId: string | null };
  onOpenTask: (task: TaskItem) => void;
  onOpenEntry: (messageId: string) => void;
  onPaste: () => void;
  isPasting?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The one "from what was copied" button in the app (AVORA-49 · chặng 5; 44b · G).
  const pasteButton = (
    <button
      type="button"
      onClick={onPaste}
      disabled={isPasting}
      className="press flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-primary/35 bg-primary/[0.07] px-4 text-[13.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.13] disabled:opacity-50"
    >
      {isPasting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardPaste className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
      Tạo nhiệm vụ từ nội dung vừa copy
    </button>
  );
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const lines: DayLine[] = tasks.map((task) => ({
    id: task.id,
    at: task.createdAt,
    icon: ListChecks,
    title: task.title,
    meta: task.status === "done" ? "Xong" : "Đang làm",
    isDone: task.status === "done",
    entryId: null,
  }));
  return (
    <div>
      <div className="px-3 pb-3 md:mx-auto md:max-w-2xl md:px-0">{pasteButton}</div>
      <DayLineList
        lines={lines}
        foldKey="avora.diary-sources.folded-days"
        label="Nguồn tạo việc"
        openId={openId}
        onOpenChange={setOpenId}
        renderDetail={(line) => {
          const task = byId.get(line.id);
          if (task === undefined) return null;
          const context = contextOf(task);
          const fileNames = task.contextSnapshot?.origin?.fileNames ?? [];
          return (
            <div className="space-y-2">
              {context.text !== "" ? (
                <p className="whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-2.5 text-[14px] leading-6 text-foreground/85">{context.text}</p>
              ) : (
                <p className="text-[13px] text-muted-foreground">Mục Nhật ký đã xoá — việc vẫn còn.</p>
              )}
              {fileNames.length > 0 ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{fileNames.join(" · ")}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1 text-[13px]">
                <button type="button" onClick={() => onOpenTask(task)} className="press inline-flex min-h-10 items-center rounded-md border border-border bg-card px-2.5 font-medium">
                  Mở nhiệm vụ
                </button>
                {context.messageId !== null ? <RowAction onClick={() => onOpenEntry(context.messageId as string)}>Tới tin gốc</RowAction> : null}
              </div>
            </div>
          );
        }}
        empty={
          <EmptyView
            icon={ClipboardPaste}
            title="Chưa có nhiệm vụ nào tạo từ Nhật ký"
            body="Tạo nhiệm vụ từ một mục Nhật ký, hoặc copy một đoạn chữ, ảnh hay tệp rồi dán vào — nhiệm vụ tạo ra sẽ nằm ở đây kèm bối cảnh."
          />
        }
      />
    </div>
  );
}
