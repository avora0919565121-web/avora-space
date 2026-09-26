import { ChevronRight, KanbanSquare, Loader2, Network, Pencil, Plus, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AddColumnDialog } from "@/components/think-hub/AddColumnDialog";
import { KanbanView } from "@/components/think-hub/KanbanView";
import { MindmapView } from "@/components/think-hub/MindmapView";
import { QuickTaskDialog } from "@/components/think-hub/QuickTaskDialog";
import { NewTableDialog, type TablePlace } from "@/components/think-hub/NewTableDialog";
import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RenameColumnDialog } from "@/components/think-hub/RenameColumnDialog";
import { TableView } from "@/components/think-hub/TableView";
import { ThinkSpace } from "@/components/think-hub/ThinkSpace";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import {
  canGrowSubTable,
  isTableFull,
  RECORD_LIMIT,
  recordCountOf,
  recordsOf,
  rootTables,
  scopeOfTable,
  subTablesOf,
  tableAncestry,
  tablesInScope,
  todayIso,
  type ColumnDef,
  type ColumnType,
  type RecordPatch,
  type ThinkRecord,
  type ThinkTable,
} from "@/lib/think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useProjects, useTaskProjectLinks } from "@/lib/use-projects";
import { useRecordTaskLinks, useThinkHub, useThinkHubActions } from "@/lib/use-think-hub";
import { HubTitle } from "@/components/nav/HubTitle";
import { cn } from "@/lib/utils";

type ViewMode = "table" | "kanban" | "mindmap";

/** The query parameter that opens Kế hoạch on one table. */
export const HUB_TABLE_PARAM = "bang";

/**
 * Kế hoạch (Think Hub) — the tables people keep to think their work through.
 *
 * Three views over the same records: Bảng is the grid, Kanban the same records stood up by status,
 * Cây the same records as a folder tree with their sub-tables and task counts.
 * The strip lists root tables only; a sub-table is reached from the Hạng mục it grew from, and a
 * breadcrumb above it leads back up.
 */
const ThinkHub = () => {
  const { user } = useAuth();
  const { tables, records, isPending, isError, error } = useThinkHub();
  const actions = useThinkHubActions();
  const conversationsQuery = useConversations();
  const projectsQuery = useProjects();
  const projectTaskLinks = useTaskProjectLinks();
  const recordTaskLinksQuery = useRecordTaskLinks();

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get(HUB_TABLE_PARAM));
  const [view, setView] = useState<ViewMode>("table");
  // "+ Bảng mới" from a thread arrives with `?moi=1`.
  const [isNewTableOpen, setIsNewTableOpen] = useState<boolean>(() => searchParams.get("moi") === "1");
  const [isAddColumnOpen, setIsAddColumnOpen] = useState<boolean>(false);
  const [renaming, setRenaming] = useState<ColumnDef | null>(null);
  const [isRecordOpen, setIsRecordOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ThinkRecord | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>("");
  const [isEditingPurpose, setIsEditingPurpose] = useState<boolean>(false);
  const [purposeDraft, setPurposeDraft] = useState<string>("");
  const [quickTaskRecord, setQuickTaskRecord] = useState<ThinkRecord | null>(null);

  const today: string = useMemo(() => todayIso(), []);
  const roots: ThinkTable[] = useMemo(() => rootTables(tables), [tables]);

  const conversationById = useMemo(
    () => new Map((conversationsQuery.data ?? []).map((item) => [item.conversationId, item] as const)),
    [conversationsQuery.data],
  );
  const projectById = useMemo(
    () => new Map((projectsQuery.data ?? []).map((project) => [project.id, project] as const)),
    [projectsQuery.data],
  );

  // Follows the tables rather than owning a copy: the first visit creates a table asynchronously,
  // and a table put away should not leave the screen pointing at nothing.
  const active: ThinkTable | null = useMemo(() => {
    if (tables.length === 0) return null;
    return tables.find((table) => table.id === activeId) ?? roots[0] ?? tables[0];
  }, [tables, roots, activeId]);

  useEffect(() => {
    if (active !== null && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  const openTable = useCallback(
    (tableId: string): void => {
      setActiveId(tableId);
      setIsEditingPurpose(false);
      setSearchParams({ [HUB_TABLE_PARAM]: tableId }, { replace: true });
    },
    [setSearchParams],
  );

  const ancestry = useMemo(
    () => (active === null ? [] : tableAncestry(tables, records, active.id)),
    [tables, records, active],
  );
  const activeRootId: string | undefined = ancestry[0]?.table.id ?? active?.id;

  const visibleRecords: ThinkRecord[] = useMemo(
    () => (active === null ? [] : recordsOf(records, active.id)),
    [records, active],
  );

  // How many tasks hang under each Hạng mục — project links and everywhere-else links together.
  const taskCountByRecord: Map<string, number> = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of projectTaskLinks.values()) {
      if (link.recordId !== null) counts.set(link.recordId, (counts.get(link.recordId) ?? 0) + 1);
    }
    for (const link of recordTaskLinksQuery.data ?? []) {
      counts.set(link.recordId, (counts.get(link.recordId) ?? 0) + 1);
    }
    return counts;
  }, [projectTaskLinks, recordTaskLinksQuery.data]);

  const knownStatuses: string[] = useMemo(
    () => [...new Set(visibleRecords.map((record) => record.status))],
    [visibleRecords],
  );

  const tableChoices: ThinkTable[] = useMemo(
    () => (active === null ? [] : tablesInScope(tables, scopeOfTable(active))),
    [tables, active],
  );

  const places: TablePlace[] = useMemo(() => {
    const list: TablePlace[] = [{ conversationId: null, label: "Riêng tôi (Nhật ký)" }];
    for (const item of conversationsQuery.data ?? []) {
      if (item.kind === "direct") list.push({ conversationId: item.conversationId, label: `1-1 với ${conversationTitle(item)}` });
    }
    for (const item of conversationsQuery.data ?? []) {
      if (item.kind === "group") list.push({ conversationId: item.conversationId, label: `Nhóm ${conversationTitle(item)}` });
    }
    return list;
  }, [conversationsQuery.data]);

  const isOwner: boolean = active !== null && active.ownerUserId === user?.id;
  const targetTable: ThinkTable | null = tables.find((table) => table.id === targetTableId) ?? active;
  const isFull: boolean = targetTable !== null && isTableFull(records, targetTable.id);
  const activeProject = active?.projectId != null ? projectById.get(active.projectId) : undefined;
  const isProjectRoot = active !== null && active.projectId !== null && active.parentRecordId === null;
  // A closed project's tables stay readable and stop taking changes; the server enforces the same.
  const isReadOnly: boolean = activeProject !== undefined && activeProject.status !== "active";

  const scopeLabel = useCallback(
    (table: ThinkTable): string => {
      if (table.projectId !== null) return `Dự án ${projectById.get(table.projectId)?.title ?? ""}`.trim();
      if (table.conversationId !== null) {
        const conversation = conversationById.get(table.conversationId);
        if (conversation === undefined) return "Cuộc trò chuyện";
        return conversation.kind === "group" ? `Nhóm ${conversationTitle(conversation)}` : `1-1 với ${conversationTitle(conversation)}`;
      }
      return "Riêng tôi";
    },
    [projectById, conversationById],
  );

  const handleCreateTable = useCallback(
    async (input: { name: string; purpose: string; conversationId: string | null }): Promise<void> => {
      const created = await actions.createTable(input);
      openTable(created.id);
      toast.success(`Đã tạo bảng "${created.name}".`);
    },
    [actions, openTable],
  );

  const handleAddColumn = useCallback(
    async (input: { label: string; type: ColumnType; options?: readonly string[] }): Promise<void> => {
      if (active === null) return;
      await actions.addColumn({ tableId: active.id, ...input });
      toast.success(`Đã thêm cột "${input.label}".`);
    },
    [actions, active],
  );

  const handleRenameColumn = useCallback(
    async (column: ColumnDef, label: string): Promise<void> => {
      if (active === null) return;
      await actions.renameColumn({ tableId: active.id, columnId: column.id, label });
      toast.success("Đã đổi tên cột.");
    },
    [actions, active],
  );

  const handleResizeColumn = useCallback(
    (column: ColumnDef, width: number | null): void => {
      if (active === null) return;
      actions.setColumnWidth({ tableId: active.id, columnId: column.id, width }).catch((caught: unknown) => {
        toast.error(caught instanceof Error ? caught.message : "Không lưu được độ rộng cột.");
      });
    },
    [actions, active],
  );

  const handleToggleColumnHidden = useCallback(
    (column: ColumnDef, hidden: boolean): void => {
      if (active === null) return;
      actions.setColumnHidden({ tableId: active.id, columnId: column.id, hidden }).then(
        () => toast.success(hidden ? `Đã ẩn cột "${column.label}".` : `Đã hiện lại cột "${column.label}".`),
        (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được cột."),
      );
    },
    [actions, active],
  );

  const openNewRecord = useCallback((): void => {
    if (active === null) return;
    if (isTableFull(records, active.id)) {
      toast.error(`Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục, hãy dọn bớt trước khi thêm.`);
      return;
    }
    setTargetTableId(active.id);
    setEditing(null);
    setIsRecordOpen(true);
  }, [active, records]);

  const openRecord = useCallback((record: ThinkRecord): void => {
    setTargetTableId(record.tableId);
    setEditing(record);
    setIsRecordOpen(true);
  }, []);

  const handleSaveRecord = useCallback(
    async (patch: RecordPatch): Promise<void> => {
      if (editing !== null) {
        await actions.updateRecord(editing.id, patch);
        toast.success("Đã lưu.");
        return;
      }
      if (targetTable === null) return;
      if (isTableFull(records, targetTable.id)) {
        throw new Error(`Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục, hãy dọn bớt trước khi thêm.`);
      }

      await actions.createRecord({
        tableId: targetTable.id,
        scope: scopeOfTable(targetTable),
        title: patch.title ?? "",
        status: patch.status,
        priority: patch.priority,
        category: patch.category ?? null,
        nextActionDate: patch.nextActionDate ?? null,
        remindAt: patch.remindAt ?? null,
        tags: patch.tags ?? [],
        notes: patch.notes ?? null,
        extensionFields: patch.extensionFields,
      });
      toast.success("Đã thêm Hạng mục.");
    },
    [actions, editing, targetTable, records],
  );

  const handleCreateSubTable = useCallback(
    async (input: { name: string; purpose: string }): Promise<void> => {
      if (editing === null) return;
      const created = await actions.createSubTable({ recordId: editing.id, name: input.name, purpose: input.purpose });
      setIsRecordOpen(false);
      openTable(created.id);
      toast.success(`Đã tạo bảng con "${created.name}".`);
    },
    [actions, editing, openTable],
  );

  const savePurpose = useCallback(async (): Promise<void> => {
    if (active === null) return;
    try {
      await actions.setPurpose(active.id, purposeDraft);
      setIsEditingPurpose(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Không lưu được mục đích.");
    }
  }, [actions, active, purposeDraft]);

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
            {error?.message ?? "Không tải được Kế hoạch."}
          </p>
        </div>
      </div>
    );
  }

  const editingTable: ThinkTable | undefined =
    editing === null ? undefined : tables.find((table) => table.id === editing.tableId);

  return (
    <div className="paper flex min-h-0 flex-1 flex-col">
      <HubTitle
        title="Kế hoạch"
        className="max-w-6xl"
        action={
          <button
              type="button"
              onClick={openNewRecord}
              disabled={active === null || isReadOnly}
              title={isReadOnly ? "Dự án đã đóng — bảng chỉ còn để đọc" : undefined}
              className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[14.5px] md:px-5 md:text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-50"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              Thêm Hạng mục
            </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 md:px-10">

        <div>
          <ThinkSpace tables={roots} records={records} today={today} onOpenTable={openTable} />
        </div>

        <nav aria-label="Các bảng" className="mt-7 flex flex-wrap items-center gap-1.5">
          {roots.map((table) => (
            <button
              key={table.id}
              type="button"
              onClick={() => openTable(table.id)}
              aria-current={activeRootId === table.id ? "page" : undefined}
              title={scopeLabel(table)}
              className={cn(
                "press rounded-md px-3.5 py-2 text-[14.5px] transition-colors",
                activeRootId === table.id
                  ? "bg-accent/70 font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {table.name}
              <span className="tabular ml-2 text-[12.5px] text-muted-foreground">{recordCountOf(records, table.id)}</span>
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
          <p className="mt-8 text-[15px] text-muted-foreground">Chưa có bảng nào. Tạo bảng đầu tiên để bắt đầu.</p>
        ) : (
          <>
            {ancestry.length > 1 ? (
              <nav aria-label="Vị trí bảng" className="mt-5 flex flex-wrap items-center gap-1 text-[13px]">
                {ancestry.map((step, index) => (
                  <span key={step.table.id} className="inline-flex items-center gap-1">
                    {index > 0 ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                    ) : null}
                    {index === ancestry.length - 1 ? (
                      <span className="font-semibold text-foreground">{step.table.name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openTable(step.table.id)}
                        className="press rounded px-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {step.table.name}
                        {step.viaRecord !== null ? <span className="font-normal"> · {step.viaRecord.title}</span> : null}
                      </button>
                    )}
                  </span>
                ))}
                <span className="ml-1 text-muted-foreground">(tầng {active.depth}/3)</span>
              </nav>
            ) : null}

            <section aria-label="Mục đích của bảng" className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[12px] font-medium text-muted-foreground">{scopeLabel(active)}</p>
              {isProjectRoot ? (
                <dl className="mt-1.5 space-y-1.5 text-[13.5px]">
                  <div>
                    <dt className="inline font-medium text-muted-foreground">Kim chỉ nam: </dt>
                    <dd className="inline text-foreground">{activeProject?.valueOrientation ?? "…"}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-muted-foreground">Mục tiêu: </dt>
                    <dd className="inline text-foreground">{activeProject?.objective ?? "…"}</dd>
                  </div>
                </dl>
              ) : isEditingPurpose ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    value={purposeDraft}
                    autoFocus
                    maxLength={2000}
                    aria-label="Mục đích của bảng"
                    onChange={(event) => setPurposeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void savePurpose();
                      if (event.key === "Escape") setIsEditingPurpose(false);
                    }}
                    className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void savePurpose()}
                    className="press rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground"
                  >
                    Lưu
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-start gap-2">
                  <p className={cn("min-w-0 flex-1 text-[14px]", active.purpose === null ? "text-muted-foreground" : "text-foreground")}>
                    {active.purpose ?? "Chưa ghi mục đích."}
                  </p>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPurposeDraft(active.purpose ?? "");
                        setIsEditingPurpose(true);
                      }}
                      aria-label="Sửa mục đích"
                      title="Sửa mục đích"
                      className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Kiểu xem" className="inline-flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setView("table")}
                  aria-pressed={view === "table"}
                  className={cn(
                    "press inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[14px] font-medium transition-colors",
                    view === "table" ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:text-foreground",
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
                    view === "kanban" ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <KanbanSquare className="h-[16px] w-[16px]" strokeWidth={1.8} aria-hidden="true" />
                  Theo trạng thái
                </button>
                <button
                  type="button"
                  onClick={() => setView("mindmap")}
                  aria-pressed={view === "mindmap"}
                  className={cn(
                    "press inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[14px] font-medium transition-colors",
                    view === "mindmap" ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Network className="h-[16px] w-[16px]" strokeWidth={1.8} aria-hidden="true" />
                  Cây
                </button>
              </div>

              {isTableFull(records, active.id) ? (
                <p role="status" className="text-[13.5px] text-destructive">
                  Bảng đã đầy {RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục, hãy dọn bớt trước khi thêm.
                </p>
              ) : null}
            </div>

            {/* Rendered even when empty: the columns ARE what a new table is offering. */}
            {view === "table" ? (
              <TableView
                records={visibleRecords}
                columns={active.columns}
                onOpenRecord={openRecord}
                onAddColumn={isOwner && !isReadOnly ? () => setIsAddColumnOpen(true) : undefined}
                onRenameColumn={isOwner && !isReadOnly ? setRenaming : undefined}
                onResizeColumn={isOwner && !isReadOnly ? handleResizeColumn : undefined}
                onToggleColumnHidden={isOwner && !isReadOnly ? handleToggleColumnHidden : undefined}
                onQuickTask={isReadOnly ? undefined : setQuickTaskRecord}
                taskCountByRecord={taskCountByRecord}
                today={today}
              />
            ) : (
              view === "kanban" ? (
                <KanbanView records={visibleRecords} onOpenRecord={openRecord} today={today} />
              ) : (
                <MindmapView
                  table={active}
                  tables={tables}
                  records={records}
                  taskCountByRecord={taskCountByRecord}
                  onOpenRecord={openRecord}
                  onOpenTable={openTable}
                />
              )
            )}
          </>
        )}
      </div>
      </div>

      <NewTableDialog
        open={isNewTableOpen}
        onOpenChange={setIsNewTableOpen}
        onCreate={handleCreateTable}
        isWorking={actions.isWorking}
        places={places}
        initialConversationId={searchParams.get("noi")}
      />

      <AddColumnDialog
        open={isAddColumnOpen}
        onOpenChange={setIsAddColumnOpen}
        onAdd={handleAddColumn}
        isWorking={actions.isWorking}
      />

      <QuickTaskDialog
        record={quickTaskRecord}
        table={quickTaskRecord === null ? undefined : tables.find((table) => table.id === quickTaskRecord.tableId)}
        project={(() => {
          const owning = quickTaskRecord === null ? undefined : tables.find((table) => table.id === quickTaskRecord.tableId);
          return owning?.projectId != null ? projectById.get(owning.projectId) : undefined;
        })()}
        conversationKind={(() => {
          const owning = quickTaskRecord === null ? undefined : tables.find((table) => table.id === quickTaskRecord.tableId);
          if (owning === undefined || owning.conversationId === null) return null;
          const kind = conversationById.get(owning.conversationId)?.kind;
          return kind === "group" ? "group" : kind === "direct" ? "direct" : null;
        })()}
        conversationName={(() => {
          const owning = quickTaskRecord === null ? undefined : tables.find((table) => table.id === quickTaskRecord.tableId);
          if (owning === undefined) return "";
          const conversationId =
            owning.projectId !== null ? projectById.get(owning.projectId)?.conversationId : owning.conversationId;
          const conversation = conversationId == null ? undefined : conversationById.get(conversationId);
          return conversation === undefined ? (owning.projectId !== null ? projectById.get(owning.projectId)?.title ?? "" : "") : conversationTitle(conversation);
        })()}
        onOpenChange={(open) => {
          if (!open) setQuickTaskRecord(null);
        }}
      />

      <RenameColumnDialog
        column={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onRename={handleRenameColumn}
        isWorking={actions.isWorking}
      />

      <RecordDialog
        open={isRecordOpen}
        onOpenChange={setIsRecordOpen}
        columns={(editing === null ? targetTable : editingTable)?.columns ?? []}
        record={editing}
        knownStatuses={knownStatuses}
        onSave={handleSaveRecord}
        isWorking={actions.isWorking}
        tableChoices={tableChoices}
        selectedTableId={targetTable?.id}
        onSelectTable={setTargetTableId}
        subTables={editing === null ? undefined : subTablesOf(tables, editing.id)}
        canGrowSubTable={editingTable !== undefined && canGrowSubTable(editingTable) && !isReadOnly}
        onQuickTask={
          editing === null || isReadOnly
            ? undefined
            : () => {
                setIsRecordOpen(false);
                setQuickTaskRecord(editing);
              }
        }
        onCreateSubTable={handleCreateSubTable}
        onOpenTable={(tableId) => {
          setIsRecordOpen(false);
          openTable(tableId);
        }}
      />
    </div>
  );
};

export default ThinkHub;
