import { Archive, ArchiveRestore, BellOff, BellRing, Clock3 } from "lucide-react";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl px-4 pb-6 pt-5">
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
              className="press h-12 rounded-xl border border-border bg-card text-[14.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
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
 * stays a scroll. Computer: right-click shows the same three. Nothing here touches the swipe-to-
 * reply inside a thread, and nothing opens a single message's menu.
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
  children: ReactNode;
}) {
  const [offset, setOffset] = useState<number>(0);
  const [tray, setTray] = useState<"left" | null>(null);
  const [isMuteOpen, setIsMuteOpen] = useState<boolean>(false);
  const startRef = useRef<{ x: number; y: number; decided: "swipe" | "scroll" | null; base: number } | null>(null);
  const swipedRef = useRef<boolean>(false);

  const closeTray = useCallback((): void => {
    setTray(null);
    setOffset(0);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== "touch") return;
    swipedRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY, decided: null, base: tray === "left" ? -TRAY_PX : 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative overflow-hidden rounded-lg">
            {/* Behind the row: what a left swipe uncovers. */}
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
              onClickCapture={(event) => {
                // A swipe or an open tray is not a tap on the row.
                if (swipedRef.current || tray !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  swipedRef.current = false;
                  if (tray !== null) closeTray();
                }
              }}
              style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
              className={cn("relative bg-background touch-pan-y", startRef.current === null && "transition-transform duration-200")}
            >
              {children}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="truncate text-[12px] font-normal text-muted-foreground">{title}</ContextMenuLabel>
          <ContextMenuItem disabled={!canReadLater} onSelect={onReadLater} className="min-h-10 gap-2">
            <Clock3 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Xem sau
          </ContextMenuItem>
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
        </ContextMenuContent>
      </ContextMenu>
      <ConversationMuteSheet open={isMuteOpen} onOpenChange={setIsMuteOpen} title={title} choices={muteChoices} onPick={onMute} />
    </>
  );
}
