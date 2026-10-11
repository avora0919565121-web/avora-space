import { useState, type MouseEvent, type ReactNode } from "react";

import { KeepsakeSheet } from "@/components/KeepsakeSheet";
import { AvoraSticker } from "@/components/chat/AvoraSticker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { useKeepsake } from "@/lib/use-keepsake";
import { cn } from "@/lib/utils";

/**
 * AVORA-100 · S.2 §4.3 — the greeting of Avora Space, with the person's own keepsake.
 *
 * Sticker: beside the greeting, 72 px, one small bob each time Avora Space opens (never with reduced
 * motion). Photo: a low strip at the top (≤ 22 % of a phone screen) under a dim, softly blurred layer
 * so the greeting reads at AA in either theme. Hold the greeting (right-click on a computer) →
 * `Đặt dấu ấn của tôi`; change or remove it there too. Only here, only for its owner.
 */
export function KeepsakeGreeting({ children }: { children: ReactNode }) {
  const api = useKeepsake();
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);
  const press = useLongPress({ onHold: () => setIsMenuOpen(true), contextMenu: "after-hold" });
  const keepsake = api.keepsake;

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsMenuOpen(true);
  };

  const pressProps = {
    onPointerDown: press.onPointerDown,
    onPointerMove: press.onPointerMove,
    onPointerUp: press.onPointerUp,
    onPointerCancel: press.onPointerCancel,
    onPointerLeave: press.onPointerLeave,
    onTouchStart: press.onTouchStart,
    onTouchEnd: press.onTouchEnd,
    onTouchCancel: press.onTouchCancel,
    onContextMenu,
  };

  const body =
    keepsake?.kind === "photo" ? (
      <div
        data-keepsake="photo"
        className="relative h-[min(22dvh,176px)] overflow-hidden rounded-card bg-secondary md:h-[200px]"
        style={api.photoUrl !== null ? { backgroundImage: `url("${api.photoUrl}")`, backgroundSize: "cover", backgroundPosition: `50% ${Math.round(keepsake.focusY * 100)}%` } : undefined}
      >
        {/* Dim + soft blur at the bottom where the words sit: white text stays ≥ 4.5 : 1 on any photo. */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/50 to-black/10" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/5 backdrop-blur-[2px] [mask-image:linear-gradient(to_top,#000_40%,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 p-4 [&_*]:!text-white [&_.text-task-idle]:!text-white/70">{children}</div>
      </div>
    ) : keepsake?.kind === "sticker" ? (
      <div data-keepsake="sticker" className="flex items-center gap-3">
        <AvoraSticker id={keepsake.stickerId} size={72} className="avora-keepsake-bob -my-2 shrink-0" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    ) : (
      children
    );

  return (
    <>
      <div {...pressProps} data-keepsake-hold="" className={cn("relative select-none [-webkit-touch-callout:none]", keepsake?.kind === "photo" && "-mx-1")}>
        {body}
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          {/* A point to hang the menu on; the hold / right-click above is what opens it. */}
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute left-4 top-full h-0 w-0" />
          </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-[232px] rounded-card p-1.5">
          <DropdownMenuItem className="min-h-12 rounded-lg px-3 text-[15px]" onSelect={() => setIsSheetOpen(true)} data-keepsake-open="">
            {keepsake === null ? "Đặt dấu ấn của tôi" : "Đổi dấu ấn của tôi"}
          </DropdownMenuItem>
          {keepsake !== null ? (
            <DropdownMenuItem className="min-h-12 rounded-lg px-3 text-[15px] text-muted-foreground" onSelect={() => void api.clear()}>
              Gỡ dấu ấn
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <KeepsakeSheet open={isSheetOpen} onOpenChange={setIsSheetOpen} api={api} />
    </>
  );
}
