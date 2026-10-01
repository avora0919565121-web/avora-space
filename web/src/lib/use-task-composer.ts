import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth";
import { logError } from "@/lib/log";
import { createTaskReminderBefore, taskReminderKeys } from "@/lib/task-reminders";
import { browserTimezone } from "@/lib/task-schedule";
import type { TaskContextSnapshot } from "@/lib/task-context";
import { departureTimes, type Recipients } from "@/lib/task-composer";
import {
  fetchMyTravelPlans,
  fetchSuggestionTravelFlags,
  fetchTaskRecipientIds,
  setTaskTravel,
  suggestionKeys,
  type SuggestionEvent,
  type SuggestionTarget,
  type TaskSuggestion,
  type TravelPlan,
} from "@/lib/task-suggestions";
import {
  isSharedTask,
  isTaskEditUnchanged,
  taskKeys,
  todayIso,
  updatePersonalTaskSchedule,
  updateSharedTaskSchedule,
  validateTaskEdit,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskActions } from "@/lib/use-tasks";
import { useSuggestionActions } from "@/lib/use-task-suggestions";

/** Everything the one task form hands back when the button is pressed. */
export type ComposerValues = {
  title: string;
  description: string;
  deadline: string;
  deadlineTime: string | null;
  /** ISO instants, or null when there is no Sự kiện. */
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  requiresPresence: boolean;
  /** Only ever set for the person who travels — never proposed to someone else. */
  travelMinutes: number | null;
  reminderOffsetMinutes: number;
  /** AVORA-53 · 4.3: minutes before the deadline to remind (0 = on time), or null for none. Own tasks only. */
  remindBeforeMinutes?: number | null;
  /** AVORA-53 · 4.2: this person's own reading, written to `task_flags`. */
  isImportant?: boolean;
  durationMinutes?: number | null;
};

export function eventOf(values: ComposerValues): SuggestionEvent {
  return {
    startAt: values.startAt,
    endAt: values.startAt === null ? null : values.endAt,
    location: values.startAt === null ? null : values.location,
    requiresPresence: values.startAt !== null && values.requiresPresence,
  };
}

/** Who "Cả nhóm" / "Chọn người" may reach here (server-decided). Null while unknown. */
export function useTaskRecipientIds(conversationId: string | null): UseQueryResult<string[], Error> {
  return useQuery<string[], Error>({
    queryKey: suggestionKeys.recipients(conversationId ?? ""),
    queryFn: () => fetchTaskRecipientIds(conversationId as string),
    enabled: conversationId !== null,
    staleTime: 30_000,
  });
}

/** This person's own travel plans (task_travel_plans only ever returns the owner's rows). */
export function useMyTravelPlans(): UseQueryResult<TravelPlan[], Error> {
  const { user } = useAuth();
  return useQuery<TravelPlan[], Error>({
    queryKey: suggestionKeys.travelPlans,
    queryFn: fetchMyTravelPlans,
    enabled: Boolean(user?.id),
  });
}

/** "đã sắp xếp đi lại" per accepted suggestion — a yes/no, never the minutes. */
export function useSuggestionTravelFlags(): UseQueryResult<Map<string, boolean>, Error> {
  const { user } = useAuth();
  return useQuery<Map<string, boolean>, Error>({
    queryKey: suggestionKeys.travelFlags,
    queryFn: fetchSuggestionTravelFlags,
    enabled: Boolean(user?.id),
  });
}

/**
 * Sends a composed task to everyone it is for: the author's own task first, then one suggestion
 * per other person, one after another so a failure halfway is counted honestly.
 */
export async function sendToRecipients(input: {
  recipients: Recipients;
  createMine: () => Promise<void>;
  proposeTo: (assigneeId: string) => Promise<void>;
}): Promise<{ done: number; total: number; error: Error | null }> {
  const total = (input.recipients.includesSelf ? 1 : 0) + input.recipients.others.length;
  let done = 0;
  try {
    if (input.recipients.includesSelf) {
      await input.createMine();
      done += 1;
    }
    for (const assigneeId of input.recipients.others) {
      await input.proposeTo(assigneeId);
      done += 1;
    }
    return { done, total, error: null };
  } catch (error) {
    return { done, total, error: error instanceof Error ? error : new Error("Không gửi được.") };
  }
}

/** The write paths the one form uses, all through routes that already exist on the server. */
export function useComposerActions() {
  const queryClient = useQueryClient();
  const { addPersonal, editDetails } = useTaskActions();
  const { propose } = useSuggestionActions();

  const refreshTravel = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: suggestionKeys.travelPlans });
    void queryClient.invalidateQueries({ queryKey: suggestionKeys.travelFlags });
  }, [queryClient]);

  /** A personal task, with Sự kiện / Hiện diện written in the same insert. */
  const createPersonal = useCallback(
    async (userId: string, values: ComposerValues, contextSnapshot: TaskContextSnapshot | null): Promise<TaskItem> => {
      const event = eventOf(values);
      const presence = event.requiresPresence;
      const times = presence ? departureTimes(event.startAt, values.travelMinutes, values.reminderOffsetMinutes) : null;
      const created = await addPersonal.mutateAsync({
        userId,
        draft: {
          title: values.title,
          description: values.description,
          deadline: values.deadline,
          deadlineTime: values.deadlineTime ?? undefined,
          isImportant: values.isImportant,
          durationMinutes: values.durationMinutes ?? null,
        },
        contextSnapshot,
        schedule: {
          startAt: event.startAt,
          endAt: event.endAt,
          location: event.location,
          requiresPresence: presence,
          travelDurationMinutes: presence ? values.travelMinutes : null,
          departureReminderAt: times === null ? null : times.remindAt.toISOString(),
        },
      });
      if (values.remindBeforeMinutes !== undefined && values.remindBeforeMinutes !== null) {
        try {
          await createTaskReminderBefore(created.id, userId, values.remindBeforeMinutes, values.deadline, values.deadlineTime, browserTimezone());
          void queryClient.invalidateQueries({ queryKey: taskReminderKeys.all });
        } catch (error) {
          // The task exists; the reminder can be set again from it.
          logError("task-reminders", error);
        }
      }
      return created;
    },
    [addPersonal, queryClient],
  );

  /**
   * One suggestion. Naming yourself in a group comes back already accepted (the server's
   * self-accept path); the author's own travel then goes where only they can read it.
   */
  const proposeOne = useCallback(
    async (target: SuggestionTarget, values: ComposerValues, isSelf: boolean): Promise<TaskSuggestion> => {
      const suggestion = await propose.mutateAsync({
        target,
        draft: {
          title: values.title,
          description: values.description,
          deadline: values.deadline,
          deadlineTime: values.deadlineTime,
        },
        event: eventOf(values),
      });
      if (isSelf && suggestion.acceptedTaskId !== null && eventOf(values).requiresPresence && values.travelMinutes !== null) {
        try {
          await setTaskTravel(suggestion.acceptedTaskId, values.travelMinutes, values.reminderOffsetMinutes);
          refreshTravel();
        } catch {
          // The task exists; travel can be set again from the task itself.
        }
      }
      return suggestion;
    },
    [propose, refreshTravel],
  );

  /**
   * "Sửa" on a live task — same form as creating. Wording and schedule are separate writes on
   * the server; each is skipped when nothing in it changed, so the other side sees no false edit.
   */
  const saveTaskEdit = useMutation({
    mutationFn: async ({ task, values }: { task: TaskItem; values: ComposerValues }): Promise<void> => {
      const clean = validateTaskEdit(
        { title: values.title, description: values.description, deadline: values.deadline, deadlineTime: values.deadlineTime },
        todayIso(),
      );
      if (!clean.value) throw new Error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      if (!isTaskEditUnchanged(task, clean.value)) {
        await editDetails.mutateAsync({ taskId: task.id, isShared: isSharedTask(task), edit: clean.value });
      }

      const event = eventOf(values);
      const presence = event.requiresPresence;
      const travel = presence ? values.travelMinutes : null;
      if (isSharedTask(task)) {
        await updateSharedTaskSchedule(task.id, {
          estimatedDurationMinutes: task.estimatedDurationMinutes,
          requiresPresence: presence,
          startAt: event.startAt,
          endAt: event.endAt,
          location: event.location,
          travelDurationMinutes: travel,
          reminderOffsetMinutes: values.reminderOffsetMinutes,
        });
      } else {
        const times = presence ? departureTimes(event.startAt, travel, values.reminderOffsetMinutes) : null;
        await updatePersonalTaskSchedule(task.id, {
          requiresPresence: presence,
          startAt: event.startAt,
          endAt: event.endAt,
          location: event.location,
          travelDurationMinutes: travel,
          departureReminderAt: times === null ? null : times.remindAt.toISOString(),
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      refreshTravel();
    },
  });

  return { createPersonal, proposeOne, saveTaskEdit, refreshTravel, isWorking: addPersonal.isPending || propose.isPending || saveTaskEdit.isPending };
}

/** The travel this person set for a task: their private plan when owned, else the task row. */
export function travelOf(
  task: Pick<TaskItem, "id" | "startAt" | "travelDurationMinutes" | "departureReminderAt">,
  plans: readonly TravelPlan[] | undefined,
): { travelMinutes: number | null; reminderOffsetMinutes: number } {
  const plan = plans?.find((entry) => entry.taskId === task.id);
  if (plan !== undefined) return { travelMinutes: plan.travelMinutes, reminderOffsetMinutes: plan.reminderOffsetMinutes };
  if (task.travelDurationMinutes === null) return { travelMinutes: null, reminderOffsetMinutes: 10 };
  if (task.startAt === null || task.departureReminderAt === null) {
    return { travelMinutes: task.travelDurationMinutes, reminderOffsetMinutes: 0 };
  }
  const leave = new Date(task.startAt).getTime() - task.travelDurationMinutes * 60_000;
  const offset = Math.round((leave - new Date(task.departureReminderAt).getTime()) / 60_000);
  return { travelMinutes: task.travelDurationMinutes, reminderOffsetMinutes: Math.max(0, offset) };
}
