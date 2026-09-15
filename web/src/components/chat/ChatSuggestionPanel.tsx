import { ChevronRight, Lightbulb } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { SkipSuggestionDialog } from "@/components/chat/SkipSuggestionDialog";
import { useAuth } from "@/lib/auth";
import type { ConversationKind } from "@/lib/chat";
import type { GroupMember } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import {
  canAnswerSuggestion,
  canSkipSuggestionSilently,
  pendingInConversation,
  type TaskSuggestion,
} from "@/lib/task-suggestions";
import { deadlineLabel, suggestedByNote, todayIso } from "@/lib/tasks";
import { useSuggestionActions, useTaskSuggestions } from "@/lib/use-task-suggestions";
import { cn } from "@/lib/utils";

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
   */
  onSendMessage: (content: string) => Promise<void>;
};

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

  // An unanswered question aimed at this person opens the panel; one they are merely waiting
  // on does not — the other side is holding that, and nothing is being asked of the reader.
  const awaitingMe = pending.some((entry) => canAnswerSuggestion(entry, userId));
  const isOpen = isOpenOverride ?? awaitingMe;

  if (pending.length === 0) return null;

  return (
    <section aria-label="Gợi ý tác vụ" className="border-t border-border bg-card px-5 md:px-10">
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
            Gợi ý tác vụ
          </span>
          <span
            className={cn(
              "tabular shrink-0 text-[13px]",
              awaitingMe ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {awaitingMe ? "Chờ bạn trả lời" : `${pending.length} đang chờ`}
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
  return member ? peerLabel(member.displayName, member.email) : peerName;
}

function SuggestionRow({
  suggestion,
  userId,
  today,
  conversationKind,
  peerName,
  members,
  onSendMessage,
}: {
  suggestion: TaskSuggestion;
  userId: string | undefined;
  today: string;
  conversationKind: ConversationKind;
  peerName: string;
  members: readonly GroupMember[];
  onSendMessage: (content: string) => Promise<void>;
}) {
  const { accept, skip } = useSuggestionActions();
  const [isSkipOpen, setIsSkipOpen] = useState<boolean>(false);
  const canAnswer = canAnswerSuggestion(suggestion, userId);
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
   */
  const handleSkip = useCallback(
    async (input: { silent: boolean; message: string | null }): Promise<void> => {
      try {
        await skip.mutateAsync({ suggestionId: suggestion.id, silent: input.silent });
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
      toast.success("Đã bỏ qua gợi ý này.");
    },
    [skip, suggestion.id, onSendMessage],
  );

  const handleAccept = useCallback(async (): Promise<void> => {
    try {
      await accept.mutateAsync(suggestion.id);
      toast.success("Đã tạo tác vụ.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tạo được tác vụ.");
    }
  }, [accept, suggestion.id]);

  return (
    <li className="rounded-[10px] border border-dashed border-border bg-card px-3 py-2.5">
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
          {suggestion.description.trim() !== "" ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
              {suggestion.description}
            </p>
          ) : null}
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
        above the two buttons is what makes "Bỏ qua" read as a legitimate answer rather than as
        refusing an order.
      */}
      <p className="mt-1.5 pl-7 text-[11.5px] text-muted-foreground">
        {canAnswer
          ? suggestedByNote(askedBy)
          : `Đang chờ ${askedOf === "Bạn" ? "bạn" : askedOf} trả lời`}
      </p>

      {canAnswer ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={accept.isPending}
            className="press h-12 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Tạo tác vụ
          </button>
          <button
            type="button"
            onClick={() => setIsSkipOpen(true)}
            disabled={skip.isPending}
            className="press h-12 rounded-[10px] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
          >
            Bỏ qua
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
    </li>
  );
}
