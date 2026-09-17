import { ListTodo, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { filterMemberSections, groupTasksByAssignee } from "@/lib/group-task-list";
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
  /** The member the list is narrowed to, or null for "everyone". Keyed like the sections are. */
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  // Closing the sheet forgets the pick, so reopening reads the whole room again.
  useEffect(() => {
    if (!open) setPickedKey(null);
  }, [open]);

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
  const visibleSections = useMemo(
    () => filterMemberSections(sections, pickedKey),
    [sections, pickedKey],
  );

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

        {/*
          One chip per person the list already groups by. The bar only earns its place when
          there is more than one answer — a single member has nothing to narrow.
        */}
        {sections.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-3">
            <button
              type="button"
              onClick={() => setPickedKey(null)}
              aria-pressed={pickedKey === null}
              className={cn(
                "press rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                pickedKey === null
                  ? "border-foreground/25 bg-accent text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent/40",
              )}
            >
              Tất cả
            </button>
            {sections.map((section) => {
              const active = pickedKey === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setPickedKey(active ? null : section.key)}
                  aria-pressed={active}
                  className={cn(
                    "press flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                    active
                      ? "border-foreground/25 bg-accent text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent/40",
                  )}
                >
                  {section.name}
                  <span className="tabular text-[11px] text-muted-foreground/80">{section.tasks.length}</span>
                </button>
              );
            })}
            {pickedKey !== null ? (
              <button
                type="button"
                onClick={() => setPickedKey(null)}
                title="Bỏ lọc"
                aria-label="Bỏ lọc theo người đảm trách"
                className="press flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                Bỏ lọc
              </button>
            ) : null}
          </div>
        ) : null}

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
          ) : visibleSections.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[14px] text-muted-foreground">
                Người này hiện không đảm trách việc nào. Có thể việc của họ vừa được hoàn tất hoặc
                xoá — bấm “Tất cả” để xem lại cả nhóm.
              </p>
            </div>
          ) : (
            <ul className="space-y-6">
              {visibleSections.map((section) => (
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
