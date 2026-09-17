import { useMemo } from "react";

import { groupByStatus, priorityLabel, type BusinessRecord } from "@/lib/business-hub";
import { cn } from "@/lib/utils";

type KanbanViewProps = {
  records: readonly BusinessRecord[];
  onOpenRecord: (record: BusinessRecord) => void;
  today: string;
};

/**
 * The board: one column per status, grouped by the Trạng thái column and nothing else.
 *
 * Not configurable in v1, deliberately. A board that can group by any column is a second set
 * of decisions (what happens to records with no value, what the column order is, whether the
 * grouping is remembered per table) and the one grouping people actually reach for is status.
 */
export function KanbanView({ records, onOpenRecord, today }: KanbanViewProps) {
  const columns = useMemo(() => groupByStatus(records), [records]);

  return (
    <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <section
          key={column.status}
          aria-label={column.label}
          className="flex w-[264px] shrink-0 flex-col rounded-xl border border-border bg-card"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="text-[14px] font-semibold text-foreground">{column.label}</h3>
            <span className="tabular rounded-full bg-accent/60 px-2 py-0.5 text-[12px] font-medium text-accent-foreground">
              {column.records.length}
            </span>
          </header>

          <div className="flex flex-col gap-2 p-3">
            {column.records.length === 0 ? (
              <p className="px-1 py-4 text-center text-[13px] text-muted-foreground">
                Chưa có mục nào
              </p>
            ) : (
              column.records.map((record) => {
                const isOverdue: boolean =
                  record.nextActionDate !== null && record.nextActionDate < today;
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onOpenRecord(record)}
                    className="press rounded-lg border border-border bg-background px-3.5 py-3 text-left transition-colors hover:bg-accent/30"
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
