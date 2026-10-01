import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** One row of the board menu; a row that may not be used stays visible, dimmed, with its reason. */
export type BoardMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  /** Why it is not available here. Present = dimmed, not hidden (AVORA-61 · C). */
  blockedReason?: string | null;
  danger?: boolean;
  /** Draw a separator above this row. */
  separated?: boolean;
};

/**
 * Everything a Bảng can do, in one ⋯ right beside its name (AVORA-61 · C). The Hạng mục toolbar
 * keeps only what belongs to Hạng mục, so nobody deletes a whole board while looking at its rows.
 */
export function BoardMenu({ boardName, items, footer }: { boardName: string; items: readonly BoardMenuItem[]; footer?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Thao tác với Bảng ${boardName}`}
          title="Thao tác với Bảng"
          data-board-menu=""
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} collisionPadding={12} className="w-64">
        {items.map((item) => {
          const isBlocked = item.blockedReason != null;
          return (
            <div key={item.id}>
              {item.separated === true ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={isBlocked}
                onSelect={item.onSelect}
                className={
                  item.danger === true
                    ? "min-h-10 flex-col items-start gap-0 text-destructive focus:text-destructive data-[disabled]:opacity-100"
                    : "min-h-10 flex-col items-start gap-0 data-[disabled]:opacity-100"
                }
              >
                <span className={isBlocked ? "opacity-45" : undefined}>{item.label}</span>
                {isBlocked ? (
                  <span className="text-[11.5px] font-normal leading-snug text-muted-foreground">{item.blockedReason}</span>
                ) : null}
              </DropdownMenuItem>
            </div>
          );
        })}
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
