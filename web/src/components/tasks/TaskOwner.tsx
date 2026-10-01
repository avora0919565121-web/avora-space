import { UserRound } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import type { TaskOwnership } from "@/lib/task-owner";
import type { TaskItem } from "@/lib/tasks";
import { useTaskOwnership } from "@/lib/use-task-owner";
import { cn } from "@/lib/utils";

/**
 * The one place a task says whose it is (AVORA-59 · B). Every list, calendar, chat panel and the
 * detail use this pair, so "my work" looks the same everywhere:
 *
 * - `TaskOwnerFrame` — a 3px orange stripe on the left when the viewer has to do it; the same
 *   width, transparent, otherwise (rows never shift sideways).
 * - `TaskOwnerLine` — `Của tôi` · `Của tôi · từ Lan` · `Giao Lan · chờ nhận` · `Lan → Minh`.
 *
 * Whose circle is tappable stays with the row (only the doer finishes); a circle that is not the
 * viewer's to tap is drawn faded with `ownerCircleClass`.
 */
export function TaskOwnerFrame({
  task,
  ownership,
  className,
  children,
  ...rest
}: { task: TaskItem; ownership?: TaskOwnership; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const computed = useTaskOwnership(task);
  const owner = ownership ?? computed;
  return (
    <div
      data-task-mine={owner.isMine ? "true" : "false"}
      className={cn("border-l-[3px]", owner.isMine ? "border-l-primary" : "border-l-transparent", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** `ownerStripeClass(isMine)` for rows that already are a `<li>` and cannot take a wrapper. */
export function ownerStripeClass(isMine: boolean): string {
  return cn("border-l-[3px]", isMine ? "border-l-primary" : "border-l-transparent");
}

/** A circle that is somebody else's to tap: shown, never inviting. */
export function ownerCircleClass(isMine: boolean): string {
  return isMine ? "" : "opacity-45";
}

export function TaskOwnerLine({
  task,
  ownership,
  className,
}: {
  task: TaskItem;
  ownership?: TaskOwnership;
  className?: string;
}) {
  const computed = useTaskOwnership(task);
  const owner = ownership ?? computed;
  return (
    <span
      data-task-owner=""
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-[12px]",
        owner.isMine ? "font-medium text-primary" : "text-muted-foreground",
        className,
      )}
    >
      <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 truncate">{owner.line}</span>
    </span>
  );
}
