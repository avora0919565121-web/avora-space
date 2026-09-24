import { useMemo } from "react";

import {
  attentionSentence,
  hubAttention,
  recordCountOf,
  type ThinkRecord,
  type ThinkTable,
  type HubAttention,
} from "@/lib/think-hub";

type ThinkSpaceProps = {
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  today: string;
  /** Opening a table from the overview — the overview itself only ever reads. */
  onOpenTable: (tableId: string) => void;
};

/** What each number counts, in the order the strip reads. */
const WINDOW_LABELS: readonly { key: "overdue" | "today" | "week"; label: string }[] = [
  { key: "overdue", label: "Quá hạn" },
  { key: "today", label: "Hôm nay" },
  { key: "week", label: "Trong tuần" },
] as const;

/**
 * Think Space — the fixed overview of the whole HUB.
 *
 * Read-only on purpose. It answers "what is asking for me across everything I keep" and then
 * hands over to the table that holds the answer; a place that both summarises and edits ends
 * up being a worse version of both.
 *
 * The three windows are the same three Tài chính uses for money that is due — late, today,
 * this week — so a person reads the same shape whichever part of AVORA is talking.
 */
export function ThinkSpace({ tables, records, today, onOpenTable }: ThinkSpaceProps) {
  const attention: HubAttention = useMemo(() => hubAttention(records, today), [records, today]);

  return (
    <section aria-label="Tổng quan kế hoạch" className="rounded-xl border border-border bg-card p-5">
      <header>
        <h2 className="text-[17px] font-semibold tracking-tight text-foreground">Tổng quan</h2>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          {attentionSentence(attention, tables.length)}
        </p>
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {WINDOW_LABELS.map((window) => (
          <div key={window.key} className="rounded-lg border border-border bg-background px-3 py-3">
            <dt className="text-[12.5px] text-muted-foreground">{window.label}</dt>
            <dd className="tabular mt-0.5 text-[22px] font-semibold text-foreground">
              {attention[window.key]}
            </dd>
          </div>
        ))}
      </dl>

      {tables.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {tables.map((table) => (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => onOpenTable(table.id)}
                className="press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/35"
              >
                <span className="truncate text-[14.5px] font-medium text-foreground">
                  {table.name}
                </span>
                <span className="tabular shrink-0 text-[13px] text-muted-foreground">
                  {recordCountOf(records, table.id)} mục
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
