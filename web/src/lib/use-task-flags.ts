import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  dismissGuidance,
  fetchDismissedGuidance,
  guidanceKeys,
  shouldShowGuidance,
  type GuidanceKey,
} from "@/lib/guidance";
import {
  fetchTaskFlags,
  saveTaskFlag,
  taskFlagKeys,
  toFlagIndex,
  upsertFlagRow,
  type TaskFlagRow,
} from "@/lib/task-flags";
import { NO_TASK_FLAGS, type TaskFlagIndex, type TaskFlagValue } from "@/lib/tasks";

export { taskFlagKeys, guidanceKeys };

/** This person's own readings of their tasks. Shared through one key, like the task list. */
export function useTaskFlags(): UseQueryResult<TaskFlagRow[], Error> {
  const { user } = useAuth();
  return useQuery<TaskFlagRow[], Error>({
    queryKey: taskFlagKeys.list,
    queryFn: fetchTaskFlags,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** The same flags as a lookup by task id — what every list view reads. */
export function useTaskFlagIndex(): TaskFlagIndex {
  const { data } = useTaskFlags();
  return useMemo(() => (data === undefined ? NO_TASK_FLAGS : toFlagIndex(data)), [data]);
}

export function useTaskFlagActions(): {
  setFlag: (taskId: string, patch: Partial<TaskFlagValue>) => void;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data: flags } = useTaskFlags();

  const save = useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Partial<TaskFlagValue> }) => {
      const current = flags?.find((row) => row.taskId === taskId);
      return saveTaskFlag(
        taskId,
        userId,
        patch,
        current === undefined
          ? undefined
          : { isImportant: current.isImportant, durationMinutes: current.durationMinutes },
      );
    },
    onSuccess: (row) => {
      const cached = queryClient.getQueryData<TaskFlagRow[]>(taskFlagKeys.list);
      if (cached === undefined) {
        void queryClient.invalidateQueries({ queryKey: taskFlagKeys.all });
        return;
      }
      queryClient.setQueryData<TaskFlagRow[]>(taskFlagKeys.list, upsertFlagRow(cached, row));
    },
  });

  const setFlag = useCallback(
    (taskId: string, patch: Partial<TaskFlagValue>): void => {
      if (userId === "") return;
      save.mutate({ taskId, patch });
    },
    [save, userId],
  );

  return { setFlag, isWorking: save.isPending };
}

/**
 * One-time explanations: which are still worth showing, and how to retire one.
 *
 * While the list is loading nothing is shown. That is deliberate — flashing an explanation
 * the person dismissed months ago, for the half second before the answer arrives, would be
 * worse than showing it a moment late.
 */
export function useGuidance(): {
  shouldShow: (key: GuidanceKey) => boolean;
  dismiss: (key: GuidanceKey) => void;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { data, isSuccess } = useQuery<GuidanceKey[], Error>({
    queryKey: guidanceKeys.list,
    queryFn: fetchDismissedGuidance,
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });

  const dismissed = data ?? [];

  const shouldShow = useCallback(
    (key: GuidanceKey): boolean => (isSuccess ? shouldShowGuidance(dismissed, key) : false),
    [dismissed, isSuccess],
  );

  const dismiss = useCallback(
    (key: GuidanceKey): void => {
      if (userId === "") return;
      // Hidden immediately: waiting for the round trip would leave the hint on screen after
      // the person has already said they are done with it.
      queryClient.setQueryData<GuidanceKey[]>(guidanceKeys.list, (current) =>
        current === undefined || current.includes(key) ? current ?? [key] : [...current, key],
      );
      void dismissGuidance(userId, key)
        .then(() => queryClient.invalidateQueries({ queryKey: guidanceKeys.all }))
        .catch((error: unknown) => {
          console.error("[guidance] could not record dismissal", error);
        });
    },
    [queryClient, userId],
  );

  return { shouldShow, dismiss };
}
