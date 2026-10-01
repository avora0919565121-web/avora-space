import { ChevronDown, Plus, type LucideIcon } from "lucide-react";
import { useState } from "react";

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

/**
 * The one `+` of every hub — Nhiệm vụ, Kế hoạch, Két sắt (AVORA-59 · D / AVORA-60 · D).
 *
 * Tap: the thing done most often there. Hold (phone) or the small arrow beside it (computer):
 * a short menu anchored to the button — under it, right edges aligned, flipped above when there
 * is no room (Lớp nổi: anchor → flip → centre). Holding never selects text and never opens the
 * phone's own Copy · Look Up · Translate (`no-callout` + contextmenu blocked). The first time,
 * a one-line hint explains the hold; it goes once dismissed or once the menu has been used.
 */
export function PlusMenuButton({
  label,
  tapLabel,
  onTap,
  entries,
  hintKey,
}: {
  /** Accessible name: "Thêm nhiệm vụ", "Thêm Hạng mục"… */
  label: string;
  /** Spoken after the name: "giữ để chọn loại". */
  tapLabel?: string;
  onTap: () => void;
  entries: readonly PlusMenuEntry[];
  hintKey?: GuidanceKey;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const { shouldShow, dismiss } = useGuidance();
  const hasMenu = entries.length > 0;
  const showHint = hasMenu && hintKey !== undefined && shouldShow(hintKey);

  const openMenu = (): void => {
    setIsMenuOpen(true);
    if (showHint && hintKey !== undefined) dismiss(hintKey);
  };

  const { onClick, ...hold } = useLongPress({
    onTap,
    onHold: openMenu,
    isEnabled: () => hasMenu,
    pointerTypes: ["touch", "pen"],
    contextMenu: "always",
  });

  const name = hasMenu && tapLabel !== undefined ? `${label} (${tapLabel})` : label;

  return (
    <div className="no-callout relative" onContextMenu={(event) => event.preventDefault()}>
      <DropdownMenu open={isMenuOpen} onOpenChange={(next) => (next ? openMenu() : setIsMenuOpen(false))} modal={false}>
        <div className="flex items-center">
          {/* The trigger is the + itself, so the menu anchors to it; it never opens on a tap. */}
          <DropdownMenuTrigger asChild disabled={!hasMenu}>
            <button
              type="button"
              {...hold}
              onPointerDown={(event) => {
                // Radix opens the menu on pointerdown; the + must stay a plain tap.
                event.preventDefault();
                hold.onPointerDown(event);
              }}
              onKeyDown={(event) => {
                // Enter / Space is the tap; ArrowDown opens the menu like the arrow does.
                if (event.key === "ArrowDown" && hasMenu) {
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
              title={name}
              data-plus-button=""
              className="icon-btn icon-btn-primary no-callout h-11 w-11"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          {hasMenu ? (
            <button
              type="button"
              aria-label="Chọn loại mới"
              onClick={openMenu}
              className="icon-btn no-callout ml-1 hidden h-11 w-8 text-muted-foreground hover:text-foreground md:inline-flex short:hidden"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </div>
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
