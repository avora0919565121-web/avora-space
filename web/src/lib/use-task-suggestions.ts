import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { useChatRealtime } from "@/lib/realtime";
import {
  acceptTaskSuggestion,
  createTaskSuggestion,
  editTaskSuggestion,
  fetchTaskSuggestions,
  skipTaskSuggestion,
  suggestionKeys,
  upsertSuggestion,
  withdrawTaskSuggestion,
  type SuggestionEditDraft,
  type SuggestionTarget,
  type TaskSuggestion,
} from "@/lib/task-suggestions";
import { taskFromRealtimeRow, taskKeys, upsertTask, type TaskItem } from "@/lib/tasks";

export { suggestionKeys };

/** Realtime is the delivery path; polling only engages while the socket is down. */
export const OFFLINE_SUGGESTIONS_POLL_MS = 10_000;

/** Every suggestion in the rooms this person belongs to. RLS decides what that means. */
export function useTaskSuggestions(): UseQueryResult<TaskSuggestion[], Error> {
  const { user } = useAuth();
  const { isLive } = useChatRealtime();

  return useQuery<TaskSuggestion[], Error>({
    queryKey: suggestionKeys.list,
    queryFn: fetchTaskSuggestions,
    enabled: Boolean(user?.id),
    refetchInterval: isLive ? false : OFFLINE_SUGGESTIONS_POLL_MS,
  });
}

export function useSuggestionActions() {
  const queryClient: QueryClient = useQueryClient();

  /**
   * Writes the row the server just returned straight into the cache, so the person acting
   * sees their own answer even if the realtime echo is delayed or dropped.
   */
  const applyOwnResult = (suggestion: TaskSuggestion): void => {
    const current = queryClient.getQueryData<TaskSuggestion[]>(suggestionKeys.list);
    if (!current) {
      void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
      return;
    }
    queryClient.setQueryData<TaskSuggestion[]>(
      suggestionKeys.list,
      upsertSuggestion(current, suggestion),
    );
  };

  const propose = useMutation({
    mutationFn: ({
      target,
      draft,
    }: {
      target: SuggestionTarget;
      draft: { title: string; description: string; deadline: string; deadlineTime: string | null };
    }) => createTaskSuggestion(target, draft),
    /**
     * Work someone took on themselves comes back already accepted, with its task alongside.
     *
     * Only the suggestion list would be patched otherwise, and the task — which genuinely
     * exists from this moment — would not appear under "Nhiệm vụ của tôi" until something
     * else happened to refetch it.
     */
    onSuccess: (suggestion) => {
      applyOwnResult(suggestion);
      if (suggestion.status === "accepted" && suggestion.acceptedTaskId !== null) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      }
    },
  });

  /**
   * "Tạo nhiệm vụ". Two caches move at once, and they must move together: the suggestion stops
   * being a question and the task starts existing. Patching only one would leave the screen
   * showing an unanswered request beside the task it just became.
   */
  const accept = useMutation({
    mutationFn: (suggestionId: string) => acceptTaskSuggestion(suggestionId),
    onSuccess: (row, suggestionId) => {
      const task: TaskItem = taskFromRealtimeRow(row);
      const cachedTasks = queryClient.getQueryData<TaskItem[]>(taskKeys.list);
      if (cachedTasks) queryClient.setQueryData<TaskItem[]>(taskKeys.list, upsertTask(cachedTasks, task));
      else void queryClient.invalidateQueries({ queryKey: taskKeys.all });

      const cached = queryClient.getQueryData<TaskSuggestion[]>(suggestionKeys.list);
      const existing = cached?.find((entry) => entry.id === suggestionId);
      if (cached && existing) {
        queryClient.setQueryData<TaskSuggestion[]>(
          suggestionKeys.list,
          upsertSuggestion(cached, {
            ...existing,
            status: "accepted",
            acceptedTaskId: task.id,
            resolvedAt: new Date().toISOString(),
          }),
        );
      } else {
        void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
      }
    },
  });

  /** "Bỏ qua". Touches no task cache at all, because no task was created or destroyed. */
  const skip = useMutation({
    mutationFn: ({ suggestionId, silent }: { suggestionId: string; silent: boolean }) =>
      skipTaskSuggestion(suggestionId, silent),
    onSuccess: applyOwnResult,
  });

  /** "Sửa": rewording the ask. The row is patched in place, still pending. */
  const edit = useMutation({
    mutationFn: ({ suggestionId, draft }: { suggestionId: string; draft: SuggestionEditDraft }) =>
      editTaskSuggestion(suggestionId, draft),
    onSuccess: applyOwnResult,
  });

  /** "Rút lại": taking the question back. The resolved row drops out of every pending list. */
  const withdraw = useMutation({
    mutationFn: (suggestionId: string) => withdrawTaskSuggestion(suggestionId),
    onSuccess: applyOwnResult,
  });

  return {
    propose,
    accept,
    skip,
    edit,
    withdraw,
    isWorking: propose.isPending || accept.isPending || skip.isPending || edit.isPending || withdraw.isPending,
  };
}
