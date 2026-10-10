import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { MAX_ATTACHMENT_BYTES, signedUrlsFor } from "@/lib/attachments";
import { logError } from "@/lib/log";

/**
 * AVORA-104 · PHẦN 2 · 2.5 — files on a task (`Thêm tệp`).
 *
 * Read by whoever sees the task, added by whoever may edit it, removed by the uploader or the
 * task's creator — all decided by RLS on `task_files` and the private `task-files` bucket. Files of
 * the message a task came from are only referenced (ADR-012): read from `message_attachments`,
 * never copied here.
 */
export type TaskFile = {
  id: string;
  taskId: string;
  uploadedBy: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  /** "own" = attached to the task; "message" = a file of the message the task came from. */
  origin: "own" | "message";
};

type Row = {
  id: string;
  task_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
};

const COLUMNS = "id, task_id, uploaded_by, storage_path, file_name, mime_type, byte_size, created_at";
const BUCKET = "task-files";

export const taskFileKeys = {
  all: ["task-files"] as const,
  task: (taskId: string) => ["task-files", taskId] as const,
  message: (messageIds: readonly string[]) => ["task-files", "message", ...messageIds] as const,
};

function toFile(row: Row): TaskFile {
  return {
    id: row.id,
    taskId: row.task_id,
    uploadedBy: row.uploaded_by,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
    origin: "own",
  };
}

function fail(code: string | undefined, message: string): Error {
  logError("task-files", { code, message });
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return new Error("Chỉ người tải lên hoặc người tạo việc làm được việc này.");
  }
  if (/exceeded|too large|payload|byte_size/i.test(message)) return new Error("Tệp quá lớn (tối đa 25 MB).");
  return new Error("Không xử lý được tệp. Vui lòng thử lại.");
}

export async function fetchTaskFiles(taskId: string): Promise<TaskFile[]> {
  const { data, error } = await supabase
    .from("task_files" as never)
    .select(COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw fail(error.code, error.message);
  return ((data ?? []) as unknown as Row[]).map(toFile);
}

/** Uploads into `<task>/<uuid>-<name>`, then records the row; a refused row takes its object back out. */
export async function uploadTaskFile(taskId: string, file: File): Promise<TaskFile> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("Tệp quá lớn (tối đa 25 MB).");
  if (file.size === 0) throw new Error("Tệp trống.");
  const safe = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "tep";
  const path = `${taskId}/${crypto.randomUUID()}-${safe}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) throw fail(undefined, uploadError.message);
  const { data, error } = await supabase
    .from("task_files" as never)
    .insert({
      task_id: taskId,
      storage_path: path,
      file_name: file.name.slice(0, 255) || "tệp",
      mime_type: (file.type || "application/octet-stream").slice(0, 255),
      byte_size: file.size,
    } as never)
    .select(COLUMNS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw fail(error.code, error.message);
  }
  return toFile(data as unknown as Row);
}

/** Removes the row first (RLS decides who may), then the object. */
export async function deleteTaskFile(file: TaskFile): Promise<void> {
  const { data, error } = await supabase.from("task_files" as never).delete().eq("id", file.id).select("id");
  if (error) throw fail(error.code, error.message);
  if (((data ?? []) as unknown[]).length === 0) throw fail("42501", "permission denied");
  await supabase.storage.from(BUCKET).remove([file.storagePath]);
}

/** Opens a file: a ten-minute link from whichever bucket holds it. */
export async function openTaskFile(file: TaskFile): Promise<string> {
  if (file.origin === "message") {
    const urls = await signedUrlsFor([file.storagePath]);
    const url = urls.get(file.storagePath);
    if (url === undefined) throw new Error("Không mở được tệp này.");
    return url;
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storagePath, 600);
  if (error || data === null) throw fail(undefined, error?.message ?? "no url");
  return data.signedUrl;
}

/** The files of the message(s) a task came from — referenced, not copied (ADR-012). */
export async function fetchMessageFiles(taskId: string, messageIds: readonly string[]): Promise<TaskFile[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, message_id, attached_by, storage_path, file_name, mime_type, byte_size, created_at")
    .in("message_id", [...messageIds])
    .order("created_at", { ascending: true })
    // rows-bounded: a message carries at most 10 files; a task points at a handful of messages.
    .limit(500);
  if (error) {
    logError("task-files", error);
    return [];
  }
  return ((data ?? []) as unknown as {
    id: string;
    attached_by: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    byte_size: number;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    taskId,
    uploadedBy: row.attached_by,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
    origin: "message" as const,
  }));
}

/** Own files + the source message's files, for the card's `TỆP` group. */
export function useTaskFiles(taskId: string | null, messageIds: readonly string[]): UseQueryResult<TaskFile[], Error> {
  return useQuery<TaskFile[], Error>({
    queryKey: [...taskFileKeys.task(taskId ?? ""), ...messageIds],
    queryFn: async () => {
      const [own, fromMessage] = await Promise.all([
        fetchTaskFiles(taskId as string),
        fetchMessageFiles(taskId as string, messageIds),
      ]);
      return [...fromMessage, ...own];
    },
    enabled: taskId !== null,
    staleTime: 30_000,
  });
}

export function useTaskFileActions(taskId: string | null) {
  const queryClient = useQueryClient();
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: taskFileKeys.task(taskId ?? "") });
  const upload = useMutation({
    mutationFn: (file: File) => uploadTaskFile(taskId as string, file),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (file: TaskFile) => deleteTaskFile(file),
    onSuccess: refresh,
  });
  return { upload, remove };
}
