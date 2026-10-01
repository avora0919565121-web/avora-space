import { ChevronDown, LayoutGrid, ListPlus, Plus } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { GUIDANCE_TEXT } from "@/lib/guidance";
import { useGuidance } from "@/lib/use-task-flags";

/**
 * Kế hoạch's one `+` (AVORA-57 · E).
 *
 * Tap: a new Hạng mục in the open table (no table yet → a new table). Hold (phone) or the small
 * arrow beside it (computer): `Hạng mục mới` · `Bảng mới`. The first time, a one-line hint says
 * so; it goes for good once dismissed or once the menu has been used.
 */
export function PlanPlusButton({
  canAddRecord,
  onNewRecord,
  onNewTable,
}: {
  canAddRecord: boolean;
  onNewRecord: () => void;
  onNewTable: () => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const { shouldShow, dismiss } = useGuidance();
  const showHint = shouldShow("plan_plus_hold");

  const openMenu = (): void => {
    setIsMenuOpen(true);
    if (showHint) dismiss("plan_plus_hold");
  };

  const { onClick, ...hold } = useLongPress({
    onTap: () => (canAddRecord ? onNewRecord() : onNewTable()),
    onHold: () => {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
      openMenu();
    },
    pointerTypes: ["touch"],
    contextMenu: "after-hold",
  });

  return (
    <div className="relative">
      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(next) => (next ? openMenu() : setIsMenuOpen(false))}
      >
        <div className="flex items-center">
          <button
            type="button"
            {...hold}
            onClick={(event) => {
              // A mouse or keyboard press has no hold, so it is always the tap.
              onClick(event);
            }}
            aria-label={canAddRecord ? "Thêm Hạng mục (giữ để tạo bảng mới)" : "Tạo bảng mới"}
            title={canAddRecord ? "Thêm Hạng mục · giữ để tạo bảng mới" : "Tạo bảng mới"}
            className="icon-btn icon-btn-primary h-11 w-11"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
          </button>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chọn loại mới"
              className="icon-btn ml-1 hidden h-11 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={!canAddRecord} onSelect={onNewRecord} className="min-h-11 gap-2.5 text-[14px]">
            <ListPlus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Hạng mục mới
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewTable} className="min-h-11 gap-2.5 text-[14px]">
            <LayoutGrid className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Bảng mới
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showHint ? (
        <div
          role="note"
          className="absolute right-0 top-full z-20 mt-2 flex w-max max-w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] text-foreground shadow-md"
        >
          <span>{GUIDANCE_TEXT.plan_plus_hold}</span>
          <button
            type="button"
            onClick={() => dismiss("plan_plus_hold")}
            className="press shrink-0 rounded px-1.5 text-[12px] font-semibold text-primary"
          >
            Đã hiểu
          </button>
        </div>
      ) : null}
    </div>
  );
}
