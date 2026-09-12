import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  createTaskCategory,
  deleteTaskCategory,
  fetchTaskCategories,
  renameTaskCategory,
  taskCategoryKeys,
  TASK_CATEGORY_COLORS,
  type TaskCategory,
} from "@/lib/task-categories";
import {
  createTaskReminder,
  deleteTaskReminder,
  dueReminders,
  fetchTaskReminders,
  markReminderSurfaced,
  taskReminderKeys,
  type TaskReminder,
} from "@/lib/task-reminders";
import { browserTimezone, reminderPresetById, type ReminderPresetId } from "@/lib/task-schedule";

export { taskCategoryKeys, taskReminderKeys };

/** The six seeded shelves plus anything this person added. */
export function useTaskCategories(): UseQueryResult<TaskCategory[], Error> {
  const { user } = useAuth();
  return useQuery<TaskCategory[], Error>({
    queryKey: taskCategoryKeys.list,
    queryFn: fetchTaskCategories,
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });
}

export function useTaskReminders(): UseQueryResult<TaskReminder[], Error> {
  const { user } = useAuth();
  return useQuery<TaskReminder[], Error>({
    queryKey: taskReminderKeys.list,
    queryFn: fetchTaskReminders,
    enabled: Boolean(user?.id),
    // Reminders fire on a clock, so the list is re-read often enough to notice one arriving.
    refetchInterval: 60_000,
  });
}

/** Quick lookup by id, for rendering a task's label without a per-row search. */
export function useCategoryIndex(): Map<string, TaskCategory> {
  const { data } = useTaskCategories();
  return useMemo(() => new Map((data ?? []).map((entry) => [entry.id, entry])), [data]);
}

export function useTaskCategoryActions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data: categories } = useTaskCategories();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: taskCategoryKeys.all });
  }, [queryClient]);

  const add = useMutation({
    mutationFn: (name: string) => {
      const used = categories?.length ?? 0;
      const color = TASK_CATEGORY_COLORS[used % TASK_CATEGORY_COLORS.length] ?? "#6B635A";
      return createTaskCategory(userId, name, color, used + 1);
    },
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTaskCategory(id, name),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTaskCategory(id),
    onSuccess: () => {
      invalidate();
      // A removed shelf releases its tasks, so their labels have to be re-read.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return { add, rename, remove, isWorking: add.isPending || rename.isPending || remove.isPending };
}

export function useTaskReminderActions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: taskReminderKeys.all });
  }, [queryClient]);

  const set = useMutation({
    mutationFn: ({
      taskId,
      preset,
      deadline,
      deadlineTime,
    }: {
      taskId: string;
      preset: ReminderPresetId;
      deadline: string;
      deadlineTime: string | null;
    }) => {
      const definition = reminderPresetById(preset);
      if (definition === null) return Promise.resolve(null);
      return createTaskReminder(taskId, userId, definition, deadline, deadlineTime, browserTimezone());
    },
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: (reminderId: string) => deleteTaskReminder(reminderId),
    onSuccess: invalidate,
  });

  return { set, clear, isWorking: set.isPending || clear.isPending };
}

/**
 * Reminders whose moment has come.
 *
 * Delivery is in-app only: there is no mail, SMS or push sender in this project, so a
 * reminder is shown when the person has AVORA open and cannot reach a closed tab. Each one is
 * marked surfaced once acknowledged so re-opening the app does not replay it.
 */
export function useDueReminders(): {
  due: TaskReminder[];
  dismiss: (reminderId: string) => void;
} {
  const { data } = useTaskReminders();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  const due = useMemo(
    () => dueReminders(data ?? []).filter((reminder) => !dismissed.includes(reminder.id)),
    [data, dismissed],
  );

  const dismiss = useCallback(
    (reminderId: string): void => {
      setDismissed((current) => (current.includes(reminderId) ? current : [...current, reminderId]));
      void markReminderSurfaced(reminderId)
        .then(() => queryClient.invalidateQueries({ queryKey: taskReminderKeys.all }))
        .catch((error: unknown) => {
          console.error("[task-reminders] could not mark surfaced", error);
        });
    },
    [queryClient],
  );

  return { due, dismiss };
}
