import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronLeft, X } from "lucide-react";
import * as React from "react";

import { useEdgeSwipeBack } from "@/components/chat/StackedSheetHeader";
import { BackClosesBinding } from "@/lib/use-back-closes";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = ({ ref, className, ...props }: React.ComponentPropsWithRef<typeof SheetPrimitive.Overlay>) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 max-h-[85dvh] overflow-y-auto border-b pt-[max(env(safe-area-inset-top),1.5rem)] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t pb-[max(env(safe-area-inset-bottom),1.5rem)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[env(safe-area-inset-bottom)] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

/** Panels that draw their own `‹` (StackedSheetHeader) hide the default close with this class. */
const OWN_HEADER_MARK = "[&>button.absolute]:hidden";

function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

interface SheetContentProps
  extends React.ComponentPropsWithRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /** Phone header for a side panel: what `‹` says. Default `Quay lại`. */
  backLabel?: string;
}

const SheetContent = ({
  ref,
  side = "right",
  className,
  children,
  backLabel = "Quay lại",
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  ...props
}: SheetContentProps) => {
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const isSidePanel = side === "left" || side === "right";
  const hasOwnHeader = typeof className === "string" && className.includes(OWN_HEADER_MARK);
  const [isPhone] = React.useState<boolean>(isPhoneWidth);
  const close = React.useCallback((): void => closeRef.current?.click(), []);

  // Panels with their own header already spread their own edge swipe (it goes one level back).
  const edgeSwipe = useEdgeSwipeBack(isSidePanel && !hasOwnHeader ? close : undefined);

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(
          sheetVariants({ side }),
          className,
          // AVORA-59 · F: the `‹` bar below carries the notch inset itself. Callers often pass
          // `p-0`, which twMerge lets wipe the variant's safe-area padding — that left the bar
          // at y=0, under the status bar, on exactly the panels that needed it.
          isSidePanel && !hasOwnHeader && "pt-0 md:pt-[env(safe-area-inset-top)]",
        )}
        onPointerDown={(event) => {
          edgeSwipe.onPointerDown(event);
          onPointerDown?.(event);
        }}
        onPointerUp={(event) => {
          edgeSwipe.onPointerUp(event);
          onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          edgeSwipe.onPointerCancel();
          onPointerCancel?.(event);
        }}
        {...props}
      >
        {/*
          AVORA-57 · H — phone: a fixed bar with a ≥44px `‹` instead of the 16px X. It sits under
          the notch (the panel already pads by safe-area-inset-top) and never scrolls away.
        */}
        {isSidePanel && !hasOwnHeader ? (
          <div
            data-sheet-back-bar=""
            className="sticky top-0 z-20 -mb-px flex shrink-0 items-center border-b border-border bg-inherit px-2 pb-1.5 pt-[calc(env(safe-area-inset-top)+0.375rem)] md:hidden"
          >
            <button
              type="button"
              onClick={close}
              aria-label={backLabel}
              className="press no-callout flex min-h-11 min-w-11 items-center gap-1 rounded-md px-2 text-[15px] font-medium text-primary hover:bg-accent/40"
            >
              <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="truncate">{backLabel}</span>
            </button>
          </div>
        ) : null}
        {/* AVORA-94B · luật 5: every sheet (any side, any width) closes on Back first. Mounted only while open. */}
        <BackClosesBinding close={close} />
        {children}
        <SheetPrimitive.Close
          ref={closeRef}
          aria-label="Đóng"
          className={cn(
            "absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none",
            isSidePanel && !hasOwnHeader && "invisible md:visible",
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
};
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = ({ ref, className, ...props }: React.ComponentPropsWithRef<typeof SheetPrimitive.Title>) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SheetPrimitive.Description>) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
);
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
