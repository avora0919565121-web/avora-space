import { CheckSquare } from "lucide-react";
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * 101B · 3d: the thread's tasks as one small ☑ floating at the top-right of the messages, not a
 * row of its own. A dot counts them and fills when something waits for the viewer. Tapping opens
 * the list as a sheet over the thread — the messages never move down.
 */
export function ThreadTaskButton({
  count,
  needsMe,
  open,
  onOpenChange,
  isScrolling,
  children,
}: {
  count: number;
  needsMe: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isScrolling: boolean;
  children: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <>
      <button
        type="button"
        data-thread-task-button=""
        onClick={() => onOpenChange(true)}
        aria-label={`${count} việc trong cuộc trò chuyện này${needsMe ? ", có việc chờ bạn" : ""}`}
        className={cn(
          "press absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-personal backdrop-blur-sm transition-opacity motion-reduce:transition-none md:right-6",
          "[html[data-keyboard=open]_&]:hidden",
          isScrolling ? "opacity-40" : "opacity-100",
        )}
      >
        <CheckSquare className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        <span
          aria-hidden="true"
          className={cn(
            "tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
            needsMe ? "bg-personal text-personal-foreground" : "border border-border bg-background text-muted-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      </button>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[60dvh] scroll-y p-0">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle className="text-[15px]">Việc trong cuộc trò chuyện</SheetTitle>
            <SheetDescription className="sr-only">Danh sách việc của cuộc trò chuyện này</SheetDescription>
          </SheetHeader>
          <div className="pb-[max(env(safe-area-inset-bottom),1rem)]">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
