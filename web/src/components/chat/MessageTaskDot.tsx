import { describeMessageTasks, type MessageTaskSummary } from "@/lib/message-tasks";
import { cn } from "@/lib/utils";

/**
 * A single dot beside a message's time, saying work came out of it.
 *
 * Deliberately not a chat line and not a notification. A system message would put words in
 * the room that nobody said, and everyone would be told twice — once by the task itself, once
 * by an announcement about it. A mark on the original message says the same thing to whoever
 * happens to scroll past, and says nothing to anybody who does not.
 *
 * The colour carries the only distinction worth making at this size: orange when any of the
 * work is the reader's own, green when it belongs to somebody else. Both are existing system
 * tokens — a new colour for this would be a third vocabulary nobody has learned.
 */
export function MessageTaskDot({
  summary,
  onOpen,
}: {
  summary: MessageTaskSummary;
  onOpen: () => void;
}) {
  const label = describeMessageTasks(summary);
  const isMine = summary.tone === "mine";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      /* A 6px dot is far too small to hit, so the button is a normal touch target with the
         dot drawn inside it rather than being the dot. */
      className="press -m-1 flex h-6 w-6 items-center justify-center rounded-full p-1 transition-colors hover:bg-accent/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-[7px] w-[7px] rounded-full",
          isMine ? "bg-primary" : "bg-money-in",
        )}
      />
      {/* Several pieces of work from one message stay one dot; the count rides alongside it
          only when there is more than one, so the usual case stays silent. */}
      {summary.count > 1 ? (
        <span className="tabular ml-0.5 text-[11px] font-medium text-muted-foreground">
          {summary.count}
        </span>
      ) : null}
    </button>
  );
}
