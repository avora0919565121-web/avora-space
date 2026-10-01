import { Plus, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { GUIDANCE_TEXT, type GuidanceKey } from "@/lib/guidance";
import { useGuidance } from "@/lib/use-task-flags";

export type PlusMenuEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

/** The hover caption of a `+` with a menu (AVORA-61 · A). */
export function plusCaption(tapAction: string): string {
  return `Bấm: ${tapAction} · Giữ: thêm lựa chọn`;
}

/**
 * The one `+` of every hub — Kết nối, Nhiệm vụ, Kế hoạch, Két sắt (AVORA-61 · A).
 *
 * One way of working everywhere, phone and computer alike: a tap / click does the thing done
 * most often there; holding (finger, pen, or a mouse held ~0.5 s) or a right-click opens a
 * short menu anchored under the button, right edges aligned, flipped above when there is no
 * room. There is no separate ▾ any more — it made Kế hoạch work differently from the rest.
 * Holding never selects text and never opens the phone's Copy · Look Up · Translate. With a
 * mouse, hovering shows `Bấm: … · Giữ: thêm lựa chọn`.
 */
export function PlusMenuButton({
  label,
  tapLabel,
  tapAction,
  onTap,
  entries,
  hintKey,
}: {
  /** Accessible name: "Thêm nhiệm vụ", "Thêm Hạng mục"… */
  label: string;
  /** Spoken after the name: "giữ để chọn loại". */
  tapLabel?: string;
  /** What a click does, for the hover caption: "nhiệm vụ cho tôi". Defaults to the label. */
  tapAction?: string;
  onTap: () => void;
  entries: readonly PlusMenuEntry[];
  hintKey?: GuidanceKey;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isCaptionShown, setIsCaptionShown] = useState<boolean>(false);
  const captionTimer = useRef<number | null>(null);
  const clearCaption = (): void => {
    if (captionTimer.current !== null) window.clearTimeout(captionTimer.current);
    captionTimer.current = null;
    setIsCaptionShown(false);
  };
  useEffect(() => () => {
    if (captionTimer.current !== null) window.clearTimeout(captionTimer.current);
  }, []);
  const { shouldShow, dismiss } = useGuidance();
  const hasMenu = entries.length > 0;
  const showHint = hasMenu && hintKey !== undefined && shouldShow(hintKey);

  const openMenu = (): void => {
    setIsMenuOpen(true);
    if (showHint && hintKey !== undefined) dismiss(hintKey);
  };

  const { onClick, onContextMenu: _ignored, ...hold } = useLongPress({
    onTap,
    onHold: openMenu,
    isEnabled: () => hasMenu,
    contextMenu: "always",
  });

  const name = hasMenu && tapLabel !== undefined ? `${label} (${tapLabel})` : label;
  const caption = hasMenu ? plusCaption(tapAction ?? label.toLowerCase()) : label;

  return (
    <div
      className="no-callout relative"
      onPointerEnter={(event) => {
        // Mouse only, after a short rest: a caption, never on touch.
        if (event.pointerType !== "mouse" || !hasMenu) return;
        clearCaption();
        captionTimer.current = window.setTimeout(() => setIsCaptionShown(true), 500);
      }}
      onPointerLeave={clearCaption}
      onPointerDown={clearCaption}
      onContextMenu={(event) => {
        // A right-click (or the phone's own long-press menu) opens ours instead.
        event.preventDefault();
        if (hasMenu) openMenu();
      }}
    >
      <DropdownMenu open={isMenuOpen} onOpenChange={(next) => (next ? openMenu() : setIsMenuOpen(false))} modal={false}>
        {/* The trigger is the + itself, so the menu anchors to it; it never opens on a tap. */}
        <DropdownMenuTrigger asChild disabled={!hasMenu}>
          <button
            type="button"
            {...hold}
            onPointerDown={(event) => {
              // Radix opens the menu on pointerdown; the + must stay a plain click.
              event.preventDefault();
              hold.onPointerDown(event);
            }}
            onKeyDown={(event) => {
              // Enter / Space is the click; ArrowDown (or the menu key) opens the menu.
              if ((event.key === "ArrowDown" || event.key === "ContextMenu") && hasMenu) {
                event.preventDefault();
                openMenu();
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onTap();
              }
            }}
            onClick={(event) => {
              event.preventDefault();
              onClick(event);
            }}
            aria-label={name}
            data-plus-button=""
            className="icon-btn icon-btn-primary no-callout h-11 w-11"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        {hasMenu ? (
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
            avoidCollisions
            data-plus-menu=""
            className="no-callout w-56"
          >
            {entries.map((entry) => {
              const Icon = entry.icon;
              return (
                <DropdownMenuItem key={entry.id} disabled={entry.disabled} onSelect={entry.onSelect} className="min-h-11 gap-2.5 text-[14px]">
                  <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> {entry.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
      {/* Mouse only: a small caption after a short rest; never on touch, never over the open menu. */}
      {isCaptionShown && !isMenuOpen && !showHint ? (
        <span
          role="tooltip"
          data-plus-caption=""
          className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 w-max max-w-[260px] rounded-md bg-foreground px-2 py-1 text-[11.5px] font-medium text-background shadow-md animate-in fade-in-0"
        >
          {caption}
        </span>
      ) : null}
      {showHint && hintKey !== undefined ? (
        <div
          role="note"
          className="absolute right-0 top-full z-20 mt-2 flex w-max max-w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] text-foreground shadow-md"
        >
          <span>{GUIDANCE_TEXT[hintKey]}</span>
          <button type="button" onClick={() => dismiss(hintKey)} className="press shrink-0 rounded px-1.5 text-[12px] font-semibold text-primary">
            Đã hiểu
          </button>
        </div>
      ) : null}
    </div>
  );
}
