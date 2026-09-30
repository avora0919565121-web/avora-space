import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Hộp dài hơn màn (44b · H4, AVORA-50 · C): the title row and the last row of buttons stay in
 * view; only the middle scrolls. One shell for every long box — put these three parts inside a
 * `DialogContent` / `SheetContent` given `longDialogContentClass`.
 */
export const longDialogContentClass = "flex max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden p-0";

/** The same, for a bottom sheet on a phone (never taller than 92% of the screen). */
export const longSheetContentClass = "flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0";

export function LongDialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 border-b border-border px-5 pb-3.5 pt-5 pr-12", className)} {...props} />;
}

export function LongDialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", className)} {...props} />;
}

export function LongDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 [&>*]:whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
