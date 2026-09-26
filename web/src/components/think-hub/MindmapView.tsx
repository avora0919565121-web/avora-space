import { ChevronRight, ListChecks, Table2 } from "lucide-react";
import { useCallback, useState, type ReactElement } from "react";

import { recordsOf, statusLabel, subTablesOf, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

type MindmapViewProps = {
  table: ThinkTable;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  taskCountByRecord: ReadonlyMap<string, number>;
  onOpenRecord: (record: ThinkRecord) => void;
  onOpenTable: (tableId: string) => void;
};

/**
 * Mindmap (OPEN-008): the same Hạng mục as the grid, drawn as a folder tree.
 *
 * Each node is one Hạng mục with its task count; unfolding it shows the sub-table grown from it
 * and that table's own Hạng mục, down to the third level. Nothing new is stored — the tree is
 * read straight from `parent_record_id` and the task links. Tapping a title opens the Hạng mục;
 * tapping a sub-table's name opens that table.
 */
export function MindmapView({ table, tables, records, taskCountByRecord, onOpenRecord, onOpenTable }: MindmapViewProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((recordId: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const renderTable = (current: ThinkTable, level: number): ReactElement => {
    const items = recordsOf(records, current.id).reverse();
    if (items.length === 0) {
      return (
        <p className="py-2 text-[13px] text-muted-foreground" style={{ paddingLeft: `${level * 22 + 30}px` }}>
          Chưa có Hạng mục nào.
          {level === 0 ? <span className="ml-1 text-muted-foreground/80">Hạng mục là một dòng trong Bảng này.</span> : null}
        </p>
      );
    }
    return (
      <ul role={level === 0 ? "tree" : "group"} aria-label={level === 0 ? `Cây của bảng ${current.name}` : undefined}>
        {items.map((record) => {
          const sub = subTablesOf(tables, record.id)[0];
          const count = taskCountByRecord.get(record.id) ?? 0;
          const expandable = sub !== undefined;
          const isOpen = open.has(record.id);
          return (
            <li key={record.id} role="treeitem" aria-expanded={expandable ? isOpen : undefined}>
              <div
                className="flex min-h-11 items-center gap-1.5 rounded-lg pr-2 transition-colors hover:bg-accent/30"
                style={{ paddingLeft: `${level * 22}px` }}
              >
                <button
                  type="button"
                  onClick={() => toggle(record.id)}
                  disabled={!expandable}
                  aria-label={expandable ? (isOpen ? `Thu gọn ${record.title}` : `Mở ${record.title}`) : undefined}
                  className="press flex h-9 w-7 shrink-0 items-center justify-center rounded text-muted-foreground disabled:opacity-0"
                >
                  <ChevronRight className={cn("h-4 w-4", isOpen && "rotate-90")} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenRecord(record)}
                  className="press min-w-0 flex-1 truncate py-2 text-left text-[14.5px] font-medium text-foreground"
                >
                  {record.title}
                </button>
                <span className="shrink-0 rounded-full bg-accent/60 px-2 py-0.5 text-[11.5px] font-medium text-accent-foreground">
                  {statusLabel(record.status)}
                </span>
                {count > 0 ? (
                  <span
                    className="tabular inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground"
                    title={`${count} tác vụ gắn với Hạng mục này`}
                  >
                    <ListChecks className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {count}
                  </span>
                ) : null}
              </div>

              {expandable && isOpen ? (
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenTable(sub.id)}
                    className="press flex min-h-9 items-center gap-1.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    style={{ paddingLeft: `${(level + 1) * 22 + 8}px` }}
                  >
                    <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    Bảng con: {sub.name}
                  </button>
                  {renderTable(sub, level + 1)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return <div className="mt-5 rounded-xl border border-border bg-card px-3 py-3">{renderTable(table, 0)}</div>;
}
