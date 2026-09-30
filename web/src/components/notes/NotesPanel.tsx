import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Loader2,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";

import { askText } from "@/components/ConfirmHost";
import { NoteEditor, type EditingNote } from "@/components/notes/NoteEditor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  appendPasted,
  arrangeFolders,
  blocksFromText,
  bucketNotes,
  emptyBlock,
  matchesNote,
  newBlockId,
  noteDisplayTitle,
  noteFirstLine,
  notesLayout,
  readDraft,
  readNotesFullscreen,
  readNotesPlace,
  rememberLastFolder,
  rememberNotesFullscreen,
  rememberNotesPlace,
  type Note,
  type NoteFilter,
} from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";
import { cn } from "@/lib/utils";

/** Which folder is open: an id, "recent" (Gần đây), "unsorted" (Chưa xếp), "trash", or null (phone: the folder list). */
type FolderKey = string | null;

const RECENT = "recent";
const UNSORTED = "unsorted";
const TRASH = "trash";

function relative(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "";
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "vừa sửa";
  if (minutes < 60) return `sửa ${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `sửa ${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days < 30) return `sửa ${days} ngày trước`;
  return `sửa ${new Date(iso).toLocaleDateString("vi-VN")}`;
}

function newNote(folderId: string | null, extra: Partial<EditingNote> = {}): EditingNote {
  return {
    id: crypto.randomUUID(),
    folderId,
    title: "",
    blocks: [emptyBlock()],
    tags: [],
    bookRecordId: null,
    pinnedAt: null,
    bookTitle: null,
    isNew: true,
    ...extra,
  };
}

function toEditing(note: Note, extra: Partial<EditingNote> = {}): EditingNote {
  const draft = readDraft(note.id);
  // A draft left on this device while offline wins when it is newer than the server copy.
  const useDraft = draft !== null && draft.savedLocallyAt > note.updatedAt;
  return {
    id: note.id,
    folderId: useDraft ? draft.folderId : note.folderId,
    title: useDraft ? draft.title : note.title,
    blocks: useDraft ? draft.blocks : note.blocks,
    tags: useDraft ? draft.tags : note.tags,
    bookRecordId: note.bookRecordId,
    pinnedAt: note.pinnedAt,
    bookTitle: note.bookTitle,
    isNew: false,
    ...extra,
  };
}

/** True while the person is typing somewhere; a paste there belongs to that field. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * Ghi chép (AVORA-44 · B, bố cục 44b · B–E): a writing space. A computer shows Thư mục · Danh
 * sách · Trình soạn (220 · 300 · the rest, at least 560); narrower, the folders fold into the
 * list's header; `⤢` gives the whole width to the editor. A phone steps through the three.
 * Opening Ghi chép again lands on the folder, note, caret and scroll that were open last.
 */
export function NotesPanel({
  data,
  isWide,
  request,
  onRequestHandled,
  onCreateTask,
  onToBoard,
  onOpenBook,
}: {
  data: NotesData;
  isWide: boolean;
  /** From outside (Kệ sách, Liên kết, File, tìm kiếm): open this note, or start one for a book. */
  request: { noteId?: string; book?: { recordId: string; title: string } } | null;
  onRequestHandled: () => void;
  onCreateTask: (input: { title: string; text: string; sourceLabel: string }) => void;
  onToBoard: (input: { title: string; text: string }) => void;
  onOpenBook: (recordId: string) => void;
}) {
  const folders = useMemo(() => data.folders.data ?? [], [data.folders.data]);
  const notes = data.liveNotes;
  const attachments = useMemo(() => data.attachments.data ?? [], [data.attachments.data]);
  const [folderKey, setFolderKey] = useState<FolderKey>(isWide ? RECENT : null);
  const [editing, setEditing] = useState<EditingNote | null>(null);
  const [query, setQuery] = useState<string>("");
  const [searchAll, setSearchAll] = useState<boolean>(false);
  const [filter, setFilter] = useState<NoteFilter>({ voice: false, files: false, pinned: false });
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string; count: number } | null>(null);
  const [restored, setRestored] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => readNotesFullscreen());
  const [pasted, setPasted] = useState<{ text: string; pickingOld: boolean } | null>(null);
  const [width, setWidth] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const readingFolder = folders.find((folder) => folder.systemKey === "reading") ?? null;

  const layout = notesLayout(isWide, width);
  const showFullscreen = isWide && isFullscreen && editing !== null;

  // The layout follows the space Ghi chép actually has, not the window.
  useEffect(() => {
    const node = rootRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const toggleFullscreen = useCallback((): void => {
    setIsFullscreen((current) => {
      rememberNotesFullscreen(!current);
      return !current;
    });
  }, []);

  // Esc leaves the full-width editor and lands back on the same folder, note and caret.
  useEffect(() => {
    if (!showFullscreen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setIsFullscreen(false);
      rememberNotesFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFullscreen]);

  // Back to where the person was (folder + note), once the data is here.
  useEffect(() => {
    if (restored || data.folders.data === undefined || data.notes.data === undefined) return;
    setRestored(true);
    const place = readNotesPlace();
    if (place === null) return;
    setFolderKey(place.folderId ?? (isWide ? RECENT : null));
    if (place.noteId !== null) {
      const found = (data.notes.data ?? []).find((note) => note.id === place.noteId && note.deletedAt === null);
      if (found !== undefined) setEditing(toEditing(found));
    }
  }, [restored, data.folders.data, data.notes.data, isWide]);

  // A saved note keeps its place; a new one is remembered only once it has something in it.
  const editingSaved = editing !== null && (!editing.isNew || notes.some((note) => note.id === editing.id));
  useEffect(() => {
    if (!restored) return;
    rememberNotesPlace({ folderId: folderKey, noteId: editingSaved ? (editing?.id ?? null) : null });
  }, [restored, folderKey, editing?.id, editingSaved]);

  // Requests from elsewhere in the app.
  useEffect(() => {
    if (request === null || data.notes.data === undefined || data.folders.data === undefined) return;
    if (request.noteId !== undefined) {
      const found = data.notes.data.find((note) => note.id === request.noteId);
      if (found !== undefined) {
        setFolderKey(found.folderId ?? UNSORTED);
        setEditing(toEditing(found));
      }
    } else if (request.book !== undefined && readingFolder !== null) {
      setFolderKey(readingFolder.id);
      setEditing(
        newNote(readingFolder.id, {
          title: `${request.book.title} — ghi chép`,
          tags: [request.book.title],
          bookRecordId: request.book.recordId,
          bookTitle: request.book.title,
        }),
      );
    }
    setRestored(true);
    onRequestHandled();
  }, [request, data.notes.data, data.folders.data, readingFolder, onRequestHandled]);

  const summaries = useMemo(() => arrangeFolders(folders, notes), [folders, notes]);
  const unsortedCount = notes.filter((note) => note.folderId === null).length;
  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const note of notes) for (const tag of note.tags) if (!seen.has(tag.toLocaleLowerCase("vi"))) seen.set(tag.toLocaleLowerCase("vi"), tag);
    return [...seen.values()];
  }, [notes]);
  const attachmentsOf = useCallback((noteId: string) => attachments.filter((item) => item.noteId === noteId), [attachments]);

  const inFolder = useMemo(() => {
    const everywhere = searchAll && query.trim() !== "";
    const source = folderKey === TRASH && !everywhere ? data.trashedNotes : notes;
    const inPlace = (note: Note): boolean => {
      if (everywhere || folderKey === TRASH || folderKey === RECENT || folderKey === null) return true;
      if (folderKey === UNSORTED) return note.folderId === null;
      return note.folderId === folderKey;
    };
    return source
      .filter(inPlace)
      .filter((note) => matchesNote(note, query, attachmentsOf(note.id)))
      .filter((note) => !filter.pinned || note.pinnedAt !== null)
      .filter((note) => !filter.voice || attachmentsOf(note.id).some((item) => item.kind === "voice"))
      .filter((note) => !filter.files || attachmentsOf(note.id).some((item) => item.kind !== "voice"));
  }, [folderKey, notes, data.trashedNotes, query, searchAll, filter, attachmentsOf]);

  /** The folder a new note goes into from here: the open one, or Chưa xếp from Gần đây (44b · E). */
  const targetFolder = (key: FolderKey = folderKey): string | null =>
    key === null || key === RECENT || key === UNSORTED || key === TRASH ? null : key;

  const openFolder = (key: FolderKey): void => {
    setFolderKey(key);
    setQuery("");
    setSearchAll(false);
    // 44b · D: switching folder never leaves an editor open on a note that is not there.
    if (editing !== null && key !== RECENT && !(key === UNSORTED ? editing.folderId === null : editing.folderId === key)) setEditing(null);
    if (key !== null && key !== TRASH && key !== UNSORTED && key !== RECENT) rememberLastFolder(key);
  };

  /** 44b · D: a note exists only once `+ Ghi chép` is pressed and something is typed. */
  const plusNote = (): void => {
    const folderId = targetFolder();
    setEditing(newNote(folderId));
    if (folderId !== null) rememberLastFolder(folderId);
  };

  const folderName = (key: FolderKey): string => {
    if (key === null || key === RECENT) return "Gần đây";
    if (key === UNSORTED) return "Chưa xếp";
    if (key === TRASH) return "Thùng rác";
    return folders.find((folder) => folder.id === key)?.name ?? "Ghi chép";
  };

  const deleteNote = (noteId: string): void => {
    data.patch.mutate(
      { id: noteId, deleted: true },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success("Đã chuyển ghi chép vào Thùng rác (giữ 30 ngày).", {
            action: { label: "Hoàn tác", onClick: () => data.patch.mutate({ id: noteId, deleted: false }) },
          });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const addFolder = (): void => {
    void askText({ title: "Thư mục mới", confirmLabel: "Tạo" }).then((name) => {
      if (name === null) return;
      data.addFolder.mutate(name, { onSuccess: (folder) => openFolder(folder.id), onError: (error) => toast.error(error.message) });
    });
  };

  // Việc 3: pasting while the list (not an editor) has focus asks where the words go.
  const offerPaste = useCallback((text: string): void => {
    if (text.trim() === "") return;
    setPasted({ text, pickingOld: false });
  }, []);
  useEffect(() => {
    if (editing !== null && layout === "phone") return;
    const onPaste = (event: ClipboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      if (rootRef.current === null || rootRef.current.offsetParent === null) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.trim() === "") return;
      event.preventDefault();
      offerPaste(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editing, layout, offerPaste]);
  const pasteFromButton = (): void => {
    if (navigator.clipboard?.readText === undefined) {
      toast.info("Chạm giữ trong một ghi chép rồi chọn Dán.");
      return;
    }
    void navigator.clipboard
      .readText()
      .then((text) => (text.trim() === "" ? toast.info("Bộ nhớ tạm đang trống.") : offerPaste(text)))
      .catch(() => toast.info("Trình duyệt chưa cho đọc bộ nhớ tạm — chạm giữ trong ghi chép rồi chọn Dán."));
  };

  const isLoading = data.folders.isPending || data.notes.isPending;
  if (data.folders.isError || data.notes.isError) {
    return (
      <div className="mx-auto max-w-sm py-14 text-center">
        <p className="text-[14px] text-muted-foreground">{(data.folders.error ?? data.notes.error)?.message ?? "Chưa tải được Ghi chép."}</p>
        <button type="button" onClick={data.refresh} className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px]">
          Thử lại
        </button>
      </div>
    );
  }

  const noteRow = (note: Note, inTrash = false) => {
    const files = attachmentsOf(note.id);
    const voices = files.filter((item) => item.kind === "voice").length;
    const others = files.length - voices;
    return (
      <li key={note.id}>
        <div className={cn("group flex items-start gap-2 rounded-lg px-3 py-2.5 transition-colors", editing?.id === note.id ? "bg-accent/70" : "hover:bg-accent/35")}>
          <button type="button" disabled={inTrash} onClick={() => setEditing(toEditing(note))} className="min-w-0 flex-1 text-left disabled:cursor-default">
            <span className="flex items-center gap-1.5">
              {note.pinnedAt !== null ? <Pin className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              <span className="truncate text-[14.5px] font-semibold text-foreground">{noteDisplayTitle(note)}</span>
              {others > 0 ? (
                <span className="flex shrink-0 items-center gap-0.5 text-[11.5px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {others}
                </span>
              ) : null}
              {voices > 0 ? <Mic className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Có ghi âm" /> : null}
            </span>
            {note.bookRecordId !== null || note.bookTitle !== null ? (
              <span className="mt-0.5 flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-300">
                <BookOpen className="h-3 w-3" /> {note.bookTitle}
                {note.bookRecordId === null ? " (đã xoá khỏi kệ)" : ""}
              </span>
            ) : null}
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{noteFirstLine(note) || relative(note.updatedAt)}</span>
          </button>
          {inTrash ? (
            <button type="button" onClick={() => data.patch.mutate({ id: note.id, deleted: false })} className="press flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Khôi phục
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Thao tác ghi chép" className="press rounded-md p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => data.patch.mutate({ id: note.id, pinned: note.pinnedAt === null })}>{note.pinnedAt === null ? "Ghim" : "Bỏ ghim"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => data.patch.mutate({ id: note.id, folderId: null })}>Chuyển vào Chưa xếp</DropdownMenuItem>
                {folders.map((folder) => (
                  <DropdownMenuItem key={folder.id} disabled={folder.id === note.folderId} onSelect={() => data.patch.mutate({ id: note.id, folderId: folder.id })}>
                    <FolderInput className="mr-2 h-4 w-4" /> {folder.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => deleteNote(note.id)}>
                  Xoá
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </li>
    );
  };

  /** One folder row (column or header menu). */
  const folderRows = (asMenu: boolean) => {
    const rows: { key: string; label: string; count: number | null; icon: ReactElement; hint: string | null; folder?: (typeof summaries)[number]["folder"] }[] = [
      { key: RECENT, label: "Gần đây", count: null, icon: <Clock className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />, hint: null },
      ...summaries.map(({ folder, count, lastEditedAt }) => ({
        key: folder.id,
        label: folder.name,
        count,
        icon: folder.isSystem ? <BookOpen className="h-[18px] w-[18px] shrink-0 text-amber-600" /> : <Folder className="h-[18px] w-[18px] shrink-0 text-primary" />,
        hint: lastEditedAt !== null ? relative(lastEditedAt) : null,
        folder,
      })),
      ...(unsortedCount > 0 ? [{ key: UNSORTED, label: "Chưa xếp", count: unsortedCount, icon: <FolderOpen className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />, hint: null }] : []),
      ...(data.trashedNotes.length > 0 ? [{ key: TRASH, label: "Thùng rác", count: data.trashedNotes.length, icon: <Trash2 className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />, hint: null }] : []),
    ];
    if (asMenu) {
      return (
        <>
          {rows.map((row) => (
            <DropdownMenuItem key={row.key} onSelect={() => openFolder(row.key)} className={cn("gap-2", folderKey === row.key && "bg-accent")}>
              {row.icon}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.count !== null ? <span className="tabular text-[12px] text-muted-foreground">{row.count}</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={addFolder} className="gap-2 text-primary">
            <FolderPlus className="h-4 w-4" /> Thư mục mới
          </DropdownMenuItem>
        </>
      );
    }
    return (
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <div className={cn("group flex items-center gap-1 rounded-lg pr-1 transition-colors", folderKey === row.key ? "bg-accent/70" : "hover:bg-accent/35")}>
              <button type="button" onClick={() => openFolder(row.key)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
                {row.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-foreground">{row.label}</span>
                  {row.hint !== null ? <span className="block truncate text-[12px] text-muted-foreground">{row.hint}</span> : null}
                </span>
                {row.count !== null ? <span className="tabular text-[12.5px] text-muted-foreground">{row.count}</span> : null}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" />
              </button>
              {row.folder !== undefined && !row.folder.isSystem ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Thao tác thư mục ${row.label}`} className="press rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-accent group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        const folder = row.folder;
                        if (folder === undefined) return;
                        void askText({ title: "Tên mới của thư mục", initial: folder.name }).then((name) => {
                          if (name === null || name === folder.name) return;
                          data.rename.mutate({ id: folder.id, name }, { onError: (error) => toast.error(error.message) });
                        });
                      }}
                    >
                      Đổi tên
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onSelect={() => setDeletingFolder({ id: row.key, name: row.label, count: row.count ?? 0 })}>
                      Xoá thư mục
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </li>
        ))}
        <li>
          <button type="button" onClick={addFolder} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] text-primary hover:bg-accent/35">
            <FolderPlus className="h-[18px] w-[18px]" /> Thư mục mới
          </button>
        </li>
      </ul>
    );
  };

  // ---------------------------------------------------------------- columns
  const folderColumn = (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-5 pb-2 pt-4 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Thư mục</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : folderRows(false)}
        {!isLoading && notes.length === 0 ? (
          <p className="px-4 py-6 text-[13.5px] leading-relaxed text-muted-foreground">
            Ghi chép là nơi bạn tự viết ra để đọc lại — bài học, bài giảng, ghi họp dài.
          </p>
        ) : null}
      </div>
    </div>
  );

  const isEverywhere = searchAll && query.trim() !== "";
  const listColumn = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
        {layout === "phone" ? (
          <button type="button" onClick={() => openFolder(null)} aria-label="Về thư mục" className="press rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        {layout === "two" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="press flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-left hover:bg-accent/50">
                <span className="truncate text-[16px] font-semibold text-foreground">{isEverywhere ? "Mọi ghi chép" : folderName(folderKey)}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {folderRows(true)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <p className="min-w-0 flex-1 truncate px-1 text-[16px] font-semibold text-foreground">{isEverywhere ? "Mọi ghi chép" : folderName(folderKey)}</p>
        )}
        {folderKey === TRASH ? null : (
          <>
            <button type="button" onClick={pasteFromButton} aria-label="Dán nội dung vừa copy" title="Dán nội dung vừa copy" className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/50 hover:text-foreground">
              <ClipboardPaste className="h-4 w-4" />
            </button>
            <button type="button" onClick={plusNote} className="press inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" /> Ghi chép
            </button>
          </>
        )}
      </div>
      {folderKey === TRASH ? (
        <p className="px-5 pb-2 text-[12.5px] text-muted-foreground">Ghi chép trong Thùng rác được giữ 30 ngày, cùng tệp đính kèm.</p>
      ) : (
        <div className="space-y-1.5 px-3 pb-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm ghi chép · #thẻ"
              aria-label="Tìm ghi chép"
              className="h-10 w-full rounded-full border border-border bg-background pl-8 pr-3 text-[14px] outline-none focus:border-primary"
            />
          </label>
          {query.trim() !== "" && folderKey !== RECENT ? (
            <button type="button" onClick={() => setSearchAll((current) => !current)} className="press px-2 text-[12.5px] font-medium text-primary">
              {searchAll ? `Chỉ tìm trong ${folderName(folderKey)}` : "Tìm trong mọi ghi chép ›"}
            </button>
          ) : null}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc">
            {(
              [
                ["voice", "Có ghi âm"],
                ["files", "Có tệp"],
                ["pinned", "Đã ghim"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter[key]}
                onClick={() => setFilter((current) => ({ ...current, [key]: !current[key] }))}
                className={cn("press whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px]", filter[key] ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : inFolder.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">
            {query.trim() !== "" ? `Không tìm thấy "${query.trim()}"` : folderKey === TRASH ? "Thùng rác trống." : "Chưa có ghi chép nào ở đây."}
          </p>
        ) : folderKey === TRASH && !isEverywhere ? (
          <ul>{inFolder.map((note) => noteRow(note, true))}</ul>
        ) : (
          bucketNotes(inFolder).map((bucket) => (
            <section key={bucket.key}>
              <p className="px-3 pb-0.5 pt-3 text-[12px] font-medium text-muted-foreground">{bucket.label}</p>
              <ul>{bucket.notes.map((note) => noteRow(note))}</ul>
            </section>
          ))
        )}
      </div>
    </div>
  );

  const editorColumn =
    editing === null ? null : (
      <NoteEditor
        key={`${editing.id}:${editing.revision ?? 0}`}
        initial={editing}
        folders={folders}
        attachments={attachmentsOf(editing.id)}
        notesData={data}
        knownTags={knownTags}
        showBack={layout === "phone"}
        fullscreen={isWide ? { isOn: showFullscreen, toggle: toggleFullscreen } : null}
        onBack={() => setEditing(null)}
        onMove={(noteId, folderId) => {
          if (!editing.isNew) data.patch.mutate({ id: noteId, folderId });
        }}
        onCreateTask={onCreateTask}
        onToBoard={onToBoard}
        onDelete={deleteNote}
        onOpenBook={onOpenBook}
      />
    );

  const emptyEditor = (
    <div className="flex h-full items-center justify-center px-8 text-center text-[14px] text-muted-foreground">
      <p>
        Chọn một ghi chép, hoặc <span className="font-semibold text-foreground">+ Ghi chép</span>.
        <br />
        <span className="text-[13px]">Dán chữ vừa copy vào đây cũng được.</span>
      </p>
    </div>
  );

  const recentNotes = [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 12);
  const dialogs = (
    <>
      <Dialog open={pasted !== null} onOpenChange={(open) => !open && setPasted(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Dán vào đâu?</DialogTitle>
          <DialogDescription className="line-clamp-3 whitespace-pre-wrap">{pasted?.text.slice(0, 280) ?? ""}</DialogDescription>
          {pasted?.pickingOld === true ? (
            <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
              {recentNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const text = pasted.text;
                      setPasted(null);
                      setFolderKey(note.folderId ?? UNSORTED);
                      const base = toEditing(note);
                      setEditing({ ...base, blocks: appendPasted(base.blocks, text), startDirty: true, revision: Date.now() });
                    }}
                    className="press flex w-full flex-col rounded-md border border-border px-3 py-2 text-left hover:bg-accent/40"
                  >
                    <span className="truncate text-[14px] font-medium">{noteDisplayTitle(note)}</span>
                    <span className="truncate text-[12px] text-muted-foreground">{relative(note.updatedAt)}</span>
                  </button>
                </li>
              ))}
              {recentNotes.length === 0 ? <li className="py-4 text-center text-[13px] text-muted-foreground">Chưa có ghi chép nào.</li> : null}
            </ul>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const text = pasted?.text ?? "";
                  setPasted(null);
                  setEditing(newNote(targetFolder(), { blocks: blocksFromText(text), startDirty: true }));
                }}
                className="press rounded-md bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground"
              >
                Ghi chép mới
              </button>
              <button type="button" disabled={notes.length === 0} onClick={() => setPasted((current) => (current === null ? null : { ...current, pickingOld: true }))} className="press rounded-md border border-border px-4 py-2.5 text-[14px] disabled:opacity-50">
                Thêm vào ghi chép cũ
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={deletingFolder !== null} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{`Xoá thư mục "${deletingFolder?.name ?? ""}"?`}</DialogTitle>
          <DialogDescription>{deletingFolder?.count === 0 ? "Thư mục trống." : `Còn ${deletingFolder?.count ?? 0} ghi chép bên trong.`}</DialogDescription>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                const target = deletingFolder;
                if (target === null) return;
                data.removeFolder.mutate({ id: target.id, trashNotes: false }, {
                  onSuccess: () => {
                    toast.success(`Đã xoá thư mục. ${target.count} ghi chép ở "Chưa xếp".`);
                    if (folderKey === target.id) setFolderKey(target.count > 0 ? UNSORTED : isWide ? RECENT : null);
                  },
                  onError: (error) => toast.error(error.message),
                });
                setDeletingFolder(null);
              }}
              className="press rounded-md bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground"
            >
              {`Chuyển ${deletingFolder?.count ?? 0} ghi chép vào "Chưa xếp"`}
            </button>
            {(deletingFolder?.count ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const target = deletingFolder;
                  if (target === null) return;
                  data.removeFolder.mutate({ id: target.id, trashNotes: true }, {
                    onSuccess: () => {
                      toast.success(`Đã xoá thư mục và chuyển ${target.count} ghi chép vào Thùng rác.`);
                      if (folderKey === target.id) setFolderKey(isWide ? RECENT : null);
                    },
                    onError: (error) => toast.error(error.message),
                  });
                  setDeletingFolder(null);
                }}
                className="press rounded-md border border-destructive/40 px-4 py-2.5 text-[14px] text-destructive"
              >
                Xoá luôn vào Thùng rác
              </button>
            ) : null}
            <button type="button" onClick={() => setDeletingFolder(null)} className="press rounded-md px-4 py-2 text-[14px] text-muted-foreground">
              Huỷ
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  let body: ReactElement;
  if (showFullscreen) {
    body = <div className="h-full min-w-0">{editorColumn}</div>;
  } else if (layout === "three") {
    body = (
      <div className="flex h-full min-h-0">
        <div className="w-[220px] shrink-0 border-r border-border">{folderColumn}</div>
        <div className="w-[300px] shrink-0 border-r border-border">{listColumn}</div>
        <div className="min-w-[560px] flex-1">{editorColumn ?? emptyEditor}</div>
      </div>
    );
  } else if (layout === "two") {
    body = (
      <div className="flex h-full min-h-0">
        <div className="w-[300px] shrink-0 border-r border-border">{listColumn}</div>
        <div className="min-w-0 flex-1">{editorColumn ?? emptyEditor}</div>
      </div>
    );
  } else {
    body = <div className="h-full min-h-0">{editorColumn ?? (folderKey === null ? folderColumn : listColumn)}</div>;
  }

  return (
    <div ref={rootRef} className="h-full min-h-0">
      {body}
      {dialogs}
    </div>
  );
}

export { newBlockId };
