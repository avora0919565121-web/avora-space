import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * CC-15: the one empty state of the house — a line-drawn icon, one warm sentence with a subject, and at
 * most one way forward. Where the way forward is already on screen (Nhật ký's composer) there is no button.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title?: string;
  children: ReactNode;
  action?: { label: string; icon?: LucideIcon; onClick: () => void };
  className?: string;
}) {
  const ActionIcon = action?.icon;
  return (
    <div data-empty-state="" className={cn("mx-auto flex max-w-sm flex-col items-center px-4 py-10 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-personal-soft text-personal-soft-foreground">
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden="true" />
      </span>
      {title !== undefined ? <p className="mt-3 text-[15px] font-semibold text-foreground">{title}</p> : null}
      <p className={cn("text-[14px] leading-relaxed text-muted-foreground", title !== undefined ? "mt-1" : "mt-3")}>{children}</p>
      {action !== undefined ? (
        <button
          type="button"
          onClick={action.onClick}
          className="press mt-4 inline-flex h-11 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
        >
          {ActionIcon !== undefined ? <ActionIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> : null}
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
