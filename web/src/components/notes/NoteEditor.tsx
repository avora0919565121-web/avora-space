import {
  ChevronLeft,
  IndentDecrease,
  IndentIncrease,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CloudOff,
  FolderOpen,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Pin,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { askConfirm } from "@/components/ConfirmHost";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MessageAttachment } from "@/lib/attachments";
import {
  applyTyping,
  attachmentKindFor,
  blockLabels,
  blocksFromText,
  clearDraft,
  emptyBlock,
  indentBlock,
  isNoteEmpty,
  isOfflineError,
  normalizeTags,
  noteKeys,
  pressBackspaceAtStart,
  pressEnter,
  readDraft,
  readNotesPlace,
  rememberNotePosition,
  saveNote,
  uploadNoteAttachment,
  visibleBlocks,
  writeDraft,
  type Note,
  type NoteAttachment,
  type NoteBlock,
  type NoteFolder,
} from "@/lib/notes";
import { formatRecordingClock, isRecordingSupported, startRecording, stopRecording, useRecorder } from "@/lib/recorder";
import type { NotesData } from "@/lib/use-notes";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const AUTOSAVE_MS = 800;
const INDENT_PX = 16;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "offline" } | { kind: "error" };

/** A note as the editor holds it (the server copy, or the local draft when that is newer). */
export type EditingNote = Pick<Note, "id" | "folderId" | "title" | "blocks" | "tags" | "bookRecordId"> & {
  bookLocator?: string | null;
  pinnedAt: string | null;
  bookTitle: string | null;
  isNew: boolean;
  /** Opened with words already in it (a paste): saved without waiting for a keystroke. */
  startDirty?: boolean;
  /** Bumped to reopen the same note with new content. */
  revision?: number;
};

export function toAttachmentView(item: NoteAttachment): MessageAttachment {
  return {
    id: item.id,
    messageId: item.noteId,
    conversationId: "",
    attachedBy: "",
    kind: item.kind,
    storagePath: item.storagePath,
    fileName: item.fileName,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    width: null,
    height: null,
    durationSeconds: item.durationSeconds,
    permission: "export",
    originMessageId: null,
    createdAt: item.createdAt,
  };
}

function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onFocus,
  onSelectText,
  placeholder,
  className,
  innerRef,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string, caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onSelectText: (text: string) => void;
  placeholder?: string;
  className?: string;
  innerRef: (node: HTMLTextAreaElement | null) => void;
  ariaLabel: string;
}) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const node = local.current;
    if (node === null) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      lang="vi"
      spellCheck
      ref={(node) => {
        local.current = node;
        innerRef(node);
      }}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onSelect={(event) => {
        const node = event.currentTarget;
        onSelectText(node.value.slice(node.selectionStart, node.selectionEnd).trim());
      }}
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/70", className)}
    />
  );
}

/**
 * The Ghi chép editor (AVORA-44 · B): leveled blocks, saved about 800 ms after typing stops, kept
 * on this device while offline and sent as soon as the connection is back. Files are attachments
 * in a strip at the end; a small icon marks where each was added.
 */
export function NoteEditor({
  initial,
  folders,
  attachments,
  notesData,
  knownTags,
  showBack = true,
  fullscreen = null,
  onBack,
  onMove,
  onCreateTask,
  onToBoard,
  onDelete,
  onOpenBook,
}: {
  initial: EditingNote;
  folders: readonly NoteFolder[];
  attachments: readonly NoteAttachment[];
  notesData: NotesData;
  knownTags: readonly string[];
  /** Phone: the ‹ back to the list. A computer keeps the list in sight instead. */
  showBack?: boolean;
  /** Computer: `⤢ Viết toàn màn` / `⤡` (44b · B). */
  fullscreen?: { isOn: boolean; toggle: () => void } | null;
  onBack: () => void;
  onMove: (noteId: string, folderId: string | null) => void;
  onCreateTask: (input: { title: string; text: string; sourceLabel: string }) => void;
  onToBoard: (input: { title: string; text: string }) => void;
  onDelete: (noteId: string) => void;
  onOpenBook: (recordId: string) => void;
}) {
  const queryClient = useQueryClient();
  const userId = notesData.userId;
  const [title, setTitle] = useState<string>(initial.title);
  const [blocks, setBlocks] = useState<NoteBlock[]>(initial.blocks.length > 0 ? initial.blocks : [emptyBlock()]);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagDraft, setTagDraft] = useState<string>("");
  const [folderId, setFolderId] = useState<string | null>(initial.folderId);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [dirty, setDirty] = useState<boolean>(initial.startDirty === true);
  const [exists, setExists] = useState<boolean>(!initial.isNew);
  const [selection, setSelection] = useState<string>("");
  const refs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const focusRef = useRef<{ blockId: string; caret: number } | null>(null);
  const lastFocus = useRef<{ blockId: string; caret: number }>({ blockId: blocks[0]?.id ?? "", caret: 0 });
  const savingRef = useRef<boolean>(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const recorder = useRecorder();
  const noteId = initial.id;

  const labels = useMemo(() => blockLabels(blocks), [blocks]);
  const visible = useMemo(() => visibleBlocks(blocks), [blocks]);
  const folderName = folders.find((folder) => folder.id === folderId)?.name ?? "Chưa xếp";
  const byId = useMemo(() => new Map(attachments.map((item) => [item.id, item] as const)), [attachments]);

  const snapshot = useCallback(
    () => ({ id: noteId, folderId, title, blocks, tags, bookRecordId: initial.bookRecordId, bookLocator: initial.bookLocator ?? null }),
    [noteId, folderId, title, blocks, tags, initial.bookRecordId, initial.bookLocator],
  );

  const persist = useCallback(async (): Promise<void> => {
    const current = snapshot();
    if (!exists && isNoteEmpty(current)) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSave({ kind: "saving" });
    try {
      await saveNote(current);
      clearDraft(noteId);
      setExists(true);
      setDirty(false);
      setSave({ kind: "saved", at: new Date() });
      void queryClient.invalidateQueries({ queryKey: noteKeys.list });
    } catch (error) {
      writeDraft({ ...current, savedLocallyAt: new Date().toISOString() });
      setSave(isOfflineError(error) ? { kind: "offline" } : { kind: "error" });
    } finally {
      savingRef.current = false;
    }
  }, [snapshot, exists, noteId, queryClient]);

  // Autosave: every change restarts the clock; the local draft is written at once so nothing typed is lost.
  useEffect(() => {
    if (!dirty) return;
    const current = snapshot();
    if (exists || !isNoteEmpty(current)) writeDraft({ ...current, savedLocallyAt: new Date().toISOString() });
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, title, blocks, tags, folderId, snapshot, persist, exists]);

  useEffect(() => {
    const back = (): void => {
      if (readDraft(noteId) !== null) void persist();
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [noteId, persist]);

  // Leaving the editor sends whatever is still waiting.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => () => void persistRef.current(), []);

  // Place the caret after a structural edit, and remember it for "quay lại đúng chỗ".
  useLayoutEffect(() => {
    const target = focusRef.current;
    if (target === null) return;
    focusRef.current = null;
    const node = refs.current.get(target.blockId);
    if (node === undefined) return;
    node.focus();
    node.setSelectionRange(target.caret, target.caret);
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const remember = useCallback(
    (blockId: string, caret: number): void => {
      lastFocus.current = { blockId, caret };
      rememberNotePosition({ noteId, blockId, caret, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    },
    [noteId],
  );

  // Việc 2: reopening a note lands on the same caret and scroll it was left at.
  useLayoutEffect(() => {
    const place = readNotesPlace();
    if (place === null || place.noteId !== noteId) return;
    const node = scrollRef.current;
    if (node !== null && typeof place.scrollTop === "number") node.scrollTop = place.scrollTop;
    const blockId = place.blockId ?? null;
    if (blockId === null) return;
    const field = refs.current.get(blockId);
    if (field === undefined) return;
    const caret = Math.min(place.caret ?? 0, field.value.length);
    lastFocus.current = { blockId, caret };
    field.focus({ preventScroll: true });
    field.setSelectionRange(caret, caret);
    // noteId is the editor's identity (it is keyed on it); this runs once per opened note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The scroll position is kept as the reader moves, not only when the caret moves.
  const onEditorScroll = useCallback((): void => {
    rememberNotePosition({ noteId, scrollTop: scrollRef.current?.scrollTop ?? 0 });
  }, [noteId]);

  const change = (next: NoteBlock[], focus?: { blockId: string; caret: number }): void => {
    setBlocks(next);
    setDirty(true);
    if (focus !== undefined) focusRef.current = focus;
  };

  const onBlockKey = (index: number) => (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const node = event.currentTarget;
    const caret = node.selectionStart;
    const hasSelection = node.selectionStart !== node.selectionEnd;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const result = pressEnter(blocks, index, caret);
      change(result.blocks, { blockId: result.blocks[result.focusIndex].id, caret: result.focusCaret });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const next = [...blocks];
      next[index] = indentBlock(blocks[index], event.shiftKey ? -1 : 1);
      change(next, { blockId: next[index].id, caret });
      return;
    }
    if (event.key === "Backspace" && caret === 0 && !hasSelection) {
      const result = pressBackspaceAtStart(blocks, index);
      if (result === null) return;
      event.preventDefault();
      change(result.blocks, { blockId: result.blocks[result.focusIndex].id, caret: result.focusCaret });
      return;
    }
    if (event.key === "ArrowUp" && caret === 0 && index > 0) {
      const previous = blocks.slice(0, index).reverse().find((_, back) => visible[index - 1 - back]);
      if (previous !== undefined) {
        event.preventDefault();
        focusRef.current = { blockId: previous.id, caret: previous.text.length };
        setBlocks([...blocks]);
      }
    }
  };

  const indentFocused = (direction: 1 | -1): void => {
    const index = blocks.findIndex((block) => block.id === lastFocus.current.blockId);
    if (index < 0) return;
    const next = [...blocks];
    next[index] = indentBlock(blocks[index], direction);
    change(next, { blockId: next[index].id, caret: lastFocus.current.caret });
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    if (userId === undefined) return;
    if (!exists) await persist();
    const anchor = lastFocus.current.blockId;
    for (const file of files) {
      try {
        const saved = await uploadNoteAttachment({
          userId,
          noteId,
          file,
          fileName: file.name || "Ảnh",
          kind: attachmentKindFor(file.type),
          anchorBlockId: anchor,
        });
        setBlocks((current) =>
          current.map((block) => (block.id === anchor ? { ...block, attachmentRefs: [...(block.attachmentRefs ?? []), saved.id] } : block)),
        );
        setDirty(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không đính kèm được tệp này.");
      }
    }
    void queryClient.invalidateQueries({ queryKey: noteKeys.attachments });
  };

  const onBlockPaste = (index: number) => (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    event.preventDefault();
    const node = event.currentTarget;
    const current = blocks[index];
    const before = current.text.slice(0, node.selectionStart);
    const after = current.text.slice(node.selectionEnd);
    const pasted = blocksFromText(text);
    const first = pasted[0];
    const last = pasted[pasted.length - 1];
    const merged: NoteBlock[] = [
      { ...current, text: before + first.text, level: current.level ?? first.level },
      ...pasted.slice(1, -1),
      ...(pasted.length > 1 ? [{ ...last, text: last.text + after }] : []),
    ];
    if (pasted.length === 1) merged[0] = { ...merged[0], text: merged[0].text + after };
    const next = [...blocks.slice(0, index), ...merged, ...blocks.slice(index + 1)];
    const focusBlock = merged[merged.length - 1];
    change(next, { blockId: focusBlock.id, caret: focusBlock.text.length - after.length });
  };

  const startVoice = (): void => {
    if (userId === undefined) return;
    const anchor = lastFocus.current.blockId;
    void (async () => {
      if (!exists) await persist();
      await startRecording({
        target: "note",
        ownerKey: noteId,
        returnTo: `${window.location.pathname}${window.location.search}`,
        done: (result) => {
          const extension = result.blob.type.includes("mp4") ? "m4a" : "webm";
          const stamp = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
          void uploadNoteAttachment({
            userId,
            noteId,
            file: result.blob,
            fileName: `Ghi âm ${stamp}.${extension}`,
            kind: "voice",
            durationSeconds: result.durationSeconds,
            anchorBlockId: anchor,
          })
            .then(async (saved) => {
              // The editor may be closed by now: the icon is written straight into the stored note.
              setBlocks((current) =>
                current.map((block) => (block.id === anchor ? { ...block, attachmentRefs: [...(block.attachmentRefs ?? []), saved.id] } : block)),
              );
              setDirty(true);
              toast.success("Đã lưu bản ghi âm vào ghi chép.");
              void queryClient.invalidateQueries({ queryKey: noteKeys.all });
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được bản ghi âm."));
        },
      });
    })().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không dùng được micro."));
  };

  const removeIcon = (blockId: string, attachmentId: string): void => {
    change(blocks.map((block) => (block.id === blockId ? { ...block, attachmentRefs: (block.attachmentRefs ?? []).filter((id) => id !== attachmentId) } : block)));
  };

  const addTag = (raw: string): void => {
    const next = normalizeTags([...tags, raw]);
    setTags(next);
    setTagDraft("");
    setDirty(true);
  };
  const tagSuggestions = useMemo(() => {
    const needle = tagDraft.replace(/^#/, "").trim().toLocaleLowerCase("vi");
    if (needle === "") return [];
    const mine = new Set(tags.map((tag) => tag.toLocaleLowerCase("vi")));
    return knownTags.filter((tag) => tag.toLocaleLowerCase("vi").includes(needle) && !mine.has(tag.toLocaleLowerCase("vi"))).slice(0, 5);
  }, [tagDraft, tags, knownTags]);

  const plain = (): string => blocks.map((block, index) => (labels[index] === null ? block.text : `${labels[index]} ${block.text}`)).join("\n");
  const displayTitle = title.trim() === "" ? (blocks.find((block) => block.text.trim() !== "")?.text.trim().slice(0, 120) ?? "Ghi chép mới") : title.trim();
  const isRecordingHere = recorder.isRecording && recorder.ownerKey === noteId;
  const sourceOfSelection = initial.bookRecordId !== null ? `Từ sách ${initial.bookTitle ?? ""}` : `Từ ghi chép ${displayTitle}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 md:px-8">
        {showBack ? (
          <button type="button" onClick={onBack} aria-label="Về danh sách" data-back="" className="press flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="press flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground">
              <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.7} />
              <span className="truncate">{folderName}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => { setFolderId(null); setDirty(true); onMove(noteId, null); }}>Chưa xếp</DropdownMenuItem>
            {folders.map((folder) => (
              <DropdownMenuItem key={folder.id} onSelect={() => { setFolderId(folder.id); setDirty(true); onMove(noteId, folder.id); }}>
                {folder.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground" aria-live="polite">
          {save.kind === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang lưu…
            </>
          ) : save.kind === "saved" ? (
            <>
              <Check className="h-3.5 w-3.5" /> Đã lưu · {save.at.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
            </>
          ) : save.kind === "offline" ? (
            <span className="flex items-center gap-1 text-amber-600">
              <CloudOff className="h-3.5 w-3.5" /> Chưa lưu — sẽ lưu khi có mạng
            </span>
          ) : save.kind === "error" ? (
            <button type="button" onClick={() => void persist()} className="text-destructive underline underline-offset-2">
              Chưa lưu được — thử lại
            </button>
          ) : null}
        </span>
        {fullscreen !== null ? (
          <button
            type="button"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.isOn ? "Thu lại (Esc)" : "Viết toàn màn"}
            title={fullscreen.isOn ? "Thu lại (Esc)" : "Viết toàn màn"}
            className="press rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            {fullscreen.isOn ? <Minimize2 className="h-[18px] w-[18px]" strokeWidth={1.7} /> : <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.7} />}
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Thêm thao tác" className="press rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
              <MoreHorizontal className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onCreateTask({ title: displayTitle, text: selection !== "" ? selection : plain(), sourceLabel: `Từ ghi chép ${displayTitle}` })}>
              Tạo nhiệm vụ
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToBoard({ title: displayTitle, text: selection !== "" ? selection : plain() })}>Đưa vào Bảng</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void persist().then(() => notesData.patch.mutate({ id: noteId, pinned: initial.pinnedAt === null }));
              }}
            >
              <Pin className="mr-2 h-4 w-4" /> {initial.pinnedAt === null ? "Ghim" : "Bỏ ghim"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(noteId)}>
              <Trash2 className="mr-2 h-4 w-4" /> Xoá
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={scrollRef} onScroll={onEditorScroll} className="min-h-0 flex-1 scroll-y px-4 pb-28 pt-5 md:px-10">
        <div className="mx-auto max-w-2xl">
          {initial.bookRecordId !== null || initial.bookTitle !== null ? (
            <button
              type="button"
              onClick={() => initial.bookRecordId !== null && onOpenBook(initial.bookRecordId)}
              className="press mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[12.5px] font-medium text-amber-700 dark:text-amber-300"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {initial.bookTitle ?? "Sách"}
              {initial.bookRecordId === null ? " (đã xoá khỏi kệ)" : ""}
            </button>
          ) : null}
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
            maxLength={200}
            placeholder="Tiêu đề"
            title="Để trống thì lấy dòng đầu"
            aria-label="Tiêu đề ghi chép"
            className="w-full bg-transparent text-[24px] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[12.5px] text-primary">
                #{tag}
                <button type="button" aria-label={`Bỏ thẻ ${tag}`} onClick={() => { setTags(tags.filter((item) => item !== tag)); setDirty(true); }}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <span className="relative inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              <input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === ",") && tagDraft.trim() !== "") {
                    event.preventDefault();
                    addTag(tagDraft);
                  }
                }}
                placeholder="#thẻ"
                aria-label="Thêm thẻ"
                className="w-28 bg-transparent outline-none placeholder:text-muted-foreground/60"
              />
              {tagSuggestions.length > 0 ? (
                <span className="absolute left-0 top-6 z-20 flex flex-col rounded-md border border-border bg-popover p-1 shadow-md">
                  {tagSuggestions.map((tag) => (
                    <button key={tag} type="button" onClick={() => addTag(tag)} className="rounded px-2 py-1 text-left text-[12.5px] hover:bg-accent">
                      #{tag}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>

          <div className="mt-5 space-y-0.5">
            {blocks.map((block, index) => {
              if (!visible[index]) return null;
              const label = labels[index];
              const icons = (block.attachmentRefs ?? []).map((id) => byId.get(id)).filter((item): item is NoteAttachment => item !== undefined);
              return (
                <div key={block.id} className="group flex items-start gap-1.5" style={{ paddingLeft: block.level === null ? 0 : block.level * INDENT_PX }}>
                  {label !== null ? (
                    <button
                      type="button"
                      onClick={() => change(blocks.map((item) => (item.id === block.id ? { ...item, collapsed: item.collapsed !== true } : item)))}
                      aria-label={block.collapsed === true ? "Mở nhánh" : "Thu gọn nhánh"}
                      className={cn(
                        "tabular mt-[3px] min-w-[1.6rem] shrink-0 select-none rounded text-right text-[15px] font-semibold leading-7 text-primary/80 hover:text-primary",
                        block.collapsed === true && "underline decoration-dotted underline-offset-4",
                      )}
                    >
                      {label}
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <AutoTextarea
                      value={block.text}
                      ariaLabel={label === null ? "Đoạn" : `Mục ${label}`}
                      innerRef={(node) => {
                        if (node === null) refs.current.delete(block.id);
                        else refs.current.set(block.id, node);
                      }}
                      placeholder={
                        index === 0 && blocks.length === 1
                          ? "Bạn đang học được điều gì?"
                          : initial.bookRecordId !== null && index === blocks.length - 1 && block.text === ""
                            ? "Điều này áp dụng vào đâu?"
                            : undefined
                      }
                      onChange={(value, caret) => {
                        const next = [...blocks];
                        const typed = applyTyping(block, value);
                        next[index] = typed;
                        const shift = value.length - typed.text.length;
                        change(next, shift > 0 ? { blockId: block.id, caret: Math.max(0, caret - shift) } : undefined);
                        remember(block.id, caret);
                      }}
                      onKeyDown={onBlockKey(index)}
                      onPaste={onBlockPaste(index)}
                      onFocus={() => remember(block.id, refs.current.get(block.id)?.selectionStart ?? 0)}
                      onSelectText={setSelection}
                      className={cn("py-[3px] text-[16px] leading-7 text-foreground", block.level === 0 && "font-semibold")}
                    />
                    {icons.length > 0 ? (
                      <span className="mb-1 flex flex-wrap gap-1">
                        {icons.map((item) => (
                          <span key={item.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => document.getElementById(`note-file-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              {item.kind === "voice" ? <Mic className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
                              <span className="max-w-[9rem] truncate">{item.fileName}</span>
                            </button>
                            <button type="button" aria-label="Bỏ biểu tượng (tệp vẫn còn)" onClick={() => removeIcon(block.id, item.id)} className="opacity-60 hover:opacity-100">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {attachments.length > 0 ? (
            <section aria-label="Đính kèm" className="mt-8 border-t border-border pt-4">
              <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Đính kèm · {attachments.length}</p>
              <ul className="space-y-2">
                {attachments.map((item) => (
                  <li key={item.id} id={`note-file-${item.id}`} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <MessageAttachments attachments={[toAttachmentView(item)]} urlOf={notesData.urlOf} outgoing={false} />
                    </div>
                    <button
                      type="button"
                      aria-label={`Xoá tệp ${item.fileName}`}
                      onClick={() => {
                        void askConfirm({ title: `Xoá tệp "${item.fileName}" khỏi ghi chép?`, confirmLabel: "Xoá tệp", danger: true }).then((ok) => {
                          if (!ok) return;
                          change(blocks.map((block) => ({ ...block, attachmentRefs: (block.attachmentRefs ?? []).filter((id) => id !== item.id) })));
                          notesData.removeAttachment.mutate(item);
                        });
                      }}
                      className="press mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {selection !== "" ? (
            <div role="toolbar" aria-label="Áp dụng đoạn đã chọn" className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-card p-2 shadow-lg">
              <span className="px-1 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">Áp dụng</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onToBoard({ title: selection.slice(0, 120), text: `${sourceOfSelection}\n\n${selection}` })}
                className="press whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-[13px]"
              >
                Tạo Hạng mục
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onCreateTask({ title: selection.slice(0, 120), text: selection, sourceLabel: sourceOfSelection })}
                className="press rounded-md bg-primary px-2.5 py-1.5 text-[13px] font-semibold text-primary-foreground"
              >
                Tạo nhiệm vụ
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        The small toolbar that sits over the phone keyboard. With the keyboard up it is pinned to
        the bottom of what is actually visible (visualViewport, `--vv-bottom` from KeyboardSync) —
        not to window.innerHeight, which on iPhone left a gap above the keyboard (100 · S.1).
      */}
      <div
        data-note-toolbar=""
        className="flex items-center gap-1 border-t border-border bg-card px-3 py-2 md:px-8 [html[data-keyboard=open]_&]:fixed [html[data-keyboard=open]_&]:inset-x-0 [html[data-keyboard=open]_&]:z-30 [html[data-keyboard=open]_&]:bottom-[calc(100%-var(--vv-bottom,100%))]"
      >
        <button type="button" aria-label="Lùi một cấp" onMouseDown={(event) => event.preventDefault()} onClick={() => indentFocused(-1)} className="press rounded-md p-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <IndentDecrease className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Thụt vào một cấp" onMouseDown={(event) => event.preventDefault()} onClick={() => indentFocused(1)} className="press rounded-md p-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <IndentIncrease className="h-[18px] w-[18px]" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <span className="flex-1" aria-hidden="true" />
        <button type="button" aria-label="Đính kèm tệp" onClick={() => fileInput.current?.click()} className="press rounded-md p-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <Paperclip className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Chụp ảnh" onClick={() => cameraInput.current?.click()} className="press rounded-md p-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <Camera className="h-[18px] w-[18px]" />
        </button>
        {isRecordingSupported() ? (
          isRecordingHere ? (
            <button type="button" onClick={() => stopRecording()} className="press ml-1 inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-[13px] font-semibold text-destructive-foreground">
              <Square className="h-3.5 w-3.5 fill-current" /> {formatRecordingClock(recorder.elapsedSeconds)} · Dừng
            </button>
          ) : (
            <button
              type="button"
              aria-label="Ghi âm (tối đa 30 phút)"
              disabled={recorder.isRecording}
              onClick={startVoice}
              className="press rounded-md p-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
            >
              <Mic className="h-[18px] w-[18px]" />
            </button>
          )
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void addFiles(files);
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void addFiles(files);
          }}
        />
      </div>
    </div>
  );
}
