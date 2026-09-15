import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  dependencyKeys,
  fetchTaskDependencies,
  linkTaskDependency,
  removeDependency,
  unlinkTaskDependency,
  upsertDependency,
  type TaskDependency,
} from "@/lib/task-dependencies";

export { dependencyKeys };

const NO_LINKS: readonly TaskDependency[] = [];

/** Every dependency this person can see both ends of. Shared through one key like the task list. */
export function useTaskDependencies(): UseQueryResult<TaskDependency[], Error> {
  const { user } = useAuth();
  return useQuery<TaskDependency[], Error>({
    queryKey: dependencyKeys.list,
    queryFn: fetchTaskDependencies,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** The same links as a plain array, safe to read before the query has answered. */
export function useDependencyList(): readonly TaskDependency[] {
  const { data } = useTaskDependencies();
  return useMemo(() => data ?? NO_LINKS, [data]);
}

export function useDependencyActions(): {
  link: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  unlink: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const add = useMutation({
    mutationFn: ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }) =>
      linkTaskDependency(taskId, dependsOnTaskId, userId),
    onSuccess: (row) => {
      const cached = queryClient.getQueryData<TaskDependency[]>(dependencyKeys.list);
      if (cached === undefined) void queryClient.invalidateQueries({ queryKey: dependencyKeys.all });
      else queryClient.setQueryData<TaskDependency[]>(dependencyKeys.list, upsertDependency(cached, row));
    },
  });

  const drop = useMutation({
    mutationFn: ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }) =>
      unlinkTaskDependency(taskId, dependsOnTaskId),
    onSuccess: (_result, variables) => {
      const cached = queryClient.getQueryData<TaskDependency[]>(dependencyKeys.list);
      if (cached === undefined) void queryClient.invalidateQueries({ queryKey: dependencyKeys.all });
      else
        queryClient.setQueryData<TaskDependency[]>(
          dependencyKeys.list,
          removeDependency(cached, variables.taskId, variables.dependsOnTaskId),
        );
    },
  });

  return {
    link: async (taskId: string, dependsOnTaskId: string): Promise<void> => {
      if (userId === "") return;
      await add.mutateAsync({ taskId, dependsOnTaskId });
    },
    unlink: async (taskId: string, dependsOnTaskId: string): Promise<void> => {
      await drop.mutateAsync({ taskId, dependsOnTaskId });
    },
    isWorking: add.isPending || drop.isPending,
  };
}
