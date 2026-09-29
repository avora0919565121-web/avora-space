import { TaskComposer } from "@/components/tasks/TaskComposer";
import { useAuth } from "@/lib/auth";
import type { ComposerPlace } from "@/lib/task-composer";
import { isSharedTask, isTaskAssignee, type TaskItem } from "@/lib/tasks";
import { travelOf, useComposerActions, useMyTravelPlans } from "@/lib/use-task-composer";

/**
 * "Sửa" / "Chỉnh theo cách của bạn" on a live task — the same one form (ADR-030), Giao cho locked.
 *
 * Travel is offered only to the person who goes: the owner of a personal task, the assignee of
 * shared work. For a task that came from a suggestion it is stored where only they can read it.
 */
export function TaskEditComposer({
  task,
  open,
  onOpenChange,
  lockedLabel = "Chỉ bạn",
  isOwnedByAssignee = false,
}: {
  task: TaskItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lockedLabel?: string;
  /** From an accepted suggestion (D3): the assignee's own, presence no longer "cho cả hai". */
  isOwnedByAssignee?: boolean;
}) {
  const { user } = useAuth();
  const { saveTaskEdit } = useComposerActions();
  const { data: plans } = useMyTravelPlans();
  if (task === null) return null;

  const shared = isSharedTask(task);
  const goes = !shared || isTaskAssignee(task, user?.id);
  const travel = travelOf(task, plans);
  const place: ComposerPlace = task.type === "group-shared" ? "group" : task.type === "1-1-shared" ? "direct" : "personal";

  return (
    <TaskComposer
      key={task.id}
      open={open}
      onOpenChange={onOpenChange}
      mode="edit-task"
      place={place}
      lockedRecipientLabel={lockedLabel}
      allowTravel={goes}
      presenceNote={shared && !isOwnedByAssignee ? "Áp dụng cho cả hai" : undefined}
      initial={{
        title: task.title,
        description: task.description,
        deadline: task.deadline ?? "",
        deadlineTime: task.deadlineTime,
        startAt: task.startAt,
        endAt: task.endAt,
        location: task.location,
        requiresPresence: task.requiresPresence,
        travelMinutes: travel.travelMinutes,
        reminderOffsetMinutes: travel.reminderOffsetMinutes,
      }}
      onSave={async (values) => {
        await saveTaskEdit.mutateAsync({ task, values });
      }}
    />
  );
}
