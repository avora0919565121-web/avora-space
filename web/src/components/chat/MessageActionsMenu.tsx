import { ListPlus, MoreHorizontal, Pencil, Pin, PinOff, Reply, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/components/chat/MessageTaskButton";
import { canEditMessage, canRecallMessage, canReplyToMessage, type ChatMessage } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** Everything that can be done to a single message. */
export type MessageAction = "reply" | "task" | "edit" | "recall" | "pin" | "unpin";

/**
 * Everything you can do to one message, in one place.
 *
 * "Tạo task" used to be its own icon on every bubble, which worked while it was the only
 * action. Adding reply, edit and recall beside it would have put four icons on every line of a
 * conversation — so they collapse into a single "…" that stays quiet until wanted.
 *
 * What appears inside depends on who sent the message and how long ago. Edit and recall are
 * simply absent past the 24-hour window rather than shown and refused: an action that is
 * offered and then rejected teaches people not to trust the menu. The server enforces the
 * same window regardless, so this is an honest reflection of the rule, not the rule itself.
 */
export function MessageActionsMenu({
  message,
  viewerId,
  canRaiseTask,
  canPin = false,
  isPinned = false,
  onAction,
  open,
  onOpenChange,
  className,
}: {
  message: ChatMessage;
  viewerId: string | undefined;
  /** False in a journal, where there is nobody to give a task to. */
  canRaiseTask: boolean;
  /** False for a withdrawn message: there are no words left to point at. */
  canPin?: boolean;
  /** True when this message is already pinned for an audience the viewer can clear. */
  isPinned?: boolean;
  onAction: (action: MessageAction) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const showReply = canReplyToMessage(message);
  const showEdit = canEditMessage(message, viewerId);
  const showRecall = canRecallMessage(message, viewerId);
  const showTask = canRaiseTask && message.pending !== true && message.deletedAt == null;
  const showPin = canPin && message.pending !== true && message.deletedAt == null;

  if (!showReply && !showEdit && !showRecall && !showTask && !showPin) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Nhiệm vụ cho tin nhắn: ${message.content.slice(0, 60)}`}
          title="Nhiệm vụ"
          className={cn(
            "press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {showReply ? (
          <DropdownMenuItem onSelect={() => onAction("reply")}>
            <Reply className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Trả lời
          </DropdownMenuItem>
        ) : null}
        {showTask ? (
          <DropdownMenuItem onSelect={() => onAction("task")}>
            <ListPlus className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Tạo task
          </DropdownMenuItem>
        ) : null}
        {showPin ? (
          <DropdownMenuItem onSelect={() => onAction(isPinned ? "unpin" : "pin")}>
            {isPinned ? (
              <PinOff className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Pin className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            )}
            {isPinned ? "Bỏ ghim" : "Ghim"}
          </DropdownMenuItem>
        ) : null}
        {showEdit ? (
          <DropdownMenuItem onSelect={() => onAction("edit")}>
            <Pencil className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Sửa
          </DropdownMenuItem>
        ) : null}
        {showRecall ? (
          <DropdownMenuItem onSelect={() => onAction("recall")} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Thu hồi
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One bubble with its menu, plus the touch way in.
 *
 * A pointer gets the "…" on hover; a finger has no hover, so resting on the bubble opens the
 * same menu. Open state is held here so both gestures reach one menu rather than two
 * lookalikes, and the long-press hook lives here rather than in the thread's render loop,
 * where it would be a hook inside a map.
 */
export function MessageActionsAffordance({
  message,
  viewerId,
  canRaiseTask,
  canPin = false,
  isPinned = false,
  outgoing,
  onAction,
  reactionPicker,
  children,
}: {
  message: ChatMessage;
  viewerId: string | undefined;
  canRaiseTask: boolean;
  canPin?: boolean;
  isPinned?: boolean;
  outgoing: boolean;
  onAction: (action: MessageAction) => void;
  /**
   * Sits beside the menu rather than inside it. A reaction is a one-tap gesture, and burying
   * it two taps deep in a list would make it slower than typing "ok".
   */
  reactionPicker?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const { handlers, isPressing } = useLongPress(() => setIsOpen(true));

  return (
    <div className={cn("flex w-full items-center gap-1.5", outgoing ? "flex-row-reverse" : "flex-row")}>
      <div
        {...handlers}
        className={cn(
          "max-w-[80%] transition-opacity",
          isPressing ? "select-none opacity-70" : "opacity-100",
        )}
      >
        {children}
      </div>
      {reactionPicker}
      <MessageActionsMenu
        message={message}
        viewerId={viewerId}
        canRaiseTask={canRaiseTask}
        canPin={canPin}
        isPinned={isPinned}
        onAction={onAction}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </div>
  );
}
