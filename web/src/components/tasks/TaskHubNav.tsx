import { TASK_HUB_SECTIONS, type TaskHubSection, type TaskHubSectionId } from "@/lib/task-hub";
import { cn } from "@/lib/utils";

/**
 * The ten places Nhiệm vụ can be read from, as one scrollable strip. The chosen section's
 * one-line description sits under it, so every place says what it holds before it is read.
 */
export function TaskHubNav({
  active,
  counts,
  onChange,
}: {
  active: TaskHubSection;
  counts: Partial<Record<TaskHubSectionId, number>>;
  onChange: (section: TaskHubSection) => void;
}) {
  return (
    <div>
      <nav aria-label="Các mục Nhiệm vụ" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1.5 pb-1">
          {TASK_HUB_SECTIONS.map((section) => {
            const isActive = section.id === active.id;
            const count = counts[section.id];
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onChange(section)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "press flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] transition-colors",
                  isActive
                    ? "border-foreground bg-foreground font-semibold text-background"
                    : "border-border bg-card font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {section.label}
                {count !== undefined && count > 0 ? (
                  <span className={cn("tabular text-[11.5px]", isActive ? "text-background/70" : "text-task-idle")}>{count}</span>
                ) : null}
                {section.isComingSoon ? <span className="text-[10.5px] opacity-70">Sắp có</span> : null}
              </button>
            );
          })}
        </div>
      </nav>
      <p className="mt-2 text-[13px] text-muted-foreground">{active.description}</p>
    </div>
  );
}
