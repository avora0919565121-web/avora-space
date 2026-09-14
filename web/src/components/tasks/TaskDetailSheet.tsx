import { MessagesSquare, Pencil } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { PERSONAL_BUBBLE_STATE, SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { TaskEditForm } from "@/components/tasks/TaskEditForm";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { contextLink, contextTarget } from "@/lib/task-context";
import { durationFor, isImportantFor } from "@/lib/tasks";
import { formatDuration } from "@/lib/task-flags";
import {
  canConfirmSharedTask,
  canDeleteTask,
  canEditTask,
  canMarkSharedDone,
  canReturnSharedTask,
  canReviewSharedDone,
  deadlineLabel,
  editBlockedReason,
  isSharedTask,
  sharedTaskNote,
  taskStatusLabel,
  TIER_LABELS,
  taskTier,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskFlagIndex } from "@/lib/use-task-flags";
import { useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

/**
 * One task, opened from the list rather than from the conversation it lives in.
 *
 * Tab Nhiệm vụ used to be read-only: seeing what a task actually said meant finding the chat
 * it came from, which is a long way to go to re-read a sentence. This panel closes that gap —
 * the full text, who is carrying it, and where it came from, with editing available to the
 * people entitled to it.
 *
 * Deciding a shared task still happens in the conversation. Accepting work, filing it done
 * and reviewing that claim are two-party moments, and the place for them is where both people
 * can see what was agreed; this panel points there rather than duplicating those buttons.
 */
export function TaskDetailSheet({
  task,
  today,
  open,
  onOpenChange,
}: {
  task: TaskItem | null;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const flags = useTaskFlagIndex();
  const { togglePersonalDone } = useTaskActions();
  const [isEditing, setIsEditing] = useState<boolean>(false);

  if (task === null) return null;

  const userId = user?.id;
  const canEdit = canEditTask(task, userId);
  const blocked = editBlockedReason(task, userId);
  const target = contextTarget(task.contextSnapshot, task.conversationId);
  const deadline = deadlineLabel(task.deadline, today);
  const duration = formatDuration(durationFor(flags, task.id));
  const shared = isSharedTask(task);
  const done = task.status === "done";

  /** The panel is for reading and rewording; deciding a shared task stays in the chat. */
  const awaitsDecision =
    canConfirmSharedTask(task, userId) ||
    canMarkSharedDone(task, userId) ||
    canReviewSharedDone(task, userId) ||
    canReturnSharedTask(task, userId);

  const close = (): void => {
    setIsEditing(false);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setIsEditing(false);
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle className="sr-only">Chi tiết nhiệm vụ</SheetTitle>
        <SheetDescription className="sr-only">
          Xem và sửa nội dung nhiệm vụ. Các bước nhận việc và xác nhận hoàn thành nằm trong cuộc trò
          chuyện.
        </SheetDescription>

        <div className="space-y-4 pt-2">
          <div className="flex items-start gap-3">
            <TaskBubble
              state={shared ? SHARED_BUBBLE_STATE[task.status] : PERSONAL_BUBBLE_STATE[task.status]}
              label={taskStatusLabel(task.status)}
              onClick={
                shared || done
                  ? undefined
                  : () => {
                      void togglePersonalDone
                        .mutateAsync({ taskId: task.id, done: true })
                        .then(() => toast.success("Đã đánh dấu hoàn thành."))
                        .catch((error: unknown) => {
                          toast.error(
                            error instanceof Error ? error.message : "Có lỗi xảy ra. Thử lại nhé.",
                          );
                        });
                    }
              }
            />
            <div className="min-w-0 flex-1">
              <h2
                className={cn(
                  "text-[17px] font-semibold leading-6",
                  done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {task.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {TIER_LABELS[taskTier(task, userId)]} · {taskStatusLabel(task.status)}
              </p>
            </div>
          </div>

          {isEditing ? (
            <div className="rounded-[10px] border border-border bg-secondary/30 p-3">
              <TaskEditForm task={task} today={today} onClose={() => setIsEditing(false)} />
            </div>
          ) : (
            <>
              <div className="rounded-[10px] border border-border bg-card p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Mô tả
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6 text-foreground">
                  {task.description.trim() === "" ? "—" : task.description}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div className="rounded-[10px] border border-border bg-card px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">Hạn hoàn thành</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {deadline ?? "Không có hạn"}
                    {task.deadlineTime !== null ? ` · ${task.deadlineTime}` : ""}
                  </dd>
                </div>
                <div className="rounded-[10px] border border-border bg-card px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">Đánh giá của bạn</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {isImportantFor(flags, task.id) ? "Quan trọng" : "Bình thường"}
                    {duration !== null ? ` · ${duration}` : ""}
                  </dd>
                </div>
              </dl>

              {shared ? (
                <p className="text-[13px] text-muted-foreground">{sharedTaskNote(task, userId)}</p>
              ) : null}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Sửa
              </button>
            ) : null}

            {target !== null ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  navigate(contextLink(target.conversationId, task.id));
                }}
                className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <MessagesSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Xem trong ngữ cảnh
              </button>
            ) : null}
          </div>

          {/* Say why editing is unavailable rather than leaving an absent button to be read. */}
          {!canEdit && blocked !== null && !isEditing ? (
            <p className="text-[12px] leading-5 text-muted-foreground">{blocked}</p>
          ) : null}

          {/*
            A shared task waiting on this person is decided in the conversation, where both
            sides can see what was agreed. Saying so beats a button that silently is not here.
          */}
          {awaitsDecision ? (
            <p className="rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
              Nhiệm vụ này đang chờ bạn quyết định. Các bước nhận việc, báo xong và xác nhận hoàn thành
              nằm trong cuộc trò chuyện — nơi cả hai bên cùng thấy điều đã thống nhất.
            </p>
          ) : null}

          {canDeleteTask(task, userId) ? null : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
