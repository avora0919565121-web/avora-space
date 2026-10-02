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
import { messageActionGroup, orderMessageActions, type MessageMenuAction, type MessageMenuGroup } from "@/lib/menu-order";
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
  | "details"
  | "delete";

type MenuEntry = {
  action: MessageAction;
  label: string;
  icon: LucideIcon;
  group: MessageMenuGroup;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * Everything you can do to one message, in one place.
 *
 * Five groups, one order everywhere (AVORA-71 · B, `MESSAGE_MENU_ORDER`):
 * ① Trả lời · Chuyển tiếp · Sao chép ② Tạo nhiệm vụ · Lưu vào Nhật ký · Lưu ảnh · Xem sau
 * ③ Ghim / Bỏ ghim · Chọn nhiều tin ④ Sửa · Chi tiết ⑤ Thu hồi / Đề nghị thu hồi · Xoá · Báo cáo (red, last)
 *
 * On a phone the same entries show as a 4-column icon grid — first row Trả lời · Chuyển tiếp · Sao chép · Tạo nhiệm vụ; a computer keeps the
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
  canDelete = false,
  onAction,
  onQuickReact,
  open,
  onOpenChange,
  className,
}: {
  message: ChatMessage;
  viewerId: string | undefined;
  /** True wherever a task can be raised — a journal included (it becomes the writer's own task). */
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
  /** AVORA-70 · C / 71 · B: only in Nhật ký của tôi — a soft delete into its Thùng rác. */
  canDelete?: boolean;
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

  // AVORA-71 · B: which actions apply is decided here; their ORDER comes from one constant.
  const meta: Record<MessageMenuAction, { label: string; icon: LucideIcon; danger?: boolean; disabled?: boolean } | null> = {
    reply: showReply ? { label: "Trả lời", icon: Reply } : null,
    forward: showForward ? { label: "Chuyển tiếp", icon: Forward } : null,
    copy: showCopy ? { label: "Sao chép", icon: Copy } : null,
    task: showTask ? { label: "Tạo nhiệm vụ", icon: ListPlus } : null,
    "save-journal": showSaveJournal ? { label: "Lưu vào Nhật ký", icon: NotebookPen } : null,
    "save-image": showSaveImage ? { label: "Lưu ảnh", icon: ImageDown } : null,
    later: showLater ? { label: "Xem sau", icon: Clock3 } : null,
    pin: showPin && !isPinned ? { label: "Ghim", icon: Pin } : null,
    unpin: showPin && isPinned ? { label: "Bỏ ghim", icon: PinOff } : null,
    // Selecting starts from the message the menu was opened on, so the first tick is made.
    select: showForward ? { label: "Chọn nhiều tin", icon: CheckSquare } : null,
    edit: showEdit ? { label: "Sửa", icon: Pencil } : null,
    details: showDetails ? { label: "Chi tiết", icon: Info } : null,
    recall: showRecall ? { label: "Thu hồi", icon: Trash2, danger: true } : null,
    // Asking, not doing: the sender decides. Shown as already-asked rather than hidden.
    "request-recall": showRequestRecall
      ? { label: hasRequestedRecall ? "Đã đề nghị thu hồi" : "Đề nghị thu hồi", icon: Hand, danger: true, disabled: hasRequestedRecall }
      : null,
    delete: canDelete && message.pending !== true ? { label: "Xoá", icon: Trash2, danger: true } : null,
    report: showReport ? { label: "Báo cáo tin nhắn", icon: Flag, danger: true } : null,
  };
  const shown = new Set((Object.keys(meta) as MessageMenuAction[]).filter((action) => meta[action] !== null));
  const entries: MenuEntry[] = orderMessageActions(shown).map((action) => {
    const entry = meta[action] as NonNullable<(typeof meta)[MessageMenuAction]>;
    return { action, label: entry.label, icon: entry.icon, group: messageActionGroup(action), danger: entry.danger, disabled: entry.disabled };
  });

  const canQuickReact = onQuickReact !== undefined && live;
  if (entries.length === 0 && !canQuickReact) return null;

  const groups = (["answer", "keep", "arrange", "own", "restrict"] as const)
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
  canDelete = false,
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
  canDelete?: boolean;
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
        canDelete={canDelete}
        onAction={onAction}
        onQuickReact={onQuickReact}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </div>
  );
}
