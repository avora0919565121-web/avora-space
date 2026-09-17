import { cn } from "@/lib/utils";

/**
 * How far something has come, as a bar that animates to its new width.
 *
 * The number is always spoken as well as drawn: a bar alone reads as "some progress" at a
 * glance, and the difference between 40% and 60% is exactly what someone opening a project
 * wants to know.
 */
export function ProjectProgressBar({
  percent,
  label,
  size = "md",
}: {
  percent: number;
  /** What the percentage is measuring, for anyone not reading the bar visually. */
  label: string;
  size?: "sm" | "md";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const isComplete = clamped === 100;

  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${clamped}%`}
        className={cn(
          "relative block min-w-0 flex-1 overflow-hidden rounded-full bg-secondary",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        <span
          aria-hidden="true"
          style={{ width: `${clamped}%` }}
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
            isComplete ? "bg-primary" : "bg-primary/70",
          )}
        />
      </span>
      <span
        className={cn(
          "tabular shrink-0 text-[12px]",
          isComplete ? "font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        {clamped}%
      </span>
    </span>
  );
}
