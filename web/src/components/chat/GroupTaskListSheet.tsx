import { ListTodo } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { groupTasksByAssignee } from "@/lib/group-task-list";
import type { GroupMember } from "@/lib/groups";
import { contextLink } from "@/lib/task-context";
import {
  deadlineLabel,
  isOpenTask,
  isSharedTask,
  partitionByBin,
  sortTasksByPriority,
  taskStatusLabel,
  todayIso,
  type TaskItem,
} from "@/lib/tasks";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

type GroupTaskListSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  groupName: string;
  members: readonly GroupMember[];
};

/**
 * The whole group's work, in one place.
 *
 * The panel inside the chat is deliberately narrow — your own work, nothing else — so this is
 * where the rest of it lives: who is carrying what, across every member. It reads rather than
 * decides; each row links back to the message its task came from, which is where the buttons
 * that move a task along have always been.
 */
export function GroupTaskListSheet({
  open,
  onOpenChange,
  conversationId,
  groupName,
  members,
}: GroupTaskListSheetProps) {
  const { user } = useAuth();
  const { data: tasks } = useTasks();
  const userId: string | undefined = user?.id;
  const today = todayIso();

  const threadTasks: TaskItem[] = useMemo(() => {
    const kept = partitionByBin(tasks ?? [], userId).kept;
    return sortTasksByPriority(
      kept.filter((task) => isSharedTask(task) && task.conversationId === conversationId),
      today,
      userId,
    );
  }, [tasks, userId, conversationId, today]);

  const sections = useMemo(
    () => groupTasksByAssignee(threadTasks, members, userId),
    [threadTasks, members, userId],
  );

  const openCount = threadTasks.filter((task) => isOpenTask(task, userId)).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md">
        <div className="border-b border-border px-5 py-5">
          <SheetTitle className="text-[20px] font-semibold tracking-tight text-foreground">
            Danh sách nhiệm vụ nhóm
          </SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
            {threadTasks.length === 0
              ? `Chưa có nhiệm vụ nào trong ${groupName}`
              : `${threadTasks.length} việc trong ${groupName} · ${openCount} đang mở`}
          </SheetDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {sections.length === 0 ? (
            <div className="py-16 text-center">
              <ListTodo
                className="mx-auto h-10 w-10 text-muted-foreground/60"
                strokeWidth={1.3}
                aria-hidden="true"
              />
              <p className="mt-4 text-[14px] text-muted-foreground">
                Nhiệm vụ được tạo từ trong cuộc trò chuyện — mở một tin nhắn và chọn “Tạo task từ tin nhắn
                này”.
              </p>
            </div>
          ) : (
            <ul className="space-y-6">
              {sections.map((section) => (
                <li key={section.key}>
                  <div className="mb-2 flex items-center gap-2.5">
                    <InitialsAvatar name={section.name} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
                      {section.name}
                    </p>
                    <span className="tabular shrink-0 text-[12px] text-muted-foreground">
                      {section.tasks.length} việc
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {section.tasks.map((task) => {
                      const deadline = deadlineLabel(task.deadline, today);
                      return (
                        <li key={task.id}>
                          <Link
                            to={contextLink(conversationId, task.id)}
                            onClick={() => onOpenChange(false)}
                            className="press flex items-start gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40"
                          >
                            <TaskBubble
                              state={SHARED_BUBBLE_STATE[task.status]}
                              label={taskStatusLabel(task.status)}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block text-[14px] font-medium leading-5",
                                  task.status === "done"
                                    ? "text-muted-foreground line-through"
                                    : "text-foreground",
                                )}
                              >
                                {task.title}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                                <span>{taskStatusLabel(task.status)}</span>
                                {deadline !== null ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{deadline}</span>
                                  </>
                                ) : null}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
