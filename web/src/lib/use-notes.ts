import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  createFolder,
  deleteFolder,
  deleteNoteAttachment,
  fetchFolders,
  fetchNoteAttachments,
  fetchNotes,
  noteKeys,
  patchNote,
  renameFolder,
  signedNoteUrls,
  type Note,
  type NoteAttachment,
  type NoteFolder,
} from "@/lib/notes";

/** Folders, notes and their files for the signed-in person. RLS: only their own rows exist. */
export function useNotes({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const on = enabled && userId !== undefined;

  const folders = useQuery<NoteFolder[], Error>({ queryKey: noteKeys.folders, queryFn: fetchFolders, enabled: on, staleTime: 60_000 });
  const notes = useQuery<Note[], Error>({ queryKey: noteKeys.list, queryFn: fetchNotes, enabled: on, staleTime: 30_000 });
  const attachments = useQuery<NoteAttachment[], Error>({
    queryKey: noteKeys.attachments,
    queryFn: fetchNoteAttachments,
    enabled: on,
    staleTime: 30_000,
  });

  const paths = useMemo(() => (attachments.data ?? []).map((item) => item.storagePath), [attachments.data]);
  const urls = useQuery<Map<string, string>, Error>({
    queryKey: [...noteKeys.attachments, "urls", paths.join("|")],
    queryFn: () => signedNoteUrls(paths),
    enabled: on && paths.length > 0,
    staleTime: 8 * 60_000,
  });

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: noteKeys.all });
  }, [queryClient]);

  const addFolder = useMutation({
    mutationFn: (name: string) => createFolder(name, (folders.data ?? []).filter((folder) => !folder.isSystem).length),
    onSuccess: refresh,
  });
  const rename = useMutation({ mutationFn: (input: { id: string; name: string }) => renameFolder(input.id, input.name), onSuccess: refresh });
  const removeFolder = useMutation({
    mutationFn: (input: { id: string; trashNotes: boolean }) => deleteFolder(input.id, input.trashNotes),
    onSuccess: refresh,
  });
  const patch = useMutation({
    mutationFn: (input: { id: string; folderId?: string | null; pinned?: boolean; deleted?: boolean }) => patchNote(input.id, input),
    onSuccess: refresh,
  });
  const removeAttachment = useMutation({ mutationFn: (attachment: NoteAttachment) => deleteNoteAttachment(attachment), onSuccess: refresh });

  const liveNotes = useMemo(() => (notes.data ?? []).filter((note) => note.deletedAt === null), [notes.data]);
  const trashedNotes = useMemo(() => (notes.data ?? []).filter((note) => note.deletedAt !== null), [notes.data]);

  const urlOf = useCallback((path: string): string | null => urls.data?.get(path) ?? null, [urls.data]);

  return {
    userId,
    folders,
    notes,
    liveNotes,
    trashedNotes,
    attachments,
    urlOf,
    refresh,
    addFolder,
    rename,
    removeFolder,
    patch,
    removeAttachment,
  };
}

export type NotesData = ReturnType<typeof useNotes>;
