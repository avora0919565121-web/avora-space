import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { BackClosesBinding } from "@/lib/use-back-closes";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = ({ ref, className, ...props }: React.ComponentPropsWithRef<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-foreground/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * KT-07b (CEO 12/11 · 7, QA-02 CC-36): a create form. On a phone it is a sheet pulled up from the
   * bottom with a drag handle (drag down to close), like Telegram; on a computer the centred box.
   */
  phoneSheet?: boolean;
};

const CENTRED =
  "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-32px)] w-[calc(100vw-16px)] max-w-lg scroll-y-free translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";

/** Phone: anchored to the bottom edge, full width, rounded top; from md up: exactly CENTRED. */
const PHONE_SHEET =
  "fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] w-full max-w-lg scroll-y-free gap-4 rounded-t-[20px] border-t bg-background p-6 pt-8 shadow-lg duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom md:inset-x-auto md:bottom-auto md:left-[50%] md:top-[50%] md:max-h-[calc(100dvh-32px)] md:w-[calc(100vw-16px)] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:border md:pt-6 md:duration-200 md:data-[state=open]:fade-in-0 md:data-[state=closed]:fade-out-0 md:data-[state=open]:zoom-in-95 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%] md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%]";

/**
 * The grab bar of a phone sheet. Dragging it down moves the sheet with the finger; letting go
 * past 80 px closes it (through the dialog's own Close, so onOpenChange runs as for ✕).
 */
function SheetHandle() {
  const start = React.useRef<number | null>(null);
  const handleRef = React.useRef<HTMLDivElement | null>(null);
  const sheet = (): HTMLElement | null => handleRef.current?.closest<HTMLElement>("[role=dialog]") ?? null;
  return (
    <>
      <div
        ref={handleRef}
        data-sheet-handle=""
        aria-hidden="true"
        onPointerDown={(event) => {
          start.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current === null) return;
          const dy = Math.max(0, event.clientY - start.current);
          const el = sheet();
          if (el !== null) el.style.transform = `translateY(${dy}px)`;
        }}
        onPointerUp={(event) => {
          const dy = start.current === null ? 0 : event.clientY - start.current;
          start.current = null;
          const el = sheet();
          if (el !== null) el.style.transform = "";
          if (dy > 80) el?.querySelector<HTMLButtonElement>("[data-sheet-close]")?.click();
        }}
        onPointerCancel={() => {
          start.current = null;
          const el = sheet();
          if (el !== null) el.style.transform = "";
        }}
        className="absolute inset-x-0 top-0 flex h-7 cursor-grab touch-none items-center justify-center md:hidden"
      >
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
      </div>
      <DialogPrimitive.Close data-sheet-close="" tabIndex={-1} aria-hidden="true" className="hidden" />
    </>
  );
}

/** Closes the dialog through its own Close (Radix calls onOpenChange). */
function DialogBackBinding() {
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <DialogPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden="true" className="hidden" />
      <BackClosesBinding close={() => closeRef.current?.click()} />
    </>
  );
}

const DialogContent = ({ ref, className, children, showCloseButton = true, phoneSheet = false, ...props }: DialogContentProps) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-phone-sheet={phoneSheet ? "" : undefined}
      className={cn(phoneSheet ? PHONE_SHEET : CENTRED, className)}
      {...props}
    >
      {/* AVORA-94B · luật 5: Back closes the dialog first, never the screen beneath. */}
      <DialogBackBinding />
      {phoneSheet ? <SheetHandle /> : null}
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close aria-label="Đóng" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = ({ ref, className, ...props }: React.ComponentPropsWithRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
);
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
);
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
