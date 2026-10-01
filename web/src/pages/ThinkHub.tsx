import {
  ChevronRight,
  KanbanSquare,
  Library,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Star,
  Table2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AddColumnDialog } from "@/components/think-hub/AddColumnDialog";
import { KanbanView } from "@/components/think-hub/KanbanView";
import { MindmapView } from "@/components/think-hub/MindmapView";
import { QuickTaskDialog } from "@/components/think-hub/QuickTaskDialog";
import { NewTableDialog, type TablePlace } from "@/components/think-hub/NewTableDialog";
import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RenameColumnDialog } from "@/components/think-hub/RenameColumnDialog";
import { TableView } from "@/components/think-hub/TableView";
import { HubShelf } from "@/components/think-hub/HubShelf";
import { ReviewPrompt } from "@/components/review/ReviewSheet";
import { useReview } from "@/lib/use-review";
import { TemplateGallery } from "@/components/think-hub/TemplateGallery";
import {
  ApplyTemplateRow,
  DeleteTableDialog,
  HubTrashDialog,
  MoveRecordDialog,
  ProposeDialog,
  SaveTemplateDialog,
} from "@/components/think-hub/TableActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  arrangeShelf,
  drawerOfTable,
  isArchivedTree,
  readLastTable,
  reminderTiles,
  rememberLastTable,
  type Drawer,
  type ProposalAction,
  type ProposalTarget,
} from "@/lib/think-hub-shelf";
import { useProposals, useShelfActions, useStars, useTemplates } from "@/lib/use-think-hub-shelf";
import { useThinkTables } from "@/lib/use-think-hub";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import {
  canGrowSubTable,
  HUB_RECORD_PARAM,
  isTableFull,
  RECORD_LIMIT,
  recordCountOf,
  recordsOf,
  rootTables,
  scopeOfTable,
  subTablesOf,
  tableAncestry,
  tablesInScope,
  thinkHubKeys,
  todayIso,
  type ColumnDef,
  type ColumnType,
  type RecordPatch,
  type ThinkRecord,
  type ThinkTable,
} from "@/lib/think-hub";
import { tablePlaces } from "@/lib/table-places";
import { useConversations } from "@/lib/use-conversations";
import { useProjects, useTaskProjectLinks } from "@/lib/use-projects";
import { useRecordTaskLinks, useThinkHub, useThinkHubActions } from "@/lib/use-think-hub";
import { AvoraSearchButton } from "@/components/search/AvoraSearch";
import { HubTitle } from "@/components/nav/HubTitle";
import { ReturnChip } from "@/components/nav/ReturnChip";
import { carryReturn, hereFrom, readReturn, withReturn } from "@/lib/return-to";
import { taskLink } from "@/lib/task-scope";
import type { TaskItem } from "@/lib/tasks";
import { useTasks } from "@/lib/use-tasks";
import { spotlight } from "@/lib/spotlight";
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
  const review = useReview();
  const actions = useThinkHubActions();
  const conversationsQuery = useConversations();
  const projectsQuery = useProjects();
  const projectTaskLinks = useTaskProjectLinks();
  const recordTaskLinksQuery = useRecordTaskLinks();
  const tasksQuery = useTasks();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  // C3 ③: the URL wins, then the table last opened on this device.
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get(HUB_TABLE_PARAM) ?? readLastTable(user?.id));
  const [view, setView] = useState<ViewMode>("table");
  const viewChosenRef = useRef<string | null>(null);
  const isFullscreen: boolean = searchParams.get("toan-man") === "1";
  const shelfActions = useShelfActions();
  const starsQuery = useStars();
  const stars: Set<string> = useMemo(() => starsQuery.data ?? new Set<string>(), [starsQuery.data]);
  const proposalsQuery = useProposals();
  const templatesQuery = useTemplates();
  const allTablesQuery = useThinkTables();
  const [isTrashOpen, setIsTrashOpen] = useState<boolean>(false);
  const [onlyStarred, setOnlyStarred] = useState<boolean>(false);
  const [proposeTarget, setProposeTarget] = useState<{ action: ProposalAction; targetType: ProposalTarget; targetId: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ThinkTable | null>(null);
  const [saveTemplateTarget, setSaveTemplateTarget] = useState<ThinkTable | null>(null);
  const [moveRequest, setMoveRequest] = useState<{ record: ThinkRecord; mode: "move" | "copy" } | null>(null);
  const [galleryConversationId, setGalleryConversationId] = useState<string | null>(null);
  // "+ Bảng mới" from a thread arrives with `?moi=1`.
  const [isNewTableOpen, setIsNewTableOpen] = useState<boolean>(() => searchParams.get("moi") === "1");
  // Where "Bảng mới" was pressed (`?noi=`), kept after the address is cleaned so a reload never reopens the form.
  const [originConversationId] = useState<string | null>(() => searchParams.get("noi"));
  const createdTableRef = useRef<boolean>(false);

  /*
   * `moi`/`noi` are one-shot instructions: once the form is open they leave the address
   * (AVORA-39 / C1), so reloading or coming Back does not pop an empty form again.
   */
  useEffect(() => {
    if (searchParams.get("moi") === null && searchParams.get("noi") === null) return;
    const next = new URLSearchParams(searchParams);
    next.delete("moi");
    next.delete("noi");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [isAddColumnOpen, setIsAddColumnOpen] = useState<boolean>(false);
  const [renaming, setRenaming] = useState<ColumnDef | null>(null);
  const [isRecordOpen, setIsRecordOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ThinkRecord | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>("");
  const [isEditingPurpose, setIsEditingPurpose] = useState<boolean>(false);
  const [purposeDraft, setPurposeDraft] = useState<string>("");
  // AVORA-53 · 5.1: the table's own name, edited where it is read.
  const [isRenamingTable, setIsRenamingTable] = useState<boolean>(false);
  const [nameDraft, setNameDraft] = useState<string>("");
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
    const shelfRoots = roots.filter((table) => table.kind !== "bookshelf");
    return (
      tables.find((table) => table.id === activeId) ??
      shelfRoots.find((table) => table.conversationId === null && table.projectId === null) ??
      shelfRoots[0] ??
      tables[0]
    );
  }, [tables, roots, activeId]);

  /*
   * AVORA-53 · 3.1 / 3.2 — `?bang=` is followed every time it changes (search result, ReturnChip),
   * and a table that is gone or out of reach says so and is cleaned from the address instead of
   * quietly opening another one.
   */
  const requestedTableId: string | null = searchParams.get(HUB_TABLE_PARAM);
  useEffect(() => {
    if (requestedTableId === null || isPending) return;
    if (tables.some((table) => table.id === requestedTableId)) {
      if (requestedTableId !== activeId) setActiveId(requestedTableId);
      return;
    }
    if (tables.length === 0) return;
    toast("Không mở được Bảng này", { description: "Bảng đã bị xoá hoặc bạn không còn quyền xem." });
    const next = new URLSearchParams(searchParams);
    next.delete(HUB_TABLE_PARAM);
    setSearchParams(next, { replace: true });
    if (activeId === requestedTableId) setActiveId(readLastTable(user?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the requested table or the list changes
  }, [requestedTableId, isPending, tables]);

  useEffect(() => {
    if (active !== null && active.id !== activeId) setActiveId(active.id);
    if (active !== null) rememberLastTable(user?.id, active.id);
  }, [active, activeId, user?.id]);

  // A table opens in its template's view the first time it is shown (C1 default_view).
  useEffect(() => {
    if (active === null || viewChosenRef.current === active.id) return;
    viewChosenRef.current = active.id;
    setView(active.defaultView === "kanban" ? "kanban" : active.defaultView === "tree" ? "mindmap" : "table");
  }, [active]);

  const kindOf = useCallback(
    (conversationId: string) => conversationById.get(conversationId)?.kind,
    [conversationById],
  );
  const placeOf = useCallback(
    (table: ThinkTable): string | null => {
      if (table.projectId !== null) return projectById.get(table.projectId)?.title ?? "Dự án";
      if (table.conversationId === null) return null;
      const conversation = conversationById.get(table.conversationId);
      return conversation === undefined ? null : conversationTitle(conversation);
    },
    [conversationById, projectById],
  );
  const isQuiet = useCallback(
    (table: ThinkTable): boolean => {
      if (isArchivedTree(tables, records, table.id)) return true;
      const project = table.projectId === null ? undefined : projectById.get(table.projectId);
      return project !== undefined && project.status !== "active";
    },
    [tables, records, projectById],
  );
  const shelf = useMemo(
    () => arrangeShelf(tables, records, user?.id, kindOf, placeOf, today),
    [tables, records, user?.id, kindOf, placeOf, today],
  );
  const tiles = useMemo(() => reminderTiles(tables, records, stars, today, isQuiet), [tables, records, stars, today, isQuiet]);
  const drawerOf = useCallback((table: ThinkTable): Drawer => drawerOfTable(table, kindOf), [kindOf]);
  const activeRoot: ThinkTable | null = useMemo(() => {
    if (active === null) return null;
    const steps = tableAncestry(tables, records, active.id);
    return steps[0]?.table ?? active;
  }, [active, tables, records]);
  const selectedShelf = useMemo(() => {
    if (activeRoot === null) return null;
    for (const drawer of Object.values(shelf)) {
      const found = [...drawer.live, ...drawer.archived].find((item) => item.table.id === activeRoot.id);
      if (found !== undefined) return found;
    }
    return null;
  }, [shelf, activeRoot]);
  const isArchived: boolean = active !== null && isArchivedTree(tables, records, active.id);
  const isShared: boolean = active !== null && (active.conversationId !== null || active.projectId !== null);
  const openProposal = useMemo(
    () =>
      activeRoot === null
        ? undefined
        : (proposalsQuery.data ?? []).find((proposal) => proposal.status === "open" && proposal.targetId === (active?.id ?? "")),
    [proposalsQuery.data, activeRoot, active],
  );
  const binnedPersonal: ThinkTable[] = useMemo(
    () =>
      (allTablesQuery.data ?? []).filter(
        (table) => table.deletedAt !== null && table.conversationId === null && table.projectId === null && table.ownerUserId === user?.id && table.parentRecordId === null,
      ),
    [allTablesQuery.data, user?.id],
  );

  const setFullscreen = useCallback(
    (on: boolean): void => {
      const next = new URLSearchParams(searchParams);
      if (on) {
        next.set("toan-man", "1");
        setSearchParams(next);
      } else if (searchParams.get("toan-man") === "1") {
        navigate(-1);
      }
    },
    [searchParams, setSearchParams, navigate],
  );

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, setFullscreen]);

  const openTable = useCallback(
    (tableId: string): void => {
      setActiveId(tableId);
      setIsEditingPurpose(false);
      // The way back survives moving between tables, so "← {nơi xuất phát}" stays until the person leaves.
      const next = carryReturn(searchParams, new URLSearchParams());
      next.set(HUB_TABLE_PARAM, tableId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const ancestry = useMemo(
    () => (active === null ? [] : tableAncestry(tables, records, active.id)),
    [tables, records, active],
  );
  const activeRootId: string | undefined = ancestry[0]?.table.id ?? active?.id;

  const visibleRecords: ThinkRecord[] = useMemo(() => {
    const list = active === null ? [] : recordsOf(records, active.id);
    return onlyStarred ? list.filter((record) => stars.has(record.id)) : list;
  }, [records, active, onlyStarred, stars]);

  const tasksById = useMemo(() => new Map((tasksQuery.data ?? []).map((task) => [task.id, task] as const)), [tasksQuery.data]);

  /** The tasks under each Hạng mục, for the list inside its dialog (and the D4 spotlight). */
  const tasksByRecord: Map<string, TaskItem[]> = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    const push = (recordId: string, taskId: string): void => {
      const task = tasksById.get(taskId);
      if (task === undefined) return;
      const list = map.get(recordId) ?? [];
      if (!list.some((existing) => existing.id === task.id)) list.push(task);
      map.set(recordId, list);
    };
    for (const link of recordTaskLinksQuery.data ?? []) push(link.recordId, link.taskId);
    for (const link of projectTaskLinks.values()) if (link.recordId !== null) push(link.recordId, link.taskId);
    return map;
  }, [recordTaskLinksQuery.data, projectTaskLinks, tasksById]);

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

  // Opened from inside a conversation (`?noi=`), only the Diary and that conversation are offered.
  const places: TablePlace[] = useMemo(
    () => tablePlaces(conversationsQuery.data ?? [], originConversationId),
    [conversationsQuery.data, originConversationId],
  );

  const isOwner: boolean = active !== null && active.ownerUserId === user?.id;
  const targetTable: ThinkTable | null = tables.find((table) => table.id === targetTableId) ?? active;
  const isFull: boolean = targetTable !== null && isTableFull(records, targetTable.id);
  const activeProject = active?.projectId != null ? projectById.get(active.projectId) : undefined;
  const isProjectRoot = active !== null && active.projectId !== null && active.parentRecordId === null;
  // A closed project's tables stay readable and stop taking changes; the server enforces the same.
  const isReadOnly: boolean = (activeProject !== undefined && activeProject.status !== "active") || isArchived;

  const scopeLabel = useCallback(
    (table: ThinkTable): string => {
      if (table.projectId !== null) return `Dự án ${projectById.get(table.projectId)?.title ?? ""}`.trim();
      if (table.conversationId !== null) {
        const conversation = conversationById.get(table.conversationId);
        if (conversation === undefined) return "Cuộc trò chuyện";
        return conversation.kind === "group" ? `Nhóm ${conversationTitle(conversation)}` : `1-1 với ${conversationTitle(conversation)}`;
      }
      return "Của tôi";
    },
    [projectById, conversationById],
  );

  const handleCreateTable = useCallback(
    async (input: { name: string; purpose: string; conversationId: string | null }): Promise<void> => {
      const created = await actions.createTable(input);
      createdTableRef.current = true;
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

  /*
   * `?hang-muc=<id>` (AVORA-39 / D4): open the table that holds it (a sub-table included), bring the
   * row into view and light it, then open the Hạng mục. Handled once per id; one that is gone
   * or out of reach says so and leaves only the table open.
   */
  const requestedRecordId: string | null = searchParams.get(HUB_RECORD_PARAM);
  const handledRecordRef = useRef<string | null>(null);
  useEffect(() => {
    if (requestedRecordId === null || isPending || handledRecordRef.current === requestedRecordId) return;
    handledRecordRef.current = requestedRecordId;
    const next = new URLSearchParams(searchParams);
    const requestedTaskId: string | null = searchParams.get("nhiem-vu");
    next.delete(HUB_RECORD_PARAM);
    next.delete("nhiem-vu");
    const record = records.find((entry) => entry.id === requestedRecordId);
    if (record === undefined || !tables.some((table) => table.id === record.tableId)) {
      toast("Không tìm thấy Hạng mục này nữa.");
      setSearchParams(next, { replace: true });
      return;
    }
    setActiveId(record.tableId);
    setView("table");
    next.set(HUB_TABLE_PARAM, record.tableId);
    setSearchParams(next, { replace: true });
    spotlight("data-record-id", record.id);
    window.setTimeout(() => {
      openRecord(record);
      // D4: the task named in the link, lit inside the Hạng mục. Gone from it → quietly nothing.
      if (requestedTaskId !== null) spotlight("data-record-task-id", requestedTaskId, { attempts: 20 });
    }, 700);
  }, [requestedRecordId, isPending, records, tables, searchParams, setSearchParams, openRecord]);

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

  const saveTableName = async (): Promise<void> => {
    if (active === null) return;
    const next = nameDraft.trim();
    if (next === "" || next === active.name) {
      setIsRenamingTable(false);
      return;
    }
    try {
      await actions.renameTable(active.id, next);
      setIsRenamingTable(false);
      toast.success("Đã đổi tên Bảng.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Không đổi được tên Bảng.");
    }
  };

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
        <div className="mx-auto max-w-2xl px-6 py-16 text-center md:px-10">
          <p role="alert" className="text-[15px] text-muted-foreground">
            {error?.message ?? "Không tải được Kế hoạch."}
          </p>
          {/* AVORA-53 · 3.3: a failed load always offers a way to try again. */}
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all })}
            className="press mt-5 min-h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium hover:bg-secondary"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const editingTable: ThinkTable | undefined =
    editing === null ? undefined : tables.find((table) => table.id === editing.tableId);

  return (
    <div className={cn("paper flex min-h-0 flex-1 flex-col", isFullscreen && "fixed inset-0 z-50 bg-background")}>
      {isFullscreen ? null : (
      <HubTitle
        title="Kế hoạch"
        className="max-w-6xl"
        action={
          <div className="flex items-center gap-2">
            <AvoraSearchButton here={{ tab: "ke-hoach", label: "Kế hoạch" }} />
            <button
              type="button"
              onClick={() => navigate(withReturn("/ke-hoach/ke-sach", hereFrom(location, "Kế hoạch")))}
              aria-label="Kệ sách"
              className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-[14.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              <Library className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              <span className="hidden md:inline">Kệ sách</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setGalleryConversationId(null);
                setIsNewTableOpen(true);
              }}
              className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[14.5px] md:px-5 md:text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              Bảng mới
            </button>
          </div>
        }
      />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto px-4 pb-10 pt-5 sm:px-6 md:px-10", isFullscreen ? "max-w-none pt-2" : "max-w-6xl")}>

        {isFullscreen ? null : (
          <>
            <ReturnChip className="-mt-2 mb-2" />
            {/* C7 · AVORA-50 B: Nhìn lại tuần (card) / hôm nay (one line), only when due. */}
            {/* AVORA-55 · 3.3: a jump from Avora Space (`?nhin-lai=`) lands with the review open. */}
            <ReviewPrompt
              review={review}
              variant="card"
              initialOpen={searchParams.get("nhin-lai") === "week" ? "week" : searchParams.get("nhin-lai") === "day" ? "day" : null}
            />
            <HubShelf
              tiles={tiles}
              shelf={shelf}
              today={today}
              selected={selectedShelf}
              selectedDrawer={selectedShelf?.drawer ?? null}
              drawerOfLine={(line) => drawerOf(line.table)}
              onPickTable={openTable}
              onPickLine={(line) => {
                openTable(line.record.tableId);
                setView("table");
                spotlight("data-record-id", line.record.id);
              }}
              onNewTable={(drawer) => {
                // AVORA-53 · 5.5: "Bảng mới ở đây" starts in the drawer it was pressed in.
                if (drawer === "project") {
                  const projectRoots = roots.filter((table) => table.projectId !== null && table.parentRecordId === null);
                  const chosen = projectRoots.find((table) => table.id === activeRoot?.id) ?? projectRoots[0];
                  if (chosen === undefined) {
                    toast("Chưa có dự án nào. Tạo dự án trong Kết nối › Dự án.");
                    return;
                  }
                  openTable(chosen.id);
                  setView("table");
                  toast("Bảng của dự án mọc từ một Hạng mục của Bảng gốc này: mở Hạng mục › ⋯ › Bảng con.");
                  return;
                }
                const here =
                  drawer === "personal"
                    ? null
                    : activeRoot !== null && activeRoot.conversationId !== null && drawerOf(activeRoot) === drawer
                      ? activeRoot.conversationId
                      : (places.find((place) => place.conversationId !== null && kindOf(place.conversationId) === drawer)?.conversationId ?? null);
                setGalleryConversationId(here);
                setIsNewTableOpen(true);
              }}
              onOpenTrash={() => setIsTrashOpen(true)}
            />
          </>
        )}

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

            {/* AVORA-53 · 5.1: tap the name to rename it right here (also ⋯ › Đổi tên). */}
            <div className="mt-4">
              {isRenamingTable ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTableName();
                  }}
                >
                  <input
                    value={nameDraft}
                    autoFocus
                    maxLength={120}
                    aria-label="Tên Bảng"
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setIsRenamingTable(false);
                    }}
                    className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[18px] font-semibold text-foreground outline-none focus:border-primary"
                  />
                  <button type="submit" className="press h-11 rounded-md bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
                    Lưu
                  </button>
                  <button type="button" onClick={() => setIsRenamingTable(false)} className="press h-11 rounded-md border border-border px-3 text-[14px]">
                    Huỷ
                  </button>
                </form>
              ) : isReadOnly || active.kind === "bookshelf" || isProjectRoot ? (
                <h2 className="text-[20px] font-semibold tracking-tight text-foreground">{active.name}</h2>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(active.name);
                    setIsRenamingTable(true);
                  }}
                  title="Chạm để đổi tên"
                  className="press group -mx-1 inline-flex max-w-full items-center gap-2 rounded-md px-1 text-left"
                >
                  <h2 className="truncate text-[20px] font-semibold tracking-tight text-foreground">{active.name}</h2>
                  <Pencil className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" strokeWidth={1.8} aria-hidden="true" />
                </button>
              )}
            </div>

            <section aria-label="Mục đích của bảng" className="mt-3 rounded-lg border border-border bg-card px-4 py-3">
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

            {isArchived ? (
              <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-secondary/70 px-4 py-2.5 text-[13.5px] text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden="true" />
                Đã lưu trữ{activeRoot?.archivedAt != null ? ` ngày ${activeRoot.archivedAt.slice(8, 10)}/${activeRoot.archivedAt.slice(5, 7)}` : ""} · Chỉ xem
              </p>
            ) : null}
            {openProposal !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  // AVORA-53 · 2.5: straight into the conversation that holds the proposal, with the way back.
                  const where =
                    active?.projectId != null ? projectById.get(active.projectId)?.conversationId : active?.conversationId;
                  if (where == null) return;
                  navigate(withReturn(`/tin-nhan/${where}`, hereFrom(location, "Kế hoạch")));
                }}
                className="press mt-3 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-left text-[13px] text-amber-800 dark:text-amber-200"
              >
                Đang có đề nghị {openProposal.action === "delete" ? "xoá" : openProposal.action === "archive" ? "lưu trữ" : "mở lại"} · Xem
              </button>
            ) : null}
            {active.orphanOrigin !== null ? <p className="mt-3 text-[12.5px] text-muted-foreground">{active.orphanOrigin}</p> : null}

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

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={onlyStarred}
                  onClick={() => setOnlyStarred(!onlyStarred)}
                  className={cn("press inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium", onlyStarred ? "bg-amber-400/20 text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Star className={cn("h-4 w-4", onlyStarred && "fill-amber-400 text-amber-400")} aria-hidden="true" />
                  <span className="hidden sm:inline">Chỉ quan trọng</span>
                </button>
                {isReadOnly ? null : (
                  <button
                    type="button"
                    onClick={openNewRecord}
                    className="press inline-flex min-h-9 items-center gap-1 rounded-md bg-primary px-3 text-[13.5px] font-semibold text-primary-foreground"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Hạng mục
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFullscreen(!isFullscreen)}
                  aria-label={isFullscreen ? "Thu gọn" : "Xem toàn màn"}
                  title={isFullscreen ? "Thu gọn (Esc)" : "Xem toàn màn"}
                  className="press inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2.5 text-[13px]"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  {isFullscreen ? <span>Thu gọn</span> : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="Thêm thao tác với Bảng" className="press inline-flex min-h-9 items-center rounded-md border border-border px-2">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    {!isReadOnly && active.kind !== "bookshelf" && !isProjectRoot ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setNameDraft(active.name);
                          setIsRenamingTable(true);
                        }}
                      >
                        Đổi tên
                      </DropdownMenuItem>
                    ) : null}
                    {isOwner && !isReadOnly ? (
                      <DropdownMenuItem onSelect={() => setSaveTemplateTarget(active)}>Lưu làm mẫu của tôi</DropdownMenuItem>
                    ) : null}
                    {isShared && active.kind === null ? (
                      <DropdownMenuItem onSelect={() => shelfActions.copyToJournal.mutateAsync(active.id).then((copied) => { toast.success("Đã sao chép về Nhật ký (chỉ Hạng mục của bạn)."); openTable(copied.id); }, (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không sao chép được."))}>
                        Sao chép về Nhật ký
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    {active.kind === "bookshelf" || isProjectRoot ? null : !isShared ? (
                      <>
                        {active.parentRecordId === null ? (
                          <DropdownMenuItem onSelect={() => shelfActions.archive.mutateAsync({ tableId: active.id, archived: !isArchived }).then(() => toast.success(isArchived ? "Đã mở lại Bảng." : "Đã lưu trữ Bảng — chỉ xem."), (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được."))}>
                            {isArchived ? "Mở lại" : "Lưu trữ"}
                          </DropdownMenuItem>
                        ) : null}
                        {isOwner ? (
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(active)}>Xoá Bảng</DropdownMenuItem>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {active.parentRecordId === null && active.projectId === null ? (
                          <DropdownMenuItem onSelect={() => setProposeTarget({ action: isArchived ? "reopen" : "archive", targetType: "think_hub_table", targetId: active.id, name: active.name })}>
                            {isArchived ? "Đề nghị mở lại" : "Đề nghị lưu trữ"}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem className="text-destructive" onSelect={() => setProposeTarget({ action: "delete", targetType: "think_hub_table", targetId: active.id, name: active.name })}>
                          Đề nghị xoá
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {isTableFull(records, active.id) ? (
                <p role="status" className="w-full text-[13.5px] text-destructive">
                  Bảng đã đầy {RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục, hãy dọn bớt trước khi thêm.
                </p>
              ) : null}
            </div>

            {visibleRecords.length === 0 && !onlyStarred && (active.purpose !== null || active.sourceTemplateKey !== null) ? (
              <div className="mt-4 rounded-xl border border-dashed border-border px-5 py-5 text-center">
                {active.purpose !== null ? <p className="text-[15px] font-medium text-foreground">{active.purpose}</p> : null}
                {isOwner && !isReadOnly && active.sourceTemplateKey === null && active.columns.length === 0 ? (
                  <ApplyTemplateRow tableId={active.id} templates={templatesQuery.data ?? []} onApply={(template) => shelfActions.apply.mutateAsync({ tableId: active.id, template }).then(() => toast.success("Đã áp mẫu."), (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không áp được mẫu."))} />
                ) : null}
              </div>
            ) : null}

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
                <KanbanView records={visibleRecords} onOpenRecord={openRecord} today={today} statusOptions={active.statusOptions} />
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

      <TemplateGallery
        open={isNewTableOpen}
        places={places}
        initialConversationId={originConversationId ?? galleryConversationId}
        lockPlace={originConversationId !== null}
        kindOf={kindOf}
        onCreated={(created) => {
          createdTableRef.current = true;
          openTable(created.id);
        }}
        onOpenChange={(next) => {
          setIsNewTableOpen(next);
          if (next) {
            createdTableRef.current = false;
            return;
          }
          // Cancelled a form started somewhere else: go back there, replacing this step so Back
          // does not land on an empty Kế hoạch. Created: stay on the new table, way back kept.
          const origin = readReturn(searchParams);
          if (!createdTableRef.current && origin !== null) navigate(origin.path, { replace: true });
          createdTableRef.current = false;
        }}
      />

      <ProposeDialog target={proposeTarget} onOpenChange={(next) => !next && setProposeTarget(null)} />
      <SaveTemplateDialog table={saveTemplateTarget} onOpenChange={(next) => !next && setSaveTemplateTarget(null)} />
      <DeleteTableDialog
        table={deleteTarget}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        onRename={() => {
          setDeleteTarget(null);
          setPurposeDraft(active?.purpose ?? "");
          setIsEditingPurpose(true);
        }}
        onDelete={async (table) => {
          try {
            await actions.removeTable(table.id);
            setDeleteTarget(null);
            setActiveId(null);
            toast.success("Đã chuyển Bảng vào Thùng rác.", { action: { label: "Hoàn tác", onClick: () => void actions.restoreTable(table.id) } });
          } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : "Không xoá được Bảng.");
          }
        }}
      />
      <HubTrashDialog
        open={isTrashOpen}
        onOpenChange={setIsTrashOpen}
        personalBinned={binnedPersonal}
        onRestorePersonal={async (tableId) => {
          try {
            await actions.restoreTable(tableId);
            toast.success("Đã khôi phục Bảng cùng nhiệm vụ đã đi theo.");
          } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : "Không khôi phục được.");
          }
        }}
      />
      <MoveRecordDialog
        request={moveRequest}
        tables={tables}
        records={records}
        drawerOf={drawerOf}
        onOpenChange={(next) => !next && setMoveRequest(null)}
        onDone={(targetTableId) => openTable(targetTableId)}
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
        tasks={editing === null ? undefined : tasksByRecord.get(editing.id) ?? []}
        onOpenTask={(taskId) => {
          setIsRecordOpen(false);
          navigate(withReturn(taskLink(taskId), hereFrom(location, "Kế hoạch")));
        }}
        isStarred={editing !== null && stars.has(editing.id)}
        onToggleStar={editing === null ? undefined : () => shelfActions.star.mutate(editing.id)}
        onMove={
          editing === null || isReadOnly
            ? undefined
            : () => {
                setIsRecordOpen(false);
                setMoveRequest({ record: editing, mode: "move" });
              }
        }
        onCopy={
          editing === null || isReadOnly
            ? undefined
            : () => {
                setIsRecordOpen(false);
                setMoveRequest({ record: editing, mode: "copy" });
              }
        }
        isReadOnly={isReadOnly && editing !== null}
      />
    </div>
  );
};

export default ThinkHub;
