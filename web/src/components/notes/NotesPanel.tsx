import { BookOpen, ChevronLeft, ClipboardPaste, FolderInput, Mic, MoreHorizontal, Paperclip, Pin, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { NoteEditor, type EditingNote } from "@/components/notes/NoteEditor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  appendPasted,
  blocksFromText,
  bucketNotes,
  emptyBlock,
  folderPath,
  newBlockId,
  noteDisplayTitle,
  noteFirstLine,
  readDraft,
  readNotesFullscreen,
  readNotesPlace,
  rememberLastFolder,
  rememberNotesFullscreen,
  rememberNotesPlace,
  type Note,
} from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";
import { BookCover } from "@/components/library/BookCover";
import { useShelfCovers } from "@/components/library/use-bookshelf";
import { cn } from "@/lib/utils";
import { isPreviousEntry } from "@/lib/nav-history";

/** AVORA-94B: the note open in Ghi chép, in the address (`?gc=<id>`). */
export const OPEN_NOTE_PARAM = "gc";

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

/** What the tree (or anything else in the app) asks Ghi chép to open. */
export type NotesRequest = {
  noteId?: string;
  book?: { recordId: string; title: string; excerpt?: { text: string; where: string | null; locator?: string | null } };
  /** Start a new note in this folder (null = Chưa xếp). */
  newIn?: string | null;
  /** Show Thùng rác in the pane. */
  trash?: boolean;
};

/** How many notes `Gần đây` lists in the empty pane. */
const RECENT_LIMIT = 15;

/**
 * Ghi chép (AVORA-52 · A). The folder tree lives in the Nhật ký column on a computer
 * (NotesTree); this pane holds only what is open — the editor, Thùng rác, or `Gần đây`
 * (Đã ghim first). A phone shows the tree (`tree`) as its list screen and the editor full
 * screen; `‹` returns to the same tree. Opening Ghi chép again lands on the note, caret and
 * scroll that were open last.
 */
export function NotesPanel({
  data,
  isWide,
  request,
  onRequestHandled,
  onCreateTask,
  onToBoard,
  onOpenBook,
  onEditingChange,
  tree,
  onlyBooks = false,
  onClearFilter,
}: {
  data: NotesData;
  isWide: boolean;
  /** From the tree or elsewhere (Kệ sách, Liên kết, File, tìm kiếm). */
  request: NotesRequest | null;
  onRequestHandled: () => void;
  onCreateTask: (input: { title: string; text: string; sourceLabel: string }) => void;
  onToBoard: (input: { title: string; text: string }) => void;
  onOpenBook: (recordId: string) => void;
  /** The open note (null when none), so the tree beside can mark it. */
  onEditingChange?: (noteId: string | null) => void;
  /** Phone only: the tree, shown when nothing is open. */
  tree?: ReactNode;
  /** AVORA-94 · B2.3: kệ 5 `Mọi ghi chú sách ›` — only notes tied to a book. */
  onlyBooks?: boolean;
  onClearFilter?: () => void;
}) {
  const folders = useMemo(() => data.folders.data ?? [], [data.folders.data]);
  const notes = data.liveNotes;
  const attachments = useMemo(() => data.attachments.data ?? [], [data.attachments.data]);
  const [editing, setEditingState] = useState<EditingNote | null>(null);
  /**
   * AVORA-94B · luật 1 (ADR-062): an open note is one step deeper — `?gc=<id>` is pushed, so `‹`,
   * the browser Back and the editor's own `‹` all close it by stepping back.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openParam: string | null = searchParams.get(OPEN_NOTE_PARAM);
  const setEditing = useCallback(
    (next: EditingNote | null): void => {
      setEditingState(next);
      const current = new URLSearchParams(location.search);
      if (next === null) {
        if (current.get(OPEN_NOTE_PARAM) === null) return;
        current.delete(OPEN_NOTE_PARAM);
        const query = current.toString();
        if (isPreviousEntry(`${location.pathname}${query === "" ? "" : `?${query}`}`)) navigate(-1);
        else setSearchParams(current, { replace: true });
        return;
      }
      if (current.get(OPEN_NOTE_PARAM) === next.id) return;
      const hadOne = current.get(OPEN_NOTE_PARAM) !== null;
      current.set(OPEN_NOTE_PARAM, next.id);
      setSearchParams(current, { replace: hadOne });
    },
    [location.pathname, location.search, navigate, setSearchParams],
  );
  // The address moved (Back, a link): follow it — the note opens or closes with it.
  const seenParamRef = useRef<string | null>(openParam);
  useEffect(() => {
    if (seenParamRef.current === openParam) return;
    seenParamRef.current = openParam;
    if (openParam === null) {
      setEditingState(null);
      return;
    }
    setEditingState((current) => {
      if (current?.id === openParam) return current;
      const found = notes.find((note) => note.id === openParam);
      return found === undefined ? current : toEditing(found);
    });
  }, [openParam, notes]);
  const [showTrash, setShowTrash] = useState<boolean>(false);
  const [restored, setRestored] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => readNotesFullscreen());
  const [pasted, setPasted] = useState<{ text: string; pickingOld: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const readingFolder = folders.find((folder) => folder.systemKey === "reading") ?? null;
  const showFullscreen = isWide && isFullscreen && editing !== null;

  const editingSaved = editing !== null && (!editing.isNew || notes.some((note) => note.id === editing.id));
  const editingId = editing?.id ?? null;
  useEffect(() => onEditingChange?.(editingSaved ? editingId : null), [editingSaved, editingId, onEditingChange]);

  const toggleFullscreen = useCallback((): void => {
    setIsFullscreen((current) => {
      rememberNotesFullscreen(!current);
      return !current;
    });
  }, []);

  // Esc leaves the full-width editor and lands back on the same note and caret.
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

  // Back to the note that was open, once the data is here.
  useEffect(() => {
    if (restored || data.folders.data === undefined || data.notes.data === undefined) return;
    setRestored(true);
    // The address names a note (Back / reload onto it): that one. Else the last one (same screen, `‹` closes it).
    const wanted = openParam ?? readNotesPlace()?.noteId ?? null;
    if (wanted === null) return;
    const found = (data.notes.data ?? []).find((note) => note.id === wanted && note.deletedAt === null);
    if (found === undefined) return;
    setEditingState(toEditing(found));
    // The address says which note is open (replace: reopening is not a step deeper).
    if (openParam === null) {
      const next = new URLSearchParams(location.search);
      next.set(OPEN_NOTE_PARAM, found.id);
      seenParamRef.current = found.id;
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the data first arrives
  }, [restored, data.folders.data, data.notes.data]);

  // A saved note keeps its place; a new one is remembered only once it has something in it.
  useEffect(() => {
    if (!restored) return;
    rememberNotesPlace({ folderId: editing?.folderId ?? null, noteId: editingSaved ? editingId : null });
  }, [restored, editingId, editing?.folderId, editingSaved]);

  // Requests from the tree and from elsewhere in the app.
  useEffect(() => {
    if (request === null) return;
    if (request.trash === true) {
      setEditing(null);
      setShowTrash(true);
    } else if (request.newIn !== undefined) {
      setShowTrash(false);
      setEditing(newNote(request.newIn));
      if (request.newIn !== null) rememberLastFolder(request.newIn);
    } else {
      if (data.notes.data === undefined || data.folders.data === undefined) return;
      if (request.noteId !== undefined) {
        const found = data.notes.data.find((note) => note.id === request.noteId);
        if (found !== undefined) {
          setShowTrash(false);
          setEditing(toEditing(found));
        }
      } else if (request.book !== undefined && readingFolder !== null) {
        setShowTrash(false);
        setEditing(
          newNote(readingFolder.id, {
            title: `${request.book.title} — ghi chép`,
            tags: [request.book.title],
            bookRecordId: request.book.recordId,
            bookTitle: request.book.title,
            bookLocator: request.book.excerpt?.locator ?? null,
            // The passage as a quotation, where it came from, then an empty line for the thought.
            ...(request.book.excerpt !== undefined
              ? {
                  blocks: [
                    { ...emptyBlock(), text: `“${request.book.excerpt.text}”` },
                    ...(request.book.excerpt.where !== null ? [{ ...emptyBlock(), text: `— ${request.book.excerpt.where}` }] : []),
                    emptyBlock(),
                  ],
                  startDirty: true,
                }
              : {}),
          }),
        );
      }
    }
    setRestored(true);
    onRequestHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setEditing follows the address
  }, [request, data.notes.data, data.folders.data, readingFolder, onRequestHandled]);

  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const note of notes) for (const tag of note.tags) if (!seen.has(tag.toLocaleLowerCase("vi"))) seen.set(tag.toLocaleLowerCase("vi"), tag);
    return [...seen.values()];
  }, [notes]);
  const attachmentsOf = useCallback((noteId: string) => attachments.filter((item) => item.noteId === noteId), [attachments]);

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

  // Pasting while no editor has focus asks where the words go.
  const offerPaste = useCallback((text: string): void => {
    if (text.trim() === "") return;
    setPasted({ text, pickingOld: false });
  }, []);
  useEffect(() => {
    if (editing !== null && !isWide) return;
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
  }, [editing, isWide, offerPaste]);
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
    const where = note.folderId === null ? "Chưa xếp" : folderPath(folders, note.folderId).join(" › ");
    return (
      <li key={note.id}>
        <div className={cn("group flex items-start gap-2 rounded-lg px-3 py-2.5 transition-colors", editing?.id === note.id ? "bg-accent/70" : "hover:bg-accent/35")}>
          <button
            type="button"
            disabled={inTrash}
            onClick={() => {
              setShowTrash(false);
              setEditing(toEditing(note));
            }}
            className="min-w-0 flex-1 text-left disabled:cursor-default"
          >
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
                {note.bookRecordId !== null ? <NoteBookCover recordId={note.bookRecordId} title={note.bookTitle ?? ""} /> : <BookOpen className="h-3 w-3" />} {note.bookTitle}
                {note.bookRecordId === null ? " (đã xoá khỏi kệ)" : ""}
              </span>
            ) : null}
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{noteFirstLine(note) || relative(note.updatedAt)}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground/80">
              {where} · {relative(note.updatedAt)}
            </span>
          </button>
          {inTrash ? (
            <button type="button" onClick={() => data.patch.mutate({ id: note.id, deleted: false })} className="press flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Khôi phục
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Thao tác ghi chép" className="press flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="min-h-10" onSelect={() => data.patch.mutate({ id: note.id, pinned: note.pinnedAt === null })}>
                  {note.pinnedAt === null ? "Ghim" : "Bỏ ghim"}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="min-h-10">Chuyển vào…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[50dvh] w-60 overflow-y-auto">
                    <DropdownMenuItem disabled={note.folderId === null} onSelect={() => data.patch.mutate({ id: note.id, folderId: null })} className="min-h-10">
                      Chưa xếp
                    </DropdownMenuItem>
                    {folders.map((folder) => (
                      <DropdownMenuItem key={folder.id} disabled={folder.id === note.folderId} onSelect={() => data.patch.mutate({ id: note.id, folderId: folder.id })} className="min-h-10">
                        <FolderInput className="mr-2 h-4 w-4 shrink-0" /> <span className="truncate">{folderPath(folders, folder.id).join(" › ")}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-10 text-destructive" onSelect={() => deleteNote(note.id)}>
                  Xoá
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </li>
    );
  };

  const editorColumn =
    editing === null ? null : (
      <NoteEditor
        key={`${editing.id}:${editing.revision ?? 0}`}
        initial={editing}
        folders={folders}
        attachments={attachmentsOf(editing.id)}
        notesData={data}
        knownTags={knownTags}
        showBack={false}
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

  const recentNotes = [...notes].filter((note) => !onlyBooks || note.bookRecordId !== null || note.bookTitle !== null).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const recentPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-5 pb-2 pt-4">
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">{onlyBooks ? "Ghi chú sách" : "Gần đây"}</p>
        {onlyBooks && onClearFilter !== undefined ? (
          <button type="button" onClick={onClearFilter} data-notes-filter-clear="" className="press shrink-0 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-accent/50 hover:text-foreground">
            Bỏ lọc
          </button>
        ) : null}
        <button type="button" onClick={pasteFromButton} aria-label="Dán nội dung vừa copy" title="Dán nội dung vừa copy" className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <ClipboardPaste className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setEditing(newNote(null))} className="press inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> Ghi chép
        </button>
      </div>
      <div className="min-h-0 flex-1 scroll-y px-3 pb-6">
        {data.notes.isPending ? null : onlyBooks && recentNotes.length === 0 ? (
          <p className="px-4 py-14 text-center text-[14px] text-muted-foreground">Chưa có ghi chú nào gắn với sách.</p>
        ) : notes.length === 0 ? (
          <div className="mx-auto max-w-sm px-4 py-14 text-center text-[14px] leading-relaxed text-muted-foreground">
            <p>Ghi chép là nơi bạn tự viết ra để đọc lại — bài học, bài giảng, ghi họp dài.</p>
            <p className="mt-2 text-[13px]">Tạo thư mục ở cây bên trái, hoặc bấm + Ghi chép. Dán chữ vừa copy vào đây cũng được.</p>
          </div>
        ) : (
          bucketNotes(onlyBooks ? recentNotes : recentNotes.filter((note) => note.pinnedAt !== null).concat(recentNotes.filter((note) => note.pinnedAt === null).slice(0, RECENT_LIMIT))).map((bucket) => (
            <section key={bucket.key}>
              <p className="px-3 pb-0.5 pt-3 text-[12px] font-medium text-muted-foreground">{bucket.label}</p>
              <ul>{bucket.notes.map((note) => noteRow(note))}</ul>
            </section>
          ))
        )}
      </div>
    </div>
  );

  const trashPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-3">
        <button type="button" onClick={() => setShowTrash(false)} className="press inline-flex h-10 items-center gap-1 rounded-md pl-1 pr-2 text-[14px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" /> {isWide ? "Gần đây" : "Ghi chép"}
        </button>
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">Thùng rác</p>
      </div>
      <p className="px-5 pb-2 text-[12.5px] text-muted-foreground">Ghi chép trong Thùng rác được giữ 30 ngày, cùng tệp đính kèm.</p>
      <div className="min-h-0 flex-1 scroll-y px-2 pb-6">
        {data.trashedNotes.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">Thùng rác trống.</p>
        ) : (
          <ul>{data.trashedNotes.map((note) => noteRow(note, true))}</ul>
        )}
      </div>
    </div>
  );

  const pasteList = recentNotes.slice(0, 12);
  const dialogs = (
    <Dialog open={pasted !== null} onOpenChange={(open) => !open && setPasted(null)}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Dán vào đâu?</DialogTitle>
        <DialogDescription className="line-clamp-3 whitespace-pre-wrap">{pasted?.text.slice(0, 280) ?? ""}</DialogDescription>
        {pasted?.pickingOld === true ? (
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {pasteList.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => {
                    const text = pasted.text;
                    setPasted(null);
                    setShowTrash(false);
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
            {pasteList.length === 0 ? <li className="py-4 text-center text-[13px] text-muted-foreground">Chưa có ghi chép nào.</li> : null}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                const text = pasted?.text ?? "";
                setPasted(null);
                setShowTrash(false);
                setEditing(newNote(null, { blocks: blocksFromText(text), startDirty: true }));
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
  );

  let body: ReactElement;
  if (editorColumn !== null) body = <div className="h-full min-w-0">{editorColumn}</div>;
  else if (showTrash) body = trashPane;
  else if (!isWide && tree !== undefined && !onlyBooks) body = <div className="h-full min-h-0 scroll-y">{tree}</div>;
  else body = recentPane;

  return (
    <div ref={rootRef} className="h-full min-h-0">
      {body}
      {dialogs}
    </div>
  );
}

export { newBlockId };

/** AVORA-103 · C7: a book note shows the book's cover (small) — the same cover as on the shelf. */
function NoteBookCover({ recordId, title }: { recordId: string; title: string }) {
  const { coverOf } = useShelfCovers();
  return <BookCover {...coverOf({ id: recordId, title })} size="mini" className="w-3" />;
}
