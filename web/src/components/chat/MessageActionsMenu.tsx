import {
  CheckSquare,
  Clock3,
  Copy,
  Flag,
  Forward,
  Hand,
  ImageDown,
  Info,
  ListPlus,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  type LucideIcon,
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
import { useIsMobile } from "@/hooks/use-mobile";
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
  | "report"
  | "copy"
  | "save-image"
  | "save-journal"
  | "details";

type MenuEntry = {
  action: MessageAction;
  label: string;
  icon: LucideIcon;
  group: "act" | "arrange" | "withdraw";
  danger?: boolean;
  disabled?: boolean;
};

/**
 * Everything you can do to one message, in one place.
 *
 * Three groups (Đợt gộp 2 · A1), what people reach for most first:
 * 1. Làm với tin này — Trả lời · Chuyển tiếp · Sao chép · Lưu ảnh · Lưu vào Nhật ký · Tạo nhiệm vụ
 * 2. Sắp xếp — Xem sau · Chọn nhiều tin · Ghim / Bỏ ghim · Sửa · Chi tiết
 * 3. Rút lại / báo — Thu hồi or Đề nghị thu hồi · Báo cáo tin nhắn (always last, warning colour)
 *
 * AVORA-57 · C: on a phone the same entries show as a 4-column icon grid; a computer keeps the
 * list. Edit and recall are absent past their window rather than shown and refused. There is
 * no "Đã xem" anywhere (ADR-028).
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
  canCopy = false,
  canSaveImage = false,
  canSaveToJournal = false,
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
  /** AVORA-57 · C: a message with words (never in the Avora AI window). */
  canCopy?: boolean;
  /** AVORA-57 · C: only when an image on it may be downloaded (`export`). */
  canSaveImage?: boolean;
  /** AVORA-57 · C: words / images / files into the viewer's own Nhật ký, by file permission. */
  canSaveToJournal?: boolean;
  onAction: (action: MessageAction) => void;
  /** AVORA-49 · 2.4: six quick reactions on top of the menu — the one way in on a phone. */
  onQuickReact?: (emoji: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const isPhone = useIsMobile();
  const live = message.pending !== true && message.deletedAt == null;
  const showReply = canReplyToMessage(message);
  const showEdit = canEditMessage(message, viewerId);
  const showRecall = canRecallMessage(message, viewerId);
  const showTask = canRaiseTask && live;
  const showPin = canPin && live;
  // Asking has no time limit of its own: a message that still says something can still be
  // objected to, long after its author's own 24-hour window to take it back has closed.
  const showRequestRecall = canRequestRecall && live;
  const showForward = canForward && live;
  const showReport =
    canReport && message.pending !== true && viewerId !== undefined && message.senderId !== viewerId;
  const showLater =
    canReadLater && message.pending !== true && viewerId !== undefined && message.senderId !== viewerId && message.systemKind == null;
  const showCopy = canCopy && live && message.content.trim() !== "";
  const showSaveImage = canSaveImage && live;
  const showSaveJournal = canSaveToJournal && live;
  const showDetails = message.pending !== true;

  const entries: MenuEntry[] = [];
  if (showReply) entries.push({ action: "reply", label: "Trả lời", icon: Reply, group: "act" });
  if (showForward) entries.push({ action: "forward", label: "Chuyển tiếp", icon: Forward, group: "act" });
  if (showCopy) entries.push({ action: "copy", label: "Sao chép", icon: Copy, group: "act" });
  if (showSaveImage) entries.push({ action: "save-image", label: "Lưu ảnh", icon: ImageDown, group: "act" });
  if (showSaveJournal) entries.push({ action: "save-journal", label: "Lưu vào Nhật ký", icon: NotebookPen, group: "act" });
  if (showTask) entries.push({ action: "task", label: "Tạo nhiệm vụ", icon: ListPlus, group: "act" });
  // Right under the "do" actions: only the reader's own read mark moves back.
  if (showLater) entries.push({ action: "later", label: "Xem sau", icon: Clock3, group: "arrange" });
  // Selecting starts from the message the menu was opened on, so the first tick is made.
  if (showForward) entries.push({ action: "select", label: "Chọn nhiều tin", icon: CheckSquare, group: "arrange" });
  if (showPin)
    entries.push({ action: isPinned ? "unpin" : "pin", label: isPinned ? "Bỏ ghim" : "Ghim", icon: isPinned ? PinOff : Pin, group: "arrange" });
  if (showEdit) entries.push({ action: "edit", label: "Sửa", icon: Pencil, group: "arrange" });
  if (showDetails) entries.push({ action: "details", label: "Chi tiết", icon: Info, group: "arrange" });
  if (showRecall) entries.push({ action: "recall", label: "Thu hồi", icon: Trash2, group: "withdraw", danger: true });
  // Asking, not doing: the sender decides. Shown as already-asked rather than hidden.
  if (showRequestRecall)
    entries.push({
      action: "request-recall",
      label: hasRequestedRecall ? "Đã đề nghị thu hồi" : "Đề nghị thu hồi",
      icon: Hand,
      group: "withdraw",
      danger: true,
      disabled: hasRequestedRecall,
    });
  if (showReport) entries.push({ action: "report", label: "Báo cáo tin nhắn", icon: Flag, group: "withdraw", danger: true });

  const canQuickReact = onQuickReact !== undefined && live;
  if (entries.length === 0 && !canQuickReact) return null;

  const groups = (["act", "arrange", "withdraw"] as const)
    .map((group) => entries.filter((entry) => entry.group === group))
    .filter((list) => list.length > 0);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Tuỳ chọn tin nhắn: ${message.content.slice(0, 60)}`}
          title="Tuỳ chọn"
          className={cn(
            "icon-btn h-9 w-9 text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className={isPhone ? "w-[min(340px,calc(100vw-16px))] p-2" : canQuickReact ? "w-[272px]" : "w-52"}
      >
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
            {entries.length > 0 ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {isPhone ? (
          <div className="grid grid-cols-4 gap-1" data-testid="message-menu-grid">
            {entries.map((entry) => (
              <DropdownMenuItem
                key={entry.action}
                disabled={entry.disabled}
                onSelect={() => onAction(entry.action)}
                className={cn(
                  "flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center text-[11.5px] leading-tight",
                  entry.danger ? "text-destructive focus:text-destructive" : "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    entry.danger ? "bg-destructive/10" : "bg-secondary",
                  )}
                >
                  <entry.icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="line-clamp-2">{entry.label}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ) : (
          groups.map((list, index) => (
            <div key={list[0].group}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {list.map((entry) => (
                <DropdownMenuItem
                  key={entry.action}
                  disabled={entry.disabled}
                  onSelect={() => onAction(entry.action)}
                  className={entry.danger ? "text-destructive focus:text-destructive" : undefined}
                >
                  <entry.icon className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
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
  canCopy = false,
  canSaveImage = false,
  canSaveToJournal = false,
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
  canCopy?: boolean;
  canSaveImage?: boolean;
  canSaveToJournal?: boolean;
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
          // AVORA-59 · D: holding a bubble opens our menu, never the phone's text callout.
          "no-callout max-w-[80%] transition-opacity",
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
        canCopy={canCopy}
        canSaveImage={canSaveImage}
        canSaveToJournal={canSaveToJournal}
        onAction={onAction}
        onQuickReact={onQuickReact}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </div>
  );
}
