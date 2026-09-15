import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AssigneePicker } from "@/components/chat/AssigneePicker";
import { TimeField } from "@/components/tasks/TimeField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import type { ConversationKind } from "@/lib/chat";
import type { GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import { buildContextSnapshot, type ContextMessage } from "@/lib/task-context";
import type { SuggestionTarget } from "@/lib/task-suggestions";
import { isTaskDraftComplete, todayIso, validateTaskDraft, type TaskDraft } from "@/lib/tasks";
import { useSuggestionActions } from "@/lib/use-task-suggestions";
import { cn } from "@/lib/utils";

type TaskFromChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationKind: ConversationKind;
  conversationName: string;
  /** The 1-1 peer. Null in a group, where the assignees are chosen from the member list. */
  peerId: string | null;
  peerName: string;
  members: readonly GroupMember[];
  /**
   * The message this task is about. Raising a task from the composer quotes the newest message
   * in the thread; raising it from a bubble quotes that bubble. Null in an empty thread.
   */
  contextMessage: ContextMessage | null;
  contextSenderName: string;
};

const FIELD_CLASS =
  "w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground";

/**
 * Proposing work from inside the conversation it came out of.
 *
 * This raises a SUGGESTION, not a task. Nothing lands on anybody's task list until the person
 * being asked says yes — writing the task straight away put unanswered requests into their
 * deadlines and counters as though they had already agreed, which is the thing that made a
 * question feel like an instruction. The message being answered is copied onto the suggestion
 * and carried onto the task it eventually becomes, so it still makes sense long after the
 * thread moves on.
 */
export function TaskFromChatDialog({
  open,
  onOpenChange,
  conversationId,
  conversationKind,
  conversationName,
  peerId,
  peerName,
  members,
  contextMessage,
  contextSenderName,
}: TaskFromChatDialogProps) {
  const { user } = useAuth();
  const { propose } = useSuggestionActions();
  const today = todayIso();
  const isGroup = conversationKind === "group";

  const [draft, setDraft] = useState<TaskDraft>({ title: "", description: "", deadline: "" });
  const [deadlineTime, setDeadlineTime] = useState<string>("");
  const [assignees, setAssignees] = useState<GroupMember[]>([]);

  useEffect(() => {
    if (open) return;
    setDraft({ title: "", description: "", deadline: "" });
    setDeadlineTime("");
    setAssignees([]);
  }, [open]);

  /** Who this will be given to: the chosen members in a group, the other person in a 1-1. */
  const assigneeIds: string[] = useMemo(
    () => (isGroup ? assignees.map((member) => member.userId) : peerId === null ? [] : [peerId]),
    [isGroup, assignees, peerId],
  );

  const assigneeNames: string = isGroup
    ? assignees.map((member) => memberLabel(member)).join(", ")
    : peerName;

  const complete = isTaskDraftComplete(draft) && assigneeIds.length > 0;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const clean = validateTaskDraft({ ...draft, deadlineTime }, today);
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return;
    }
    if (assigneeIds.length === 0) {
      toast.error("Hãy chọn ít nhất một người đảm trách nhiệm vụ này.");
      return;
    }

    // One snapshot, taken once: every task from this dialog quotes the same moment.
    const contextSnapshot = buildContextSnapshot({
      conversationType: conversationKind,
      conversationId,
      conversationName,
      message: contextMessage,
      senderName: contextSenderName,
      userResponse: clean.value.description,
    });

    /**
     * Several people means several suggestions, not one suggestion with several owners. Each
     * is answered on its own, without waiting on anyone else. They are raised one after another
     * so a failure halfway is reported honestly rather than leaving the caller guessing which
     * ones landed.
     */
    const created: string[] = [];
    try {
      for (const assigneeId of assigneeIds) {
        const target: SuggestionTarget = {
          conversationId,
          assigneeId,
          messageId: contextMessage?.id ?? null,
          contextSnapshot,
        };
        await propose.mutateAsync({
          target,
          draft: {
            title: clean.value.title,
            description: clean.value.description,
            deadline: clean.value.deadline,
            deadlineTime: clean.value.deadlineTime,
          },
        });
        created.push(assigneeId);
      }
      toast.success(
        created.length > 1
          ? `Đã gửi ${created.length} gợi ý tới ${assigneeNames}.`
          : `Đã gợi ý việc này cho ${assigneeNames}.`,
      );
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không gửi được gợi ý.";
      toast.error(
        created.length === 0
          ? message
          : `Đã gửi ${created.length}/${assigneeIds.length} gợi ý. ${message}`,
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] max-w-[540px] gap-0 overflow-y-auto rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              Gợi ý tác vụ
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Đề xuất việc vừa trao đổi trong {conversationName} — người nhận sẽ quyết định
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        {contextMessage !== null ? (
          <div className="mx-5 mb-1 rounded-[10px] border border-border bg-secondary/40 px-3.5 py-2.5 sm:mx-6">
            <p className="text-[12px] font-medium text-muted-foreground">
              Gắn với tin nhắn của {contextSenderName}
            </p>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] leading-5 text-foreground">
              {contextMessage.content}
            </p>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-3 px-5 pb-5 pt-3 sm:px-6 sm:pb-6">
          <div>
            <label htmlFor="chat-task-title" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Tiêu đề
            </label>
            <input
              id="chat-task-title"
              value={draft.title}
              autoFocus
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Việc cần làm là gì?"
              className={cn(FIELD_CLASS, "h-12")}
            />
          </div>

          <div>
            <label
              htmlFor="chat-task-description"
              className="mb-1 block text-[12px] font-medium text-muted-foreground"
            >
              Mô tả cụ thể
            </label>
            <textarea
              id="chat-task-description"
              value={draft.description}
              rows={3}
              maxLength={2000}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Bạn cần gì? Kết quả dự kiến là gì?"
              className={cn(FIELD_CLASS, "resize-y py-2.5 leading-6")}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label
                htmlFor="chat-task-deadline"
                className="mb-1 block text-[12px] font-medium text-muted-foreground"
              >
                Hạn hoàn thành
              </label>
              <input
                id="chat-task-deadline"
                type="date"
                value={draft.deadline}
                min={today}
                onChange={(event) => setDraft((current) => ({ ...current, deadline: event.target.value }))}
                className={cn(FIELD_CLASS, "h-12 text-[14px]")}
              />
            </div>
            <div>
              <label
                htmlFor="chat-task-time"
                className="mb-1 block text-[12px] font-medium text-muted-foreground"
              >
                Giờ (không bắt buộc)
              </label>
              <TimeField id="chat-task-time" value={deadlineTime} onChange={setDeadlineTime} />
            </div>
          </div>

          <div>
            <label
              htmlFor="chat-task-assignee"
              className="mb-1 block text-[12px] font-medium text-muted-foreground"
            >
              Gợi ý cho
            </label>
            {isGroup ? (
              <AssigneePicker
                id="chat-task-assignee"
                members={members}
                selected={assignees}
                onChange={setAssignees}
                selfId={user?.id}
              />
            ) : (
              <p
                id="chat-task-assignee"
                className="flex h-12 items-center rounded-[10px] border border-border bg-secondary/40 px-3 text-[15px] text-foreground"
              >
                {peerName}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="press h-12 rounded-[10px] border border-border px-5 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={!complete || propose.isPending}
              title={complete ? undefined : "Cần đủ tiêu đề, mô tả, hạn hoàn thành và người nhận gợi ý"}
              className="press flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {propose.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {propose.isPending ? "Đang gửi…" : "Gửi gợi ý"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
