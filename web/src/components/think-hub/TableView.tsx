import { Eye, EyeOff, ListPlus, Plus } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  cellValue,
  clampColumnWidth,
  priorityLabel,
  statusLabel,
  visibleColumns,
  type ColumnDef,
  type ThinkRecord,
} from "@/lib/think-hub";
import { cn } from "@/lib/utils";

type TableViewProps = {
  records: readonly ThinkRecord[];
  /** Every column the table has, hidden ones included — hidden ones are folded away here. */
  columns: readonly ColumnDef[];
  onOpenRecord: (record: ThinkRecord) => void;
  /** The following are absent when the viewer does not own the table: only its owner reshapes it. */
  onAddColumn?: () => void;
  onRenameColumn?: (column: ColumnDef) => void;
  onResizeColumn?: (column: ColumnDef, width: number | null) => void;
  onToggleColumnHidden?: (column: ColumnDef, hidden: boolean) => void;
  /** "Tạo tác vụ" on a row — anyone who can add to the table may hand work out from it. */
  onQuickTask?: (record: ThinkRecord) => void;
  /** How many tasks hang under each Hạng mục, for the small count beside its title. */
  taskCountByRecord?: ReadonlyMap<string, number>;
  today: string;
};

const DEFAULT_COLUMN_WIDTH = 160;

/**
 * One extension-column header: its label (tap to rename), a quick hide, and a drag strip on the
 * right edge. The width follows the pointer while dragging and is saved once, on release.
 */
function ColumnHeader({
  column,
  width,
  onPreview,
  onRename,
  onResize,
  onHide,
}: {
  column: ColumnDef;
  width: number | undefined;
  onPreview: (columnId: string, width: number | null) => void;
  onRename?: (column: ColumnDef) => void;
  onResize?: (column: ColumnDef, width: number | null) => void;
  onHide?: (column: ColumnDef, hidden: boolean) => void;
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const thRef = useRef<HTMLTableCellElement | null>(null);

  const handleDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>): void => {
      if (event.button !== 0 || onResize === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      startRef.current = { x: event.clientX, width: thRef.current?.getBoundingClientRect().width ?? DEFAULT_COLUMN_WIDTH };
    },
    [onResize],
  );

  const handleMove = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>): void => {
      const start = startRef.current;
      if (start === null) return;
      onPreview(column.id, clampColumnWidth(start.width + event.clientX - start.x));
    },
    [column.id, onPreview],
  );

  const handleUp = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>): void => {
      const start = startRef.current;
      startRef.current = null;
      if (start === null || onResize === undefined) return;
      const next = clampColumnWidth(start.width + event.clientX - start.x);
      if (Math.abs(next - start.width) >= 2) onResize(column, next);
      else onPreview(column.id, null);
    },
    [column, onPreview, onResize],
  );

  return (
    <th
      ref={thRef}
      scope="col"
      style={width !== undefined ? { width, minWidth: width, maxWidth: width } : undefined}
      className="group relative whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      <span className="flex items-center gap-1">
        {onRename !== undefined ? (
          <button
            type="button"
            onClick={() => onRename(column)}
            title="Đổi tên cột"
            className="press -mx-1 min-w-0 truncate rounded px-1 uppercase tracking-wide transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            {column.label}
          </button>
        ) : (
          <span className="min-w-0 truncate">{column.label}</span>
        )}
        {onHide !== undefined ? (
          <button
            type="button"
            onClick={() => onHide(column, true)}
            aria-label={`Ẩn cột ${column.label}`}
            title="Ẩn cột với mọi người xem bảng"
            className="press shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        ) : null}
      </span>
      {onResize !== undefined ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Kéo để đổi độ rộng cột ${column.label}. Chạm hai lần để về mặc định.`}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onDoubleClick={() => onResize(column, null)}
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none border-r-2 border-transparent transition-colors hover:border-primary/50"
        />
      ) : null}
    </th>
  );
}

/**
 * The grid: every Hạng mục of one table, one row each.
 *
 * The seven built-in columns first, then whatever this table added. Column width and hiding are
 * the table owner's choice and apply to everyone reading the table.
 */
export function TableView({
  records,
  columns,
  onOpenRecord,
  onAddColumn,
  onRenameColumn,
  onResizeColumn,
  onToggleColumnHidden,
  onQuickTask,
  taskCountByRecord,
  today,
}: TableViewProps) {
  // Width while a drag is in flight, before the saved value comes back.
  const [preview, setPreview] = useState<Readonly<Record<string, number>>>({});
  const shown = visibleColumns(columns);
  const hidden = columns.filter((column) => column.hidden === true);

  const handlePreview = useCallback((columnId: string, width: number | null): void => {
    setPreview((current) => {
      const next = { ...current };
      if (width === null) delete next[columnId];
      else next[columnId] = width;
      return next;
    });
  }, []);

  const handleResize = useCallback(
    (column: ColumnDef, width: number | null): void => {
      onResizeColumn?.(column, width);
      handlePreview(column.id, width);
    },
    [onResizeColumn, handlePreview],
  );

  const headClass =
    "whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground";
  const cellClass = "px-3 py-3 text-[14.5px] text-foreground align-top";

  return (
    <>
      {hidden.length > 0 && onToggleColumnHidden !== undefined ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <span>Cột đang ẩn:</span>
          {hidden.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => onToggleColumnHidden(column, false)}
              title="Hiện lại cột này"
              className="press inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 py-1 transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {column.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={headClass}>
                Tiêu đề
              </th>
              <th scope="col" className={headClass}>
                Trạng thái
              </th>
              <th scope="col" className={headClass}>
                Độ ưu tiên
              </th>
              <th scope="col" className={headClass}>
                Phân loại
              </th>
              <th scope="col" className={headClass}>
                Ngày cần làm tiếp
              </th>
              <th scope="col" className={headClass}>
                Nhãn
              </th>
              <th scope="col" className={headClass}>
                Ghi chú
              </th>
              {shown.map((column) => (
                <ColumnHeader
                  key={column.id}
                  column={column}
                  width={preview[column.id] ?? column.width}
                  onPreview={handlePreview}
                  onRename={onRenameColumn}
                  onResize={onResizeColumn === undefined ? undefined : handleResize}
                  onHide={onToggleColumnHidden}
                />
              ))}
              <th scope="col" className="px-2 py-2.5 text-right">
                {onAddColumn !== undefined ? (
                  <button
                    type="button"
                    onClick={onAddColumn}
                    className="press inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                  >
                    <Plus className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                    Thêm cột
                  </button>
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={8 + shown.length} className="px-3 py-8 text-center text-[14.5px] text-muted-foreground">
                  Bảng này chưa có Hạng mục nào. Bấm "Thêm Hạng mục" để ghi cái đầu tiên.
                  {/* Only while the table is empty: the term is explained once, then gets out of the way. */}
                  <span className="mt-1.5 block text-[12.5px] text-muted-foreground/80">
                    Hạng mục là một dòng trong Bảng này.
                  </span>
                </td>
              </tr>
            ) : null}
            {records.map((record) => {
              const isOverdue: boolean = record.nextActionDate !== null && record.nextActionDate < today;
              const taskCount = taskCountByRecord?.get(record.id) ?? 0;
              return (
                <tr
                  key={record.id}
                  onClick={() => onOpenRecord(record)}
                  className="group/row cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/25"
                >
                  <td className={cn(cellClass, "font-medium")}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0">{record.title}</span>
                      {taskCount > 0 ? (
                        <span
                          className="tabular shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                          title={`${taskCount} tác vụ`}
                        >
                          {taskCount} việc
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className={cellClass}>
                    <span className="inline-flex rounded-full bg-accent/60 px-2.5 py-1 text-[12.5px] font-medium text-accent-foreground">
                      {statusLabel(record.status)}
                    </span>
                  </td>
                  <td className={cellClass}>{priorityLabel(record.priority)}</td>
                  <td className={cn(cellClass, "text-muted-foreground")}>{record.category ?? ""}</td>
                  <td
                    className={cn(
                      cellClass,
                      "tabular whitespace-nowrap",
                      isOverdue ? "font-medium text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {record.nextActionDate ?? ""}
                  </td>
                  <td className={cellClass}>
                    <span className="flex flex-wrap gap-1">
                      {record.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={cn(cellClass, "max-w-[220px] text-muted-foreground")}>
                    <span className="line-clamp-2">{record.notes ?? ""}</span>
                  </td>
                  {shown.map((column) => {
                    const width = preview[column.id] ?? column.width;
                    return (
                      <td
                        key={column.id}
                        style={width !== undefined ? { width, minWidth: width, maxWidth: width } : undefined}
                        className={cn(cellClass, "truncate text-muted-foreground")}
                      >
                        {cellValue(record, column)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right align-top">
                    {onQuickTask !== undefined ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onQuickTask(record);
                        }}
                        aria-label={`Tạo tác vụ từ "${record.title}"`}
                        title="Tạo tác vụ"
                        className="press inline-flex min-h-9 items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground opacity-70 transition-colors hover:bg-accent/50 hover:text-foreground group-hover/row:opacity-100"
                      >
                        <ListPlus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                        <span className="hidden lg:inline">Tạo tác vụ</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
