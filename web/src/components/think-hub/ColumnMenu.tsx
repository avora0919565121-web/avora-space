import { ArrowDownAZ, ArrowUpAZ, EyeOff, Filter, MoreHorizontal, MoveHorizontal, Pencil, Repeat2, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { columnTypeLabel, type ColumnDef, type ColumnType } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

export type ColumnSort = { columnId: string; direction: "asc" | "desc" } | null;

/** One filter at a time: cells that hold something, or empty ones (Có / Không, có tệp / chưa có). */
export type ColumnFilter = { columnId: string; mode: "filled" | "empty" } | null;

/** What a column menu may do. Absent handlers = the row shows dimmed with its reason. */
export type ColumnMenuActions = {
  onRename?: (column: ColumnDef) => void;
  onChangeType?: (column: ColumnDef, type: ColumnType) => void;
  safeTypes?: (column: ColumnDef) => readonly ColumnType[];
  onSort: (column: ColumnDef, direction: "asc" | "desc" | null) => void;
  onFilter: (column: ColumnDef, mode: "filled" | "empty" | null) => void;
  onHide?: (column: ColumnDef) => void;
  onWidth?: (column: ColumnDef, width: number | null) => void;
  onDelete?: (column: ColumnDef) => void;
  /** A shared board's member: "Đề nghị xoá" instead of "Xoá cột" (ADR-031). */
  onRequestDelete?: (column: ColumnDef) => void;
  /** Why reshaping is not available (not the owner, read-only…). */
  lockedReason?: string | null;
};

const WIDTHS: readonly { label: string; value: number | null }[] = [
  { label: "Hẹp", value: 120 },
  { label: "Vừa (mặc định)", value: null },
  { label: "Rộng", value: 260 },
  { label: "Rất rộng", value: 400 },
];

function Blocked({ children, reason }: { children: ReactNode; reason: string }) {
  return (
    <DropdownMenuItem disabled className="min-h-10 flex-col items-start gap-0 data-[disabled]:opacity-100">
      <span className="opacity-45">{children}</span>
      <span className="text-[11.5px] font-normal text-muted-foreground">{reason}</span>
    </DropdownMenuItem>
  );
}

/**
 * Every column action in one place (AVORA-61 · E): ⋯ at the head of the column — shown on hover
 * with a mouse, always reachable by holding the column's name on a phone. A system column (Tiêu
 * đề, Trạng thái…) offers Sắp xếp and shows the rest dimmed with why.
 */
export function ColumnMenu({
  column,
  label,
  isSystem = false,
  sort,
  filter = null,
  actions,
  children,
  columnId: givenId,
}: {
  /** Null for a system column. */
  column: ColumnDef | null;
  label: string;
  isSystem?: boolean;
  sort: ColumnSort;
  filter?: ColumnFilter;
  /** Stable id for a system column ("status", "title"…). */
  columnId?: string;
  actions: ColumnMenuActions;
  /** The column's name, which a held finger also opens the menu from. */
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const columnId = column?.id ?? givenId ?? `system:${label}`;
  const currentDirection = sort?.columnId === columnId ? sort.direction : null;
  const currentFilter = filter?.columnId === columnId ? filter.mode : null;
  const filledWord = column?.type === "checkbox" ? "Chỉ ô Có" : column?.type === "file" ? "Chỉ ô có tệp" : "Chỉ ô đã điền";
  const emptyWord = column?.type === "checkbox" ? "Chỉ ô Không" : column?.type === "file" ? "Chỉ ô chưa có tệp" : "Chỉ ô trống";
  const subject: ColumnDef = column ?? { id: columnId, key: columnId, label, type: "text" };
  const hold = useLongPress({ onHold: () => setIsOpen(true), pointerTypes: ["touch", "pen"], contextMenu: "always" });
  const systemReason = "Cột hệ thống của mọi Bảng.";
  const locked = actions.lockedReason ?? null;
  const safe = column === null ? [] : (actions.safeTypes?.(column) ?? []);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <span className="flex min-w-0 items-center gap-1">
        <span {...hold} onClick={hold.onClick} className="no-callout min-w-0 flex-1 truncate">
          {children}
        </span>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Thao tác với cột ${label}`}
            data-column-menu={label}
            className={cn(
              "press -my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100",
              isOpen || currentDirection !== null || currentFilter !== null
                ? "text-primary opacity-100"
                : "opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100",
            )}
          >
            {currentFilter !== null ? (
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            ) : currentDirection === "asc" ? (
              <ArrowDownAZ className="h-3.5 w-3.5" aria-hidden="true" />
            ) : currentDirection === "desc" ? (
              <ArrowUpAZ className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="start" sideOffset={4} collisionPadding={12} className="w-60 normal-case tracking-normal">
        <DropdownMenuLabel className="truncate text-[12px] font-medium text-muted-foreground">
          {label}
          {column !== null ? ` · ${columnTypeLabel(column.type)}` : ""}
        </DropdownMenuLabel>
        {isSystem ? (
          <Blocked reason={systemReason}>Đổi tên</Blocked>
        ) : locked !== null || actions.onRename === undefined ? (
          <Blocked reason={locked ?? "Chỉ chủ Bảng đổi được."}>Đổi tên</Blocked>
        ) : (
          <DropdownMenuItem className="min-h-10 gap-2" onSelect={() => actions.onRename?.(subject)}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Đổi tên
          </DropdownMenuItem>
        )}
        {isSystem ? (
          <Blocked reason={systemReason}>Đổi loại</Blocked>
        ) : locked !== null || actions.onChangeType === undefined ? (
          <Blocked reason={locked ?? "Chỉ chủ Bảng đổi được."}>Đổi loại</Blocked>
        ) : safe.length === 0 ? (
          <Blocked reason="Không có loại nào đổi sang mà giữ nguyên dữ liệu.">Đổi loại</Blocked>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-10 gap-2">
              <Repeat2 className="h-4 w-4" aria-hidden="true" /> Đổi loại
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {safe.map((type) => (
                <DropdownMenuItem key={type} className="min-h-10" onSelect={() => actions.onChangeType?.(subject, type)}>
                  Thành {columnTypeLabel(type)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-10 gap-2">
            <ArrowDownAZ className="h-4 w-4" aria-hidden="true" /> Sắp xếp
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem className="min-h-10" onSelect={() => actions.onSort(subject, "asc")}>
              {column?.type === "checkbox" ? "Có trước" : column?.type === "file" ? "Nhiều tệp trước" : "Tăng dần (A → Z, 1 → 9)"}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" onSelect={() => actions.onSort(subject, "desc")}>
              {column?.type === "checkbox" ? "Không trước" : column?.type === "file" ? "Ít tệp trước" : "Giảm dần (Z → A, 9 → 1)"}
            </DropdownMenuItem>
            {currentDirection !== null ? (
              <DropdownMenuItem className="min-h-10" onSelect={() => actions.onSort(subject, null)}>
                Bỏ sắp xếp
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-10 gap-2">
            <Filter className="h-4 w-4" aria-hidden="true" /> Lọc
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem className="min-h-10" onSelect={() => actions.onFilter(subject, "filled")}>
              {filledWord}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" onSelect={() => actions.onFilter(subject, "empty")}>
              {emptyWord}
            </DropdownMenuItem>
            {currentFilter !== null ? (
              <DropdownMenuItem className="min-h-10" onSelect={() => actions.onFilter(subject, null)}>
                Bỏ lọc
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isSystem ? (
          <Blocked reason={systemReason}>Ẩn cột</Blocked>
        ) : locked !== null || actions.onHide === undefined ? (
          <Blocked reason={locked ?? "Chỉ chủ Bảng ẩn được."}>Ẩn cột</Blocked>
        ) : (
          <DropdownMenuItem className="min-h-10 gap-2" onSelect={() => actions.onHide?.(subject)}>
            <EyeOff className="h-4 w-4" aria-hidden="true" /> Ẩn cột
          </DropdownMenuItem>
        )}
        {isSystem ? null : locked !== null || actions.onWidth === undefined ? (
          <Blocked reason={locked ?? "Chỉ chủ Bảng đổi được."}>Độ rộng</Blocked>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-10 gap-2">
              <MoveHorizontal className="h-4 w-4" aria-hidden="true" /> Độ rộng
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {WIDTHS.map((entry) => (
                <DropdownMenuItem key={entry.label} className="min-h-10" onSelect={() => actions.onWidth?.(subject, entry.value)}>
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        {isSystem ? (
          <Blocked reason="Cột hệ thống không xoá được.">Xoá cột</Blocked>
        ) : actions.onDelete !== undefined && locked === null ? (
          <DropdownMenuItem className="min-h-10 gap-2 text-destructive focus:text-destructive" onSelect={() => actions.onDelete?.(subject)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Xoá cột
          </DropdownMenuItem>
        ) : actions.onRequestDelete !== undefined ? (
          <DropdownMenuItem className="min-h-10 gap-2 text-destructive focus:text-destructive" onSelect={() => actions.onRequestDelete?.(subject)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Đề nghị xoá
          </DropdownMenuItem>
        ) : (
          <Blocked reason={locked ?? "Chỉ chủ Bảng xoá được."}>Xoá cột</Blocked>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
