import {
  CheckSquare,
  Clock3,
  Flag,
  Forward,
  Hand,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { canEditMessage, canRecallMessage, canReplyToMessage, type ChatMessage } from "@/lib/chat";
import { QUICK_REACTIONS } from "@/lib/reactions";
import { cn } from "@/lib/utils";

/** How far a finger must travel right before a swipe means "answer this" (Đợt gộp 2 · A10). */
export const SWIPE_REPLY_PX = 56;

/**
 * Swipe right to reply, fingers only. A mostly vertical move is a scroll and cancels it; the
 * bubble follows the finger (at most a little past the threshold) and springs back on release.
 */
function useSwipeToReply(onReply: (() => void) | undefined) {
  const [offset, setOffset] = useState<number>(0);
  const startRef = useRef<{ x: number; y: number; decided: "swipe" | "scroll" | null; fired: boolean } | null>(null);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (onReply === undefined || event.pointerType !== "touch") return;
      startRef.current = { x: event.clientX, y: event.clientY, decided: null, fired: false };
    },
    [onReply],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const start = startRef.current;
      if (start === null || onReply === undefined) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        start.decided = Math.abs(dx) > Math.abs(dy) * 1.5 && dx > 0 ? "swipe" : "scroll";
      }
      if (start.decided !== "swipe") return;
      setOffset(Math.min(Math.max(0, dx), SWIPE_REPLY_PX + 16));
      if (!start.fired && dx >= SWIPE_REPLY_PX) {
        start.fired = true;
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
      }
    },
    [onReply],
  );

  const onPointerEnd = useCallback((): void => {
    const start = startRef.current;
    startRef.current = null;
    setOffset(0);
    if (start?.fired === true) onReply?.();
  }, [onReply]);

  return { offset, onPointerDown, onPointerMove, onPointerEnd };
}

/** Long press on a bubble is for fingers: a mouse already has hover and the visible "…". */
const TOUCH_ONLY: readonly string[] = ["touch"];

/** Everything that can be done to a single message. */
export type MessageAction =
  | "reply"
  | "later"
  | "task"
  | "edit"
  | "recall"
  | "request-recall"
  | "forward"
  | "select"
  | "pin"
  | "unpin"
  | "report";

/**
 * Everything you can do to one message, in one place.
 *
 * Creating a task used to be its own icon on every bubble, which worked while it was the only
 * action. Adding reply, edit and recall beside it would have put four icons on every line of a
 * conversation — so they collapse into a single "…" that stays quiet until wanted.
 *
 * Three groups (Đợt gộp 2 · A1), what people reach for most first:
 * 1. Làm với tin này — Trả lời · Chuyển tiếp · Tạo nhiệm vụ
 * 2. Sắp xếp — Chọn nhiều tin · Ghim / Bỏ ghim · Sửa
 * 3. Rút lại / báo — Thu hồi or Đề nghị thu hồi · Báo cáo tin nhắn
 * A group with nothing in it takes its separator with it.
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
  canRequestRecall = false,
  hasRequestedRecall = false,
  canForward = false,
  canReport = false,
  canReadLater = false,
  onAction,
  onQuickReact,
  open,
  onOpenChange,
  className,
}: {
  message: ChatMessage;
  viewerId: string | undefined;
  /** False in a journal, where there is nobody to give a task to. */
  canRaiseTask: boolean;
  /** False for a withdrawn or still-sending message: there is nothing to carry yet. */
  canForward?: boolean;
  /** False for a withdrawn message: there are no words left to point at. */
  canPin?: boolean;
  /** True when this message is already pinned for an audience the viewer can clear. */
  isPinned?: boolean;
  /** True on someone else's message in a shared thread — never on your own, never in a journal. */
  canRequestRecall?: boolean;
  /** True once this person has asked, so the menu reports it instead of inviting a second ask. */
  hasRequestedRecall?: boolean;
  /** True on someone else's message in a 1-1 or group (AVORA-37 / B). Never on your own. */
  canReport?: boolean;
  /** AVORA-47 · A: someone else's line in a shared thread can be set aside as `Xem sau`. */
  canReadLater?: boolean;
  onAction: (action: MessageAction) => void;
  /** AVORA-49 · 2.4: six quick reactions on top of the menu — the one way in on a phone. */
  onQuickReact?: (emoji: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const showReply = canReplyToMessage(message);
  const showEdit = canEditMessage(message, viewerId);
  const showRecall = canRecallMessage(message, viewerId);
  const showTask = canRaiseTask && message.pending !== true && message.deletedAt == null;
  const showPin = canPin && message.pending !== true && message.deletedAt == null;
  // Asking has no time limit of its own: a message that still says something can still be
  // objected to, long after its author's own 24-hour window to take it back has closed.
  const showRequestRecall =
    canRequestRecall && message.pending !== true && message.deletedAt == null;
  const showForward = canForward && message.pending !== true && message.deletedAt == null;
  const showReport =
    canReport && message.pending !== true && viewerId !== undefined && message.senderId !== viewerId;

  const showLater =
    canReadLater && message.pending !== true && viewerId !== undefined && message.senderId !== viewerId && message.systemKind == null;
  const hasAct = showReply || showForward || showTask;
  const hasArrange = showForward || showPin || showEdit || showLater;
  const hasWithdraw = showRecall || showRequestRecall || showReport;

  const canQuickReact = onQuickReact !== undefined && message.pending !== true && message.deletedAt == null;
  if (!hasAct && !hasArrange && !hasWithdraw && !canQuickReact) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Tuỳ chọn tin nhắn: ${message.content.slice(0, 60)}`}
          title="Tuỳ chọn"
          className={cn(
            "press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={canQuickReact ? "w-[272px]" : "w-48"}>
        {canQuickReact ? (
          <>
            <div role="group" aria-label="Thả cảm xúc" className="flex items-center justify-between px-1 py-1">
              {QUICK_REACTIONS.slice(0, 6).map((entry) => (
                <DropdownMenuItem
                  key={entry.emoji}
                  aria-label={entry.label}
                  onSelect={() => onQuickReact?.(entry.emoji)}
                  className="flex h-11 w-11 items-center justify-center rounded-full p-0 text-[22px] leading-none focus:bg-accent"
                >
                  {entry.emoji}
                </DropdownMenuItem>
              ))}
            </div>
            {hasAct || hasArrange || hasWithdraw ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {showReply ? (
          <DropdownMenuItem onSelect={() => onAction("reply")}>
            <Reply className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Trả lời
          </DropdownMenuItem>
        ) : null}
        {showForward ? (
          <DropdownMenuItem onSelect={() => onAction("forward")}>
            <Forward className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Chuyển tiếp
          </DropdownMenuItem>
        ) : null}
        {showTask ? (
          <DropdownMenuItem onSelect={() => onAction("task")}>
            <ListPlus className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Tạo nhiệm vụ
          </DropdownMenuItem>
        ) : null}
        {hasAct && (hasArrange || hasWithdraw) ? <DropdownMenuSeparator /> : null}
        {/* Right under the three "do" actions: only the reader's own read mark moves back. */}
        {showLater ? (
          <DropdownMenuItem onSelect={() => onAction("later")}>
            <Clock3 className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Xem sau
          </DropdownMenuItem>
        ) : null}
        {/* Selecting starts from the message the menu was opened on, so the first tick is made. */}
        {showForward ? (
          <DropdownMenuItem onSelect={() => onAction("select")}>
            <CheckSquare className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Chọn nhiều tin
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
        {hasArrange && hasWithdraw ? <DropdownMenuSeparator /> : null}
        {showRecall ? (
          <DropdownMenuItem onSelect={() => onAction("recall")} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Thu hồi
          </DropdownMenuItem>
        ) : null}
        {/*
          Asking, not doing. The words belong to whoever wrote them, so this sends a note and
          stops — the sender decides. Shown as already-asked rather than hidden, so pressing it
          twice reports the truth instead of looking like it failed.
        */}
        {showRequestRecall ? (
          <DropdownMenuItem
            onSelect={() => onAction("request-recall")}
            disabled={hasRequestedRecall}
          >
            <Hand className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            {hasRequestedRecall ? "Đã đề nghị thu hồi" : "Đề nghị thu hồi"}
          </DropdownMenuItem>
        ) : null}
        {showReport ? (
          <DropdownMenuItem onSelect={() => onAction("report")}>
            <Flag className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Báo cáo tin nhắn
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
 *
 * `disabled` (while picking several messages): no "…", no reactions, no long press — the row
 * only ticks. Picking does one thing (Đợt gộp 2 · A2).
 */
export function MessageActionsAffordance({
  message,
  viewerId,
  canRaiseTask,
  canPin = false,
  isPinned = false,
  canRequestRecall = false,
  hasRequestedRecall = false,
  canForward = false,
  canReport = false,
  canReadLater = false,
  outgoing,
  onAction,
  onQuickReact,
  reactionPicker,
  disabled = false,
  onSwipeReply,
  children,
}: {
  disabled?: boolean;
  /** Phone: swiping the bubble right past ~56px makes it the message being answered (A10). */
  onSwipeReply?: () => void;
  message: ChatMessage;
  viewerId: string | undefined;
  canRaiseTask: boolean;
  canPin?: boolean;
  isPinned?: boolean;
  canRequestRecall?: boolean;
  hasRequestedRecall?: boolean;
  canForward?: boolean;
  canReport?: boolean;
  canReadLater?: boolean;
  outgoing: boolean;
  onAction: (action: MessageAction) => void;
  onQuickReact?: (emoji: string) => void;
  /**
   * Sits beside the menu rather than inside it. A reaction is a one-tap gesture, and burying
   * it two taps deep in a list would make it slower than typing "ok".
   */
  reactionPicker?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isPressing, setIsPressing] = useState<boolean>(false);
  const { onClick: _ignoredTap, ...handlers } = useLongPress({
    onHold: () => setIsOpen(true),
    pointerTypes: TOUCH_ONLY,
    onPressChange: setIsPressing,
    contextMenu: "after-hold",
    isEnabled: () => !disabled,
  });
  void _ignoredTap;
  const swipe = useSwipeToReply(disabled ? undefined : onSwipeReply);

  if (disabled) {
    return (
      <div className={cn("flex w-full items-center gap-1.5", outgoing ? "flex-row-reverse" : "flex-row")}>
        <div className="max-w-[80%]">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full items-center gap-1.5", outgoing ? "flex-row-reverse" : "flex-row")}>
      <div
        {...handlers}
        onPointerDown={(event) => {
          handlers.onPointerDown(event);
          swipe.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          handlers.onPointerMove(event);
          swipe.onPointerMove(event);
        }}
        onPointerUp={() => {
          handlers.onPointerUp();
          swipe.onPointerEnd();
        }}
        onPointerCancel={() => {
          handlers.onPointerCancel();
          swipe.onPointerEnd();
        }}
        style={swipe.offset > 0 ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        className={cn(
          "max-w-[80%] transition-opacity",
          swipe.offset === 0 && "transition-transform",
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
        canRequestRecall={canRequestRecall}
        hasRequestedRecall={hasRequestedRecall}
        canForward={canForward}
        canReport={canReport}
        canReadLater={canReadLater}
        onAction={onAction}
        onQuickReact={onQuickReact}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </div>
  );
}
