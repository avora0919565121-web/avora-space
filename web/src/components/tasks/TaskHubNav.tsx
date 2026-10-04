import { MoreHorizontal } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TASK_HUB_SECTIONS, TASK_HUB_TOP, type TaskHubSection, type TaskHubSectionId } from "@/lib/task-hub";
import { cn } from "@/lib/utils";

/**
 * Nhiệm vụ's strip (AVORA-89 · 3.B / AVORA-93 · 4): three equal sections — `Hôm nay · Sắp tới ·
 * Tất cả` — with how many each holds, and ⋯ for Lịch, Đã xong, Thùng rác. No description line:
 * the first task stays in view on a phone.
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
  const top = TASK_HUB_TOP.map((id) => TASK_HUB_SECTIONS.find((section) => section.id === id)).filter(
    (section): section is TaskHubSection => section !== undefined,
  );
  const more = TASK_HUB_SECTIONS.filter((section) => section.placement === "more");
  const activeInMore = !TASK_HUB_TOP.includes(active.id);

  return (
    <nav aria-label="Các mục Nhiệm vụ" className="flex items-stretch border-b border-border" data-task-strip="">
      {top.map((section) => {
        const isActive = section.id === active.id;
        const count = counts[section.id];
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onChange(section)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "press relative flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-1 text-[14px] transition-colors",
              isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
            {count !== undefined && count > 0 ? <span className="tabular text-[12px] text-muted-foreground">{count}</span> : null}
            {isActive ? <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-personal" /> : null}
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Thêm mục: Lịch, Đã xong, Thùng rác"
          className={cn(
            "press relative flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 px-2 text-[13.5px]",
            activeInMore ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {activeInMore ? <span>{active.label}</span> : null}
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {activeInMore ? <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-personal" /> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {more.map((section) => (
            <DropdownMenuItem key={section.id} onSelect={() => onChange(section)} className="min-h-11">
              {section.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
