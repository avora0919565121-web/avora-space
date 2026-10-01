import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { askConfirm, askText } from "@/components/ConfirmHost";
import { openAvoraSearch } from "@/components/search/AvoraSearch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canAddSubFolder,
  countInSubtree,
  folderPath,
  folderSubtreeIds,
  matchesNote,
  moveTargets,
  noteDisplayTitle,
  readOpenFolders,
  rememberOpenFolders,
  type Note,
  type NoteFilter,
  type NoteFolder,
} from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";
import { cn } from "@/lib/utils";

/** Root-level marker for the virtual "Chưa xếp" row (notes with no folder). */
export const UNSORTED_KEY = "unsorted";

function shortAge(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hôm qua";
  if (days < 30) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

function byOrder(a: NoteFolder, b: NoteFolder): number {
  if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
  if (a.position !== b.position) return a.position - b.position;
  return a.name.localeCompare(b.name, "vi");
}

/**
 * Ghi chép as a tree, unfolded in place (AVORA-52 · A). Folders open and close; a note opens in
 * the pane beside (or full screen on a phone). Up to three folder levels; the reading folder is a
 * system folder with no children. Which folders are open is remembered on this device.
 */
export function NotesTree({
  data,
  activeNoteId,
  showTrash,
  onOpenNote,
  onNewNote,
  onOpenTrash,
  header,
}: {
  data: NotesData;
  activeNoteId: string | null;
  showTrash: boolean;
  onOpenNote: (note: Note) => void;
  /** Starts a note in this folder (null = Chưa xếp). */
  onNewNote: (folderId: string | null) => void;
  onOpenTrash: () => void;
  /** The `▾ Ghi chép (n) ＋` line, drawn by the place that holds the tree. */
  header?: ReactNode;
}) {
  const folders = useMemo(() => data.folders.data ?? [], [data.folders.data]);
  const notes = data.liveNotes;
  const attachments = useMemo(() => data.attachments.data ?? [], [data.attachments.data]);
  const [open, setOpen] = useState<Set<string>>(() => readOpenFolders());
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<NoteFilter>({ voice: false, files: false, pinned: false });
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  useEffect(() => rememberOpenFolders(open), [open]);

  const hasFilter = filter.voice || filter.files || filter.pinned;
  const isSearching = query.trim() !== "" || hasFilter;

  const matching = useMemo(() => {
    if (!isSearching) return null;
    return new Set(
      notes
        .filter((note) => matchesNote(note, query, attachments.filter((item) => item.noteId === note.id)))
        .filter((note) => !filter.pinned || note.pinnedAt !== null)
        .filter((note) => !filter.voice || attachments.some((item) => item.noteId === note.id && item.kind === "voice"))
        .filter((note) => !filter.files || attachments.some((item) => item.noteId === note.id && item.kind !== "voice"))
        .map((note) => note.id),
    );
  }, [isSearching, notes, query, attachments, filter]);

  /** While searching, a folder shows only if something inside its subtree matches (path kept). */
  const folderHasMatch = (folderId: string): boolean => {
    if (matching === null) return true;
    const ids = folderSubtreeIds(folders, folderId);
    return notes.some((note) => matching.has(note.id) && note.folderId !== null && ids.has(note.folderId));
  };
  const visibleNotes = (folderId: string | null): Note[] =>
    notes
      .filter((note) => note.folderId === folderId && (matching === null || matching.has(note.id)))
      .sort((a, b) => {
        if ((a.pinnedAt !== null) !== (b.pinnedAt !== null)) return a.pinnedAt !== null ? -1 : 1;
        return a.updatedAt < b.updatedAt ? 1 : -1;
      });

  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addFolder = (parentId: string | null): void => {
    void askText({ title: parentId === null ? "Thư mục mới" : "Thư mục con", confirmLabel: "Tạo", maxLength: 80 }).then((name) => {
      if (name === null || name.trim() === "") return;
      data.addFolder.mutate(
        { name, parentId },
        {
          onSuccess: (folder) => {
            setOpen((current) => new Set([...current, ...(parentId === null ? [] : [parentId]), folder.id]));
            setSelectedFolder(folder.id);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    });
  };

  const renameFolder = (folder: NoteFolder): void => {
    void askText({ title: "Tên mới của thư mục", initial: folder.name, maxLength: 80 }).then((name) => {
      if (name === null || name.trim() === "" || name === folder.name) return;
      data.rename.mutate({ id: folder.id, name }, { onError: (error) => toast.error(error.message) });
    });
  };

  const deleteFolder = (folder: NoteFolder): void => {
    const count = countInSubtree(folders, notes, folder.id);
    void askConfirm({
      title: `Xoá thư mục "${folder.name}"?`,
      body:
        count === 0
          ? "Thư mục (và thư mục con) đang trống."
          : `${count} ghi chép bên trong (kể cả thư mục con) sẽ về "Chưa xếp".`,
      confirmLabel: "Xoá thư mục",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      data.removeFolder.mutate(
        { id: folder.id, trashNotes: false },
        {
          onSuccess: () => toast.success(count > 0 ? `Đã xoá thư mục. ${count} ghi chép ở "Chưa xếp".` : "Đã xoá thư mục."),
          onError: (error) => toast.error(error.message),
        },
      );
    });
  };

  const moveFolder = (folder: NoteFolder, parentId: string | null): void => {
    data.move.mutate(
      { id: folder.id, parentId },
      {
        onSuccess: () => {
          if (parentId !== null) setOpen((current) => new Set([...current, parentId]));
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const noteRow = (note: Note, depth: number) => (
    <li key={note.id}>
      <button
        type="button"
        onClick={() => onOpenNote(note)}
        style={{ paddingLeft: 12 + depth * 16 }}
        aria-current={note.id === activeNoteId ? "true" : undefined}
        className={cn(
          "press flex min-h-10 w-full items-center gap-2 rounded-md pr-2 text-left transition-colors",
          note.id === activeNoteId ? "bg-accent/80" : "hover:bg-accent/35",
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{noteDisplayTitle(note)}</span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">{shortAge(note.updatedAt)}</span>
      </button>
    </li>
  );

  const folderNode = (folder: NoteFolder, depth: number): ReactNode => {
    if (!folderHasMatch(folder.id) && matching !== null) return null;
    const children = folders.filter((child) => child.parentId === folder.id).sort(byOrder);
    const isOpen = matching !== null || open.has(folder.id);
    const count = countInSubtree(folders, notes, folder.id);
    const Icon = folder.isSystem ? BookOpen : isOpen ? FolderOpen : Folder;
    const targets = folder.isSystem ? [] : moveTargets(folders, folder.id).filter((target) => target.id !== folder.parentId);
    return (
      <li key={folder.id}>
        <div
          className={cn(
            "group flex items-center rounded-md transition-colors",
            selectedFolder === folder.id ? "bg-accent/50" : "hover:bg-accent/35",
          )}
        >
          <button
            type="button"
            onClick={() => {
              toggle(folder.id);
              setSelectedFolder(folder.id);
            }}
            aria-expanded={isOpen}
            style={{ paddingLeft: 4 + depth * 16 }}
            className="press flex min-h-10 min-w-0 flex-1 items-center gap-1.5 pr-1 text-left"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <Icon className={cn("h-4 w-4 shrink-0", folder.isSystem ? "text-amber-600" : "text-primary")} strokeWidth={1.7} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{folder.name}</span>
            <span className="tabular shrink-0 text-[12px] text-muted-foreground">{count}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Thao tác thư mục ${folder.name}`}
                className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-accent group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => onNewNote(folder.id)} className="min-h-10 gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" /> Ghi chép mới ở đây
              </DropdownMenuItem>
              {folder.isSystem ? (
                <DropdownMenuLabel className="text-[11.5px] font-normal text-muted-foreground">
                  Thư mục hệ thống: không có thư mục con, không đổi tên, không xoá.
                </DropdownMenuLabel>
              ) : (
                <>
                  <DropdownMenuItem disabled={!canAddSubFolder(folders, folder)} onSelect={() => addFolder(folder.id)} className="min-h-10 gap-2">
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block">Thư mục con</span>
                      {!canAddSubFolder(folders, folder) ? <span className="block text-[11.5px] text-muted-foreground">Đã đủ 3 tầng</span> : null}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => renameFolder(folder)} className="min-h-10">
                    Đổi tên
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="min-h-10">Chuyển</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[50dvh] w-60 overflow-y-auto">
                      {folder.parentId !== null ? (
                        <DropdownMenuItem onSelect={() => moveFolder(folder, null)} className="min-h-10">
                          Lên tầng trên cùng
                        </DropdownMenuItem>
                      ) : null}
                      {targets.map((target) => (
                        <DropdownMenuItem key={target.id} onSelect={() => moveFolder(folder, target.id)} className="min-h-10">
                          <span className="truncate">{folderPath(folders, target.id).join(" › ")}</span>
                        </DropdownMenuItem>
                      ))}
                      {targets.length === 0 && folder.parentId === null ? (
                        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">Không còn chỗ chuyển (tối đa 3 tầng).</DropdownMenuLabel>
                      ) : null}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => deleteFolder(folder)} className="min-h-10 text-destructive focus:text-destructive">
                    Xoá
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen ? (
          <ul>
            {children.map((child) => folderNode(child, depth + 1))}
            {visibleNotes(folder.id).map((note) => noteRow(note, depth + 1))}
            {children.length === 0 && visibleNotes(folder.id).length === 0 && matching === null ? (
              <li style={{ paddingLeft: 30 + depth * 16 }} className="py-1.5 text-[12.5px] text-muted-foreground">
                Trống
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const roots = folders.filter((folder) => folder.parentId === null).sort(byOrder);
  const unsorted = visibleNotes(null);
  const unsortedOpen = matching !== null || open.has(UNSORTED_KEY);
  const isLoading = data.folders.isPending || data.notes.isPending;
  /** New note from the header goes into the folder last touched in the tree, else Chưa xếp. */
  const targetForNew = selectedFolder !== null && folders.some((folder) => folder.id === selectedFolder) ? selectedFolder : null;

  return (
    <div className="pb-2">
      {header}
      <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm ghi chép · #thẻ"
            aria-label="Tìm ghi chép"
            className="h-10 w-full rounded-full border border-border bg-background pl-8 pr-3 text-[14px] outline-none focus:border-primary"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Lọc ghi chép"
              className={cn(
                "press relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                hasFilter ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {(
              [
                ["voice", "Có ghi âm"],
                ["files", "Có tệp"],
                ["pinned", "Đã ghim"],
              ] as const
            ).map(([key, label]) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={filter[key]}
                onCheckedChange={(checked) => setFilter((current) => ({ ...current, [key]: checked === true }))}
                onSelect={(event) => event.preventDefault()}
                className="min-h-10"
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {query.trim() !== "" ? (
        <button
          type="button"
          onClick={() => openAvoraSearch({ query: query.trim(), here: { tab: "nhat-ky", label: "Ghi chép" } })}
          className="press mx-2 mb-1 block rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-primary hover:bg-primary/5"
        >
          Tìm "{query.trim()}" trong toàn AVORA ›
        </button>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-6" role="status" aria-label="Đang tải ghi chép">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ul aria-label="Cây ghi chép" className="px-1">
          {roots.map((folder) => folderNode(folder, 0))}
          {unsorted.length > 0 || (matching === null && notes.some((note) => note.folderId === null)) ? (
            <li>
              <button
                type="button"
                onClick={() => toggle(UNSORTED_KEY)}
                aria-expanded={unsortedOpen}
                className="press flex min-h-10 w-full items-center gap-1.5 rounded-md pl-1 pr-2 text-left hover:bg-accent/35"
              >
                {unsortedOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">Chưa xếp</span>
                <span className="tabular shrink-0 text-[12px] text-muted-foreground">{notes.filter((note) => note.folderId === null).length}</span>
              </button>
              {unsortedOpen ? <ul>{unsorted.map((note) => noteRow(note, 1))}</ul> : null}
            </li>
          ) : null}
          {matching !== null && matching.size === 0 ? (
            <li className="px-3 py-4 text-center text-[13px] text-muted-foreground">Không thấy ghi chép nào khớp.</li>
          ) : null}
          {matching === null ? (
            <>
              <li>
                <button
                  type="button"
                  onClick={() => addFolder(null)}
                  className="press flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-primary hover:bg-accent/35"
                >
                  <FolderPlus className="h-4 w-4" aria-hidden="true" /> Thư mục mới
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNewNote(targetForNew)}
                  className="press flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-primary hover:bg-accent/35"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Ghi chép mới
                  {targetForNew !== null ? (
                    <span className="truncate text-[12px] text-muted-foreground">trong {folders.find((folder) => folder.id === targetForNew)?.name}</span>
                  ) : null}
                </button>
              </li>
              {data.trashedNotes.length > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={onOpenTrash}
                    aria-current={showTrash ? "true" : undefined}
                    className={cn(
                      "press flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-muted-foreground hover:bg-accent/35",
                      showTrash && "bg-accent/60 text-foreground",
                    )}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Thùng rác ({data.trashedNotes.length})
                  </button>
                </li>
              ) : null}
            </>
          ) : null}
        </ul>
      )}
    </div>
  );
}
