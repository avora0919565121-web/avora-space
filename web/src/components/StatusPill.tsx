import { cn } from "@/lib/utils";

/**
 * The small wordmark pill for a part of AVORA that is not finished — "Sắp ra mắt" for what does
 * not exist yet, "Đang hoàn thiện" for what works but is still being shaped. One style, so the
 * two read as the same kind of note.
 */
export function StatusPill({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "wordmark inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
