import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { NoteEditor, type EditingNote } from "@/components/notes/NoteEditor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  arrangeFolders,
  bucketNotes,
  emptyBlock,
  matchesNote,
  newBlockId,
  noteDisplayTitle,
  noteFirstLine,
  readDraft,
  readLastFolder,
  readNotesPlace,
  rememberLastFolder,
  rememberNotesPlace,
  type Note,
  type NoteFilter,
} from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";
import { cn } from "@/lib/utils";

/** Which folder is open: an id, "unsorted" (Chưa xếp), "trash", or null for the folder list. */
type FolderKey = string | "unsorted" | "trash" | null;

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

function toEditing(note: Note): EditingNote {
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
  };
}

/**
 * Ghi chép (AVORA-44 · B): folders first, like notebooks on a shelf; a folder opens its notes;
 * a note opens the editor. A computer shows all three side by side, a phone steps through them.
 * Opening Ghi chép again lands on the folder and note that were open last.
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
  const [folderKey, setFolderKey] = useState<FolderKey>(null);
  const [editing, setEditing] = useState<EditingNote | null>(null);
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<NoteFilter>({ voice: false, files: false, pinned: false });
  const [askFolderFor, setAskFolderFor] = useState<boolean>(false);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string; count: number } | null>(null);
  const [restored, setRestored] = useState<boolean>(false);
  const readingFolder = folders.find((folder) => folder.systemKey === "reading") ?? null;

  // Back to where the person was (folder + note), once the data is here.
  useEffect(() => {
    if (restored || data.folders.data === undefined || data.notes.data === undefined) return;
    setRestored(true);
    const place = readNotesPlace();
    if (place === null) return;
    setFolderKey(place.folderId);
    if (place.noteId !== null) {
      const found = (data.notes.data ?? []).find((note) => note.id === place.noteId && note.deletedAt === null);
      if (found !== undefined) setEditing(toEditing(found));
    }
  }, [restored, data.folders.data, data.notes.data]);

  useEffect(() => {
    if (!restored) return;
    rememberNotesPlace({ folderId: folderKey, noteId: editing?.id ?? null });
  }, [restored, folderKey, editing?.id]);

  // Requests from elsewhere in the app.
  useEffect(() => {
    if (request === null || data.notes.data === undefined || data.folders.data === undefined) return;
    if (request.noteId !== undefined) {
      const found = data.notes.data.find((note) => note.id === request.noteId);
      if (found !== undefined) {
        setFolderKey(found.folderId ?? "unsorted");
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
  const recent = useMemo(() => [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 3), [notes]);
  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const note of notes) for (const tag of note.tags) if (!seen.has(tag.toLocaleLowerCase("vi"))) seen.set(tag.toLocaleLowerCase("vi"), tag);
    return [...seen.values()];
  }, [notes]);
  const attachmentsOf = useCallback((noteId: string) => attachments.filter((item) => item.noteId === noteId), [attachments]);

  const inFolder = useMemo(() => {
    if (folderKey === null) return [];
    const source = folderKey === "trash" ? data.trashedNotes : notes;
    return source
      .filter((note) => (folderKey === "trash" ? true : folderKey === "unsorted" ? note.folderId === null : note.folderId === folderKey))
      .filter((note) => matchesNote(note, query, attachmentsOf(note.id)))
      .filter((note) => !filter.pinned || note.pinnedAt !== null)
      .filter((note) => !filter.voice || attachmentsOf(note.id).some((item) => item.kind === "voice"))
      .filter((note) => !filter.files || attachmentsOf(note.id).some((item) => item.kind !== "voice"));
  }, [folderKey, notes, data.trashedNotes, query, filter, attachmentsOf]);
  const everywhere = useMemo(
    () => (folderKey === null && query.trim() !== "" ? notes.filter((note) => matchesNote(note, query, attachmentsOf(note.id))) : []),
    [folderKey, query, notes, attachmentsOf],
  );

  const openFolder = (key: FolderKey): void => {
    setFolderKey(key);
    setQuery("");
    if (key !== null && key !== "trash" && key !== "unsorted") rememberLastFolder(key);
  };

  const startNote = (folderId: string | null): void => {
    setEditing(newNote(folderId));
    if (folderId !== null) rememberLastFolder(folderId);
  };

  const plusNote = (): void => {
    if (folderKey !== null && folderKey !== "trash") startNote(folderKey === "unsorted" ? null : folderKey);
    else setAskFolderFor(true);
  };

  const folderName = (key: FolderKey): string => {
    if (key === "unsorted") return "Chưa xếp";
    if (key === "trash") return "Thùng rác";
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
            <button type="button" onClick={() => data.patch.mutate({ id: note.id, deleted: false })} className="press flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Khôi phục
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Thao tác ghi chép" className="press rounded-md p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => data.patch.mutate({ id: note.id, pinned: note.pinnedAt === null })}>{note.pinnedAt === null ? "Ghim" : "Bỏ ghim"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => data.patch.mutate({ id: note.id, folderId: null })}>Chuyển vào Chưa xếp</DropdownMenuItem>
                {folders.map((folder) => (
                  <DropdownMenuItem key={folder.id} disabled={folder.id === note.folderId} onSelect={() => data.patch.mutate({ id: note.id, folderId: folder.id })}>
                    <FolderInput className="mr-2 h-4 w-4" /> {folder.name}
                  </DropdownMenuItem>
                ))}
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

  // ---------------------------------------------------------------- columns
  const folderColumn = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={folderKey === null ? query : ""}
            onChange={(event) => {
              setFolderKey(null);
              setQuery(event.target.value);
            }}
            placeholder="Tìm trong Ghi chép · #thẻ"
            aria-label="Tìm trong toàn bộ Ghi chép"
            className="h-10 w-full rounded-full border border-border bg-background pl-8 pr-3 text-[14px] outline-none focus:border-primary"
          />
        </div>
        <button type="button" onClick={plusNote} className="press inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 text-[13.5px] font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> Ghi chép
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : query.trim() !== "" && folderKey === null ? (
          <>
            <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-muted-foreground">{everywhere.length} ghi chép khớp</p>
            <ul>{everywhere.map((note) => noteRow(note))}</ul>
            {everywhere.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{`Không tìm thấy "${query.trim()}"`}</p> : null}
          </>
        ) : (
          <>
            <p className="px-3 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Thư mục</p>
            <ul>
              {summaries.map(({ folder, count, lastEditedAt }) => (
                <li key={folder.id}>
                  <div className={cn("group flex items-center gap-2 rounded-lg pr-1 transition-colors", folderKey === folder.id ? "bg-accent/70" : "hover:bg-accent/35")}>
                    <button type="button" onClick={() => openFolder(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
                      {folder.isSystem ? <BookOpen className="h-[18px] w-[18px] shrink-0 text-amber-600" /> : <Folder className="h-[18px] w-[18px] shrink-0 text-primary" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-foreground">{folder.name}</span>
                        {lastEditedAt !== null ? <span className="block truncate text-[12px] text-muted-foreground">{relative(lastEditedAt)}</span> : null}
                      </span>
                      <span className="tabular text-[12.5px] text-muted-foreground">{count}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" />
                    </button>
                    {folder.isSystem ? null : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" aria-label={`Thao tác thư mục ${folder.name}`} className="press rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-accent group-hover:opacity-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              const name = window.prompt("Tên mới của thư mục", folder.name);
                              if (name === null || name.trim() === "" || name.trim() === folder.name) return;
                              data.rename.mutate({ id: folder.id, name }, { onError: (error) => toast.error(error.message) });
                            }}
                          >
                            Đổi tên
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDeletingFolder({ id: folder.id, name: folder.name, count })}>
                            Xoá thư mục
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
              {unsortedCount > 0 ? (
                <li>
                  <button type="button" onClick={() => openFolder("unsorted")} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors", folderKey === "unsorted" ? "bg-accent/70" : "hover:bg-accent/35")}>
                    <FolderOpen className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-foreground">Chưa xếp</span>
                    <span className="tabular text-[12.5px] text-muted-foreground">{unsortedCount}</span>
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt("Tên thư mục mới", "");
                    if (name === null || name.trim() === "") return;
                    data.addFolder.mutate(name, {
                      onSuccess: (folder) => openFolder(folder.id),
                      onError: (error) => toast.error(error.message),
                    });
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-primary hover:bg-accent/35"
                >
                  <FolderPlus className="h-[18px] w-[18px]" /> Thư mục mới
                </button>
              </li>
            </ul>
            {recent.length > 0 ? (
              <>
                <p className="px-3 pb-1 pt-4 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Gần đây</p>
                <ul>{recent.map((note) => noteRow(note))}</ul>
              </>
            ) : notes.length === 0 ? (
              <p className="px-4 py-6 text-[13.5px] leading-relaxed text-muted-foreground">
                Ghi chép là nơi bạn tự viết ra để đọc lại — bài học, bài giảng, ghi họp dài. Tạo một thư mục, rồi bấm “+ Ghi chép”.
              </p>
            ) : null}
            {data.trashedNotes.length > 0 ? (
              <button type="button" onClick={() => openFolder("trash")} className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent/35">
                <Trash2 className="h-4 w-4" /> Thùng rác · {data.trashedNotes.length}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  const listColumn =
    folderKey === null ? null : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <button type="button" onClick={() => openFolder(null)} aria-label="Về thư mục" className="press rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground md:hidden">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">{folderName(folderKey)}</p>
          {folderKey === "trash" ? null : (
            <button type="button" onClick={plusNote} className="press inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-primary/40 px-3 text-[13px] font-semibold text-primary hover:bg-primary/10">
              <Plus className="h-4 w-4" /> Ghi chép
            </button>
          )}
        </div>
        {folderKey === "trash" ? (
          <p className="px-5 pb-2 text-[12.5px] text-muted-foreground">Ghi chép trong Thùng rác được giữ 30 ngày, cùng tệp đính kèm.</p>
        ) : (
          <div className="space-y-2 px-4 pb-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm trong thư mục · #thẻ"
              aria-label="Tìm trong thư mục"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13.5px] outline-none focus:border-primary"
            />
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
                  className={cn("press rounded-full border px-2.5 py-1 text-[12px]", filter[key] ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {inFolder.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">
              {query.trim() !== "" ? `Không tìm thấy "${query.trim()}"` : folderKey === "trash" ? "Thùng rác trống." : "Chưa có ghi chép nào ở đây."}
            </p>
          ) : folderKey === "trash" ? (
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
        key={editing.id}
        initial={editing}
        folders={folders}
        attachments={attachmentsOf(editing.id)}
        notesData={data}
        knownTags={knownTags}
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

  const dialogs = (
    <>
      <Dialog open={askFolderFor} onOpenChange={setAskFolderFor}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Lưu vào thư mục nào?</DialogTitle>
          <DialogDescription>Đổi được sau.</DialogDescription>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {(() => {
              const last = readLastFolder();
              const ordered = [...summaries].sort((a, b) => (a.folder.id === last ? -1 : b.folder.id === last ? 1 : 0));
              return ordered.map(({ folder }) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAskFolderFor(false);
                      setFolderKey(folder.id);
                      startNote(folder.id);
                    }}
                    className={cn("press flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-[14px]", folder.id === last ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40")}
                  >
                    {folder.isSystem ? <BookOpen className="h-4 w-4 text-amber-600" /> : <Folder className="h-4 w-4 text-primary" />}
                    {folder.name}
                    {folder.id === last ? <span className="ml-auto text-[11.5px] text-primary">dùng gần nhất</span> : null}
                  </button>
                </li>
              ));
            })()}
            <li>
              <button
                type="button"
                onClick={() => {
                  setAskFolderFor(false);
                  setFolderKey("unsorted");
                  startNote(null);
                }}
                className="press flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-left text-[14px] text-muted-foreground hover:bg-accent/40"
              >
                <FolderOpen className="h-4 w-4" /> Chưa xếp
              </button>
            </li>
          </ul>
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
                    if (folderKey === target.id) setFolderKey(target.count > 0 ? "unsorted" : null);
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
                      if (folderKey === target.id) setFolderKey(null);
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

  if (isWide) {
    return (
      <div className="flex h-full min-h-0">
        <div className="w-[260px] shrink-0 border-r border-border">{folderColumn}</div>
        <div className={cn("shrink-0 border-r border-border", listColumn === null ? "w-0" : "w-[300px]")}>{listColumn}</div>
        <div className="min-w-0 flex-1">
          {editorColumn ?? (
            <div className="flex h-full items-center justify-center px-8 text-center text-[14px] text-muted-foreground">
              <p>
                Chọn một ghi chép, hoặc bấm <span className="font-semibold text-foreground">+ Ghi chép</span>.
                <br />
                <span className="text-[13px]">Bạn đang học được điều gì?</span>
              </p>
            </div>
          )}
        </div>
        {dialogs}
      </div>
    );
  }
  return (
    <div className="h-full min-h-0">
      {editorColumn ?? listColumn ?? folderColumn}
      {dialogs}
    </div>
  );
}

export { newBlockId };
