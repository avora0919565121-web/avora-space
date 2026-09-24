import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { instantBounds } from "@/lib/calendar-view";

import { useAuth } from "@/lib/auth";
import { useChatRealtime } from "@/lib/realtime";
import { saveTaskFlag, taskFlagKeys, upsertFlagRow, type TaskFlagRow } from "@/lib/task-flags";
import type { TaskContextSnapshot } from "@/lib/task-context";
import {
  confirmSharedTask,
  createPersonalTask,
  createSharedTask,
  deleteSharedTask,
  fetchTasks,
  fetchTasksInRange,
  isTaskGone,
  markSharedTaskDone,
  purgePersonalTask,
  removeTask,
  restoreSharedTask,
  returnSharedTask,
  reviewSharedTaskCompletion,
  setPersonalTaskDeleted,
  skipSharedTask,
  setPersonalTaskDone,
  taskKeys,
  todayIso,
  updatePersonalTaskDetails,
  updatePersonalTaskPlan,
  updateSharedTaskDetails,
  updateSharedTaskPlan,
  upsertTask,
  type SharedTaskTarget,
  type TaskDraft,
  type TaskEdit,
  type TaskItem,
  type TaskPlanPatch,
} from "@/lib/tasks";

export { taskKeys };

/**
 * Realtime is the delivery path; this interval only engages while the socket is down
 * so tasks degrade to polling instead of going silent.
 */
export const OFFLINE_TASKS_POLL_MS = 10_000;

/**
 * Only the tasks Lịch needs for the days on screen — a date-bounded query over `tasks`, never a
 * copy of them. Keeps the previous range on screen while the next one loads, so stepping a month
 * forward does not flash an empty grid.
 */
export function useTasksInRange(from: string, to: string): UseQueryResult<TaskItem[], Error> {
  const { user } = useAuth();
  const { isLive } = useChatRealtime();
  const { startIso, endIso } = instantBounds(from, to);

  return useQuery<TaskItem[], Error>({
    queryKey: taskKeys.range(from, to),
    queryFn: () => fetchTasksInRange(from, to, startIso, endIso),
    enabled: Boolean(user?.id),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_TASKS_POLL_MS,
  });
}

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
  const { user } = useAuth();
  const actorId = user?.id ?? "";

  /**
   * Records the composer's own reading of a task it just created.
   *
   * Written after the task rather than inside it: importance and effort are per-person, so
   * they belong to whoever is acting, not to the task. A failure here is logged and swallowed
   * on purpose — the task itself exists and is usable, and losing a star must not look like
   * losing the work.
   */
  const applyOwnFlags = async (
    taskId: string,
    draft: { isImportant?: boolean; durationMinutes?: number | null },
  ): Promise<void> => {
    const wantsImportant = draft.isImportant === true;
    const wantsDuration = draft.durationMinutes !== undefined && draft.durationMinutes !== null;
    if (actorId === "" || (!wantsImportant && !wantsDuration)) return;
    try {
      const row = await saveTaskFlag(taskId, actorId, {
        isImportant: wantsImportant,
        durationMinutes: draft.durationMinutes ?? null,
      });
      const cached = queryClient.getQueryData<TaskFlagRow[]>(taskFlagKeys.list);
      if (cached === undefined) void queryClient.invalidateQueries({ queryKey: taskFlagKeys.all });
      else queryClient.setQueryData<TaskFlagRow[]>(taskFlagKeys.list, upsertFlagRow(cached, row));
    } catch (error) {
      console.error("[tasks] task created but its flags could not be saved", error);
    }
  };

  /**
   * Writes the row the server just returned straight into the cache, so the acting
   * user sees the change even if their own realtime echo is delayed or dropped.
   */
  const applyOwnResult = (task: TaskItem): void => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.rangeRoot });
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
    void queryClient.invalidateQueries({ queryKey: taskKeys.rangeRoot });
    const current = queryClient.getQueryData<TaskItem[]>(taskKeys.list);
    if (current) queryClient.setQueryData<TaskItem[]>(taskKeys.list, removeTask(current, taskId));
    else void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  };

  const addPersonal = useMutation({
    mutationFn: ({
      userId,
      draft,
      contextSnapshot,
    }: {
      userId: string;
      draft: TaskDraft;
      /** Set when the task was raised from a journal note rather than the Nhiệm vụ page. */
      contextSnapshot?: TaskContextSnapshot | null;
    }) => createPersonalTask(userId, draft, todayIso(), contextSnapshot ?? null),
    onSuccess: (task, variables) => {
      applyOwnResult(task);
      void applyOwnFlags(task.id, variables.draft);
    },
  });

  const togglePersonalDone = useMutation({
    mutationFn: ({
      taskId,
      done,
      output,
    }: {
      taskId: string;
      done: boolean;
      /** Normalised by the caller; written only on the way in, never on re-open. */
      output?: string | null;
    }) => setPersonalTaskDone(taskId, done, output),
    onSuccess: applyOwnResult,
  });

  const addShared = useMutation({
    mutationFn: ({ target, draft }: { target: SharedTaskTarget; draft: TaskDraft }) =>
      createSharedTask(target, draft),
    onSuccess: (task, variables) => {
      applyOwnResult(task);
      void applyOwnFlags(task.id, variables.draft);
    },
  });

  const confirmShared = useMutation({
    mutationFn: (taskId: string) => confirmSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  const markSharedDone = useMutation({
    mutationFn: ({ taskId, output }: { taskId: string; output: string | null }) =>
      markSharedTaskDone(taskId, output),
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

  /**
   * Declining a suggestion. The task changes state and stays on the list — which is why this
   * writes the returned row back rather than dropping it from the cache like a delete.
   */
  const skipShared = useMutation({
    mutationFn: ({ taskId, silent }: { taskId: string; silent: boolean }) =>
      skipSharedTask(taskId, silent),
    onSuccess: applyOwnResult,
  });

  const restoreShared = useMutation({
    mutationFn: (taskId: string) => restoreSharedTask(taskId),
    onSuccess: applyOwnResult,
  });

  /**
   * Rewords a task. One entry point for both kinds, because the person editing does not care
   * which table rule applies — a personal task goes straight through RLS, a shared one through
   * the RPC that re-checks both parties and the task's state.
   */
  const editDetails = useMutation({
    mutationFn: ({
      taskId,
      isShared,
      edit,
    }: {
      taskId: string;
      isShared: boolean;
      edit: Required<TaskEdit>;
    }) =>
      isShared ? updateSharedTaskDetails(taskId, edit) : updatePersonalTaskDetails(taskId, edit),
    onSuccess: applyOwnResult,
  });

  /**
   * The two optional planning fields, through whichever door the task's kind requires.
   *
   * One entry point for both because the person setting a percentage does not care which
   * table rule applies — a personal task goes straight through RLS, a shared one through the
   * RPC that re-checks both parties and the task's state.
   */
  const editPlan = useMutation({
    mutationFn: ({
      taskId,
      isShared,
      patch,
    }: {
      taskId: string;
      isShared: boolean;
      patch: TaskPlanPatch;
    }) => (isShared ? updateSharedTaskPlan(taskId, patch) : updatePersonalTaskPlan(taskId, patch)),
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
    skipShared,
    restoreShared,
    editDetails,
    editPlan,
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
      skipShared.isPending ||
      restoreShared.isPending ||
      editDetails.isPending ||
      editPlan.isPending ||
      binPersonal.isPending ||
      purgePersonal.isPending,
  };
}
