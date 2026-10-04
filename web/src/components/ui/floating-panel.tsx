import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { BackClosesBinding } from "@/lib/use-back-closes";

/** Lớp nổi keeps at least this far from every screen edge (44b · H2.4). */
export const FLOATING_EDGE_PX = 16;

export type FloatingPlacement = "below" | "above" | "center";

/**
 * Where a floating panel opens on a computer (44b · H2): under the field; above it when the
 * whole panel does not fit below; centred on the screen when it fits neither way.
 */
export function chooseFloatingPlacement(input: {
  anchorTop: number;
  anchorBottom: number;
  viewportHeight: number;
  panelHeight: number;
  gap?: number;
}): FloatingPlacement {
  const gap = input.gap ?? 4;
  const below = input.viewportHeight - input.anchorBottom - gap - FLOATING_EDGE_PX;
  const above = input.anchorTop - gap - FLOATING_EDGE_PX;
  if (below >= input.panelHeight) return "below";
  if (above >= input.panelHeight) return "above";
  return "center";
}

/**
 * The one shell for everything that pops over a screen — calendar, time, people, lists
 * (44b · Lớp nổi). One set of rules instead of each field inventing its own:
 *
 * - Computer: anchored under the field, flipped above when short of room, centred with a dim
 *   backdrop when neither side fits; never closer than 16px to an edge; scrolls inside rather than
 *   running off the screen; portalled, so a dialog it was opened from never clips it.
 * - Phone: a sheet from the top (under the notch, at most 85% tall) or from the bottom (above
 *   the home bar), full width with 8px margins; the header with its close button stays in view.
 *
 * `height` is the panel's full natural height, used to decide between below / above / centre.
 */
export function FloatingPanel({
  open,
  onOpenChange,
  anchor,
  label,
  width,
  height,
  phone = "top",
  className,
  onOpenAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The field that opens the panel. */
  anchor: ReactNode;
  /** Announced as the panel's name. */
  label: string;
  width: number;
  height: number;
  phone?: "top" | "bottom";
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [placement, setPlacement] = useState<FloatingPlacement>("below");

  useLayoutEffect(() => {
    if (!open || !isDesktop) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlacement(
      chooseFloatingPlacement({ anchorTop: rect.top, anchorBottom: rect.bottom, viewportHeight: window.innerHeight, panelHeight: height }),
    );
  }, [open, isDesktop, height]);

  const panelClass = cn("flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg outline-none", className);
  const anchorNode = (
    <span ref={anchorRef} className="flex min-w-0 flex-1">
      {anchor}
    </span>
  );

  if (isDesktop && placement !== "center") {
    return (
      <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {open ? <BackClosesBinding close={() => onOpenChange(false)} /> : null}
        <PopoverPrimitive.Anchor asChild>{anchorNode}</PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            aria-label={label}
            side={placement === "above" ? "top" : "bottom"}
            align="start"
            sideOffset={4}
            collisionPadding={FLOATING_EDGE_PX}
            onOpenAutoFocus={onOpenAutoFocus}
            style={{
              width: `min(${width}px, calc(100vw - ${FLOATING_EDGE_PX * 2}px))`,
              height: `min(${height}px, var(--radix-popover-content-available-height, ${height}px))`,
            }}
            className={cn(panelClass, "z-50 max-h-[var(--radix-popover-content-available-height)] data-[state=open]:animate-in data-[state=open]:fade-in-0")}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }

  return (
    <>
      {anchorNode}
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {open ? <BackClosesBinding close={() => onOpenChange(false)} /> : null}
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={onOpenAutoFocus}
            // AVORA-65 · F: an explicit height, never `h-fit` — the body inside grows to fill the
            // panel (flex-1 min-h-0), and a fit-content parent gave it zero, cutting the calendar
            // down to its title. Short of room it scrolls inside instead.
            style={
              isDesktop
                ? { width: `min(${width}px, calc(100vw - ${FLOATING_EDGE_PX * 2}px))`, height: `min(${height}px, calc(100dvh - ${FLOATING_EDGE_PX * 2}px))` }
                : undefined
            }
            className={cn(
              panelClass,
              "fixed z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0",
              isDesktop
                ? "inset-0 m-auto max-h-[calc(100dvh-32px)]"
                : phone === "top"
                  ? "inset-x-2 top-[calc(env(safe-area-inset-top)+8px)] mx-auto max-h-[85dvh] max-w-[480px]"
                  : "inset-x-0 bottom-0 max-h-[85dvh] rounded-b-none pb-[env(safe-area-inset-bottom)]",
            )}
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
