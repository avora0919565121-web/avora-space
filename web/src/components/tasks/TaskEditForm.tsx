import { useState } from "react";
import { toast } from "sonner";

import { TimeField } from "@/components/tasks/TimeField";
import { useAutoList } from "@/hooks/use-auto-list";
import {
  isSharedTask,
  isTaskEditUnchanged,
  validateTaskEdit,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "w-full rounded-[8px] border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-muted-foreground";

/**
 * Rewording a task that is already live.
 *
 * The same three fields a new task needs, checked by the same rules — an edit that would be
 * refused as a new task is refused here too, before it costs a round trip. Saving something
 * identical closes the form without writing: bumping `updated_at` would announce an edit to
 * the other party when nothing actually changed.
 *
 * Who may open this, and until when, is decided by `canEditTask` and re-checked by the
 * server. This component only collects the text.
 */
export function TaskEditForm({
  task,
  today,
  onClose,
}: {
  task: TaskItem;
  today: string;
  onClose: () => void;
}) {
  const { editDetails } = useTaskActions();
  const [title, setTitle] = useState<string>(task.title);
  const [description, setDescription] = useState<string>(task.description);
  const [deadline, setDeadline] = useState<string>(task.deadline ?? "");
  const [deadlineTime, setDeadlineTime] = useState<string>(task.deadlineTime ?? "");
  const descriptionKeyDown = useAutoList(setDescription);

  const save = async (): Promise<void> => {
    const clean = validateTaskEdit({ title, description, deadline, deadlineTime }, today);
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return;
    }
    if (isTaskEditUnchanged(task, clean.value)) {
      onClose();
      return;
    }
    try {
      await editDetails.mutateAsync({
        taskId: task.id,
        isShared: isSharedTask(task),
        edit: clean.value,
      });
      toast.success("Đã lưu thay đổi.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được. Vui lòng thử lại.");
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label
          htmlFor={`edit-title-${task.id}`}
          className="mb-1 block text-[11px] font-medium text-muted-foreground"
        >
          Tiêu đề
        </label>
        <input
          id={`edit-title-${task.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className={cn(FIELD_CLASS, "h-10")}
        />
      </div>

      <div>
        <label
          htmlFor={`edit-description-${task.id}`}
          className="mb-1 block text-[11px] font-medium text-muted-foreground"
        >
          Mô tả cụ thể
        </label>
        <textarea
          id={`edit-description-${task.id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={descriptionKeyDown}
          rows={2}
          maxLength={2000}
          className={cn(FIELD_CLASS, "resize-y py-2 leading-5")}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[150px]">
          <label
            htmlFor={`edit-deadline-${task.id}`}
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Hạn hoàn thành
          </label>
          <input
            id={`edit-deadline-${task.id}`}
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className={cn(FIELD_CLASS, "h-10")}
          />
        </div>
        <div className="w-[130px]">
          <label
            htmlFor={`edit-time-${task.id}`}
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Giờ
          </label>
          <TimeField id={`edit-time-${task.id}`} value={deadlineTime} onChange={setDeadlineTime} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={editDetails.isPending}
          className="press h-11 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {editDetails.isPending ? "Đang lưu…" : "Lưu"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={editDetails.isPending}
          className="press h-11 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
