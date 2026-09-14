import { ChevronRight, ListTodo, Pencil, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { SkipSuggestionDialog } from "@/components/chat/SkipSuggestionDialog";
import { SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { TaskEditForm } from "@/components/tasks/TaskEditForm";
import { useAuth } from "@/lib/auth";
import type { GroupMember } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import {
  canConfirmSharedTask,
  canDeleteTask,
  canEditTask,
  canMarkSharedDone,
  canReturnSharedTask,
  canReviewSharedDone,
  canSkipSharedTask,
  deadlineLabel,
  deleteIsPermanent,
  editBlockedReason,
  involvesViewer,
  isOpenTask,
  isSharedTask,
  isSuggestion,
  isTaskAssignee,
  partitionByBin,
  sharedTaskNote,
  sortTasksByPriority,
  suggestedByNote,
  taskStatusLabel,
  todayIso,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskActions, useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

type ChatTaskPanelProps = {
  conversationId: string;
  /** The 1-1 peer's name; in a group the assignee is named from the member list instead. */
  peerName: string;
  members: readonly GroupMember[];
  /** Set when arriving from "Xem trong ngữ cảnh", so that task is opened and pointed out. */
  highlightTaskId: string | null;
  /**
   * A group narrows this panel to the viewer's own work; the whole room's list lives behind
   * "Danh sách nhiệm vụ nhóm". A 1-1 has only two people, so its list can never run long and
   * is shown whole.
   */
  scope?: "mine" | "all";
  /**
   * Sends an ordinary message into this conversation, used when someone declines with a word.
   *
   * A plain message on purpose: a decline explained in a system notice would be the app
   * speaking for the person, and the whole point is that they said it themselves.
   */
  onSendMessage: (content: string) => Promise<void>;
};

/**
 * Every shared task belonging to this conversation, with the buttons that move it along.
 *
 * These actions live here and nowhere else. A task is a promise between two people, and the
 * place to accept, hand back or close one is the conversation it was made in — where both
 * sides can see what was actually agreed. Tab Nhiệm vụ reads them; this decides them.
 */
export function ChatTaskPanel({
  conversationId,
  peerName,
  members,
  highlightTaskId,
  scope = "all",
  onSendMessage,
}: ChatTaskPanelProps) {
  const { user } = useAuth();
  const { data: tasks } = useTasks();
  const userId: string | undefined = user?.id;
  const today = todayIso();
  const [isOpenOverride, setIsOpenOverride] = useState<boolean | null>(null);

  const threadTasks: TaskItem[] = useMemo(() => {
    const kept = partitionByBin(tasks ?? [], userId).kept;
    return sortTasksByPriority(
      kept.filter(
        (task) =>
          isSharedTask(task) &&
          task.conversationId === conversationId &&
          (scope === "all" || involvesViewer(task, userId)),
      ),
      today,
      userId,
    );
  }, [tasks, userId, conversationId, today, scope]);

  const openCount = threadTasks.filter((task) => isOpenTask(task, userId)).length;
  // A task the viewer must act on, or one they were just sent here to look at, opens the panel.
  const wantsAttention =
    highlightTaskId !== null ||
    threadTasks.some(
      (task) =>
        canConfirmSharedTask(task, userId) ||
        canMarkSharedDone(task, userId) ||
        canReviewSharedDone(task, userId),
    );
  const isOpen = isOpenOverride ?? wantsAttention;

  if (threadTasks.length === 0) return null;

  return (
    <section aria-label="Nhiệm vụ chung" className="border-t border-border bg-card px-5 md:px-10">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpenOverride(!isOpen)}
          className="press flex min-h-12 w-full items-center gap-2.5 py-2.5 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={2.2}
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
          <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
            Nhiệm vụ chung
          </span>
          <span
            className={cn(
              "tabular shrink-0 text-[13px]",
              openCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {openCount > 0 ? `${openCount} đang mở` : `${threadTasks.length} việc`}
          </span>
        </button>

        {isOpen ? (
          <ul className="rise-in space-y-1 pb-3">
            {threadTasks.map((task) => (
              <ChatTaskRow
                key={task.id}
                task={task}
                userId={userId}
                today={today}
                peerName={peerName}
                members={members}
                isHighlighted={task.id === highlightTaskId}
                onSendMessage={onSendMessage}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Who was asked for this, said by name so a group task never reads as "somebody". */
function assigneeLabel(
  task: TaskItem,
  members: readonly GroupMember[],
  peerName: string,
  userId: string | undefined,
): string {
  if (isTaskAssignee(task, userId)) return "bạn";
  if (task.assigneeId === null) return peerName;
  const member = members.find((entry) => entry.userId === task.assigneeId);
  return member ? peerLabel(member.displayName, member.email) : peerName;
}


/** Who raised this, named — so "X đã gợi ý việc này" can address a person rather than "ai đó". */
function creatorLabel(
  task: TaskItem,
  members: readonly GroupMember[],
  peerName: string,
  userId: string | undefined,
): string {
  if (task.creatorId === userId) return "Bạn";
  const member = members.find((entry) => entry.userId === task.creatorId);
  return member ? peerLabel(member.displayName, member.email) : peerName;
}

function ChatTaskRow({
  task,
  userId,
  today,
  peerName,
  members,
  isHighlighted,
  onSendMessage,
}: {
  task: TaskItem;
  userId: string | undefined;
  today: string;
  peerName: string;
  members: readonly GroupMember[];
  isHighlighted: boolean;
  onSendMessage: (content: string) => Promise<void>;
}) {
  const { confirmShared, markSharedDone, reviewSharedDone, returnShared, deleteShared, skipShared } =
    useTaskActions();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSkipOpen, setIsSkipOpen] = useState<boolean>(false);
  const canConfirm = canConfirmSharedTask(task, userId);
  const canMarkDone = canMarkSharedDone(task, userId);
  const canReview = canReviewSharedDone(task, userId);
  const canReturn = canReturnSharedTask(task, userId);
  const canDelete = canDeleteTask(task, userId);
  const canEdit = canEditTask(task, userId);
  const canSkip = canSkipSharedTask(task, userId);
  const editBlocked = editBlockedReason(task, userId);
  const permanent = deleteIsPermanent(task, userId);
  const deadline = deadlineLabel(task.deadline, today);
  // A suggestion is somebody else's request awaiting this person's answer, which is what
  // turns "Xác nhận/Xoá" into "Tạo tác vụ/Bỏ qua" and earns the note above the buttons.
  const suggested = isSuggestion(task, userId);
  const askedBy = creatorLabel(task, members, peerName, userId);

  const run = async (action: Promise<unknown>): Promise<void> => {
    try {
      await action;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
    }
  };

  /**
   * Declining, and saying so.
   *
   * The task changes state FIRST: if the message send fails afterwards the decline still
   * stands, which is the honest order — the answer was given, and a network problem must not
   * silently leave the request looking unanswered. A failed note is reported so the person
   * can say it again themselves.
   */
  const handleSkip = useCallback(
    async (input: { silent: boolean; message: string | null }): Promise<void> => {
      try {
        await skipShared.mutateAsync({ taskId: task.id, silent: input.silent });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không bỏ qua được.");
        return;
      }
      setIsSkipOpen(false);
      if (input.message !== null) {
        try {
          await onSendMessage(input.message);
        } catch {
          toast.error("Đã bỏ qua, nhưng lời nhắn chưa gửi được. Bạn thử gửi lại nhé.");
          return;
        }
      }
      toast.success("Đã bỏ qua việc này.");
    },
    [skipShared, task.id, onSendMessage],
  );

  return (
    <li
      id={`task-${task.id}`}
      className={cn(
        "rounded-[10px] border px-3 py-2.5 transition-colors",
        isHighlighted ? "border-primary bg-primary/5" : "border-border bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <TaskBubble state={SHARED_BUBBLE_STATE[task.status]} label={taskStatusLabel(task.status)} />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <TaskEditForm task={task} today={today} onClose={() => setIsEditing(false)} />
          ) : (
            <>
              <p
                className={cn(
                  "text-[14px] font-medium leading-5",
                  task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {task.title}
              </p>
              {task.description.trim() !== "" ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                  {task.description}
                </p>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                <span>Giao cho {assigneeLabel(task, members, peerName, userId)}</span>
                {deadline !== null ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{deadline}</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <span>{sharedTaskNote(task, userId)}</span>
              </p>
            </>
          )}
        </div>
        {canEdit && !isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            aria-label="Sửa nhiệm vụ"
            title="Sửa nhiệm vụ"
            className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:h-9 sm:w-9"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Say why the button is missing, rather than leaving it to be guessed. */}
      {!canEdit && editBlocked !== null && task.status === "done_pending_review" ? (
        <p className="mt-1.5 pl-11 text-[11px] text-muted-foreground">{editBlocked}</p>
      ) : null}

      {/*
        Named as a suggestion, not an assignment. Someone asked; this person decides. Saying so
        above the two buttons is what makes "Bỏ qua" read as a legitimate answer rather than as
        refusing an order.
      */}
      {suggested && !isEditing ? (
        <p className="mt-1.5 pl-11 text-[11.5px] text-muted-foreground">{suggestedByNote(askedBy)}</p>
      ) : null}

      {!isEditing && (canConfirm || canSkip || canMarkDone || canReview || canReturn || canDelete) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
          {canConfirm ? (
            <button
              type="button"
              onClick={() => void run(confirmShared.mutateAsync(task.id))}
              disabled={confirmShared.isPending}
              className="press h-12 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              Tạo tác vụ
            </button>
          ) : null}
          {canSkip ? (
            <button
              type="button"
              onClick={() => setIsSkipOpen(true)}
              disabled={skipShared.isPending}
              className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
            >
              Bỏ qua
            </button>
          ) : null}
          {canMarkDone ? (
            <button
              type="button"
              onClick={() => void run(markSharedDone.mutateAsync(task.id))}
              disabled={markSharedDone.isPending}
              className="press h-12 rounded-[10px] border border-foreground px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
            >
              Báo đã xong
            </button>
          ) : null}
          {canReview ? (
            <button
              type="button"
              onClick={() => void run(reviewSharedDone.mutateAsync(task.id))}
              disabled={reviewSharedDone.isPending}
              className="press h-12 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              Xác nhận hoàn thành
            </button>
          ) : null}
          {canReturn ? (
            <button
              type="button"
              onClick={() => void run(returnShared.mutateAsync(task.id))}
              disabled={returnShared.isPending}
              className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
            >
              Trả việc
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => void run(deleteShared.mutateAsync(task.id))}
              disabled={deleteShared.isPending}
              aria-label={permanent ? "Xoá hẳn — chưa ai nhận việc này" : "Xoá khỏi danh sách của bạn"}
              title={permanent ? "Xoá hẳn — chưa ai nhận việc này" : "Xoá khỏi danh sách của bạn"}
              className="press flex h-12 w-12 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      <SkipSuggestionDialog
        task={task}
        open={isSkipOpen}
        onOpenChange={setIsSkipOpen}
        creatorName={askedBy}
        onSkip={(input) => void handleSkip(input)}
        isWorking={skipShared.isPending}
      />
    </li>
  );
}
