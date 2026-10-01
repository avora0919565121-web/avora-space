import { MoreHorizontal } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TASK_HUB_SECTIONS, type TaskHubSection, type TaskHubSectionId } from "@/lib/task-hub";
import { cn } from "@/lib/utils";

/** The sections the strip shows right now: the five fixed ones, plus Lời mời while any wait. */
export function visibleHubSections(
  counts: Partial<Record<TaskHubSectionId, number>>,
  active: TaskHubSection,
): TaskHubSection[] {
  return TASK_HUB_SECTIONS.filter(
    (section) =>
      section.placement === "top" ||
      (section.placement === "when-any" && ((counts[section.id] ?? 0) > 0 || section.id === active.id)) ||
      (section.placement === "hidden" && section.id === active.id),
  );
}

/**
 * Where Nhiệm vụ can be read from (AVORA-53 · 4.7): `Hôm nay · Tất cả · Sắp tới · Lịch · Quá hạn`,
 * `Lời mời (n)` only while someone is waiting, and `Đã xong` · `Thùng rác` behind ⋯ at the end.
 * The section's description is a small quiet line, so the first task is visible on a phone.
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
  const shown = visibleHubSections(counts, active);
  const more = TASK_HUB_SECTIONS.filter((section) => section.placement === "more");
  const activeInMore = more.some((section) => section.id === active.id);

  return (
    <div>
      <nav aria-label="Các mục Nhiệm vụ" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max items-center gap-1.5 pb-1">
          {shown.map((section) => {
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
                  <span className={cn("tabular text-[11.5px]", isActive ? "text-background/70" : "text-task-idle")}>
                    {section.id === "invitations" ? `(${count})` : count}
                  </span>
                ) : null}
              </button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Thêm mục: Đã xong, Thùng rác"
              className={cn(
                "press flex h-10 min-w-10 items-center justify-center gap-1 rounded-full border px-2.5 text-[13px] transition-colors",
                activeInMore
                  ? "border-foreground bg-foreground font-semibold text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {activeInMore ? <span>{active.label}</span> : null}
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {more.map((section) => (
                <DropdownMenuItem key={section.id} onSelect={() => onChange(section)} className="min-h-11">
                  {section.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
      <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/80">{active.description}</p>
    </div>
  );
}
