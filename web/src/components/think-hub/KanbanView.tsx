import { useMemo, useState, type DragEvent } from "react";

import { groupByStatus, priorityLabel, type StatusOption, type ThinkRecord } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

type KanbanViewProps = {
  records: readonly ThinkRecord[];
  onOpenRecord: (record: ThinkRecord) => void;
  today: string;
  /** The table's own statuses (Đợt gộp 2 · C1); null = the four defaults. */
  statusOptions?: readonly StatusOption[] | null;
  /** AVORA-75 · 72: when given, cards can be dragged to another column to change their status. */
  onMoveRecord?: (record: ThinkRecord, status: string) => void;
};

const DRAG_TYPE = "application/x-avora-record";

/**
 * The board: one column per status, grouped by the Trạng thái column and nothing else.
 *
 * Not configurable in v1, deliberately. A board that can group by any column is a second set
 * of decisions (what happens to records with no value, what the column order is, whether the
 * grouping is remembered per table) and the one grouping people actually reach for is status.
 */
export function KanbanView({ records, onOpenRecord, today, statusOptions = null, onMoveRecord }: KanbanViewProps) {
  const columns = useMemo(() => groupByStatus(records, statusOptions), [records, statusOptions]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);
  const canDrag = onMoveRecord !== undefined;

  const dropOn = (event: DragEvent<HTMLElement>, status: string): void => {
    event.preventDefault();
    const id = event.dataTransfer.getData(DRAG_TYPE) || draggingId;
    setDraggingId(null);
    setOverStatus(null);
    const record = records.find((item) => item.id === id);
    if (record === undefined || record.status.trim() === status || onMoveRecord === undefined) return;
    onMoveRecord(record, status);
  };

  return (
    <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <section
          key={column.status}
          aria-label={column.label}
          data-kanban-column={column.status}
          onDragOver={canDrag ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (overStatus !== column.status) setOverStatus(column.status); } : undefined}
          onDragLeave={canDrag ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStatus(null); } : undefined}
          onDrop={canDrag ? (event) => dropOn(event, column.status) : undefined}
          className={cn(
            "flex w-[264px] shrink-0 flex-col rounded-xl border bg-card transition-colors",
            overStatus === column.status && draggingId !== null ? "border-primary bg-accent/40" : "border-border",
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="text-[14px] font-semibold text-foreground">{column.label}</h3>
            <span className="tabular rounded-full bg-accent/60 px-2 py-0.5 text-[12px] font-medium text-accent-foreground">
              {column.records.length}
            </span>
          </header>

          <div className="flex min-h-[72px] flex-col gap-2 p-3">
            {column.records.length === 0 ? (
              <p className="px-1 py-4 text-center text-[13px] text-muted-foreground">
                {canDrag ? "Kéo thẻ vào đây" : "Chưa có Hạng mục nào"}
              </p>
            ) : (
              column.records.map((record) => {
                const isOverdue: boolean =
                  record.nextActionDate !== null && record.nextActionDate < today;
                return (
                  <button
                    key={record.id}
                    data-record-id={record.id}
                    type="button"
                    draggable={canDrag}
                    onDragStart={canDrag ? (event) => { event.dataTransfer.setData(DRAG_TYPE, record.id); event.dataTransfer.effectAllowed = "move"; setDraggingId(record.id); } : undefined}
                    onDragEnd={canDrag ? () => { setDraggingId(null); setOverStatus(null); } : undefined}
                    onClick={() => onOpenRecord(record)}
                    className={cn(
                      "press rounded-lg border border-border bg-background px-3.5 py-3 text-left transition-colors hover:bg-accent/30",
                      canDrag && "cursor-grab active:cursor-grabbing",
                      draggingId === record.id && "opacity-50",
                    )}
                  >
                    <p className="text-[14.5px] font-medium text-foreground">{record.title}</p>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      {priorityLabel(record.priority)}
                      {record.category !== null ? ` · ${record.category}` : ""}
                    </p>
                    {record.nextActionDate !== null ? (
                      <p
                        className={cn(
                          "tabular mt-1.5 text-[12.5px]",
                          isOverdue ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {record.nextActionDate}
                      </p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
