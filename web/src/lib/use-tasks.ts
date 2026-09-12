import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { useChatRealtime } from "@/lib/realtime";
import {
  confirmSharedTask,
  createPersonalTask,
  createSharedTask,
  deleteSharedTask,
  fetchTasks,
  isTaskGone,
  markSharedTaskDone,
  purgePersonalTask,
  removeTask,
  restoreSharedTask,
  returnSharedTask,
  reviewSharedTaskCompletion,
  setPersonalTaskDeleted,
  setPersonalTaskDone,
  taskKeys,
  upsertTask,
  type SharedTaskTarget,
  type TaskDraft,
  type TaskItem,
} from "@/lib/tasks";

export { taskKeys };

/**
 * Realtime is the delivery path; this interval only engages while the socket is down
 * so tasks degrade to polling instead of going silent.
 */
export const OFFLINE_TASKS_POLL_MS = 10_000;

/** The signed-in user's tasks, shared by the Nhiệm vụ screen through one query key. */
export function useTasks(): UseQueryResult<TaskItem[], Error> {
  const { user } = useAuth();
  const { isLive } = useChatRealtime();

  return useQuery<TaskItem[], Error>({
    queryKey: taskKeys.list,
    queryFn: fetchTasks,
    enabled: Boolean(user?.id),
    refetchInterval: isLive ? false : OFFLINE_TASKS_POLL_MS,
  });
}

export function useTaskActions() {
  const queryClient: QueryClient = useQueryClient();

  /**
   * Writes the row the server just returned straight into the cache, so the acting
   * user sees the change even if their own realtime echo is delayed or dropped.
   */
  const applyOwnResult = (task: TaskItem): void => {
    const current = queryClient.getQueryData<TaskItem[]>(taskKeys.list);
    if (!current) {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      return;
    }
    // Both sides have binned it: the row is gone from the database, so drop it here too.
    const next = isTaskGone(task) ? removeTask(current, task.id) : upsertTask(current, task);
    queryClient.setQueryData<TaskItem[]>(taskKeys.list, next);
  };

  const dropFromCache = (taskId: string): void => {
    const current = queryClient.getQueryData<TaskItem[]>(taskKeys.list);
    if (current) queryClient.setQueryData<TaskItem[]>(taskKeys.list, removeTask(current, taskId));
    else void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  };

  const addPersonal = useMutation({
    mutationFn: ({ userId, draft }: { userId: string; draft: TaskDraft }) =>
      createPersonalTask(userId, draft),
    onSuccess: applyOwnResult,
  });

  const togglePersonalDone = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) => setPersonalTaskDone(taskId, done),
    onSuccess: applyOwnResult,
  });

  const addShared = useMutation({
    mutationFn: ({ target, draft }: { target: SharedTaskTarget; draft: TaskDraft }) =>
      createSharedTask(target, draft),
    onSuccess: applyOwnResult,
  });

  const confirmShared = useMutation({
    mutationFn: (taskId: string) => confirmSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  const markSharedDone = useMutation({
    mutationFn: (taskId: string) => markSharedTaskDone(taskId),
    onSuccess: applyOwnResult,
  });

  const reviewSharedDone = useMutation({
    mutationFn: (taskId: string) => reviewSharedTaskCompletion(taskId),
    onSuccess: applyOwnResult,
  });

  const returnShared = useMutation({
    mutationFn: (taskId: string) => returnSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  const deleteShared = useMutation({
    mutationFn: (taskId: string) => deleteSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  const restoreShared = useMutation({
    mutationFn: (taskId: string) => restoreSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  const binPersonal = useMutation({
    mutationFn: ({ taskId, deleted }: { taskId: string; deleted: boolean }) =>
      setPersonalTaskDeleted(taskId, deleted),
    onSuccess: applyOwnResult,
  });

  const purgePersonal = useMutation({
    mutationFn: (taskId: string) => purgePersonalTask(taskId),
    onSuccess: (_result, taskId) => dropFromCache(taskId),
  });

  return {
    addPersonal,
    togglePersonalDone,
    addShared,
    confirmShared,
    markSharedDone,
    reviewSharedDone,
    returnShared,
    deleteShared,
    restoreShared,
    binPersonal,
    purgePersonal,
    isWorking:
      addPersonal.isPending ||
      togglePersonalDone.isPending ||
      addShared.isPending ||
      confirmShared.isPending ||
      markSharedDone.isPending ||
      reviewSharedDone.isPending ||
      returnShared.isPending ||
      deleteShared.isPending ||
      restoreShared.isPending ||
      binPersonal.isPending ||
      purgePersonal.isPending,
  };
}
