import { KanbanSquare, Loader2, Plus, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AddColumnDialog } from "@/components/business/AddColumnDialog";
import { BusinessSpace } from "@/components/business/BusinessSpace";
import { KanbanView } from "@/components/business/KanbanView";
import { NewTableDialog } from "@/components/business/NewTableDialog";
import { RecordDialog } from "@/components/business/RecordDialog";
import { TableView } from "@/components/business/TableView";
import {
  isTableFull,
  RECORD_LIMIT,
  recordCountOf,
  recordsOf,
  todayIso,
  type BusinessRecord,
  type BusinessTable,
  type ColumnType,
  type RecordPatch,
} from "@/lib/business-hub";
import { useBusinessHub, useBusinessHubActions } from "@/lib/use-business-hub";
import { cn } from "@/lib/utils";

type ViewMode = "table" | "kanban";

/** The query parameter that opens the HUB on one table. */
export const HUB_TABLE_PARAM = "bang";

/**
 * Business HUB — the tables someone keeps for running their own work.
 *
 * Two views over exactly the same records, never two sets of data: Bảng is the grid you scan
 * and edit, Kanban is the same records stood up by status. Switching is a way of looking, not
 * a place you go, so nothing is saved or lost by moving between them.
 */
const BusinessHub = () => {
  const { tables, records, isPending, isError, error } = useBusinessHub();
  const actions = useBusinessHubActions();

  const [searchParams] = useSearchParams();
  // Avora Space's Planning corner links straight to a table with `?bang=<id>`.
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get(HUB_TABLE_PARAM));
  const [view, setView] = useState<ViewMode>("table");
  // "+ Bảng mới" in the journal and 1-1 threads arrives here with `?moi=1`.
  const [isNewTableOpen, setIsNewTableOpen] = useState<boolean>(() => searchParams.get("moi") === "1");
  const [isAddColumnOpen, setIsAddColumnOpen] = useState<boolean>(false);
  const [isRecordOpen, setIsRecordOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<BusinessRecord | null>(null);

  const today: string = useMemo(() => todayIso(), []);

  // Follows the tables rather than owning a copy of them: the first visit creates a table
  // asynchronously, and a table put away should not leave the screen pointing at nothing.
  const active: BusinessTable | null = useMemo(() => {
    if (tables.length === 0) return null;
    return tables.find((table) => table.id === activeId) ?? tables[0];
  }, [tables, activeId]);

  useEffect(() => {
    if (active !== null && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  const visibleRecords: BusinessRecord[] = useMemo(
    () => (active === null ? [] : recordsOf(records, active.id)),
    [records, active],
  );

  const knownStatuses: string[] = useMemo(
    () => [...new Set(visibleRecords.map((record) => record.status))],
    [visibleRecords],
  );

  const isFull: boolean = active !== null && isTableFull(records, active.id);

  const handleCreateTable = useCallback(
    async (name: string): Promise<void> => {
      const created = await actions.createTable(name);
      setActiveId(created.id);
      toast.success(`Đã tạo bảng "${created.name}".`);
    },
    [actions],
  );

  const handleAddColumn = useCallback(
    async (input: { label: string; type: ColumnType; options?: readonly string[] }): Promise<void> => {
      if (active === null) return;
      await actions.addColumn({ tableId: active.id, ...input });
      toast.success(`Đã thêm cột "${input.label}".`);
    },
    [actions, active],
  );

  const openNewRecord = useCallback((): void => {
    if (isFull) {
      toast.error(
        `Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} mục, hãy dọn bớt trước khi thêm.`,
      );
      return;
    }
    setEditing(null);
    setIsRecordOpen(true);
  }, [isFull]);

  const openRecord = useCallback((record: BusinessRecord): void => {
    setEditing(record);
    setIsRecordOpen(true);
  }, []);

  const handleSaveRecord = useCallback(
    async (patch: RecordPatch): Promise<void> => {
      if (active === null) return;

      if (editing !== null) {
        await actions.updateRecord(editing.id, patch);
        toast.success("Đã lưu.");
        return;
      }

      await actions.createRecord({
        tableId: active.id,
        title: patch.title ?? "",
        status: patch.status,
        priority: patch.priority,
        category: patch.category ?? null,
        nextActionDate: patch.nextActionDate ?? null,
        tags: patch.tags ?? [],
        notes: patch.notes ?? null,
        extensionFields: patch.extensionFields,
      });
      toast.success("Đã thêm mục mới.");
    },
    [actions, active, editing],
  );

  if (isPending) {
    return (
      <div className="paper flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang tải</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
          <p role="alert" className="text-[15px] text-destructive">
            {error?.message ?? "Không tải được Business HUB."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-6xl px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
              Business HUB
            </h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Những bảng bạn tự dựng để chạy công việc của mình
            </p>
          </div>
          <button
            type="button"
            onClick={openNewRecord}
            disabled={active === null}
            className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-50"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            Thêm mục
          </button>
        </header>

        <div className="mt-6">
          <BusinessSpace
            tables={tables}
            records={records}
            today={today}
            onOpenTable={setActiveId}
          />
        </div>

        {/* The tables, as a strip. "+" sits at the end of the row it adds to. */}
        <nav aria-label="Các bảng" className="mt-7 flex flex-wrap items-center gap-1.5">
          {tables.map((table) => (
            <button
              key={table.id}
              type="button"
              onClick={() => setActiveId(table.id)}
              aria-current={active?.id === table.id ? "page" : undefined}
              className={cn(
                "press rounded-md px-3.5 py-2 text-[14.5px] transition-colors",
                active?.id === table.id
                  ? "bg-accent/70 font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {table.name}
              <span className="tabular ml-2 text-[12.5px] text-muted-foreground">
                {recordCountOf(records, table.id)}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsNewTableOpen(true)}
            aria-label="Tạo bảng mới"
            className="press inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            <Plus className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
            Bảng mới
          </button>
        </nav>

        {active === null ? (
          <p className="mt-8 text-[15px] text-muted-foreground">
            Chưa có bảng nào. Tạo bảng đầu tiên để bắt đầu.
          </p>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div
                role="group"
                aria-label="Kiểu xem"
                className="inline-flex rounded-md border border-border p-0.5"
              >
                <button
                  type="button"
                  onClick={() => setView("table")}
                  aria-pressed={view === "table"}
                  className={cn(
                    "press inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[14px] font-medium transition-colors",
                    view === "table"
                      ? "bg-accent/70 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Table2 className="h-[16px] w-[16px]" strokeWidth={1.8} aria-hidden="true" />
                  Bảng
                </button>
                <button
                  type="button"
                  onClick={() => setView("kanban")}
                  aria-pressed={view === "kanban"}
                  className={cn(
                    "press inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[14px] font-medium transition-colors",
                    view === "kanban"
                      ? "bg-accent/70 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <KanbanSquare
                    className="h-[16px] w-[16px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  Kanban
                </button>
              </div>

              {isFull ? (
                <p role="status" className="text-[13.5px] text-destructive">
                  Bảng đã đầy {RECORD_LIMIT.toLocaleString("vi-VN")} mục, hãy dọn bớt trước khi
                  thêm.
                </p>
              ) : null}
            </div>

            {/* Rendered even when empty: the seven columns ARE what a new table is offering,
                and hiding them until the first record would open the HUB on a blank page. */}
            {view === "table" ? (
              <TableView
                records={visibleRecords}
                columns={active.columns}
                onOpenRecord={openRecord}
                onAddColumn={() => setIsAddColumnOpen(true)}
                today={today}
              />
            ) : (
              <KanbanView records={visibleRecords} onOpenRecord={openRecord} today={today} />
            )}
          </>
        )}
      </div>

      <NewTableDialog
        open={isNewTableOpen}
        onOpenChange={setIsNewTableOpen}
        onCreate={handleCreateTable}
        isWorking={actions.isWorking}
      />

      <AddColumnDialog
        open={isAddColumnOpen}
        onOpenChange={setIsAddColumnOpen}
        onAdd={handleAddColumn}
        isWorking={actions.isWorking}
      />

      <RecordDialog
        open={isRecordOpen}
        onOpenChange={setIsRecordOpen}
        columns={active?.columns ?? []}
        record={editing}
        knownStatuses={knownStatuses}
        onSave={handleSaveRecord}
        isWorking={actions.isWorking}
      />
    </div>
  );
};

export default BusinessHub;
