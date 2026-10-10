import { Check, ChevronRight, Copy, ExternalLink, Lightbulb } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { SkipSuggestionDialog } from "@/components/chat/SkipSuggestionDialog";
import { TaskCard } from "@/components/tasks/TaskCard";
import { eventSummary, isLinkLocation, noteSummary, TRAVEL_CHIPS } from "@/lib/task-composer";
import { useAuth } from "@/lib/auth";
import type { ConversationKind } from "@/lib/chat";
import type { GroupMember } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import {
  canAnswerSuggestion,
  canManageSuggestion,
  canSkipSuggestionSilently,
  pendingInConversation,
  recentlyAcceptedInConversation,
  setTaskTravel,
  suggestionChanged,
  type TaskSuggestion,
} from "@/lib/task-suggestions";
import { useMyTravelPlans, useSuggestionTravelFlags, useComposerActions } from "@/lib/use-task-composer";
import { useTasks } from "@/lib/use-tasks";
import { deadlineLabel, suggestedByNote, todayIso, type TaskItem } from "@/lib/tasks";
import { useSuggestionActions, useTaskSuggestions } from "@/lib/use-task-suggestions";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ChatSuggestionPanelProps = {
  conversationId: string;
  conversationKind: ConversationKind;
  /** The 1-1 peer's name; in a group people are named from the member list instead. */
  peerName: string;
  members: readonly GroupMember[];
  /**
   * Sends an ordinary message into this conversation when someone declines with a word.
   *
   * A plain message on purpose: a decline explained in a system notice would be the app
   * speaking for the person, and the whole point is that they said it themselves.
   * `replyToMessageId` quotes the message the suggestion came out of, so the answer lands
   * beside the ask rather than loose at the bottom of the thread.
   */
  onSendMessage: (content: string, replyToMessageId?: string | null) => Promise<void>;
  /**
   * A suggestion the reader asked to see, from the dot on the message it came out of.
   *
   * It unfolds the panel and marks that one row, which is the whole answer to "what came of
   * this message" when the work is still a question nobody has answered.
   */
  focusedSuggestionId?: string | null;
  /** AVORA-49 · 2.1: opened from the thread's chip row — the list only, capped at 35% of the screen. */
  embedded?: boolean;
};

/** Suggestions waiting in this thread, for the chip row's count (AVORA-49 · 2.1). */
export function useChatSuggestions(conversationId: string) {
  const { user } = useAuth();
  const { data: suggestions } = useTaskSuggestions();
  const pending: TaskSuggestion[] = useMemo(() => pendingInConversation(suggestions ?? [], conversationId), [suggestions, conversationId]);
  const accepted: TaskSuggestion[] = useMemo(() => recentlyAcceptedInConversation(suggestions ?? [], conversationId), [suggestions, conversationId]);
  const awaitingMe = pending.some((entry) => canAnswerSuggestion(entry, user?.id));
  return { pending, accepted, awaitingMe };
}

/**
 * Work that has been proposed here and not yet answered.
 *
 * Kept separate from "Nhiệm vụ chung" below it because the two are not the same kind of thing.
 * A task is a promise somebody made; a suggestion is a question somebody asked. Mixing them put
 * unanswered questions into task counts and deadline views, which made a request look like a
 * commitment nobody had actually given.
 */
export function ChatSuggestionPanel({
  conversationId,
  conversationKind,
  peerName,
  members,
  onSendMessage,
  focusedSuggestionId = null,
  embedded = false,
}: ChatSuggestionPanelProps) {
  const { user } = useAuth();
  const { data: suggestions } = useTaskSuggestions();
  const userId: string | undefined = user?.id;
  const today = todayIso();
  const [isOpenOverride, setIsOpenOverride] = useState<boolean | null>(null);

  const pending: TaskSuggestion[] = useMemo(
    () => pendingInConversation(suggestions ?? [], conversationId),
    [suggestions, conversationId],
  );
  // D3: answered "Đồng ý" in the last few days — the assignee gets "Chỉnh theo cách của bạn",
  // the proposer sees "✓ {Tên} đã nhận vào lịch". Never a new message in the thread.
  const accepted: TaskSuggestion[] = useMemo(
    () => recentlyAcceptedInConversation(suggestions ?? [], conversationId),
    [suggestions, conversationId],
  );

  // An unanswered question aimed at this person opens the panel; one they are merely waiting
  // on does not — the other side is holding that, and nothing is being asked of the reader.
  const awaitingMe = pending.some((entry) => canAnswerSuggestion(entry, userId));
  // Being sent here to look at one particular question opens the panel too, whoever it
  // belongs to — otherwise the dot would appear to do nothing.
  const isFocusedHere = pending.some((entry) => entry.id === focusedSuggestionId);
  const isOpen = isFocusedHere ? true : (isOpenOverride ?? awaitingMe);

  if (pending.length === 0 && accepted.length === 0) return null;

  const rows = (
    <>
      {pending.map((suggestion) => (
        <SuggestionRow
          key={suggestion.id}
          suggestion={suggestion}
          userId={userId}
          today={today}
          conversationKind={conversationKind}
          peerName={peerName}
          members={members}
          onSendMessage={onSendMessage}
          isHighlighted={suggestion.id === focusedSuggestionId}
        />
      ))}
      {accepted.map((suggestion) => (
        <AcceptedRow key={suggestion.id} suggestion={suggestion} userId={userId} peerName={peerName} members={members} />
      ))}
    </>
  );

  if (embedded) {
    return (
      <section aria-label="Gợi ý nhiệm vụ" className="max-h-[35dvh] scroll-y border-b border-border bg-card px-3 md:px-10">
        <ul className="mx-auto max-w-2xl space-y-1 py-2">{rows}</ul>
      </section>
    );
  }

  return (
    <section aria-label="Gợi ý nhiệm vụ" className="border-t border-border bg-card px-5 md:px-10">
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
          <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
            Gợi ý nhiệm vụ
          </span>
          <span
            className={cn(
              "tabular shrink-0 text-[13px]",
              awaitingMe ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {awaitingMe ? "Chờ bạn trả lời" : pending.length > 0 ? `${pending.length} đang chờ` : `${accepted.length} đã nhận`}
          </span>
        </button>

        {isOpen ? (
          <ul className="rise-in space-y-1 pb-3">
            {pending.map((suggestion) => (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                userId={userId}
                today={today}
                conversationKind={conversationKind}
                peerName={peerName}
                members={members}
                onSendMessage={onSendMessage}
                isHighlighted={suggestion.id === focusedSuggestionId}
              />
            ))}
            {accepted.map((suggestion) => (
              <AcceptedRow
                key={suggestion.id}
                suggestion={suggestion}
                userId={userId}
                peerName={peerName}
                members={members}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Names someone in this room, so no line has to say "ai đó". */
function nameOf(
  personId: string,
  members: readonly GroupMember[],
  peerName: string,
  userId: string | undefined,
): string {
  if (personId === userId) return "Bạn";
  const member = members.find((entry) => entry.userId === personId);
  return member ? peerLabel(member.displayName) : peerName;
}

function SuggestionRow({
  suggestion,
  userId,
  today,
  conversationKind,
  peerName,
  members,
  onSendMessage,
  isHighlighted = false,
}: {
  suggestion: TaskSuggestion;
  userId: string | undefined;
  today: string;
  conversationKind: ConversationKind;
  peerName: string;
  members: readonly GroupMember[];
  onSendMessage: (content: string, replyToMessageId?: string | null) => Promise<void>;
  /** Set when the reader arrived here from the dot on the message this came out of. */
  isHighlighted?: boolean;
}) {
  const { accept, skip, withdraw } = useSuggestionActions();
  const [isSkipOpen, setIsSkipOpen] = useState<boolean>(false);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState<boolean>(false);
  const canAnswer = canAnswerSuggestion(suggestion, userId);
  const canManage = canManageSuggestion(suggestion, userId);
  const askedBy = nameOf(suggestion.proposerId, members, peerName, userId);
  const askedOf = nameOf(suggestion.assigneeId, members, peerName, userId);
  const deadline = deadlineLabel(suggestion.deadline, today);

  /**
   * Declining, and saying so.
   *
   * The suggestion is answered FIRST: if the message fails to send afterwards the decline
   * still stands, which is the honest order — the answer was given, and a network problem must
   * not silently leave the request looking unanswered. A failed note is reported so the person
   * can say it again themselves.
   *
   * The note quotes the message the suggestion came out of, so the ask and its answer read
   * together even with other talk in between. A suggestion raised in an empty thread has no
   * message to quote and its reply simply stands alone.
   */
  const handleSkip = useCallback(
    async (input: { silent: boolean; message: string | null }): Promise<void> => {
      try {
        await skip.mutateAsync({ suggestionId: suggestion.id, silent: input.silent });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không từ chối được.");
        return;
      }
      setIsSkipOpen(false);
      if (input.message !== null) {
        try {
          await onSendMessage(input.message, suggestion.messageId);
        } catch {
          toast.error("Đã từ chối, nhưng lời nhắn chưa gửi được. Bạn thử gửi lại nhé.");
          return;
        }
      }
      toast.success("Đã từ chối gợi ý này.");
    },
    [skip, suggestion.id, suggestion.messageId, onSendMessage],
  );

  const handleAccept = useCallback(async (): Promise<void> => {
    try {
      await accept.mutateAsync(suggestion.id);
      toast.success("Đã vào lịch của bạn.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không nhận được gợi ý này.");
    }
  }, [accept, suggestion.id]);

  const handleWithdraw = useCallback(async (): Promise<void> => {
    try {
      await withdraw.mutateAsync(suggestion.id);
      toast.success("Đã rút lại gợi ý.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không rút được gợi ý.");
    }
  }, [withdraw, suggestion.id]);

  return (
    <li
      className={cn(
        "rounded-[10px] border border-dashed bg-card px-3 py-2.5 transition-colors",
        isHighlighted ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        {/*
          A dashed outline, not a task bubble. Nothing here has been agreed to yet, and giving
          it the same mark as accepted work is exactly what made suggestions read as orders.
        */}
        <span
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-5 text-foreground">{suggestion.title}</p>
          <SuggestionSummary suggestion={suggestion} />
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
            <span>Gợi ý cho {askedOf === "Bạn" ? "bạn" : askedOf}</span>
            {deadline !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{deadline}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/*
        Named as a suggestion, not an assignment. Someone asked; this person decides. Saying so
        above the two buttons is what makes "Từ chối" read as a legitimate answer rather than as
        refusing an order.
      */}
      <p className="mt-1.5 pl-7 text-[11.5px] text-muted-foreground">
        {canAnswer
          ? suggestedByNote(askedBy)
          : canManage
            ? `Chờ ${askedOf} xem — bạn có thể sửa hoặc rút lại.`
            : `Chờ ${askedOf === "Bạn" ? "bạn" : askedOf} xem`}
      </p>

      {canAnswer ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={accept.isPending}
            className="press h-12 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Đồng ý
          </button>
          <button
            type="button"
            onClick={() => setIsSkipOpen(true)}
            disabled={skip.isPending}
            className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
          >
            Từ chối
          </button>
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
          <button
            type="button"
            onClick={() => setIsEditOpen(true)}
            disabled={withdraw.isPending}
            className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
          >
            Sửa
          </button>
          <button
            type="button"
            onClick={() => setIsWithdrawOpen(true)}
            disabled={withdraw.isPending}
            className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
          >
            Rút lại
          </button>
        </div>
      ) : null}

      <SkipSuggestionDialog
        title={suggestion.title}
        allowSilent={canSkipSuggestionSilently(conversationKind)}
        open={isSkipOpen}
        onOpenChange={setIsSkipOpen}
        creatorName={askedBy}
        onSkip={(input) => void handleSkip(input)}
        isWorking={skip.isPending}
      />

      <TaskCard
        suggestion={isEditOpen ? suggestion : null}
        assigneeName={askedOf}
        place={conversationKind === "group" ? "group" : "direct"}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />

      {/*
        Withdrawing gets one confirmation and no second chance: the question goes back and
        nobody is asked to answer it again. The copy says what actually happens — no task was
        ever created, so nothing is deleted; the request simply stops being open.
      */}
      <AlertDialog open={isWithdrawOpen} onOpenChange={setIsWithdrawOpen}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Rút lại gợi ý này?</AlertDialogTitle>
            <AlertDialogDescription>
              “{suggestion.title}” sẽ ngừng chờ câu trả lời và biến mất khỏi danh sách của cả hai
              bên. Không có nhiệm vụ nào bị xoá — nó chưa từng tồn tại.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-transparent text-foreground hover:bg-accent/40">
              Để nguyên
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleWithdraw()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Rút lại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * What a suggestion carries, one line per thing that exists: Sự kiện, "Cần bạn có mặt", Ghi chú.
 * A place written as a link gets "Mở link" (never opened on its own); a plain place gets "Chép".
 */
function SuggestionSummary({
  suggestion,
  task = null,
}: {
  suggestion: TaskSuggestion;
  /** Once accepted: the task as it is now, which is what the proposer should read. */
  task?: TaskItem | null;
}) {
  const [openLine, setOpenLine] = useState<string | null>(null);
  const startAt = task?.startAt ?? (task === null ? suggestion.startAt : null);
  const endAt = task !== null ? task.endAt : suggestion.endAt;
  const location = task !== null ? task.location : suggestion.location;
  const presence = task !== null ? task.requiresPresence : suggestion.requiresPresence;
  const description = task !== null ? task.description : suggestion.description;
  const event = eventSummary(startAt, endAt, location);
  const note = noteSummary(description);
  const changed = task !== null && suggestionChanged(suggestion, task);

  const copy = (text: string): void => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success("Đã chép địa điểm."))
      .catch(() => toast.error("Không chép được."));
  };

  if (event === null && !presence && note === null) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[12.5px] leading-5 text-muted-foreground">
      {event !== null ? (
        <div className="flex flex-wrap items-center gap-x-2">
          <button type="button" onClick={() => setOpenLine(openLine === "event" ? null : "event")} className="press min-w-0 truncate text-left text-foreground/80 hover:text-foreground">
            {event}
          </button>
          {changed ? <span className="rounded-full bg-secondary px-1.5 text-[11px] font-medium text-foreground">đã đổi</span> : null}
          {location !== null && location.trim() !== "" ? (
            isLinkLocation(location) ? (
              <a href={location.trim()} target="_blank" rel="noreferrer noopener" className="press inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                Mở link
              </a>
            ) : (
              <button type="button" onClick={() => copy(location.trim())} className="press inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Copy className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                Chép
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {openLine === "event" && startAt !== null ? (
        <p className="pl-2 text-[12px]">
          {new Date(startAt).toLocaleString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          {endAt !== null ? ` → ${new Date(endAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {location !== null ? ` · ${location}` : ""}
        </p>
      ) : null}
      {presence ? <p className="text-foreground/80">Cần bạn có mặt</p> : null}
      {note !== null ? (
        <button type="button" onClick={() => setOpenLine(openLine === "note" ? null : "note")} className="press block max-w-full truncate text-left hover:text-foreground">
          {note}
        </button>
      ) : null}
      {openLine === "note" ? <p className="whitespace-pre-wrap pl-2 text-[12px] text-foreground/80">{description}</p> : null}
    </div>
  );
}

/**
 * A suggestion someone said "Đồng ý" to. The work is the assignee's now (D3):
 * - the assignee reads "Đã vào lịch của bạn · Chỉnh theo cách của bạn" (same form, Giao cho locked),
 *   and — if presence was asked — "Bạn đi mất bao lâu?";
 * - the proposer reads "✓ {Tên} đã nhận vào lịch", the task as it stands now, "đã đổi" when the
 *   Event moved, and "đã sắp xếp đi lại" as a yes/no. Never the travel minutes.
 */
function AcceptedRow({
  suggestion,
  userId,
  peerName,
  members,
}: {
  suggestion: TaskSuggestion;
  userId: string | undefined;
  peerName: string;
  members: readonly GroupMember[];
}) {
  const { data: tasks } = useTasks();
  const { data: flags } = useSuggestionTravelFlags();
  const { data: plans } = useMyTravelPlans();
  const { refreshTravel } = useComposerActions();
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [isSavingTravel, setIsSavingTravel] = useState<boolean>(false);
  const task = tasks?.find((entry) => entry.id === suggestion.acceptedTaskId) ?? null;
  const isAssignee = suggestion.assigneeId === userId;
  const isProposer = suggestion.proposerId === userId;
  if (!isAssignee && !isProposer) return null;

  const assigneeName = nameOf(suggestion.assigneeId, members, peerName, userId);
  const hasPlan = plans?.some((plan) => plan.taskId === suggestion.acceptedTaskId) ?? false;
  const arranged = flags?.get(suggestion.id) ?? false;
  const asksTravel = isAssignee && task !== null && task.requiresPresence && task.startAt !== null && !hasPlan;

  const chooseTravel = async (minutes: number | null): Promise<void> => {
    if (suggestion.acceptedTaskId === null) return;
    setIsSavingTravel(true);
    try {
      if (minutes !== null) await setTaskTravel(suggestion.acceptedTaskId, minutes, 10);
      refreshTravel();
      if (minutes !== null) toast.success("Đã đặt giờ lên đường.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được thời gian đi.");
    } finally {
      setIsSavingTravel(false);
    }
  };

  return (
    <li className="rounded-[10px] border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-5 text-foreground">{task?.title ?? suggestion.title}</p>
          <SuggestionSummary suggestion={suggestion} task={task} />
          {isAssignee ? (
            <button
              type="button"
              disabled={task === null}
              onClick={() => setIsEditOpen(true)}
              className="press mt-1 text-left text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              Đã vào lịch của bạn · <span className="font-medium text-primary underline-offset-2 hover:underline">Chỉnh theo cách của bạn</span>
            </button>
          ) : (
            <p className="mt-1 text-[12.5px] font-medium text-foreground">
              ✓ {assigneeName} đã nhận vào lịch{suggestion.requiresPresence && arranged ? " · đã sắp xếp đi lại" : ""}
            </p>
          )}
        </div>
      </div>

      {asksTravel ? (
        <div className="mt-2 pl-7">
          <p className="mb-1.5 text-[12.5px] font-medium text-foreground">Bạn đi mất bao lâu?</p>
          <div className="flex flex-wrap gap-1.5">
            {TRAVEL_CHIPS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={isSavingTravel}
                onClick={() => void chooseTravel(minutes)}
                className="press h-10 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-foreground hover:bg-accent/50 disabled:opacity-50"
              >
                {minutes}
              </button>
            ))}
            <button
              type="button"
              disabled={isSavingTravel}
              onClick={() => void chooseTravel(null)}
              className="press h-10 rounded-full px-3 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Bỏ qua
            </button>
          </div>
        </div>
      ) : null}

      {isAssignee ? (
        <TaskCard task={isEditOpen ? task : null} open={isEditOpen} onOpenChange={setIsEditOpen} backLabel="Cuộc trò chuyện" />
      ) : null}
    </li>
  );
}
