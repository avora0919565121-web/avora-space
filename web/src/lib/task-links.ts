import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { boardChangeKeys } from "@/lib/board-changes";
import { logError } from "@/lib/log";
import { projectKeys } from "@/lib/projects";
import { thinkHubKeys } from "@/lib/think-hub";

/**
 * AVORA-104 · PHẦN 3 (ADR-076) — Gắn việc ↔ Hạng mục after the fact, from either side.
 * Every rule (may edit the task, may edit the board, "cùng nơi", one Hạng mục per task) lives in
 * the RPCs; this file only carries the words back.
 */
export type TaskRecordLink = {
  recordId: string;
  recordTitle: string;
  tableId: string;
  tableName: string;
  /** `Bảng Khách hàng` · `Hoiana – chiếu sáng › Hạng mục thi công`. */
  path: string;
  canEdit: boolean;
};

export type LinkableRecord = { recordId: string; recordTitle: string; tableId: string; tableName: string; path: string; isCurrent: boolean };
export type LinkableTask = { taskId: string; title: string; deadline: string | null; status: string; linkedRecordTitle: string | null };

export const taskLinkKeys = {
  all: ["task-links"] as const,
  ofTask: (taskId: string) => ["task-links", "of", taskId] as const,
  records: (taskId: string, query: string) => ["task-links", "records", taskId, query] as const,
  tasks: (recordId: string, query: string) => ["task-links", "tasks", recordId, query] as const,
};

/** The RPC's own sentence when it says where the task lives; a plain one otherwise. */
export function linkErrorMessage(message: string): string {
  if (message.startsWith("Việc này thuộc")) return message;
  if (message.includes("avora_record_not_editable")) return "Bạn chỉ xem Bảng này — không gắn việc vào đây được.";
  if (message.includes("avora_task_not_editable")) return "Bạn không sửa được việc này.";
  if (/failed to fetch|network/i.test(message)) return "Không kết nối được. Kiểm tra mạng rồi thử lại.";
  return "Chưa gắn được. Vui lòng thử lại.";
}

function fail(error: { code?: string; message: string }): Error {
  logError("task-links", { code: error.code, message: error.message.slice(0, 120) });
  return new Error(linkErrorMessage(error.message));
}

export async function fetchTaskRecord(taskId: string): Promise<TaskRecordLink | null> {
  const { data, error } = await supabase.rpc("task_record_of" as never, { p_task_id: taskId } as never);
  if (error) throw fail(error);
  const row = ((data ?? []) as { record_id: string; record_title: string; table_id: string; table_name: string; path: string; can_edit: boolean }[])[0];
  return row === undefined
    ? null
    : { recordId: row.record_id, recordTitle: row.record_title, tableId: row.table_id, tableName: row.table_name, path: row.path, canEdit: row.can_edit };
}

export async function fetchLinkableRecords(taskId: string, query: string): Promise<LinkableRecord[]> {
  const { data, error } = await supabase.rpc("list_linkable_records" as never, { p_task_id: taskId, p_query: query.trim() === "" ? null : query.trim() } as never);
  if (error) throw fail(error);
  return ((data ?? []) as { record_id: string; record_title: string; table_id: string; table_name: string; path: string; is_current: boolean }[]).map((row) => ({
    recordId: row.record_id,
    recordTitle: row.record_title,
    tableId: row.table_id,
    tableName: row.table_name,
    path: row.path,
    isCurrent: row.is_current,
  }));
}

export async function fetchLinkableTasks(recordId: string, query: string): Promise<LinkableTask[]> {
  const { data, error } = await supabase.rpc("list_linkable_tasks" as never, { p_record_id: recordId, p_query: query.trim() === "" ? null : query.trim() } as never);
  if (error) throw fail(error);
  return ((data ?? []) as { task_id: string; title: string; deadline_date: string | null; status: string; linked_record_title: string | null }[]).map((row) => ({
    taskId: row.task_id,
    title: row.title,
    deadline: row.deadline_date,
    status: row.status,
    linkedRecordTitle: row.linked_record_title,
  }));
}

export async function linkTaskToRecord(taskId: string, recordId: string): Promise<void> {
  const { error } = await supabase.rpc("link_task_to_record" as never, { p_task_id: taskId, p_record_id: recordId } as never);
  if (error) throw fail(error);
}

export async function unlinkTaskFromRecord(taskId: string): Promise<void> {
  const { error } = await supabase.rpc("unlink_task_from_record" as never, { p_task_id: taskId } as never);
  if (error) throw fail(error);
}

export function useTaskRecord(taskId: string | null): UseQueryResult<TaskRecordLink | null, Error> {
  return useQuery<TaskRecordLink | null, Error>({
    queryKey: taskLinkKeys.ofTask(taskId ?? ""),
    queryFn: () => fetchTaskRecord(taskId as string),
    enabled: taskId !== null,
    staleTime: 30_000,
  });
}

export function useLinkableRecords(taskId: string | null, query: string): UseQueryResult<LinkableRecord[], Error> {
  return useQuery<LinkableRecord[], Error>({
    queryKey: taskLinkKeys.records(taskId ?? "", query.trim()),
    queryFn: () => fetchLinkableRecords(taskId as string, query),
    enabled: taskId !== null,
    staleTime: 10_000,
  });
}

export function useLinkableTasks(recordId: string | null, query: string): UseQueryResult<LinkableTask[], Error> {
  return useQuery<LinkableTask[], Error>({
    queryKey: taskLinkKeys.tasks(recordId ?? "", query.trim()),
    queryFn: () => fetchLinkableTasks(recordId as string, query),
    enabled: recordId !== null,
    staleTime: 10_000,
  });
}

/** After a link moves, every list that counts tasks under a Hạng mục reads again. */
export function useTaskLinkActions() {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: taskLinkKeys.all });
    void queryClient.invalidateQueries({ queryKey: thinkHubKeys.recordTasks });
    void queryClient.invalidateQueries({ queryKey: projectKeys.taskLinks });
    void queryClient.invalidateQueries({ queryKey: boardChangeKeys.all });
  };
  const link = useMutation({
    mutationFn: ({ taskId, recordId }: { taskId: string; recordId: string }) => linkTaskToRecord(taskId, recordId),
    onSuccess: refresh,
  });
  const unlink = useMutation({
    mutationFn: (taskId: string) => unlinkTaskFromRecord(taskId),
    onSuccess: refresh,
  });
  return { link, unlink };
}
