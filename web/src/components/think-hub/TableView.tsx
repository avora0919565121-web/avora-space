import { Plus } from "lucide-react";

import {
  cellValue,
  priorityLabel,
  statusLabel,
  type ThinkRecord,
  type ColumnDef,
} from "@/lib/think-hub";
import { cn } from "@/lib/utils";

type TableViewProps = {
  records: readonly ThinkRecord[];
  columns: readonly ColumnDef[];
  onOpenRecord: (record: ThinkRecord) => void;
  /** Absent when the viewer does not own the table: only its owner reshapes it. */
  onAddColumn?: () => void;
  /** Renames by the column's permanent id; absent for anyone but the owner. */
  onRenameColumn?: (column: ColumnDef) => void;
  today: string;
};

/**
 * The grid: every record of one table, one row each.
 *
 * The seven built-in columns first, then whatever this table added, because the built-in ones
 * are the same everywhere in the HUB and become the thing a person's eye learns to find.
 */
export function TableView({
  records,
  columns,
  onOpenRecord,
  onAddColumn,
  onRenameColumn,
  today,
}: TableViewProps) {
  const headClass =
    "whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground";
  const cellClass = "px-3 py-3 text-[14.5px] text-foreground align-top";

  return (
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
            {columns.map((column) => (
              <th key={column.id} scope="col" className={headClass}>
                {onRenameColumn !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onRenameColumn(column)}
                    title="Đổi tên cột"
                    className="press rounded px-1 -mx-1 uppercase tracking-wide transition-colors hover:bg-accent/40 hover:text-foreground"
                  >
                    {column.label}
                  </button>
                ) : (
                  column.label
                )}
              </th>
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
              {/* The columns stay on screen above this: an empty table still has to show the
                  shape it is offering, or there is nothing to decide about before writing. */}
              <td colSpan={8 + columns.length} className="px-3 py-8 text-center text-[14.5px] text-muted-foreground">
                Bảng này chưa có Hạng mục nào. Bấm "Thêm Hạng mục" để ghi cái đầu tiên.
              </td>
            </tr>
          ) : null}
          {records.map((record) => {
            const isOverdue: boolean =
              record.nextActionDate !== null && record.nextActionDate < today;
            return (
              <tr
                key={record.id}
                onClick={() => onOpenRecord(record)}
                className="cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/25"
              >
                <td className={cn(cellClass, "font-medium")}>{record.title}</td>
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
                      <span
                        key={tag}
                        className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={cn(cellClass, "max-w-[220px] text-muted-foreground")}>
                  <span className="line-clamp-2">{record.notes ?? ""}</span>
                </td>
                {columns.map((column) => (
                  <td key={column.id} className={cn(cellClass, "text-muted-foreground")}>
                    {cellValue(record, column)}
                  </td>
                ))}
                <td aria-hidden="true" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
