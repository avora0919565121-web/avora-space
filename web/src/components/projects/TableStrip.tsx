import { ChevronRight, Plus, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { rootTables } from "@/lib/think-hub";
import { useThinkTables } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

/**
 * The 📊 Bảng strip above the journal and 1-1 threads.
 *
 * Shows only the tables that belong here: in the journal, the viewer's personal tables; in a
 * 1-1, the tables shared with that one person. "Bảng mới" opens Kế hoạch with this place
 * already chosen, so a table made from a thread lands in that thread's scope.
 */
export function TableStrip({ conversationId }: { conversationId: string | null }) {
  const { user } = useAuth();
  const { data } = useThinkTables();
  const tables = useMemo(
    () =>
      rootTables(data ?? []).filter((table) =>
        table.projectId !== null
          ? false
          : conversationId === null
            ? table.conversationId === null && table.ownerUserId === user?.id
            : table.conversationId === conversationId,
      ),
    [data, conversationId, user?.id],
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const newLink = conversationId === null ? "/ke-hoach?moi=1" : `/ke-hoach?moi=1&noi=${encodeURIComponent(conversationId)}`;

  return (
    <section aria-label="Bảng ở đây" className="border-b border-border bg-primary/[0.04] px-5 py-2 md:px-10">
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
              {tables.length === 0
                ? conversationId === null
                  ? "Chưa có bảng riêng — chạm để dựng"
                  : "Chưa có bảng chung với người này — chạm để dựng"
                : tables.map((table) => table.name).join(" · ")}
            </span>
          ) : null}
        </button>

        {isOpen ? (
          <ul className="mt-1.5 space-y-0.5 pb-0.5">
            {tables.map((table) => (
              <li key={table.id}>
                <Link
                  to={`/ke-hoach?bang=${encodeURIComponent(table.id)}`}
                  className="press flex min-h-10 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
                >
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{table.name}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                to={newLink}
                className="press flex min-h-10 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden="true" />
                <span className="text-[13px] text-muted-foreground">
                  {conversationId === null ? "Bảng riêng mới" : "Bảng chung mới"}
                </span>
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}
