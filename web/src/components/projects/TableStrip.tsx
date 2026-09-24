import { ChevronRight, Plus, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { visibleTables } from "@/lib/business-hub";
import { useBusinessTables } from "@/lib/use-business-hub";
import { cn } from "@/lib/utils";

/**
 * The 📊 Bảng strip above the journal and 1-1 threads.
 *
 * Projects are group work now; what a person keeps for themselves or with one other person is a
 * table in Business HUB. The strip shows the viewer's own tables — they belong to the person,
 * not to this conversation — so it reads the same in every journal and 1-1 thread.
 */
export function TableStrip() {
  const { data } = useBusinessTables();
  const tables = useMemo(() => visibleTables(data ?? []), [data]);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <section aria-label="Bảng của bạn" className="border-b border-border bg-primary/[0.04] px-5 py-2 md:px-10">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          className="press flex min-h-9 w-full items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={2.2}
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", isOpen && "rotate-90")}
          />
          <span aria-hidden="true" className="text-[13px] leading-none">
            📊
          </span>
          <span className="text-[12.5px] font-semibold text-foreground">Bảng</span>
          <span className="tabular text-[11.5px] text-muted-foreground">{tables.length}</span>
          {!isOpen ? (
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {tables.length === 0 ? "Chạm để mở Business HUB" : tables.map((table) => table.name).join(" · ")}
            </span>
          ) : null}
        </button>

        {isOpen ? (
          <ul className="mt-1.5 space-y-0.5 pb-0.5">
            {tables.map((table) => (
              <li key={table.id}>
                <Link
                  to={`/business-hub?bang=${encodeURIComponent(table.id)}`}
                  className="press flex min-h-10 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
                >
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{table.name}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/business-hub?moi=1"
                className="press flex min-h-10 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden="true" />
                <span className="text-[13px] text-muted-foreground">Bảng mới</span>
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}
