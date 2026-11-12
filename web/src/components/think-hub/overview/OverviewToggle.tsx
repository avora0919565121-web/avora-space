import { memo } from "react";

import type { OverviewMode } from "@/lib/project-tree";
import { CHIP_OFF, CHIP_ON } from "@/lib/chip";
import { cn } from "@/lib/utils";

/** `Toàn cảnh · Chỉ bảng` at the head of an open board (remembered per board, AVORA-104 · 4.2). */
export const OverviewToggle = memo(function OverviewToggle({
  mode,
  onChange,
  taskColumnHidden = false,
  onShowTaskColumn,
  className = "mt-5",
}: {
  /** KT-06 · C: the sticky board bar places it without the top margin. */
  className?: string;
  mode: OverviewMode;
  onChange: (mode: OverviewMode) => void;
  taskColumnHidden?: boolean;
  onShowTaskColumn?: () => void;
}) {
  const options: { id: OverviewMode; label: string }[] = [
    { id: "overview", label: "Toàn cảnh" },
    { id: "board", label: "Chỉ bảng" },
  ];
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {taskColumnHidden && onShowTaskColumn !== undefined ? (
        <button type="button" onClick={onShowTaskColumn} className="press min-h-9 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
          Hiện cột Việc
        </button>
      ) : null}
      <div role="radiogroup" aria-label="Cách xem" data-overview-toggle="" className="inline-flex items-center gap-1">
        {options.map((option) => {
          const isOn = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isOn}
              onClick={() => onChange(option.id)}
              className={cn(
                "press min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                cn("border", isOn ? CHIP_ON : CHIP_OFF),
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
