import { Archive, ArchiveRestore, BellOff, BellRing, Check, CheckSquare, Clock3, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useLongPress } from "@/hooks/use-long-press";
import { EDGE_PX } from "@/components/nav/NavGestures";
import type { MuteDurationOption } from "@/lib/mute";
import { cn } from "@/lib/utils";

/** How far a finger must travel before a swipe on a conversation row opens its actions. */
export const ROW_SWIPE_PX = 64;
const TRAY_PX = 152;

/**
 * The four answers of a conversation mute, as one sheet (AVORA-47 · B). Shared by the row's
 * swipe-right and by `⋯` › Thông báo, so the choice reads the same everywhere.
 */
export function ConversationMuteSheet({
  open,
  onOpenChange,
  title,
  choices,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  choices: readonly MuteDurationOption[];
  onPick: (option: MuteDurationOption) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-card px-4 pb-6 pt-5">
        <SheetTitle className="text-[17px]">Tắt thông báo</SheetTitle>
        <SheetDescription className="mt-1 text-[13px]">
          {title} · luôn có hạn. Gia đình và tin Khẩn vẫn qua được.
        </SheetDescription>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {choices.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onPick(option);
                onOpenChange(false);
              }}
              className="press h-12 rounded-control border border-border bg-card text-[14.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              {option.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Swipe and right-click on one conversation row (AVORA-47 · G).
 *
 * Phone: left reveals `Xem sau` · `Lưu trữ`; right opens `Tắt thông báo`. A mostly vertical move
 * stays a scroll. Nothing here touches the swipe-to-reply inside a thread.
 *
 * AVORA-57 · D: holding the row (phone), right-click or `⋯` (computer) open one and the same menu:
 * `Xem sau` · `Ghim` / `Bỏ ghim` · `Tắt thông báo` · `Lưu trữ` · `Chọn nhiều`. No "Xoá hội thoại":
 * one pair is one conversation, and hiding it is what Lưu trữ is for. While picking several,
 * a tap ticks the row instead of opening it.
 */
export function ConversationRowActions({
  title,
  isArchived,
  mutedUntilLabel,
  canReadLater,
  muteChoices,
  onReadLater,
  onArchive,
  onUnarchive,
  onMute,
  onUnmute,
  isPinned = false,
  onTogglePin,
  onSelectMany,
  isSelecting = false,
  isSelected = false,
  onToggleSelected,
  children,
}: {
  title: string;
  isArchived: boolean;
  /** `Đã tắt tới 14:30`, or null when the conversation is not muted. */
  mutedUntilLabel: string | null;
  canReadLater: boolean;
  muteChoices: readonly MuteDurationOption[];
  onReadLater: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMute: (option: MuteDurationOption) => void;
  onUnmute: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  /** Starts picking several conversations, with this one ticked. */
  onSelectMany?: () => void;
  isSelecting?: boolean;
  isSelected?: boolean;
  onToggleSelected?: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState<number>(0);
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);
  const { onClick: _ignoredTap, ...hold } = useLongPress({
    onHold: () => {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
      setIsSheetOpen(true);
    },
    pointerTypes: ["touch"],
    contextMenu: "after-hold",
    isEnabled: () => !isSelecting && tray === null,
  });
  void _ignoredTap;
  const [tray, setTray] = useState<"left" | null>(null);
  const [isMuteOpen, setIsMuteOpen] = useState<boolean>(false);
  const startRef = useRef<{ x: number; y: number; decided: "swipe" | "scroll" | null; base: number } | null>(null);
  const swipedRef = useRef<boolean>(false);

  const closeTray = useCallback((): void => {
    setTray(null);
    setOffset(0);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    hold.onPointerDown(event);
    if (event.pointerType !== "touch" || isSelecting) return;
    swipedRef.current = false;
    // AVORA-94B · A5: the left 20 px belong to the back swipe, never to the row's own swipe.
    if (event.clientX <= EDGE_PX) {
      startRef.current = null;
      return;
    }
    startRef.current = { x: event.clientX, y: event.clientY, decided: null, base: tray === "left" ? -TRAY_PX : 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    hold.onPointerMove(event);
    const start = startRef.current;
    if (start === null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      start.decided = Math.abs(dx) > Math.abs(dy) * 1.5 ? "swipe" : "scroll";
    }
    if (start.decided !== "swipe") return;
    swipedRef.current = true;
    setOffset(Math.max(-TRAY_PX - 16, Math.min(ROW_SWIPE_PX + 16, start.base + dx)));
  };
  const onPointerEnd = (): void => {
    hold.onPointerUp();
    const start = startRef.current;
    startRef.current = null;
    if (start === null || start.decided !== "swipe") return;
    if (offset >= ROW_SWIPE_PX) {
      closeTray();
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
      if (mutedUntilLabel !== null) onUnmute();
      else setIsMuteOpen(true);
      return;
    }
    if (offset <= -ROW_SWIPE_PX) {
      setTray("left");
      setOffset(-TRAY_PX);
      return;
    }
    closeTray();
  };

  type RowEntry = { id: string; label: string; icon: typeof Clock3; run: () => void; disabled?: boolean };
  const rowMenuEntries: (RowEntry | "sep")[] = [
    { id: "later", label: "Xem sau", icon: Clock3, run: onReadLater, disabled: !canReadLater },
    ...(onTogglePin !== undefined
      ? [{ id: "pin", label: isPinned ? "Bỏ ghim" : "Ghim", icon: isPinned ? PinOff : Pin, run: onTogglePin }]
      : []),
    mutedUntilLabel !== null
      ? { id: "unmute", label: "Bật lại thông báo", icon: BellRing, run: onUnmute }
      : { id: "mute", label: "Tắt thông báo", icon: BellOff, run: () => setIsMuteOpen(true) },
    isArchived
      ? { id: "unarchive", label: "Bỏ lưu trữ", icon: ArchiveRestore, run: onUnarchive }
      : { id: "archive", label: "Lưu trữ", icon: Archive, run: onArchive },
    ...(onSelectMany !== undefined ? ["sep" as const, { id: "select", label: "Chọn nhiều", icon: CheckSquare, run: onSelectMany }] : []),
  ];

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative overflow-hidden rounded-lg">
            {/* Behind the row: what a left swipe uncovers. AVORA-94B · D3: drawn only while swiping / open,
                so an idle row never shows a coloured edge. */}
            {tray === "left" || offset < 0 ? (
            <div aria-hidden={tray !== "left"} className="absolute inset-y-0 right-0 flex w-[152px] items-stretch">
              <button
                type="button"
                tabIndex={tray === "left" ? 0 : -1}
                disabled={!canReadLater}
                onClick={() => {
                  closeTray();
                  onReadLater();
                }}
                className="flex flex-1 flex-col items-center justify-center gap-1 bg-secondary text-[11.5px] font-medium text-foreground disabled:opacity-40"
              >
                <Clock3 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Xem sau
              </button>
              <button
                type="button"
                tabIndex={tray === "left" ? 0 : -1}
                onClick={() => {
                  closeTray();
                  if (isArchived) onUnarchive();
                  else onArchive();
                }}
                className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary text-[11.5px] font-medium text-primary-foreground"
              >
                {isArchived ? (
                  <ArchiveRestore className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <Archive className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                )}
                {isArchived ? "Bỏ lưu trữ" : "Lưu trữ"}
              </button>
            </div>
            ) : null}
            {offset > 0 ? (
              <div aria-hidden="true" className="absolute inset-y-0 left-0 flex items-center gap-1.5 bg-secondary px-4 text-[12px] font-medium text-foreground" style={{ width: offset }}>
                {mutedUntilLabel !== null ? <BellRing className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
              </div>
            ) : null}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onContextMenu={hold.onContextMenu}
              onClickCapture={(event) => {
                if (isSelecting) {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleSelected?.();
                  return;
                }
                // A swipe or an open tray is not a tap on the row.
                if (swipedRef.current || tray !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  swipedRef.current = false;
                  if (tray !== null) closeTray();
                }
              }}
              style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
              className={cn(
                // Idle: no card of its own (the list's surface shows through). Moving: opaque, over the tray.
                "group/row no-callout relative flex items-center touch-pan-y",
                offset !== 0 || tray !== null ? "bg-card" : "bg-transparent",
                startRef.current === null && "transition-transform duration-200",
              )}
            >
              {isSelecting ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    isSelected ? "border-personal bg-personal text-personal-foreground" : "border-border bg-card",
                  )}
                >
                  {isSelected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">{children}</div>
              {isPinned && !isSelecting ? (
                <Pin className="pointer-events-none absolute right-2 top-2 h-3 w-3 rotate-45 text-muted-foreground" strokeWidth={2} aria-label="Đã ghim" />
              ) : null}
              {!isSelecting ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Tuỳ chọn cho ${title}`}
                      className="icon-btn absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover/row:opacity-100 md:inline-flex"
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="truncate text-[12px] font-normal text-muted-foreground">{title}</DropdownMenuLabel>
                    {rowMenuEntries.map((entry) =>
                      entry === "sep" ? (
                        <DropdownMenuSeparator key="sep" />
                      ) : (
                        <DropdownMenuItem key={entry.id} disabled={entry.disabled} onSelect={entry.run} className="min-h-10 gap-2">
                          <entry.icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                          {entry.label}
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="truncate text-[12px] font-normal text-muted-foreground">{title}</ContextMenuLabel>
          <ContextMenuItem disabled={!canReadLater} onSelect={onReadLater} className="min-h-10 gap-2">
            <Clock3 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Xem sau
          </ContextMenuItem>
          {onTogglePin !== undefined ? (
            <ContextMenuItem onSelect={onTogglePin} className="min-h-10 gap-2">
              {isPinned ? <PinOff className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> : <Pin className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
              {isPinned ? "Bỏ ghim" : "Ghim"}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={isArchived ? onUnarchive : onArchive} className="min-h-10 gap-2">
            {isArchived ? (
              <ArchiveRestore className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Archive className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            )}
            {isArchived ? "Bỏ lưu trữ" : "Lưu trữ"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {mutedUntilLabel !== null ? (
            <ContextMenuItem onSelect={onUnmute} className="min-h-10 gap-2">
              <BellRing className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">Bật lại thông báo</span>
                <span className="block text-[11.5px] text-muted-foreground">{mutedUntilLabel}</span>
              </span>
            </ContextMenuItem>
          ) : (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="min-h-10 gap-2">
                <BellOff className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Tắt thông báo
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-40">
                {muteChoices.map((option) => (
                  <ContextMenuItem key={option.id} onSelect={() => onMute(option)} className="min-h-10">
                    {option.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {onSelectMany !== undefined ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onSelectMany} className="min-h-10 gap-2">
                <CheckSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Chọn nhiều
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <ConversationMuteSheet open={isMuteOpen} onOpenChange={setIsMuteOpen} title={title} choices={muteChoices} onPick={onMute} />
      {/* Phone: the held row's menu, as a sheet of large rows. */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-card px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
          <SheetTitle className="truncate px-2 text-[16px]">{title}</SheetTitle>
          <SheetDescription className="sr-only">Tuỳ chọn cho cuộc trò chuyện này</SheetDescription>
          <div className="mt-2">
            {rowMenuEntries.map((entry) =>
              entry === "sep" ? (
                <div key="sep" className="my-1 h-px bg-border" />
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  disabled={entry.disabled}
                  onClick={() => {
                    setIsSheetOpen(false);
                    entry.run();
                  }}
                  className="press flex min-h-12 w-full items-center gap-3 rounded-card px-3 text-left text-[15px] text-foreground hover:bg-accent/40 disabled:opacity-40"
                >
                  <entry.icon className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  {entry.label}
                </button>
              ),
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
