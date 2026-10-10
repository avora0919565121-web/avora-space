import { Check, Link2, Plus } from "lucide-react";
import { memo } from "react";

import { cardDay } from "@/lib/task-card";
import { isTaskDone } from "@/lib/project-tree";
import type { TaskItem } from "@/lib/tasks";
import { usePeopleNames } from "@/lib/use-task-owner";
import { cn } from "@/lib/utils";

/**
 * The tasks of one Hạng mục in Toàn cảnh (AVORA-104 · PHẦN 4): `○ tên · ngày · người làm`, then
 * `＋ Việc mới · ⛓ Gắn việc có sẵn`. A tap opens the task card; nothing is changed from the list.
 */
export const TaskRows = memo(function TaskRows({
  tasks,
  selectedId,
  onOpen,
  onAdd,
  onLink,
  emptyText = "Chưa có việc nào.",
}: {
  tasks: readonly TaskItem[];
  selectedId?: string | null;
  onOpen: (task: TaskItem) => void;
  onAdd?: () => void;
  onLink?: () => void;
  emptyText?: string;
}) {
  const { nameOf } = usePeopleNames();
  return (
    <div data-overview-tasks="">
      {tasks.length === 0 ? <p className="px-4 py-3 text-[13.5px] text-muted-foreground">{emptyText}</p> : null}
      <ul>
        {tasks.map((task) => {
          const isDone = isTaskDone(task);
          const day = cardDay(task.deadline);
          const who = task.assigneeId !== null && task.type !== "personal" ? nameOf(task.assigneeId) : null;
          const meta = isDone ? (task.doneAt !== null ? `Xong ${cardDay(task.doneAt.slice(0, 10))?.replace(/^.*?, /, "") ?? ""}` : "Xong") : [day, who].filter((part): part is string => part !== null && part !== "").join(" · ");
          return (
            <li key={task.id} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                data-overview-task={task.id}
                aria-current={selectedId === task.id ? "true" : undefined}
                onClick={() => onOpen(task)}
                className={cn(
                  "press flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/30",
                  selectedId === task.id && "bg-personal/10",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    isDone ? "border-personal bg-personal text-personal-foreground" : "border-muted-foreground/50",
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-[14.5px]", isDone ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</span>
                {meta !== "" ? <span className="tabular min-w-0 max-w-[48%] shrink truncate text-right text-[12px] text-muted-foreground">{meta}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {onAdd !== undefined || onLink !== undefined ? (
        <div className="flex flex-wrap gap-x-4 px-3 pt-1">
          {onAdd !== undefined ? (
            <button type="button" onClick={onAdd} className="press inline-flex min-h-11 items-center gap-1.5 px-1 text-[13.5px] font-semibold text-personal">
              <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" /> Việc mới
            </button>
          ) : null}
          {onLink !== undefined ? (
            <button type="button" onClick={onLink} className="press inline-flex min-h-11 items-center gap-1.5 px-1 text-[13.5px] font-semibold text-personal">
              <Link2 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" /> Gắn việc có sẵn
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
