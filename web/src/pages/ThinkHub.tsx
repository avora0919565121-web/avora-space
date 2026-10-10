import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  KanbanSquare,
  LayoutList,
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
  Search,
  Table2,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AddColumnDialog } from "@/components/think-hub/AddColumnDialog";
import { KanbanView } from "@/components/think-hub/KanbanView";
import { MindmapView } from "@/components/think-hub/MindmapView";
import { QuickTaskDialog, recordSourceLabel } from "@/components/think-hub/QuickTaskDialog";
import { TaskPicker } from "@/components/tasks/LinkPickers";
import { OverviewColumns } from "@/components/think-hub/overview/OverviewColumns";
import { OverviewTaskPane } from "@/components/think-hub/overview/OverviewTaskPane";
import { OverviewTree } from "@/components/think-hub/overview/OverviewTree";
import { OverviewToggle } from "@/components/think-hub/overview/OverviewToggle";
import { useProjectOverview } from "@/components/think-hub/overview/use-project-overview";
import { NewTableDialog, type TablePlace } from "@/components/think-hub/NewTableDialog";
import { askConfirm, askText } from "@/components/ConfirmHost";
import { BoardMenu, type BoardMenuItem } from "@/components/think-hub/BoardMenu";
import { boardMoveCounts, MoveBoardDialog } from "@/components/think-hub/MoveBoardDialog";
import {
  AnnounceButton,
  AnnounceDialog,
  AnnounceSettingsDialog,
  ChangeHistoryDialog,
  ChangesSinceLine,
  MarkingBar,
  NudgeLines,
  useBoardPeople,
} from "@/components/think-hub/BoardChanges";
import { BOARD_CHANGES_PARAM, marksSince, needsLeaveReminder, affectedOwners, type BoardChange } from "@/lib/board-changes";
import { useBoardChanges } from "@/lib/use-board-changes";
import { usePeopleNames } from "@/lib/use-task-owner";
import type { ColumnMenuActions } from "@/components/think-hub/ColumnMenu";
import { ColumnTrashDialog } from "@/components/think-hub/ColumnTrashDialog";
import { PlanPlusButton } from "@/components/think-hub/PlanPlusButton";
import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RenameColumnDialog } from "@/components/think-hub/RenameColumnDialog";
import { readPhoneMode, TableView, writePhoneMode, type PhoneMode } from "@/components/think-hub/TableView";
import { useMediaQuery } from "@/hooks/use-media-query";
import { HubShelf } from "@/components/think-hub/HubShelf";
import { BoardHead, ThinkingTypeDialog } from "@/components/library/BoardHead";
import { BookshelfPanel, useBookshelf } from "@/components/library/BookshelfPanel";
import { ShelfCards } from "@/components/library/ShelfCards";
import { DefaultShelf, DiaryShelf, LifecycleShelf, OtherShelf, PlannedShelf } from "@/components/library/ShelfPanels";
import { ViewBoardPanel } from "@/components/library/ViewBoardPanel";
import { DeskFullSheet, type DeskBook } from "@/components/library/ThinkDesk";
import { useActivityMeter } from "@/lib/use-activity";
import { BottomTabStrip } from "@/components/nav/TempTabBar";

/** AVORA-93 · 4.3: the Hạng mục open on a focused board (`?hm=<record id>`). */
const OPEN_RECORD_PARAM = "hm";
import { BookNotes, BooksCard, ReadingTime, RoomNumbers, StatsMenu } from "@/components/library/RoomStats";
import { EdgeArrows, OverviewShelf, ProgressMatrix, RoomMapSheet, RoomStage, RoomStrip, ShelfZone, ThinkingOverview, WorkDesk, type SpinePreview } from "@/components/library/PlanRoom";
import { AudienceAsk, PlacePicker, TemplateLibrary } from "@/components/library/TemplateLibrary";
import { lastShelfOfRow, neighbour, rememberShelf, ROOM_HOME, ROOM_PARAM, roomFromParams, rowOf, shelfOfRoom, startsInHorizontalScroller, swipeDirection, type RoomShelf } from "@/lib/room";
import { templateUsage, useOpenQuestions, useRoomPrefs } from "@/lib/use-room";
import { useFocusHeader } from "@/lib/focus-header";
import { libraryTemplates, type BoardTemplate } from "@/lib/think-hub-shelf";
import { coverColor } from "@/lib/library";
import { noteDisplayTitle } from "@/lib/notes";
import { DEFAULT_BOARDS, viewBoardOf } from "@/lib/avora-default-boards";
import { lifecycleLabel } from "@/lib/board-head";
import { useDefaultShelfAttention } from "@/lib/use-view-board-rows";
import { ARRANGEMENT_PARAM, arrangementFromLegacy, DRAWER_PARAM, isArrangement, type Arrangement, type PlaceKind } from "@/lib/desk";
import { DESK_FULL_EVENT, useArrangement, useBoardOpened, useDesk } from "@/lib/use-desk";
import { setLifecycle } from "@/lib/board-head";
import { ReviewSheet } from "@/components/review/ReviewSheet";
import { findJournal } from "@/hooks/use-paste-task";
import { ensureJournalConversation } from "@/lib/chat";
import { readingProgress } from "@/components/library/BookshelfPanel";
import { isViewBoardKey, searchViewBoards, VIEW_BOARD_PARAM, type ViewBoardKey } from "@/lib/avora-default-boards";
import {
  byLifecycle,
  initialShelf,
  isDefaultBoard,
  isShelfId,
  plannedBoards,
  searchLibrary,
  SHELF_PARAM,
  shelfOf,
  shelfStatus,
  type LibraryCounts,
  type ShelfId,
} from "@/lib/library";
import { guideQuestionOf, HUB_TILE_PARAM, isReminderTile, type ReminderTile } from "@/lib/think-hub-shelf";
import { useNotes } from "@/lib/use-notes";
import { DIARY_VIEW_PARAM, diaryViewSlug, NOTES_BOOKS_PARAM, NOTES_BOOKS_VALUE } from "@/lib/diary-views";
import { fetchAllReadingStates, type ReadingState } from "@/lib/reading-state";
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
  columnTypeLabel,
  filledCountOf,
  HUB_RECORD_PARAM,
  isTableFull,
  RECORD_LIMIT,
  recordCountOf,
  recordsOf,
  rootTables,
  safeTypeChanges,
  scopeOfTable,
  subTablesOf,
  tableAncestry,
  tablesInScope,
  thinkHubKeys,
  moveThinkTable,
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
import { OpportunityBoardBar, NewOpportunityDialog } from "@/components/think-hub/OpportunityBoard";
import { isSyncBoard, isSyncColumnKey, matchesStageChip, saveSyncEdits, setBoardView, splitSyncPatch, syncColumnDefs, withSyncValues, type StageChip } from "@/lib/opportunity-board";
import { useInvalidateOpportunityBoard, useOpportunityBoardRows } from "@/lib/use-opportunity-board";
import { AvoraSearchButton } from "@/components/search/AvoraSearch";
import { HubTitle } from "@/components/nav/HubTitle";
import { InlineBack } from "@/components/nav/InlineBack";
import { carryReturn, hereFrom, readReturn, withReturn } from "@/lib/return-to";
import { hasInAppPrevious, isPreviousEntry } from "@/lib/nav-history";
import { taskLink } from "@/lib/task-scope";
import type { TaskItem } from "@/lib/tasks";
import { useTasks } from "@/lib/use-tasks";
import { spotlight } from "@/lib/spotlight";
import { cn } from "@/lib/utils";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";
import { isAreaRoot } from "@/lib/go-back";
import { CleanupCard } from "@/components/library/CleanupCard";
import { ArchivedRecordsRow, RecordSelectSheet } from "@/components/think-hub/ArchivedRecords";
import { isoWeek } from "@/lib/cleanup";
import { useProfilePrefs } from "@/lib/use-default-boards";
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from "@/hooks/use-long-press";

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
  // AVORA-77 · B: a board opens only when named (`?bang=`); otherwise the library shows its shelves.
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get(HUB_TABLE_PARAM));
  // AVORA-72 · A: `?danh-sach-co-hoi=1` (Liên hệ, a contact) opens the synced board, whatever was open before.
  const wantsOpportunityBoard = searchParams.get("danh-sach-co-hoi") === "1";
  const [view, setView] = useState<ViewMode>("table");
  const viewChosenRef = useRef<string | null>(null);
  // AVORA-65 · C: on a phone held upright, one row — `Thẻ · Bảng · Theo trạng thái · Cây`.
  const isPhoneUpright = useMediaQuery("(max-width: 767px)");
  const [phoneMode, setPhoneMode] = useState<PhoneMode>("cards");
  const isFullscreen: boolean = searchParams.get("toan-man") === "1";
  // ---------------------------------------------------------------- AVORA-89 · PHẦN 2 · the room (ADR-057)
  const roomPrefs = useRoomPrefs();
  // AVORA-100 · V·3.3: `Dọn kệ tuần này` at most once a week; `?don=1` (Cài đặt › Dung lượng) asks for it now.
  const cleanupPrefs = useProfilePrefs();
  const thisWeek = isoWeek();
  const [isCleanupAsked, setIsCleanupAsked] = useState<boolean>(() => searchParams.get("don") === "1");
  const showCleanup = cleanupPrefs.isLoaded && (isCleanupAsked || cleanupPrefs.prefs.cleanup_seen_week !== thisWeek);
  const laterCleanup = (): void => {
    setIsCleanupAsked(false);
    void cleanupPrefs.setPref("cleanup_seen_week", thisWeek).catch(() => undefined);
  };
  // V·3.3: hold a Hạng mục to choose several (Cất · Xoá · Huỷ).
  const [selectStart, setSelectStart] = useState<string | null>(null);
  const holdRef = useRef<{ timer: number | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  const endHold = (): void => {
    if (holdRef.current.timer !== null) window.clearTimeout(holdRef.current.timer);
    holdRef.current.timer = null;
  };
  const roomFromUrl = roomFromParams(searchParams);
  const room: RoomShelf = roomFromUrl?.shelf ?? roomPrefs.savedRoom ?? ROOM_HOME;
  const [roomDir, setRoomDir] = useState<"left" | "right" | "up" | "down" | null>(null);
  const [isRoomMapOpen, setIsRoomMapOpen] = useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [isAudienceAskOpen, setIsAudienceAskOpen] = useState<boolean>(false);
  const [placingTemplate, setPlacingTemplate] = useState<BoardTemplate | null>(null);
  const roomSwipeRef = useRef<{ x: number; y: number; skip: boolean } | null>(null);
  const [libraryQuery, setLibraryQuery] = useState<string>("");
  const [addBookRequest, setAddBookRequest] = useState<number>(0);
  const [isThinkingTypeOpen, setIsThinkingTypeOpen] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shelfScroll = useRef<Map<RoomShelf, number>>(new Map());
  const focusScrollRef = useRef<number>(0);
  const notesData = useNotes();
  const bookshelfData = useBookshelf();
  // AVORA-94 · B2.3: the same query the shelf uses — `Đọc tiếp` is the book opened most recently, with its %.
  const readingStates = useQuery<ReadingState[], Error>({ queryKey: ["book-reading-state", "all"], queryFn: fetchAllReadingStates, staleTime: 30_000 });
  const lastRead = useMemo(() => {
    const states = readingStates.data ?? [];
    const percentOf = new Map(states.map((state) => [state.recordId, Number.isFinite(state.percent) ? state.percent : null] as const));
    const byId = new Map(bookshelfData.books.map((book) => [book.id, book] as const));
    // States come newest first; the first one still on the shelf is the book opened last.
    const latest = states.map((state) => byId.get(state.recordId)).find((book) => book !== undefined) ?? null;
    return { percentOf, latest };
  }, [readingStates.data, bookshelfData.books]);
  const shelfActions = useShelfActions();
  const starsQuery = useStars();
  const stars: Set<string> = useMemo(() => starsQuery.data ?? new Set<string>(), [starsQuery.data]);
  const proposalsQuery = useProposals();
  const templatesQuery = useTemplates();
  const allTablesQuery = useThinkTables();
  const [isTrashOpen, setIsTrashOpen] = useState<boolean>(false);
  const [onlyStarred, setOnlyStarred] = useState<boolean>(false);
  /** AVORA-72: the synced board's stage chip (default `Đang mở`) and its `Cơ hội mới` dialog. */
  const [stageChip, setStageChip] = useState<StageChip>("open");
  const [isNewOpportunityOpen, setIsNewOpportunityOpen] = useState<boolean>(false);
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
  // Which board `+ Thêm cột` adds to: the open one, or a sub-table opened in place (AVORA-65 · H).
  const [addColumnTableId, setAddColumnTableId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ColumnDef | null>(null);
  // The board whose column is being renamed — a sub-table's column renames on the sub-table.
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null);
  const [isColumnTrashOpen, setIsColumnTrashOpen] = useState<boolean>(false);
  const [isRecordOpen, setIsRecordOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<ThinkRecord | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>("");
  const [isEditingPurpose, setIsEditingPurpose] = useState<boolean>(false);
  const [purposeDraft, setPurposeDraft] = useState<string>("");
  // AVORA-53 · 5.1: the table's own name, edited where it is read.
  const [isRenamingTable, setIsRenamingTable] = useState<boolean>(false);
  const [nameDraft, setNameDraft] = useState<string>("");
  const [quickTaskRecord, setQuickTaskRecord] = useState<ThinkRecord | null>(null);
  // AVORA-104 · PHẦN 3: `⛓ Gắn việc có sẵn` from the open Hạng mục.
  const [linkTaskRecord, setLinkTaskRecord] = useState<ThinkRecord | null>(null);
  const [isMoveOpen, setIsMoveOpen] = useState<boolean>(false);

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
    if (tables.length === 0 || activeId === null) return null;
    return tables.find((table) => table.id === activeId) ?? null;
  }, [tables, activeId]);

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
    if (activeId === requestedTableId) setActiveId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the requested table or the list changes
  }, [requestedTableId, isPending, tables]);

  // `‹ Kệ` (or Back) took `?bang=` away: the board closes, the shelf stays.
  useEffect(() => {
    if (requestedTableId === null && activeId !== null && searchParams.get("danh-sach-co-hoi") !== "1") setActiveId(null);
  }, [requestedTableId, activeId, searchParams]);

  useEffect(() => {
    if (active !== null && active.id !== activeId) setActiveId(active.id);
    if (active !== null) rememberLastTable(user?.id, active.id);
  }, [active, activeId, user?.id]);

  // A table opens in its template's view the first time it is shown (C1 default_view).
  useEffect(() => {
    if (active === null || viewChosenRef.current === active.id) return;
    viewChosenRef.current = active.id;
    setView(active.defaultView === "kanban" ? "kanban" : active.defaultView === "tree" ? "mindmap" : "table");
    setPhoneMode(readPhoneMode(active.id));
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
  const tiles = useMemo(() => reminderTiles(tables, records, stars, today, isQuiet), [tables, records, stars, today, isQuiet]);
  const drawerOf = useCallback((table: ThinkTable): Drawer => drawerOfTable(table, kindOf), [kindOf]);
  const activeRoot: ThinkTable | null = useMemo(() => {
    if (active === null) return null;
    const steps = tableAncestry(tables, records, active.id);
    return steps[0]?.table ?? active;
  }, [active, tables, records]);
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

  // ---------------------------------------------------------------- AVORA-77 · the six shelves
  const planned: ThinkTable[] = useMemo(() => plannedBoards(tables), [tables]);
  const lanes = useMemo(() => byLifecycle(planned), [planned]);
  const defaultBoards: ThinkTable[] = useMemo(
    () => tables.filter((table) => isDefaultBoard(table) && table.deletedAt === null && table.parentRecordId === null),
    [tables],
  );
  const recordCount: Map<string, number> = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of records) if (record.deletedAt === null) map.set(record.tableId, (map.get(record.tableId) ?? 0) + 1);
    return map;
  }, [records]);
  const syncedAt: string | null = useMemo(() => {
    const ids = new Set(defaultBoards.map((board) => board.id));
    let latest: string | null = null;
    for (const board of defaultBoards) if (latest === null || board.updatedAt > latest) latest = board.updatedAt;
    for (const record of records) if (ids.has(record.tableId) && (latest === null || record.updatedAt > latest)) latest = record.updatedAt;
    return latest;
  }, [defaultBoards, records]);
  const noQuestion: ThinkTable[] = useMemo(
    // Only boards with something on them: an empty board (the first one every account gets) is nothing to file yet.
    () =>
      planned.filter(
        (table) => table.archivedAt === null && table.purpose === null && table.ownerUserId === user?.id && table.projectId === null && (recordCount.get(table.id) ?? 0) > 0,
      ),
    [planned, user?.id, recordCount],
  );
  const archivedBoards: ThinkTable[] = useMemo(() => planned.filter((table) => table.archivedAt !== null), [planned]);
  const libraryCounts: LibraryCounts = useMemo(() => {
    const books = bookshelfData.books;
    return {
      defaultBoards: defaultBoards.length,
      syncedAt,
      planned: planned.filter((table) => table.archivedAt === null).length,
      thinking: lanes.thinking.length,
      waiting: lanes.waiting.length,
      concluded: lanes.concluded.length,
      reading: books.filter((book) => book.status === "dang_doc").length,
      wantToRead: books.filter((book) => book.status === "muon_doc").length,
      books: books.length,
      diaryToday: null,
      notes: notesData.notes.data === undefined ? null : notesData.liveNotes.length,
      noQuestion: noQuestion.length,
    };
  }, [defaultBoards.length, syncedAt, planned, lanes, bookshelfData.books, notesData.notes.data, notesData.liveNotes.length, noQuestion.length]);
  const libraryHits = useMemo(
    () =>
      searchLibrary(
        libraryQuery,
        rootTables(tables).filter((table) => table.kind !== "bookshelf"),
        bookshelfData.books,
        (book) => bookshelfData.field(book, bookshelfData.keys.author),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field() reads keys
    [libraryQuery, tables, bookshelfData.books, bookshelfData.keys.author],
  );

  /**
   * AVORA-77 · A3 — `⤢` opens the board as a focus room: nothing else on screen. `⤡`, Esc or a
   * swipe down comes back to the same shelf, board and scroll. No timer, no score.
   */
  const setFullscreen = useCallback(
    (on: boolean): void => {
      const next = new URLSearchParams(searchParams);
      if (on) {
        focusScrollRef.current = scrollRef.current?.scrollTop ?? 0;
        next.set("toan-man", "1");
        setSearchParams(next);
      } else if (searchParams.get("toan-man") === "1") {
        if (hasInAppPrevious()) navigate(-1);
        else {
          next.delete("toan-man");
          setSearchParams(next, { replace: true });
        }
      }
    },
    [searchParams, setSearchParams, navigate],
  );
  const wasFullscreenRef = useRef<boolean>(isFullscreen);
  useEffect(() => {
    if (wasFullscreenRef.current && !isFullscreen) {
      const top = focusScrollRef.current;
      window.setTimeout(() => scrollRef.current?.scrollTo({ top }), 30);
    }
    wasFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);
  const swipeRef = useRef<{ y: number; atTop: boolean } | null>(null);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, setFullscreen]);

  /** Which shelf a board sits on (B2): system boards on 01, the bookshelf on 04, every other on 02. */
  const shelfForTable = useCallback(
    (tableId: string): ShelfId => {
      const table = tables.find((item) => item.id === tableId);
      if (table === undefined) return "hoach-dinh";
      if (isDefaultBoard(table)) return "mac-dinh";
      if (table.kind === "bookshelf") return "ke-sach";
      return "hoach-dinh";
    },
    [tables],
  );

  const openTable = useCallback(
    (tableId: string, homeShelf?: RoomShelf): void => {
      setActiveId(tableId);
      setIsEditingPurpose(false);
      setIsLibraryOpen(false);
      // The way back survives moving between tables, so "← {nơi xuất phát}" stays until the person leaves.
      const next = carryReturn(searchParams, new URLSearchParams());
      // AVORA-89 · 2.3: the board opens on top of the shelf it came from; `‹` goes back there.
      next.set(ROOM_PARAM, String(homeShelf ?? room));
      next.set(HUB_TABLE_PARAM, tableId);
      // AVORA-94B (ADR-062): opening a Bảng goes deeper → push, so Back returns to the shelf.
      setSearchParams(next);
    },
    [searchParams, setSearchParams, room],
  );

  /** Opens one shelf (B1). The board closes; the way back stays. */
  const openShelf = useCallback(
    (id: ShelfId | null): void => {
      const next = carryReturn(searchParams, new URLSearchParams());
      if (id !== null) next.set(SHELF_PARAM, id);
      setActiveId(null);
      setLibraryQuery("");
      setSearchParams(next);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [searchParams, setSearchParams],
  );

  /** AVORA-81 · PHẦN 1: `?xem=<key>` opens one Bảng xem (read live, nothing copied). */
  const requestedView = searchParams.get(VIEW_BOARD_PARAM);
  const activeView: ViewBoardKey | null = isViewBoardKey(requestedView) ? requestedView : null;
  const openView = useCallback(
    (key: ViewBoardKey): void => {
      const next = carryReturn(searchParams, new URLSearchParams());
      next.set(ROOM_PARAM, String(room));
      next.set(VIEW_BOARD_PARAM, key);
      setActiveId(null);
      setSearchParams(next);
    },
    [searchParams, setSearchParams, room],
  );
  const closeView = useCallback((): void => {
    if (hasInAppPrevious()) navigate(-1);
    else {
      const next = new URLSearchParams(searchParams);
      next.delete(VIEW_BOARD_PARAM);
      next.delete("toan-man");
      setSearchParams(next, { replace: true });
    }
    if (activeView !== null) spotlight("data-view-board-link", activeView);
  }, [searchParams, setSearchParams, activeView, navigate]);

  /** `‹ {kệ}` on a phone, `×` on a computer: the board closes, its row on the shelf lights up. */
  const closeBoard = useCallback((): void => {
    const closing = activeId;
    setActiveId(null);
    // AVORA-94B · luật 1: closing = one step back when the shelf is the screen behind; else the shelf, replace.
    if (hasInAppPrevious()) navigate(-1);
    else {
      const next = new URLSearchParams(searchParams);
      next.delete(HUB_TABLE_PARAM);
      next.delete("toan-man");
      next.delete(OPEN_RECORD_PARAM);
      setSearchParams(next, { replace: true });
    }
    if (closing !== null) spotlight("data-board-row", closing);
  }, [activeId, searchParams, setSearchParams, navigate]);

  const ancestry = useMemo(
    () => (active === null ? [] : tableAncestry(tables, records, active.id)),
    [tables, records, active],
  );
  const activeRootId: string | undefined = ancestry[0]?.table.id ?? active?.id;

  // AVORA-72 (ADR-045): the synced board reads opportunity + contact live; nothing is copied in.
  const isSynced: boolean = isSyncBoard(active);
  useEffect(() => {
    if (!wantsOpportunityBoard) return;
    const board = tables.find((table) => isSyncBoard(table));
    if (board !== undefined && board.id !== activeId) openTable(board.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the board is known
  }, [wantsOpportunityBoard, tables, activeId]);
  const opportunityBoard = useOpportunityBoardRows(isSynced);
  const invalidateOpportunityBoard = useInvalidateOpportunityBoard();
  const boardColumns: ColumnDef[] = useMemo(
    () => (active === null ? [] : isSynced ? [...syncColumnDefs(active), ...active.columns] : [...active.columns]),
    [active, isSynced],
  );
  const visibleRecords: ThinkRecord[] = useMemo(() => {
    let list = active === null ? [] : recordsOf(records, active.id);
    if (isSynced) {
      list = withSyncValues(
        list,
        opportunityBoard.rows,
        (conversationId) => {
          const here = conversationById.get(conversationId);
          return here === undefined ? "Cuộc trò chuyện" : conversationTitle(here);
        },
        (recordId) => recordTaskLinksQuery.data?.filter((link) => link.recordId === recordId).length ?? 0,
      ).filter((record) => matchesStageChip(record.status, stageChip));
    }
    return onlyStarred ? list.filter((record) => stars.has(record.id)) : list;
  }, [records, active, onlyStarred, stars, isSynced, opportunityBoard.rows, stageChip, conversationById, recordTaskLinksQuery.data]);

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

  // AVORA-104 · PHẦN 4: Toàn cảnh dự án — tree, task column, phone columns.
  const recordLinkedTaskIds: ReadonlySet<string> = useMemo(() => new Set((recordTaskLinksQuery.data ?? []).map((link) => link.taskId)), [recordTaskLinksQuery.data]);
  const overview = useProjectOverview({
    active,
    tables,
    records,
    tasks: tasksQuery.data ?? [],
    tasksByRecord,
    projectTaskLinks,
    recordLinkedTaskIds,
    isEnabled: searchParams.get("toan-man") !== "1",
    setActiveId,
  });

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

  // ---------------------------------------------------------------- AVORA-62 · Báo nhóm
  const boardChanges = useBoardChanges(active?.id ?? null, isShared);
  const { nameOf } = usePeopleNames();
  const boardConversationId: string | null =
    active === null ? null : active.projectId !== null ? (projectById.get(active.projectId)?.conversationId ?? null) : active.conversationId;
  const boardConversationKind: "group" | "direct" | null =
    active === null ? null : active.projectId !== null ? "group" : boardConversationId === null ? null : conversationById.get(boardConversationId)?.kind === "direct" ? "direct" : "group";
  const boardPeople = useBoardPeople(boardConversationId, boardConversationKind);
  const [isAnnounceOpen, setIsAnnounceOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isAnnounceSettingsOpen, setIsAnnounceSettingsOpen] = useState<boolean>(false);
  /** `Xem thay đổi`: "since" = since my last visit; otherwise one announcement's changes. */
  const [marking, setMarking] = useState<string | null>(null);
  const [isMarkingSeen, setIsMarkingSeen] = useState<boolean>(false);
  const changesParam = searchParams.get(BOARD_CHANGES_PARAM);
  useEffect(() => {
    if (changesParam === null) return;
    setMarking(changesParam === "1" ? "since" : changesParam);
    setIsMarkingSeen(false);
    const next = new URLSearchParams(searchParams);
    next.delete(BOARD_CHANGES_PARAM);
    setSearchParams(next, { replace: true });
  }, [changesParam, searchParams, setSearchParams]);
  useEffect(() => {
    setMarking(null);
  }, [active?.id]);
  const markingMarks = useMemo(() => {
    if (marking === null) return null;
    if (marking === "since") return boardChanges.since;
    return marksSince(boardChanges.changes, null, undefined, marking);
  }, [marking, boardChanges.since, boardChanges.changes]);
  // The marks fade once the reader has scrolled past them (or after a while on screen).
  useEffect(() => {
    if (marking === null) return;
    const timer = window.setTimeout(() => setIsMarkingSeen(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [marking]);

  // D: leaving a board with unannounced changes to someone else's Hạng mục (or a deletion).
  const pendingRef = useRef<{ table: ThinkTable | null; pending: readonly BoardChange[] }>({ table: null, pending: [] });
  pendingRef.current = { table: active, pending: boardChanges.pending };
  const leaveReminder = useCallback(
    (table: ThinkTable | null, pending: readonly BoardChange[]): void => {
      if (table === null || pending.length === 0 || !needsLeaveReminder(pending, user?.id)) return;
      if ((table.announceMode ?? "manual") !== "manual") return;
      const key = `avora.board-reminded.${table.id}`;
      try {
        const last = Number(window.localStorage.getItem(key) ?? "0");
        if (Date.now() - last < 2 * 3_600_000) return;
        window.localStorage.setItem(key, String(Date.now()));
      } catch {
        // Remembering is a courtesy.
      }
      const owners = affectedOwners(pending, user?.id).map((id) => nameOf(id));
      const text =
        owners.length > 0 ? `Bạn đã đổi việc của ${owners.slice(0, 3).join(", ")}` : `Bạn đã xoá trong Bảng "${table.name}"`;
      toast(text, {
        duration: 6000,
        className: "board-leave-reminder",
        action: {
          label: "Báo ngay",
          onClick: () => {
            setActiveId(table.id);
            window.setTimeout(() => setIsAnnounceOpen(true), 50);
          },
        },
        cancel: { label: "Để sau", onClick: () => undefined },
      });
    },
    [user?.id, nameOf],
  );
  const previousTableRef = useRef<string | null>(null);
  const previousSnapshotRef = useRef<{ table: ThinkTable | null; pending: readonly BoardChange[] }>({ table: null, pending: [] });
  useEffect(() => {
    const previous = previousSnapshotRef.current;
    if (previousTableRef.current !== null && previousTableRef.current !== (active?.id ?? null)) {
      leaveReminder(previous.table, previous.pending);
    }
    previousTableRef.current = active?.id ?? null;
  }, [active?.id, leaveReminder]);
  useEffect(() => {
    previousSnapshotRef.current = { table: active, pending: boardChanges.pending };
  }, [active, boardChanges.pending]);
  // Only a real unmount reminds — not every time a name list finishes loading.
  const leaveRef = useRef(leaveReminder);
  leaveRef.current = leaveReminder;
  useEffect(() => () => leaveRef.current(pendingRef.current.table, pendingRef.current.pending), []);

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
      const tableId = addColumnTableId ?? active?.id;
      if (tableId === undefined) return;
      await actions.addColumn({ tableId, ...input });
      setAddColumnTableId(null);
      toast.success(`Đã thêm cột "${input.label}".`);
    },
    [actions, active, addColumnTableId],
  );

  const handleRenameColumn = useCallback(
    async (column: ColumnDef, label: string): Promise<void> => {
      const tableId = renamingTableId ?? active?.id;
      if (tableId === undefined) return;
      await actions.renameColumn({ tableId, columnId: column.id, label });
      toast.success("Đã đổi tên cột.");
    },
    [actions, active, renamingTableId],
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
      // AVORA-72: a synced column is only folded away for me (it lives in Danh bạ, not on the board).
      if (isSyncColumnKey(column.key)) {
        const current = boardColumns.filter((c) => isSyncColumnKey(c.key) && c.hidden === true).map((c) => c.key);
        const next = hidden ? [...new Set([...current, column.key])] : current.filter((k) => k !== column.key);
        void setBoardView({ syncHidden: next }).then(
          () => {
            void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
            toast.success(hidden ? `Đã ẩn cột "${column.label}".` : `Đã hiện lại cột "${column.label}".`);
          },
          (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được cột."),
        );
        return;
      }
      actions.setColumnHidden({ tableId: active.id, columnId: column.id, hidden }).then(
        () => toast.success(hidden ? `Đã ẩn cột "${column.label}".` : `Đã hiện lại cột "${column.label}".`),
        (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được cột."),
      );
    },
    [actions, active, boardColumns, queryClient],
  );

  const openNewRecord = useCallback((): void => {
    if (active === null) return;
    // AVORA-72: the synced board's `+` is `Cơ hội mới` — a Hạng mục appears from the opportunity.
    if (isSyncBoard(active)) {
      setIsNewOpportunityOpen(true);
      return;
    }
    if (isTableFull(records, active.id)) {
      toast.error(`Bảng đã đủ ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục — tạo bảng con hoặc bảng mới.`);
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
    // AVORA-93 · 4.3 (ADR-061): the open Hạng mục lives in the address, so tab memory brings it back.
    // AVORA-94B: a Hạng mục is one step deeper → push; Back closes it (luật 1 / 5).
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set(OPEN_RECORD_PARAM, record.id);
      return next;
    });
  }, [setSearchParams]);
  const setRecordOpen = useCallback((open: boolean): void => {
    setIsRecordOpen(open);
    if (open) return;
    // Opened by a tap (push): close = one step back. Reopened from tab memory: just drop `hm`.
    const without = new URLSearchParams(searchParams);
    without.delete(OPEN_RECORD_PARAM);
    const query = without.toString();
    if (searchParams.get(OPEN_RECORD_PARAM) !== null && isPreviousEntry(`${location.pathname}${query === "" ? "" : `?${query}`}`)) {
      navigate(-1);
      return;
    }
    setSearchParams((current) => {
      if (current.get(OPEN_RECORD_PARAM) === null) return current;
      const next = new URLSearchParams(current);
      next.delete(OPEN_RECORD_PARAM);
      return next;
    }, { replace: true });
  }, [setSearchParams, searchParams, navigate, location.pathname]);
  // Back at `?hm=` (tab memory, reopen): open that Hạng mục again once the records are here.
  const keptRecordId: string | null = searchParams.get(OPEN_RECORD_PARAM);
  // AVORA-94B · luật 1: a step back that drops `hm` closes the Hạng mục with it.
  const lastKeptRef = useRef<string | null>(keptRecordId);
  useEffect(() => {
    const was = lastKeptRef.current;
    lastKeptRef.current = keptRecordId;
    if (was !== null && keptRecordId === null) {
      setIsRecordOpen(false);
      reopenedRef.current = null;
    }
  }, [keptRecordId]);
  const reopenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (keptRecordId === null || isPending || isRecordOpen || reopenedRef.current === keptRecordId) return;
    reopenedRef.current = keptRecordId;
    const record = records.find((entry) => entry.id === keptRecordId);
    if (record === undefined) return;
    setTargetTableId(record.tableId);
    setEditing(record);
    setIsRecordOpen(true);
  }, [keptRecordId, isPending, isRecordOpen, records]);

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
        const row = editing.opportunityId == null ? undefined : opportunityBoard.byId.get(editing.opportunityId);
        if (row !== undefined) {
          // AVORA-72: synced cells go back to Danh bạ / the opportunity; the rest stays on the board.
          const split = splitSyncPatch(patch);
          await saveSyncEdits(row, split.contact, split.opportunity);
          await actions.updateRecord(editing.id, split.board);
          invalidateOpportunityBoard();
          toast.success("Đã lưu.");
          return;
        }
        await actions.updateRecord(editing.id, patch);
        toast.success("Đã lưu.");
        return;
      }
      if (targetTable === null) return;
      if (isTableFull(records, targetTable.id)) {
        throw new Error(`Bảng đã đủ ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục — tạo bảng con hoặc bảng mới.`);
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
    [actions, editing, targetTable, records, opportunityBoard.byId, invalidateOpportunityBoard],
  );

  /**
   * AVORA-75 · 72: dragging a card to another column in `Theo trạng thái` changes its status. On the
   * synced board the status is the opportunity's stage — the server trigger carries it over.
   */
  const handleMoveRecord = useCallback(
    (record: ThinkRecord, status: string): void => {
      const isSynced = record.opportunityId != null;
      actions
        .updateRecord(record.id, { status })
        .then(() => {
          if (isSynced) invalidateOpportunityBoard();
          toast.success("Đã chuyển trạng thái.");
        })
        .catch((caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không chuyển được."));
    },
    [actions, invalidateOpportunityBoard],
  );

  /** AVORA-61 · D: a Có / Không cell ticks in place; the rest of the record's fields stay as they are. */
  const handleToggleCheckbox = useCallback(
    (record: ThinkRecord, column: ColumnDef, next: boolean): void => {
      actions
        .updateRecord(record.id, { extensionFields: { ...record.extensionFields, [column.key]: next ? "1" : null } })
        .catch((caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không lưu được."));
    },
    [actions],
  );

  /** AVORA-61 · E: every column action, in the ⋯ at the column's head. */
  const columnActionsFor = (table: ThinkTable): Omit<ColumnMenuActions, "onSort" | "onFilter"> => {
    const owns = table.ownerUserId === user?.id;
    const shared = table.conversationId !== null || table.projectId !== null;
    const readOnly = isReadOnly;
    if (readOnly) return { lockedReason: "Bảng đang chỉ xem." };
    const tableRecords = recordsOf(records, table.id);
    if (!owns) {
      return {
        lockedReason: "Chỉ chủ Bảng đổi được cột.",
        onRequestDelete: shared
          ? (column) =>
              void askText({ title: `Đề nghị xoá cột "${column.label}"`, body: "Lý do (chủ Bảng sẽ thấy trong cuộc trò chuyện).", confirmLabel: "Gửi đề nghị", maxLength: 300 }).then((reason) => {
                if (reason === null || reason.trim() === "") return;
                actions.requestColumnDelete({ tableId: table.id, columnId: column.id, reason }).then(
                  () => toast.success("Đã gửi đề nghị vào cuộc trò chuyện."),
                  (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không gửi được."),
                );
              })
          : undefined,
      };
    }
    return {
      lockedReason: null,
      onRename: (column) => {
        setRenamingTableId(table.id);
        setRenaming(column);
      },
      safeTypes: (column) => safeTypeChanges(column, tableRecords.map((record) => record.extensionFields[column.key] ?? null)),
      onChangeType: (column, type) =>
        void actions.changeColumnType({ tableId: table.id, columnId: column.id, type }).then(
          () => toast.success(`Cột "${column.label}" giờ là ${columnTypeLabel(type)}.`),
          (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được loại cột."),
        ),
      onHide: (column) =>
        isSyncColumnKey(column.key)
          ? handleToggleColumnHidden(column, true)
          : void actions.setColumnHidden({ tableId: table.id, columnId: column.id, hidden: true }).then(
          () => toast.success(`Đã ẩn cột "${column.label}".`),
          (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được cột."),
        ),
      onWidth: (column, width) =>
        void actions.setColumnWidth({ tableId: table.id, columnId: column.id, width }).catch((caught: unknown) =>
          toast.error(caught instanceof Error ? caught.message : "Không lưu được độ rộng cột."),
        ),
      onDelete: (column) => {
        const filled = filledCountOf(tableRecords, column);
        void askConfirm({
          title: `Xoá cột "${column.label}"?`,
          body: `${filled} Hạng mục đang có dữ liệu ở cột này. Cột vào Thùng rác của Bảng 30 ngày, khôi phục được kèm dữ liệu.`,
          confirmLabel: "Xoá cột",
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          actions.deleteColumn({ tableId: table.id, columnId: column.id }).then(
            () =>
              toast.success(`Đã xoá cột "${column.label}".`, {
                duration: 8000,
                action: {
                  label: "Hoàn tác",
                  onClick: () =>
                    void actions.restoreColumn({ tableId: table.id, columnId: column.id }).then(
                      () => toast.success("Đã khôi phục cột cùng dữ liệu."),
                      (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không khôi phục được."),
                    ),
                },
              }),
            (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không xoá được cột."),
          );
        });
      },
    };
  };

  /** AVORA-61 · H: a sub-table, opened right under its Hạng mục — read, edit, add, then fold away. */
  const renderSubTable = (sub: ThinkTable, mode: PhoneMode): ReactNode => (
    <div className="py-1" data-subtable={sub.id}>
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {/* The path line: `Anam Cam Ranh ›` — which Hạng mục this level grew from. */}
          <span className="text-muted-foreground">{records.find((record) => record.id === sub.parentRecordId)?.title ?? ""} › </span>
          <span className="font-semibold">{sub.name}</span>
        </span>
        <span className="tabular text-[12px] text-muted-foreground">{recordCountOf(records, sub.id)} Hạng mục</span>
        {!isReadOnly ? (
          <button
            type="button"
            onClick={() => {
              setTargetTableId(sub.id);
              setEditing(null);
              setIsRecordOpen(true);
            }}
            className="press inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-[12.5px] font-medium"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Hạng mục con
          </button>
        ) : null}
        <button type="button" onClick={() => openTable(sub.id)} className="press rounded-md px-2 text-[12.5px] font-medium text-primary">
          Mở
        </button>
      </div>
      {/* AVORA-65 · H: the very same grid as the board above — its own columns, ★, Tạo nhiệm vụ, ▸ to the next level, ⋯ on every column. */}
      <TableView
        tableId={sub.id}
        records={onlyStarred ? recordsOf(records, sub.id).filter((record) => stars.has(record.id)) : recordsOf(records, sub.id)}
        columns={sub.columns}
        onOpenRecord={openRecord}
        onAddColumn={sub.ownerUserId === user?.id && !isReadOnly ? () => {
          setAddColumnTableId(sub.id);
          setIsAddColumnOpen(true);
        } : undefined}
        columnActions={columnActionsFor(sub)}
        onToggleCheckbox={isReadOnly ? undefined : handleToggleCheckbox}
        onOpenContact={(contactId) => navigate(withReturn(`/lien-he/${contactId}`, hereFrom(location, "Kế hoạch")))}
        onQuickTask={isReadOnly ? undefined : setQuickTaskRecord}
        taskCountByRecord={taskCountByRecord}
        today={today}
        subTablesFor={(recordId) => subTablesOf(tables, recordId)}
        renderSubTable={renderSubTable}
        forcedMode={mode}
        stars={stars}
        onToggleStar={(record) => shelfActions.star.mutate(record.id)}
        marks={markingMarks}
        dots={isShared ? boardChanges.since : null}
        depth={sub.depth}
        isNested
      />
    </div>
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

  const savePurpose = useCallback(
    async (question: string, tableId?: string): Promise<void> => {
      const target = tableId ?? active?.id;
      if (target === undefined) return;
      try {
        await actions.setPurpose(target, question);
        setIsEditingPurpose(false);
        toast.success("Đã lưu câu hỏi của Bảng.");
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Không lưu được câu hỏi.");
      }
    },
    [actions, active],
  );

  /** `+ Ghi câu hỏi của Bảng` from a row on kệ 02 — asked in place, no need to open the board. */
  const askQuestionFor = useCallback(
    (tableId: string): void => {
      const table = tables.find((item) => item.id === tableId);
      void askText({ title: "Câu hỏi của Bảng", body: table?.name, confirmLabel: "Lưu", maxLength: 500, placeholder: guideQuestionOf(table?.thinkingType) ?? "Bảng này giúp bạn trả lời câu hỏi gì?" }).then(
        (question) => question !== null && void savePurpose(question, tableId),
      );
    },
    [tables, savePurpose],
  );

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

  const desk = useDesk();
  // AVORA-89 · 1.5: "lần mở cuối" is my own last open, not the last edit.
  const boardOpened = useBoardOpened();
  const markBoardOpened = boardOpened.markOpened;
  useEffect(() => {
    if (activeId !== null) markBoardOpened(activeId);
  }, [activeId, markBoardOpened]);
  useEffect(() => {
    if (activeView !== null) markBoardOpened(activeView);
  }, [activeView, markBoardOpened]);
  // AVORA-93 · PHẦN 2: one open + the minutes really spent on the board in focus (mine only).
  useActivityMeter("board", activeId ?? activeView ?? null);
  const [wantedDesk, setWantedDesk] = useState<string | null>(null);
  // ---------------------------------------------------------------- AVORA-81 · PHẦN 2 · Bàn nghĩ + cách bày
  const saved = useArrangement();
  const legacy = arrangementFromLegacy(searchParams.get(SHELF_PARAM));
  const bayParam = searchParams.get(ARRANGEMENT_PARAM);
  const arrangement: Arrangement = isArrangement(bayParam) ? bayParam : (legacy?.arrangement ?? saved.arrangement);
  const nganParam = searchParams.get(DRAWER_PARAM);
  const drawer: "sach" | "avora" | null = nganParam === "sach" || nganParam === "avora" ? nganParam : (legacy?.drawer ?? (activeView !== null ? "avora" : null));
  const setDrawer = (next: "sach" | "avora" | null): void => {
    const params = carryReturn(searchParams, new URLSearchParams());
    params.set(ARRANGEMENT_PARAM, arrangement);
    if (next !== null) params.set(DRAWER_PARAM, next);
    setActiveId(null);
    setSearchParams(params, { replace: true });
  };
  const chooseArrangement = (next: Arrangement): void => {
    saved.setArrangement(next);
    const params = carryReturn(searchParams, new URLSearchParams());
    params.set(ARRANGEMENT_PARAM, next);
    if (drawer !== null) params.set(DRAWER_PARAM, drawer);
    setSearchParams(params, { replace: true });
  };
  const placeKind = useCallback((board: ThinkTable): PlaceKind => {
    if (board.projectId !== null) return "project";
    if (board.conversationId === null) return "personal";
    return kindOf(board.conversationId) === "group" ? "group" : "direct";
  }, [kindOf]);
  const ownBoards = planned.filter((table) => table.ownerUserId === user?.id).length;
  const hotDefault = useDefaultShelfAttention();
  useEffect(() => {
    const onFull = (event: Event): void => setWantedDesk((event as CustomEvent<string>).detail);
    window.addEventListener(DESK_FULL_EVENT, onFull);
    return () => window.removeEventListener(DESK_FULL_EVENT, onFull);
  }, []);
  const [reviewOpen, setReviewOpen] = useState<"week" | "day" | null>(() => (searchParams.get("nhin-lai") === "week" ? "week" : searchParams.get("nhin-lai") === "day" ? "day" : null));
  const [pickedTile, setPickedTile] = useState<ReminderTile | null>(() => (isReminderTile(searchParams.get(HUB_TILE_PARAM)) ? (searchParams.get(HUB_TILE_PARAM) as ReminderTile) : null));
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isStoreOpen, setIsStoreOpen] = useState<boolean>(false);
  const [isShelfOpen, setIsShelfOpen] = useState<boolean>(false);
  const [isBooksOpen, setIsBooksOpen] = useState<boolean>(true);
  const [isDiaryOpen, setIsDiaryOpen] = useState<boolean>(() => roomFromUrl?.focus === "diary");
  useEffect(() => {
    if (roomFromUrl?.focus === "diary") setIsDiaryOpen(true);
  }, [roomFromUrl?.focus]);
  const [focusLane, setFocusLane] = useState<"waiting" | "thinking" | "concluded" | null>(null);
  const deskBook: DeskBook | null = useMemo(() => {
    const reading = bookshelfData.books.filter((book) => book.status === "dang_doc").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const book = reading[0];
    if (book === undefined) return null;
    const progress = readingProgress(bookshelfData.field(book, bookshelfData.keys.position));
    return { id: book.id, title: book.title, subtitle: bookshelfData.field(book, bookshelfData.keys.author) || null, percent: progress === null ? null : progress * 100 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field() reads keys
  }, [bookshelfData.books, bookshelfData.keys.position, bookshelfData.keys.author]);
  const createOnDesk = async (question: string): Promise<ThinkTable | null> => {
    try {
      const created = await actions.createTable({ name: question.slice(0, 120), purpose: question, conversationId: null });
      await setLifecycle(created.id, "thinking");
      return created;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa tạo được.");
      return null;
    }
  };
  const openJournal = async (onlyBookNotes = false): Promise<void> => {
    try {
      const journalId = findJournal(conversationsQuery.data)?.conversationId ?? (await ensureJournalConversation());
      const query = onlyBookNotes ? `?${DIARY_VIEW_PARAM}=${diaryViewSlug("notes")}&${NOTES_BOOKS_PARAM}=${NOTES_BOOKS_VALUE}` : "";
      navigate(withReturn(`/tin-nhan/${journalId}${query}`, hereFrom(location, "Kế hoạch")));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa mở được Nhật ký.");
    }
  };

  const goRoom = (to: RoomShelf, dir: "left" | "right" | "up" | "down" | null = null): void => {
    const params = carryReturn(searchParams, new URLSearchParams());
    params.set(ROOM_PARAM, String(to));
    setActiveId(null);
    setIsLibraryOpen(false);
    setIsStoreOpen(false);
    setRoomDir(dir ?? (to > room ? (to - room >= 3 ? "down" : "right") : room - to >= 3 ? "up" : "left"));
    // AVORA-101C: each shelf keeps its own scroll; coming back finds the same place.
    if (scrollRef.current !== null && inRoom) shelfScroll.current.set(room, scrollRef.current.scrollTop);
    setSearchParams(params, { replace: true });
    roomPrefs.saveRoom(to);
  };
  const inRoom = active === null && activeView === null && !isLibraryOpen && !isFullscreen;
  useEffect(() => {
    if (active === null && activeView === null) roomPrefs.saveRoom(room);
    rememberShelf(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remember where the person stands
  }, [room]);
  useLayoutEffect(() => {
    if (!inRoom) return;
    scrollRef.current?.scrollTo({ top: shelfScroll.current.get(room) ?? 0 });
  }, [room, inRoom]);
  useEffect(() => {
    if (!inRoom || isSearchOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || (target !== null && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))) return;
      const side = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : null;
      if (side === null) return;
      // ←/→ along the row; ↑/↓ change row, like `Kệ | Bàn` (to the last shelf stood on there).
      const to = side === "up" ? (rowOf(room) === "desk" ? lastShelfOfRow("wall") : null) : side === "down" ? (rowOf(room) === "wall" ? lastShelfOfRow("desk") : null) : neighbour(room, side);
      if (to === null) return;
      event.preventDefault();
      goRoom(to, side);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const closeFocus = useCallback((): void => {
    if (isLibraryOpen) setIsLibraryOpen(false);
    else if (activeView !== null) closeView();
    else closeBoard();
  }, [isLibraryOpen, activeView, closeView, closeBoard]);
  // 2.3 · one thing to focus on: the phone's top row becomes `‹ · name · kệ gốc · nơi · trạng thái`.
  useFocusHeader(
    isPhoneUpright && !isFullscreen && (active !== null || activeView !== null || isLibraryOpen)
      ? {
          title: active !== null ? active.name : activeView !== null ? viewBoardOf(activeView).name : "Mẫu bảng",
          subtitle:
            active !== null
              ? [shelfOfRoom(room).name, placeOf(active) ?? "Của tôi", lifecycleLabel(active.lifecycle)].join(" · ")
              : activeView !== null
                ? `${shelfOfRoom(room).name} · Bảng xem`
                : null,
          onBack: closeFocus,
        }
      : null,
  );
  const openQuestions = useOpenQuestions();
  const usage = useMemo(() => templateUsage(tables), [tables]);
  /** 2.2: a new board opens focused; on the desk if there is room (closes to kệ 6), else closes to kệ 3. */
  const onCreatedBoard = async (table: ThinkTable): Promise<void> => {
    let home: RoomShelf = 3;
    if (desk.ids.length < 5) {
      try {
        await desk.place.mutateAsync(table.id);
        home = 6;
      } catch {
        home = 3;
      }
    }
    openTable(table.id, home);
  };

  const roomTemplates = libraryTemplates(templatesQuery.data ?? [], { type: null, audiences: [] }, roomPrefs.audiences, usage.usedAt);
  const openTemplateLibrary = (): void => {
    setActiveId(null);
    setIsLibraryOpen(true);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const spinePreview = (id: "avora" | "desk" | "progress" | "books" | "diary"): SpinePreview => {
    switch (id) {
      case "avora":
        return { title: "Bảng Avora", count: DEFAULT_BOARDS.length, items: DEFAULT_BOARDS.slice(0, 5).map((def) => ({ key: def.key, label: def.name })), primary: { label: "Mở mặt bàn 4 ›", onPress: () => goRoom(4, "down") } };
      case "desk": {
        const onDesk = desk.ids.map((deskId) => tables.find((table) => table.id === deskId)).filter((table): table is ThinkTable => table !== undefined);
        return { title: "Bàn làm việc", count: onDesk.length, items: onDesk.map((table) => ({ key: table.id, label: table.purpose ?? table.name })), primary: { label: "Mở mặt bàn 6 ›", onPress: () => goRoom(6) } };
      }
      case "progress": {
        const recent = [...planned].filter((table) => table.archivedAt === null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return { title: "Tiến trình", count: recent.length, items: recent.slice(0, 5).map((table) => ({ key: table.id, label: table.purpose ?? table.name, sub: lifecycleLabel(table.lifecycle) })), primary: { label: "Mở kệ 3 ›", onPress: () => goRoom(3, "right") } };
      }
      case "books":
        return {
          title: "Sách",
          count: bookshelfData.books.length,
          items: bookshelfData.books.slice(0, 5).map((book) => ({ key: book.id, label: book.title, tone: coverColor(book.title) })),
          primary: { label: "Mở mặt bàn 5 ›", onPress: () => goRoom(5) },
          secondary: deskBook !== null ? { label: "Đọc tiếp", onPress: () => navigate(withReturn(`/ke-hoach/ke-sach/doc/${deskBook.id}`, hereFrom(location, "Kế hoạch"))) } : undefined,
        };
      case "diary":
        return {
          title: "Nhật ký",
          count: notesData.liveNotes.length,
          items: notesData.liveNotes.slice(0, 5).map((note) => ({ key: note.id, label: noteDisplayTitle(note) })),
          primary: { label: "Mở mặt bàn 5 ›", onPress: () => goRoom(5) },
          secondary: { label: "Mở Nhật ký", onPress: () => void openJournal() },
        };
    }
  };

  if (isPending) {
    return (
      <LoadingOrRetry className="paper" withBack={!isAreaRoot(location)} />
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

  /** AVORA-61 · C: the board's own actions, one list, shown beside its name. */
  const boardMenuItems: BoardMenuItem[] = (() => {
    if (active === null) return [];
    // AVORA-72 · Luật 2: no Xoá / Lưu trữ / Di chuyển / Đổi tên / Sửa mục tiêu — only `Ẩn khỏi danh sách`.
    if (isSyncBoard(active)) {
      return [
        {
          id: "hide-in-list",
          label: active.hiddenInList === true ? "Hiện trong danh sách" : "Ẩn khỏi danh sách",
          onSelect: () =>
            void setBoardView({ hiddenInList: active.hiddenInList !== true }).then(
              () => {
                void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
                toast.success(active.hiddenInList === true ? "Đã hiện lại trong danh sách." : "Đã ẩn khỏi danh sách. Hiện lại ở menu ⋯ của Bảng.");
              },
              (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được."),
            ),
        },
      ];
    }
    const isFixed = active.kind === "bookshelf" || isProjectRoot;
    const fixedReason = active.kind === "bookshelf" ? "Kệ sách là bảng hệ thống." : "Bảng gốc của Dự án đi cùng Dự án.";
    const items: BoardMenuItem[] = [
      {
        id: "rename",
        label: "Đổi tên",
        blockedReason: isFixed ? fixedReason : isReadOnly ? "Bảng đang chỉ xem." : null,
        onSelect: () => {
          setNameDraft(active.name);
          setIsRenamingTable(true);
        },
      },
      {
        id: "purpose",
        label: "Sửa câu hỏi của Bảng",
        blockedReason: isProjectRoot ? "Mục tiêu của Dự án sửa trong Dự án." : !isOwner ? "Chỉ chủ Bảng sửa câu hỏi." : isReadOnly ? "Bảng đang chỉ xem." : null,
        onSelect: () => {
          setPurposeDraft(active.purpose ?? "");
          setIsEditingPurpose(true);
        },
      },
    ];
    // AVORA-77 · A5: how this board thinks — the faint guide in an empty note follows it.
    if (active.kind === null && active.parentRecordId === null) {
      items.push({
        id: "thinking-type",
        label: "Kiểu tư duy",
        blockedReason: isReadOnly ? "Bảng đang chỉ xem." : active.shareMode === "view" && !isOwner ? "Bảng đang Chỉ xem." : null,
        onSelect: () => setIsThinkingTypeOpen(true),
      });
    }
    if (isOwner && !isReadOnly) items.push({ id: "template", label: "Lưu làm mẫu của tôi", onSelect: () => setSaveTemplateTarget(active) });
    // AVORA-69: the one way a board changes place — no "Sao chép sang".
    items.push({
      id: "move",
      label: "Di chuyển Bảng…",
      blockedReason: isFixed
        ? fixedReason
        : active.parentRecordId !== null
          ? "Bảng con đi theo bảng cha."
          : !isOwner
            ? "Chỉ chủ Bảng di chuyển được."
            : isReadOnly
              ? "Bảng đang chỉ xem."
              : null,
      onSelect: () => setIsMoveOpen(true),
    });
    // AVORA-69: the owner flips `Cùng sửa` / `Chỉ xem` of a board already shared into a conversation.
    if (isOwner && active.conversationId !== null && active.parentRecordId === null && !isFixed) {
      const nextMode: "edit" | "view" = active.shareMode === "view" ? "edit" : "view";
      items.push({
        id: "share-mode",
        label: nextMode === "view" ? "Đổi sang Chỉ xem" : "Đổi sang Cùng sửa",
        onSelect: () =>
          void moveThinkTable({ tableId: active.id, conversationId: active.conversationId, mode: nextMode }).then(
            () => {
              void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
              toast.success(nextMode === "view" ? "Mọi người giờ chỉ xem Bảng này." : "Mọi người giờ cùng sửa được Bảng này.");
            },
            (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được."),
          ),
      });
    }
    if (isShared) {
      items.push({ id: "history", label: "Lịch sử thay đổi", onSelect: () => setIsHistoryOpen(true) });
      if (active.parentRecordId === null && active.kind !== "bookshelf") {
        items.push({
          id: "desk",
          label: desk.ids.includes(active.id) ? "Đặt xuống khỏi bàn" : "Đặt lên bàn",
          onSelect: () => {
            if (desk.ids.includes(active.id)) {
              desk.remove.mutate(active.id, { onSuccess: () => toast.success("Đã đặt xuống.") });
              return;
            }
            desk.place.mutate(active.id, {
              onSuccess: () => toast.success("Đã đặt lên Bàn nghĩ."),
              onError: (caught) => (caught.message === "Bàn đã đủ 5" ? setWantedDesk(active.id) : toast.error(caught.message)),
            });
          },
        });
      }
      items.push({
        id: "announce-settings",
        label: "Báo thay đổi",
        blockedReason: isOwner ? null : "Chủ Bảng chọn cách báo.",
        onSelect: () => setIsAnnounceSettingsOpen(true),
      });
    }
    if (isOwner && (active.columnTrash ?? []).length > 0) {
      items.push({ id: "column-trash", label: `Cột đã xoá (${(active.columnTrash ?? []).length})`, onSelect: () => setIsColumnTrashOpen(true) });
    }
    if (isShared && active.kind === null) {
      items.push({
        id: "copy",
        label: "Sao chép về Nhật ký",
        onSelect: () =>
          void shelfActions.copyToJournal.mutateAsync(active.id).then(
            (copied) => {
              toast.success("Đã sao chép về Nhật ký (chỉ Hạng mục của bạn).");
              openTable(copied.id);
            },
            (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không sao chép được."),
          ),
      });
    }
    const isSubTable = active.parentRecordId !== null;
    if (!isShared) {
      items.push({
        id: "archive",
        label: isArchived ? "Mở lại" : "Lưu trữ",
        separated: true,
        blockedReason: isFixed ? fixedReason : isSubTable ? "Bảng con lưu trữ cùng Bảng chứa nó." : null,
        onSelect: () =>
          void shelfActions.archive.mutateAsync({ tableId: active.id, archived: !isArchived }).then(
            () => toast.success(isArchived ? "Đã mở lại Bảng." : "Đã lưu trữ Bảng — chỉ xem."),
            (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không đổi được."),
          ),
      });
      items.push({
        id: "delete",
        label: "Xoá Bảng",
        danger: true,
        blockedReason: isFixed ? fixedReason : !isOwner ? "Chỉ chủ Bảng xoá được." : null,
        onSelect: () => setDeleteTarget(active),
      });
    } else {
      items.push({
        id: "archive",
        label: isArchived ? "Đề nghị mở lại" : "Đề nghị lưu trữ",
        separated: true,
        blockedReason: isFixed ? fixedReason : isSubTable || active.projectId !== null ? "Bảng này lưu trữ cùng nơi chứa nó." : null,
        onSelect: () => setProposeTarget({ action: isArchived ? "reopen" : "archive", targetType: "think_hub_table", targetId: active.id, name: active.name }),
      });
      items.push({
        id: "delete",
        label: "Đề nghị xoá",
        danger: true,
        blockedReason: isFixed ? fixedReason : null,
        onSelect: () => setProposeTarget({ action: "delete", targetType: "think_hub_table", targetId: active.id, name: active.name }),
      });
    }
    return items;
  })();

  const currentShelf: ShelfId | null = (() => {
    const named = searchParams.get(SHELF_PARAM);
    if (isShelfId(named)) return named;
    if (active !== null) return shelfForTable(active.id);
    return initialShelf(null, isPhoneUpright);
  })();
  const shelfMeta = currentShelf === null ? null : shelfOf(currentShelf);
  // A phone swaps the whole screen for the open board; a computer keeps the library above it.
  // AVORA-89 · 2.3: one thing at a time — an open board / view / library replaces the room on every screen.
  const showLibrary: boolean = inRoom;
  const requestedTile = searchParams.get(HUB_TILE_PARAM);

  const renderShelf = (id: ShelfId): ReactNode => {
    switch (id) {
      case "mac-dinh":
        return (
          <DefaultShelf
            boards={defaultBoards}
            countOf={(tableId) => recordCount.get(tableId) ?? 0}
            activeId={active?.id ?? null}
            activeView={activeView}
            onOpenView={openView}
            onOpen={(tableId) => {
              openTable(tableId);
              setView("table");
            }}
          />
        );
      case "hoach-dinh":
        return (
          <PlannedShelf
            boards={planned}
            kindOf={kindOf}
            placeOf={placeOf}
            countOf={(tableId) => recordCount.get(tableId) ?? 0}
            activeId={active?.id ?? null}
            onOpen={openTable}
            onAskQuestion={askQuestionFor}
            onNewBoard={() => {
              setGalleryConversationId(null);
              setIsNewTableOpen(true);
            }}
          />
        );
      case "trang-thai":
        return <LifecycleShelf boards={planned} placeOf={placeOf} onOpen={openTable} />;
      case "ke-sach":
        return <BookshelfPanel addRequest={addBookRequest} />;
      case "nhat-ky":
        return <DiaryShelf />;
      case "khac":
        return <OtherShelf noQuestion={noQuestion} archived={archivedBoards} binCount={binnedPersonal.length} onOpen={openTable} onOpenTrash={() => setIsTrashOpen(true)} />;
    }
  };

  return (
    <div className={cn("paper relative flex min-h-0 flex-1 flex-col", isFullscreen && "fixed inset-0 z-50 bg-background")} data-focus-room={isFullscreen ? "" : undefined} data-room={room}>
      {isSearchOpen && !isFullscreen ? (
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:px-10" data-plan-search="">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-card px-3 focus-within:border-personal">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                autoFocus
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setLibraryQuery("");
                    setIsSearchOpen(false);
                  }
                }}
                placeholder="Tìm Bảng, sách, câu hỏi…"
                aria-label="Tìm trong Kế hoạch"
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14.5px]"
              />
            </label>
            <button type="button" onClick={() => { setLibraryQuery(""); setIsSearchOpen(false); }} className="press h-11 px-2 text-[15px] font-medium text-personal">Huỷ</button>
          </div>
          {libraryQuery.trim() !== "" ? (
            <ul className="mx-auto mt-2 max-h-[60vh] max-w-6xl overflow-y-auto rounded-card border border-border bg-card" data-library-results="">
              {searchViewBoards(libraryQuery).map((def) => (
                <li key={`v-${def.key}`} className="border-b border-border/60">
                  <button type="button" onClick={() => { setLibraryQuery(""); setIsSearchOpen(false); openView(def.key); }} className="press flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/25">
                    <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">{def.name}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{def.goal}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">Avora lập sẵn</span>
                  </button>
                </li>
              ))}
              {libraryHits.map((hit) => (
                <li key={hit.kind === "board" ? `b-${hit.table.id}` : `s-${hit.record.id}`} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setLibraryQuery("");
                      setIsSearchOpen(false);
                      if (hit.kind === "board") openTable(hit.table.id);
                      else navigate(`/ke-hoach?${ARRANGEMENT_PARAM}=noi&${DRAWER_PARAM}=sach&sach=${encodeURIComponent(hit.record.id)}`);
                    }}
                    className="press flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/25"
                  >
                    {hit.kind === "board" ? <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">{hit.kind === "board" ? hit.table.name : hit.record.title}</span>
                      {hit.detail !== null ? <span className="block truncate text-[12.5px] text-muted-foreground">{hit.detail}</span> : null}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{hit.kind === "book" ? "Sách" : (placeOf(hit.table) ?? "Của tôi")}</span>
                  </button>
                </li>
              ))}
              {libraryHits.length === 0 && searchViewBoards(libraryQuery).length === 0 ? <li className="px-4 py-3 text-[13.5px] text-muted-foreground">Không thấy gì khớp “{libraryQuery.trim()}”.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      {isFullscreen || isSearchOpen ? null : (
      <HubTitle
        title="Kế hoạch"
        action={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsSearchOpen(true)} aria-label="Tìm trong Kế hoạch" data-plan-search-button="" className="icon-btn h-11 w-11 text-foreground">
              <Search className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </button>
            {/* AVORA-57 · E: one `+` — tap adds a Hạng mục, hold (or ▾) offers Hạng mục / Bảng.
                AVORA-101C: among the books (kệ 5 · Sách) the same `+` adds a book; never an orange pill. */}
            <PlanPlusButton
              canAddRecord={active !== null && !isReadOnly}
              onNewRecord={openNewRecord}
              onNewTable={() => {
                if (!roomPrefs.audiencesAsked) setIsAudienceAskOpen(true);
                setActiveId(null);
                setIsLibraryOpen(true);
              }}
              onAddBook={
                active === null && activeView === null && (drawer === "sach" || (inRoom && room === 5))
                  ? () => {
                      setIsShelfOpen(true);
                      setIsBooksOpen(true);
                      setAddBookRequest((count) => count + 1);
                    }
                  : undefined
              }
            />
          </div>
        }
      />
      )}
      {inRoom && !isSearchOpen ? <RoomStrip shelf={room} onGo={(to, dir) => goRoom(to, dir)} onOpenMap={() => setIsRoomMapOpen(true)} /> : null}
      <div
        ref={scrollRef}
        data-scroll-memory=""
        onScroll={(event) => {
          if (inRoom) shelfScroll.current.set(room, event.currentTarget.scrollTop);
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto", inRoom && (room <= 3 ? "bg-[hsl(var(--room-wall)/0.45)]" : "bg-[hsl(var(--room-desk)/0.45)]"))}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (isFullscreen) swipeRef.current = { y: touch?.clientY ?? 0, atTop: (scrollRef.current?.scrollTop ?? 0) <= 0 };
          // 2.2: a sideways swipe on the open floor changes shelf — never inside chips, desk cards or a wide table.
          roomSwipeRef.current = inRoom ? { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0, skip: startsInHorizontalScroller(event.target, scrollRef.current) } : null;
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (isFullscreen) {
            const start = swipeRef.current;
            swipeRef.current = null;
            // A swipe down from the very top leaves the focus room.
            if (start !== null && start.atTop && (touch?.clientY ?? 0) - start.y > 110) setFullscreen(false);
          }
          const begin = roomSwipeRef.current;
          roomSwipeRef.current = null;
          if (begin === null || begin.skip || touch === undefined) return;
          const side = swipeDirection(touch.clientX - begin.x, touch.clientY - begin.y);
          const to = side === null ? null : neighbour(room, side);
          if (side !== null && to !== null) goRoom(to, side);
        }}
      >
      {/* AVORA-93 · 4.3: a focused Bảng has no tab bar; this strip brings it up for a moment. */}
      {isPhoneUpright && !inRoom && (active !== null || activeView !== null) ? <BottomTabStrip /> : null}
      <div data-under-tabs="" className={cn("mx-auto px-4 pt-4 sm:px-6 md:px-10 short:px-4", isFullscreen || (overview.isOn && overview.isWide) ? "max-w-none pb-10 pt-2" : "max-w-6xl", inRoom ? "pb-24" : isPhoneUpright && (active !== null || activeView !== null) ? "pb-[calc(2.5rem+28px)]" : "pb-10")}>

        {isFullscreen ? null : <InlineBack className="-mt-2 mb-2" />}
        {isLibraryOpen && active === null && activeView === null ? (
          <TemplateLibrary
            templates={templatesQuery.data ?? []}
            mine={roomPrefs.audiences}
            usedAt={usage.usedAt}
            places={places}
            onCreated={(table) => void onCreatedBoard(table)}
            onChangeRoles={() => setIsAudienceAskOpen(true)}
          />
        ) : null}
        {showLibrary ? (
          <RoomStage shelf={room} dir={roomDir}>
            {room === 1 ? (
              <OverviewShelf
                counts={{
                  avora: DEFAULT_BOARDS.length,
                  desk: desk.ids.length,
                  progress: planned.filter((table) => table.archivedAt === null).length,
                  books: bookshelfData.books.length,
                  diary: notesData.liveNotes.length,
                  templates: roomTemplates.length,
                }}
                previewOf={spinePreview}
                templates={roomTemplates}
                templateCount={roomTemplates.length}
                usedCount={usage.count}
                onUseTemplate={setPlacingTemplate}
                onOpenLibrary={openTemplateLibrary}
                onFirstTemplates={() => {
                  if (!roomPrefs.audiencesAsked) setIsAudienceAskOpen(true);
                }}
              />
            ) : room === 2 ? (
              <div className="space-y-5" data-room-two="">
              {/* AVORA-93 · PHẦN 2: my numbers first (hidden until there is at least one open, or by ⋯ › Ẩn số liệu). */}
              <div className="flex justify-end -mb-3"><StatsMenu /></div>
              <RoomNumbers
                isWide={!isPhoneUpright}
                onOpenBoard={(key) => (/^[0-9a-f]{8}-/.test(key) ? openTable(key, 2) : navigate(`/ke-hoach?ke=4&bang=${key}`))}
                onOpenBook={(id) => navigate(withReturn(`/ke-hoach/ke-sach/doc/${id}`, hereFrom(location, "Kế hoạch")))}
                onOpenLane={(lane) => {
                  setFocusLane(lane);
                  goRoom(3);
                }}
                onOpenTasks={() => navigate(withReturn("/nhiem-vu?muc=viec", hereFrom(location, "Kế hoạch")))}
              />
              <ThinkingOverview
                boards={planned}
                deskIds={desk.ids}
                openQuestions={openQuestions}
                placeOf={placeOf}
                onOpen={(id) => openTable(id, 2)}
                onAskQuestions={(ids) => ids[0] !== undefined && askQuestionFor(ids[0])}
                onGo={(to) => goRoom(to)}
              />
              </div>
            ) : room === 3 ? (
              <>
                {showCleanup ? <CleanupCard onLater={laterCleanup} /> : null}
                <ProgressMatrix
                  focusLane={focusLane}
                  boards={planned}
                  placeKind={placeKind}
                  placeOf={placeOf}
                  archivedCount={archivedBoards.length}
                  binCount={binnedPersonal.length}
                  onOpen={(id) => openTable(id, 3)}
                  onOpenArchive={() => setIsStoreOpen((open) => !open)}
                  onOpenTrash={() => setIsTrashOpen(true)}
                />
                {isStoreOpen || roomFromUrl?.focus === "store" ? (
                  <div className="mt-3" data-room-store="">
                    <OtherShelf noQuestion={[]} archived={archivedBoards} binCount={binnedPersonal.length} onOpen={(id) => openTable(id, 3)} onOpenTrash={() => setIsTrashOpen(true)} />
                  </div>
                ) : null}
              </>
            ) : room === 4 ? (
              <div data-room-shelf="4">{renderShelf("mac-dinh")}</div>
            ) : room === 5 ? (
              <div data-room-shelf="5">
                <div className="flex justify-end"><StatsMenu /></div>
                {/* AVORA-93 · PHẦN 2 · 3 / AVORA-94 · B2.3: computer = two columns as in Ke2-Ke5-So-Lieu.png
                    (left: reading time + books · right: book notes); a phone reads time → notes → books. */}
                {/* AVORA-101C · two zones, no second strip: Sách open, Nhật ký one folded row. */}
                <ShelfZone id="books" label="Sách" count={bookshelfData.books.length} open={isBooksOpen} onToggle={() => setIsBooksOpen((open) => !open)}>
                <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-4" data-room-five-top="">
                  <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4" data-room-five-col="left">
                    <div className="order-1 min-w-0">
                      <ReadingTime
                        books={bookshelfData.books.map((book) => ({ id: book.id, title: book.title, percent: lastRead.percentOf.get(book.id) ?? null }))}
                        continueBook={lastRead.latest !== null ? { id: lastRead.latest.id, title: lastRead.latest.title } : null}
                        onOpenBook={(id) => navigate(withReturn(`/ke-hoach/ke-sach/doc/${id}`, hereFrom(location, "Kế hoạch")))}
                      />
                    </div>
                    {isShelfOpen ? null : (
                      <div className="order-3 hidden min-w-0 md:block">
                        <BooksCard
                          books={bookshelfData.books}
                          onOpenBook={(id) => navigate(withReturn(`/ke-hoach/ke-sach/doc/${id}`, hereFrom(location, "Kế hoạch")))}
                          onOpenShelf={() => setIsShelfOpen(true)}
                        />
                      </div>
                    )}
                    {/* Phone: the shelf as before. Computer: behind the card until asked for. */}
                    <section id="room-books" data-room-section="books" className={cn("order-3 min-w-0", !isShelfOpen && "md:hidden")}>{renderShelf("ke-sach")}</section>
                  </div>
                  <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4" data-room-five-col="right">
                    <div className="order-2 min-w-0">
                      <BookNotes
                        notes={notesData.liveNotes}
                        onShelf={new Set(bookshelfData.books.map((book) => book.id))}
                        isWide={!isPhoneUpright}
                        onOpenAt={(note) => navigate(withReturn(`/ke-hoach/ke-sach/doc/${note.bookRecordId ?? ""}${note.bookLocator != null ? `?o=${note.bookLocator}` : ""}`, hereFrom(location, "Kế hoạch")))}
                        onOpenAll={() => void openJournal(true)}
                      />
                    </div>
                  </div>
                </div>
                </ShelfZone>
                <ShelfZone id="diary" label="Nhật ký" count={notesData.liveNotes.length} open={isDiaryOpen} onToggle={() => setIsDiaryOpen((open) => !open)}>
                  <section id="room-diary" data-room-section="diary" className="min-w-0">
                    <DiaryShelf />
                  </section>
                </ShelfZone>
              </div>
            ) : (
              <WorkDesk boards={tables} placeOf={placeOf} countOf={(id) => recordCount.get(id) ?? 0} onOpen={(id) => openTable(id, 6)} onCreate={createOnDesk} onFull={setWantedDesk} onGo={(to) => goRoom(to)} />
            )}
          </RoomStage>
        ) : null}
        <RoomMapSheet
          open={isRoomMapOpen}
          shelf={room}
          summaries={{
            1: "6 gáy",
            2: `${planned.filter((table) => table.lifecycle === "thinking").length} đang nghĩ`,
            3: "nơi × tiến trình",
            4: `${DEFAULT_BOARDS.length} bảng xem`,
            5: `${bookshelfData.books.length} sách · ${notesData.liveNotes.length}`,
            6: `trên bàn ${desk.ids.length}/5`,
          }}
          onOpenChange={setIsRoomMapOpen}
          onGo={(to) => {
            setIsRoomMapOpen(false);
            goRoom(to);
          }}
        />
        <PlacePicker template={placingTemplate} places={places} onClose={() => setPlacingTemplate(null)} onCreated={(table) => void onCreatedBoard(table)} />
        <AudienceAsk
          open={isAudienceAskOpen}
          initial={roomPrefs.audiences}
          onDone={(picked) => {
            setIsAudienceAskOpen(false);
            // Asked once: skipping is an answer too. Closing the sheet when changing roles keeps them.
            if (picked === null && roomPrefs.audiencesAsked) return;
            roomPrefs.saveAudiences(picked ?? []);
            if (picked !== null && picked.length > 0) openTemplateLibrary();
          }}
        />
        {!isFullscreen && (active !== null || activeView !== null) ? (
          <EdgeArrows home={room} title={active?.name ?? (activeView !== null ? viewBoardOf(activeView).name : "")} onGo={(to) => goRoom(to)} />
        ) : null}
        {reviewOpen !== null ? <ReviewSheet kind={reviewOpen} review={review} open onOpenChange={(next) => !next && setReviewOpen(null)} /> : null}
        <DeskFullSheet wanted={wantedDesk} boards={tables} placeOf={placeOf} onClose={() => setWantedDesk(null)} />

        {active === null && activeView !== null ? (
          <>
            {isFullscreen ? null : (
              <button type="button" onClick={closeView} data-board-back="" className="press mt-5 inline-flex min-h-10 items-center gap-0.5 rounded-md pr-2 text-[13.5px] font-medium text-personal">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Kệ · Avora lập sẵn
              </button>
            )}
            <ViewBoardPanel boardKey={activeView} isFullscreen={isFullscreen} onFullscreen={setFullscreen} onClose={closeView} />
          </>
        ) : null}

        {active === null ? null : overview.isOn && !overview.isWide && overview.tree !== null ? (
          <OverviewColumns
            tree={overview.tree}
            columns={overview.columns}
            isTwoUp={overview.isTwoUp}
            onlyOpen={overview.onlyOpen}
            onToggleOnlyOpen={overview.toggleOnlyOpen}
            tasksOf={overview.tasksOf}
            taskById={overview.taskById}
            canEdit={!isReadOnly}
            onGo={overview.go}
            onBack={overview.back}
            onHome={closeBoard}
            onShowBoard={() => overview.setMode("board")}
            onAddRecord={(boardId) => {
              setTargetTableId(boardId);
              setEditing(null);
              setIsRecordOpen(true);
            }}
            onAddTask={(recordId) => {
              const record = records.find((entry) => entry.id === recordId);
              if (record !== undefined) setQuickTaskRecord(record);
            }}
            onLinkTask={(recordId) => {
              const record = records.find((entry) => entry.id === recordId);
              if (record !== undefined) setLinkTaskRecord(record);
            }}
            onRecordDetails={(recordId) => {
              const record = records.find((entry) => entry.id === recordId);
              if (record !== undefined) openRecord(record);
            }}
          />
        ) : (
          <div
            data-overview-desk={overview.isOn ? "" : undefined}
            className={cn(overview.isOn && "mt-3 grid grid-cols-[300px_minmax(0,1fr)_420px] items-start gap-0 overflow-hidden rounded-card border border-border bg-card/40")}
          >
          {overview.isOn && overview.tree !== null ? (
            <aside className="sticky top-2 max-h-[calc(100dvh-7rem)] overflow-y-auto border-r border-border/70 bg-secondary/30 px-2 py-3">
              <OverviewTree
                tree={overview.tree}
                activeBoardId={active.id}
                selectedKey={overview.recordKey}
                selectedTaskId={overview.taskId}
                onlyOpen={overview.onlyOpen}
                onToggleOnlyOpen={overview.toggleOnlyOpen}
                tasksOf={overview.tasksOf}
                onOpenBoard={(boardId) => overview.go({ board: boardId, record: null, task: null }, "push")}
                onOpenRecord={(node) => overview.go({ board: node.kind === "unlinked" ? (overview.tree?.root?.id ?? active.id) : (node.parentId ?? active.id), record: node.kind === "unlinked" ? "chua-gan" : node.id, task: null }, "push")}
                onOpenTask={(node, task) =>
                  overview.go({ board: node.kind === "unlinked" ? (overview.tree?.root?.id ?? active.id) : (node.parentId ?? active.id), record: node.kind === "unlinked" ? "chua-gan" : node.id, task: task.id }, "push")
                }
              />
            </aside>
          ) : null}
          <div className={cn("min-w-0", overview.isOn && "px-6 pb-8")} data-overview-middle={overview.isOn ? "" : undefined}>
            {isFullscreen ? null : (
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={closeBoard} data-board-back="" className="press mt-5 inline-flex min-h-10 items-center gap-0.5 rounded-md pr-2 text-[13.5px] font-medium text-personal">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Kệ
                </button>
                {active.kind === "bookshelf" ? null : (
                  <OverviewToggle
                    mode={overview.mode}
                    onChange={overview.setMode}
                    taskColumnHidden={overview.isOn && overview.isWide && overview.isTaskColumnHidden}
                    onShowTaskColumn={overview.showTaskColumn}
                  />
                )}
              </div>
            )}
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
                    className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[18px] font-semibold text-foreground outline-none focus:border-personal"
                  />
                  <button type="submit" className="press h-11 rounded-md bg-personal px-4 text-[14px] font-semibold text-personal-foreground">
                    Lưu
                  </button>
                  <button type="button" onClick={() => setIsRenamingTable(false)} className="press h-11 rounded-md border border-border px-3 text-[14px]">
                    Huỷ
                  </button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center gap-1">
                  {isReadOnly || active.kind === "bookshelf" || isProjectRoot || isSynced ? (
                    <h2 className="min-w-0 truncate text-[20px] font-semibold tracking-tight text-foreground">{active.name}</h2>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNameDraft(active.name);
                        setIsRenamingTable(true);
                      }}
                      title="Chạm để đổi tên"
                      className="press group -mx-1 inline-flex min-w-0 max-w-full items-center gap-2 rounded-md px-1 text-left"
                    >
                      <h2 className="truncate text-[20px] font-semibold tracking-tight text-foreground">{active.name}</h2>
                      <Pencil className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  )}
                  {/* AVORA-61 · C: every board action lives here, beside the name — not by the Hạng mục toolbar. */}
                  <BoardMenu boardName={active.name} items={boardMenuItems} />
                  {/* AVORA-62 · B: only while I have changes not yet announced. */}
                  {isShared && (active.announceMode ?? "manual") !== "silent" ? (
                    <AnnounceButton
                      count={boardChanges.pending.reduce((sum, change) => sum + (change.kind === "record_edit" ? change.cells : 1), 0)}
                      onClick={() => setIsAnnounceOpen(true)}
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* AVORA-69: where this board lives now, and how it is shared. */}
            {active.conversationId !== null && active.parentRecordId === null ? (
              <p data-board-place="" className="mt-1 text-[12.5px] text-muted-foreground">
                Đang ở {(() => {
                  const here = conversationById.get(active.conversationId);
                  return here === undefined ? "cuộc trò chuyện" : conversationTitle(here);
                })()} · {active.shareMode === "view" ? "Chỉ xem" : "Cùng sửa"}
              </p>
            ) : null}

            {isSynced ? (
              <OpportunityBoardBar chip={stageChip} onChip={setStageChip} records={visibleRecords} isEmpty={opportunityBoard.rows.filter((row) => row.removedAt === null).length === 0} onNew={() => setIsNewOpportunityOpen(true)} />
            ) : null}

            <BoardHead
              key={active.id}
              table={active}
              isReadOnly={isReadOnly}
              scopeLabel={scopeLabel(active)}
              editingQuestion={isEditingPurpose}
              onEditingQuestion={setIsEditingPurpose}
              onSaveQuestion={(question) => savePurpose(question)}
              projectLines={isProjectRoot ? { guide: activeProject?.valueOrientation ?? null, objective: activeProject?.objective ?? null } : null}
            />

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
            {/* AVORA-62 · E: no need to wait to be told — what changed since I last looked. */}
            {isShared && marking === null ? (
              <ChangesSinceLine
                count={boardChanges.since.count}
                onView={() => {
                  setMarking("since");
                  setIsMarkingSeen(false);
                }}
              />
            ) : null}
            {markingMarks !== null ? (
              <MarkingBar
                count={markingMarks.count}
                onDone={() => {
                  setIsMarkingSeen(true);
                  window.setTimeout(() => setMarking(null), 1300);
                }}
              />
            ) : null}
            <NudgeLines onOpen={(nudge) => openTable(nudge.tableId)} />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              {/* AVORA-65 · C: one row. A phone held upright adds `Thẻ` in front; the computer keeps three. */}
              <div role="group" aria-label="Kiểu xem" className="inline-flex max-w-full overflow-x-auto rounded-md border border-border p-0.5">
                {(
                  [
                    ...(isPhoneUpright ? ([["cards", "Thẻ", LayoutList]] as const) : []),
                    ["table", "Bảng", Table2],
                    ["kanban", "Theo trạng thái", KanbanSquare],
                    ["mindmap", "Cây", Network],
                  ] as const
                ).map(([value, label, Icon]) => {
                  const isOn =
                    value === "cards"
                      ? view === "table" && phoneMode === "cards"
                      : value === "table"
                        ? view === "table" && (!isPhoneUpright || phoneMode === "table")
                        : view === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={isOn}
                      onClick={() => {
                        if (value === "cards" || (value === "table" && isPhoneUpright)) {
                          setView("table");
                          setPhoneMode(value);
                          if (active !== null) writePhoneMode(active.id, value);
                          return;
                        }
                        setView(value);
                      }}
                      className={cn(
                        "press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-[14px] font-medium transition-colors sm:px-3",
                        isOn ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-[16px] w-[16px]" strokeWidth={1.8} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
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
                    className="press inline-flex min-h-9 items-center gap-1 rounded-md bg-personal px-3 text-[13.5px] font-semibold text-personal-foreground"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> {isSynced ? "Cơ hội mới" : "Hạng mục"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFullscreen(!isFullscreen)}
                  aria-label={isFullscreen ? "Thu nhỏ" : "Mở to tập trung"}
                  title={isFullscreen ? "Thu nhỏ (Esc)" : "Mở to tập trung"}
                  className="press inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2.5 text-[13px]"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  {isFullscreen ? <span>Thu nhỏ</span> : null}
                </button>
              </div>
              {isTableFull(records, active.id) ? (
                <p role="status" className="w-full text-[13.5px] text-destructive">
                  {active.syncSource === "contact_opportunities"
                    ? `Bảng đã đủ ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục. Cơ hội tạo từ Danh bạ vẫn được lưu và vẫn lên bảng này; chỉ thêm tay ở đây là bị chặn.`
                    : `Bảng đã đủ ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục — tạo bảng con hoặc bảng mới.`}
                </p>
              ) : null}
            </div>

            {visibleRecords.length === 0 && !onlyStarred && (active.purpose !== null || active.sourceTemplateKey !== null) ? (
              <div className="mt-4 rounded-card border border-dashed border-border px-5 py-5 text-center">
                {active.purpose !== null ? <p className="text-[15px] font-medium text-foreground">{active.purpose}</p> : null}
                {isOwner && !isReadOnly && active.sourceTemplateKey === null && active.columns.length === 0 ? (
                  <ApplyTemplateRow tableId={active.id} templates={templatesQuery.data ?? []} onApply={(template) => shelfActions.apply.mutateAsync({ tableId: active.id, template }).then(() => toast.success("Đã áp mẫu."), (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không áp được mẫu."))} />
                ) : null}
              </div>
            ) : null}

            <div
              data-change-seen={isMarkingSeen ? "true" : "false"}
              onScroll={() => undefined}
              onPointerDown={(event) => {
                holdRef.current.fired = false;
                const row = (event.target as HTMLElement).closest<HTMLElement>("[data-record-id]");
                const id = row?.getAttribute("data-record-id") ?? null;
                if (isReadOnly || id === null || event.button !== 0) return;
                endHold();
                holdRef.current.x = event.clientX;
                holdRef.current.y = event.clientY;
                holdRef.current.timer = window.setTimeout(() => {
                  holdRef.current.timer = null;
                  holdRef.current.fired = true;
                  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
                  setSelectStart(id);
                }, LONG_PRESS_MS);
              }}
              onPointerMove={(event) => {
                if (Math.abs(event.clientX - holdRef.current.x) > LONG_PRESS_SLOP_PX || Math.abs(event.clientY - holdRef.current.y) > LONG_PRESS_SLOP_PX) endHold();
              }}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onClickCapture={(event) => {
                // A hold already answered: the click that follows must not also open the Hạng mục.
                if (!holdRef.current.fired) return;
                holdRef.current.fired = false;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
            {/* Rendered even when empty: the columns ARE what a new table is offering. */}
            {view === "table" ? (
              <TableView
                tableId={active.id}
                records={visibleRecords}
                columns={boardColumns}
                onOpenRecord={openRecord}
                onAddColumn={isOwner && !isReadOnly ? () => {
                  setAddColumnTableId(null);
                  setIsAddColumnOpen(true);
                } : undefined}
                columnActions={columnActionsFor(active)}
                onResizeColumn={isOwner && !isReadOnly ? handleResizeColumn : undefined}
                onShowColumn={isOwner && !isReadOnly ? (column) => handleToggleColumnHidden(column, false) : undefined}
                onToggleCheckbox={isReadOnly ? undefined : handleToggleCheckbox}
                onOpenContact={(contactId) => navigate(withReturn(`/lien-he/${contactId}`, hereFrom(location, "Kế hoạch")))}
                onQuickTask={isReadOnly ? undefined : setQuickTaskRecord}
                taskCountByRecord={taskCountByRecord}
                today={today}
                subTablesFor={(recordId) => subTablesOf(tables, recordId)}
                renderSubTable={renderSubTable}
                forcedMode={phoneMode}
                stars={stars}
                onToggleStar={(record) => shelfActions.star.mutate(record.id)}
                depth={1}
                taskTally={overview.taskTally}
                defaultCardColumns={active.mobileColumns}
                marks={markingMarks}
                dots={isShared ? boardChanges.since : null}
                onRestoreRecord={
                  isReadOnly
                    ? undefined
                    : (recordId) =>
                        void actions.restoreRecord(recordId).then(
                          () => toast.success("Đã khôi phục Hạng mục."),
                          (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không khôi phục được."),
                        )
                }
              />
            ) : (
              view === "kanban" ? (
                <KanbanView records={visibleRecords} onOpenRecord={openRecord} today={today} statusOptions={active.statusOptions} onMoveRecord={isReadOnly ? undefined : handleMoveRecord} />
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
            </div>
            <ArchivedRecordsRow tableId={active.id} canEdit={!isReadOnly} />
            <RecordSelectSheet
              records={visibleRecords}
              startId={selectStart}
              onClose={() => setSelectStart(null)}
              onDelete={async (ids) => {
                try {
                  for (const id of ids) await actions.removeRecord(id);
                  toast.success(`Đã chuyển ${ids.length} mục vào Thùng rác.`);
                } catch (caught) {
                  toast.error(caught instanceof Error ? caught.message : "Chưa xoá được.");
                }
              }}
            />
          </div>
          {overview.isOn ? (
            <aside aria-label="Việc" data-overview-right="" className="sticky top-2 flex h-[calc(100dvh-7rem)] min-h-0 flex-col border-l border-border/70 bg-background">
              <OverviewTaskPane
                node={overview.selectedNode}
                tasks={overview.recordKey === null ? [] : overview.tasksOf(overview.recordKey)}
                task={overview.taskId === null ? null : (overview.taskById(overview.taskId) ?? null)}
                taskMissing={overview.taskId !== null && overview.taskById(overview.taskId) === undefined}
                canEdit={!isReadOnly}
                onOpenTask={(task) => overview.go({ board: active.id, record: overview.recordKey, task: task.id }, "push")}
                onCloseTask={() => overview.back({ board: active.id, record: overview.recordKey, task: null })}
                onClose={() => overview.go({ board: active.id, record: null, task: null }, "replace")}
                onAdd={() => {
                  const record = records.find((entry) => entry.id === overview.recordKey);
                  if (record !== undefined) setQuickTaskRecord(record);
                }}
                onLink={() => {
                  const record = records.find((entry) => entry.id === overview.recordKey);
                  if (record !== undefined) setLinkTaskRecord(record);
                }}
              />
            </aside>
          ) : null}
          </div>
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

      {active !== null && isShared ? (
        <>
          <AnnounceDialog
            open={isAnnounceOpen}
            onOpenChange={setIsAnnounceOpen}
            table={active}
            pending={boardChanges.pending}
            conversationName={placeOf(active) ?? "cuộc trò chuyện"}
            people={boardPeople}
            isSending={boardChanges.announce.isPending}
            onSend={async (input) => {
              try {
                await boardChanges.announce.mutateAsync(input);
                setIsAnnounceOpen(false);
                toast.success("Đã báo vào cuộc trò chuyện.");
              } catch (caught) {
                toast.error(caught instanceof Error ? caught.message : "Chưa báo được.");
              }
            }}
          />
          <ChangeHistoryDialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen} changes={boardChanges.changes} columns={active.columns} />
          {isOwner ? <AnnounceSettingsDialog open={isAnnounceSettingsOpen} onOpenChange={setIsAnnounceSettingsOpen} table={active} /> : null}
        </>
      ) : null}
      <ColumnTrashDialog
        open={isColumnTrashOpen}
        onOpenChange={setIsColumnTrashOpen}
        trash={active?.columnTrash ?? []}
        onRestore={(columnId) =>
          active === null
            ? Promise.resolve()
            : actions.restoreColumn({ tableId: active.id, columnId }).then(
                () => {
                  toast.success("Đã khôi phục cột cùng dữ liệu.");
                },
                (caught: unknown) => {
                  toast.error(caught instanceof Error ? caught.message : "Không khôi phục được.");
                },
              )
        }
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
        onOpenChange={(open) => {
          setIsAddColumnOpen(open);
          if (!open) setAddColumnTableId(null);
        }}
        onAdd={handleAddColumn}
        isWorking={actions.isWorking}
      />

      {active !== null && isMoveOpen ? (
        <MoveBoardDialog
          open={isMoveOpen}
          onOpenChange={setIsMoveOpen}
          table={active}
          conversations={conversationsQuery.data ?? []}
          counts={boardMoveCounts(tables, records, taskCountByRecord, active.id)}
          onMoved={(status) =>
            toast.success(
              status === "proposed"
                ? "Đã gửi đề nghị di chuyển vào cuộc trò chuyện — chờ mọi người đồng ý."
                : status === "mode_changed"
                  ? "Đã đổi quyền của Bảng."
                  : "Đã di chuyển Bảng.",
            )
          }
        />
      ) : null}

      {linkTaskRecord !== null ? (
        <TaskPicker
          recordId={linkTaskRecord.id}
          recordTitle={linkTaskRecord.title}
          open
          onOpenChange={(open) => {
            if (!open) setLinkTaskRecord(null);
          }}
        />
      ) : null}
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
        sourceLabel={
          quickTaskRecord === null
            ? undefined
            : recordSourceLabel(
                quickTaskRecord.title,
                tableAncestry(tables, records, quickTaskRecord.tableId)
                  .reverse()
                  .map((step) => ({ name: step.table.name, viaTitle: step.viaRecord?.title ?? null })),
              )
        }
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

      <NewOpportunityDialog
        open={isNewOpportunityOpen}
        onOpenChange={setIsNewOpportunityOpen}
        onCreated={() => invalidateOpportunityBoard()}
      />
      <RecordDialog
        open={isRecordOpen}
        onOpenChange={setRecordOpen}
        columns={editing !== null && editingTable !== undefined && isSyncBoard(editingTable) ? [...syncColumnDefs(editingTable).map((c) => ({ ...c, hidden: false })), ...editingTable.columns] : ((editing === null ? targetTable : editingTable)?.columns ?? [])}
        syncNote={editing !== null && editing.opportunityId != null ? "Sửa ở đây là sửa trong Danh bạ. Ô 🔗 Liên hệ, Công ty, Nơi trao đổi đổi ở chính liên hệ." : undefined}
        record={editing !== null && editing.opportunityId != null ? (withSyncValues([editing], opportunityBoard.rows, () => "", () => 0)[0] ?? editing) : editing}
        knownStatuses={editing !== null && editing.opportunityId != null ? ["lead", "tiem_nang", "dang_cham_soc", "doi_tac", "khong_thanh"] : knownStatuses}
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
        onLinkTask={editing === null || isReadOnly ? undefined : () => setLinkTaskRecord(editing)}
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
        boardOwnerId={(editing === null ? targetTable : editingTable)?.ownerUserId}
        isSharedBoard={(() => {
          const board = editing === null ? targetTable : editingTable;
          return board != null && (board.conversationId !== null || board.projectId !== null);
        })()}
        guideQuestion={guideQuestionOf((editing === null ? targetTable : editingTable)?.thinkingType ?? activeRoot?.thinkingType)}
      />
      {active !== null ? <ThinkingTypeDialog table={active} open={isThinkingTypeOpen} onOpenChange={setIsThinkingTypeOpen} /> : null}
    </div>
  );
};

export default ThinkHub;
