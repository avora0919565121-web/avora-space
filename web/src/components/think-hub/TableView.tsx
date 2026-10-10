import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Eye, ListPlus, Paperclip, Plus, Settings2, SquareCheck, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ColumnMenu, type ColumnFilter, type ColumnMenuActions, type ColumnSort } from "@/components/think-hub/ColumnMenu";
import { ColumnTypeIcon } from "@/components/think-hub/ColumnTypeIcon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { ChangeMarks } from "@/lib/board-changes";
import { boardFileKeys, fetchBoardFiles, fileCountsByCell } from "@/lib/board-files";
import {
  cellSortKey,
  cellValue,
  clampColumnWidth,
  isHttpLink,
  priorityLabel,
  RECORD_PRIORITIES,
  statusLabel,
  visibleColumns,
  type ColumnDef,
  type ThinkRecord,
  type ThinkTable,
} from "@/lib/think-hub";
import { useContacts } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

export type TableViewProps = {
  /** The board these rows belong to — for remembering its phone layout and finding its files. */
  tableId: string;
  records: readonly ThinkRecord[];
  /** Every column the table has, hidden ones included — hidden ones are folded away here. */
  columns: readonly ColumnDef[];
  onOpenRecord: (record: ThinkRecord) => void;
  /** Absent when the viewer may not reshape the table. */
  onAddColumn?: () => void;
  /** Everything the ⋯ at the head of a column can do (AVORA-61 · E). */
  columnActions?: Omit<ColumnMenuActions, "onSort" | "onFilter">;
  onResizeColumn?: (column: ColumnDef, width: number | null) => void;
  onShowColumn?: (column: ColumnDef) => void;
  /** Tick / untick a Có / Không cell in place. Absent = read-only. */
  onToggleCheckbox?: (record: ThinkRecord, column: ColumnDef, next: boolean) => void;
  onOpenContact?: (contactId: string) => void;
  /** "Tạo nhiệm vụ" on a row — anyone who can add to the table may hand work out from it. */
  onQuickTask?: (record: ThinkRecord) => void;
  /** How many tasks hang under each Hạng mục, for the small count beside its title. */
  taskCountByRecord?: ReadonlyMap<string, number>;
  today: string;
  /** AVORA-61 · H: the sub-tables grown from a Hạng mục, opened right under it. */
  subTablesFor?: (recordId: string) => readonly ThinkTable[];
  renderSubTable?: (table: ThinkTable, mode: PhoneMode) => ReactNode;
  /** A nested sub-table follows its parent's phone layout and draws no layout switch. */
  forcedMode?: PhoneMode;
  /** Columns the board suggests for its cards (owner's choice), before the reader picks their own. */
  defaultCardColumns?: readonly string[];
  isNested?: boolean;
  /** AVORA-62 · C: `Xem thay đổi` — changed cells get an orange outline, new rows a light wash. */
  marks?: ChangeMarks | null;
  /** AVORA-62 · E: a small orange dot on whatever changed since I last looked. */
  dots?: ChangeMarks | null;
  /** Restore a Hạng mục shown as `đã xoá` while marking (absent = no right to). */
  onRestoreRecord?: (recordId: string) => void;
  /** ★ — each person's own (AVORA-65 · H: every level of board has it). */
  stars?: ReadonlySet<string>;
  onToggleStar?: (record: ThinkRecord) => void;
  /** 1 = the board itself; 2, 3 = sub-tables opened in place (indent + a lighter wash). */
  depth?: number;
  /** Who put a contact into a shared cell, when it was not me (AVORA-65 · E). */
  myName?: string;
  /**
   * AVORA-104 · PHẦN 4: the virtual `Việc` column of Toàn cảnh — `☑ xong/tổng`, a tap opens the
   * right column. Never stored in `column_defs`; `⋯ › Ẩn cột` hides it on this device.
   */
  taskTally?: TaskTally;
};

/** See {@link TableViewProps.taskTally}. */
export type TaskTally = {
  of: (recordId: string) => { done: number; total: number } | null;
  onOpen: (record: ThinkRecord) => void;
  selectedId: string | null;
  onHide: () => void;
};

/** The virtual column's id (never a real column key). */
export const TASK_TALLY_COLUMN = "__viec";

export type PhoneMode = "cards" | "table";

const DEFAULT_COLUMN_WIDTH = 160;
const OPEN_SUBTABLES_KEY = "avora.subtables-open";
const PHONE_MODE_KEY = "avora.board-phone-mode";

/** The phone layout this person last chose for a board (`Thẻ` until they pick `Bảng`). */
export function readPhoneMode(tableId: string): PhoneMode {
  return readStore<Record<string, PhoneMode>>("local", PHONE_MODE_KEY, {})[tableId] ?? "cards";
}

export function writePhoneMode(tableId: string, mode: PhoneMode): void {
  writeStore("local", PHONE_MODE_KEY, { ...readStore<Record<string, PhoneMode>>("local", PHONE_MODE_KEY, {}), [tableId]: mode });
}

/** A row that slides sideways fades at its edges, so a column passing out of view never shows half a letter. */
const EDGE_FADE = "[mask-image:linear-gradient(to_right,transparent,black_14px,black_calc(100%-14px),transparent)]";
const CARD_COLUMNS_KEY = "avora.board-card-columns";

function readStore<T>(storage: "local" | "session", key: string, fallback: T): T {
  try {
    const raw = (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStore(storage: "local" | "session", key: string, value: unknown): void {
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Remembering is a courtesy.
  }
}

/** One column of the grid, system or the board's own, with how it draws, sorts and filters. */
type GridColumn = {
  id: string;
  /** The key the change log uses for this field (`status`, `ext:<key>`…). */
  fieldKey?: string;
  label: string;
  width: number;
  def: ColumnDef | null;
  render: (record: ThinkRecord) => ReactNode;
  /** Classes for the whole cell (Có / Không turns the cell green). */
  cellClass?: (record: ThinkRecord) => string | undefined;
  sortKey: (record: ThinkRecord) => string | number;
  isFilled: (record: ThinkRecord) => boolean;
  /** A cell that answers a tap itself (checkbox, link) instead of opening the Hạng mục. */
  isInteractive?: boolean;
};

function plain(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Shared subtable open state for this session (H: "nhớ trạng thái mở trong phiên"). */
function useOpenSubTables(): [ReadonlySet<string>, (recordId: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => new Set(readStore<string[]>("session", OPEN_SUBTABLES_KEY, [])));
  const toggle = useCallback((recordId: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      writeStore("session", OPEN_SUBTABLES_KEY, [...next]);
      return next;
    });
  }, []);
  return [open, toggle];
}

function ResizeStrip({
  column,
  thRef,
  onPreview,
  onResize,
}: {
  column: ColumnDef;
  thRef: React.RefObject<HTMLTableCellElement | null>;
  onPreview: (columnId: string, width: number | null) => void;
  onResize: (column: ColumnDef, width: number | null) => void;
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Kéo để đổi độ rộng cột ${column.label}. Chạm hai lần để về mặc định.`}
      onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = { x: event.clientX, width: thRef.current?.getBoundingClientRect().width ?? DEFAULT_COLUMN_WIDTH };
      }}
      onPointerMove={(event) => {
        const start = startRef.current;
        if (start !== null) onPreview(column.id, clampColumnWidth(start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => {
        const start = startRef.current;
        startRef.current = null;
        if (start === null) return;
        const next = clampColumnWidth(start.width + event.clientX - start.x);
        if (Math.abs(next - start.width) >= 2) onResize(column, next);
        else onPreview(column.id, null);
      }}
      onDoubleClick={() => onResize(column, null)}
      className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none border-r-2 border-transparent transition-colors hover:border-primary/50"
    />
  );
}

function HeaderCell({
  column,
  sort,
  filter,
  actions,
  width,
  onPreview,
  onResize,
  className,
}: {
  column: GridColumn;
  sort: ColumnSort;
  filter: ColumnFilter;
  actions: ColumnMenuActions;
  width: number | undefined;
  onPreview: (columnId: string, width: number | null) => void;
  onResize?: (column: ColumnDef, width: number | null) => void;
  className?: string;
}) {
  const thRef = useRef<HTMLTableCellElement | null>(null);
  return (
    <th
      ref={thRef}
      scope="col"
      style={width !== undefined ? { width, minWidth: width, maxWidth: width } : undefined}
      className={cn(
        "group relative whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      <ColumnMenu column={column.def} columnId={column.id} label={column.label} isSystem={column.def === null} sort={sort} filter={filter} actions={actions}>
        <span className="inline-flex items-center gap-1.5">
          {column.def !== null ? <ColumnTypeIcon type={column.def.type} className="opacity-70" /> : null}
          {column.label}
        </span>
      </ColumnMenu>
      {column.def !== null && onResize !== undefined ? (
        <ResizeStrip column={column.def} thRef={thRef} onPreview={onPreview} onResize={onResize} />
      ) : null}
    </th>
  );
}

/**
 * The grid: every Hạng mục of one table.
 *
 * Computer (and a phone on its side): one row each, the title pinned on the left, every column
 * action in the ⋯ at its head. Phone upright: `Thẻ` (title + up to three chosen columns) or
 * `Bảng` — column names in one sticky row, each Hạng mục's title on its own full-width line, its
 * cells beneath; sliding any row of cells slides them all together (AVORA-61 · G). A Hạng mục with
 * sub-tables opens them right underneath (AVORA-61 · H).
 */
export function TableView({
  tableId,
  records,
  columns,
  onOpenRecord,
  onAddColumn,
  columnActions,
  onResizeColumn,
  onShowColumn,
  onToggleCheckbox,
  onOpenContact,
  onQuickTask,
  taskCountByRecord,
  today,
  subTablesFor,
  renderSubTable,
  forcedMode,
  defaultCardColumns = [],
  isNested = false,
  marks = null,
  dots = null,
  onRestoreRecord,
  stars,
  onToggleStar,
  depth = 1,
  taskTally,
}: TableViewProps) {
  const markClass = (record: ThinkRecord, column: GridColumn | null): string | undefined => {
    if (marks === null) return undefined;
    const key = column === null ? "title" : column.fieldKey;
    if (key !== undefined && marks.cells.has(`${record.id}:${key}`)) return "change-cell";
    return undefined;
  };
  const rowMark = (record: ThinkRecord): string | undefined =>
    taskTally?.selectedId === record.id
      ? "bg-personal/10 hover:bg-personal/15"
      : marks !== null && marks.newRecords.has(record.id)
        ? "change-new"
        : undefined;
  const dot = (record: ThinkRecord): ReactNode =>
    dots !== null && marks === null && dots.records.has(record.id) ? (
      <span aria-label="có thay đổi từ lần bạn xem trước" data-change-dot="" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
    ) : null;
  const deletedRows =
    marks !== null && marks.deleted.length > 0 ? (
      <ul className="mt-2 space-y-1" aria-label="Hạng mục đã xoá">
        {marks.deleted.map((entry) => (
          <li key={entry.recordId} data-change-deleted="" className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[13.5px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate line-through opacity-70">{entry.title}</span>
            <span className="shrink-0 text-[12px]">đã xoá</span>
            {onRestoreRecord !== undefined ? (
              <button type="button" onClick={() => onRestoreRecord(entry.recordId)} className="press shrink-0 rounded-md px-2 py-1 text-[12.5px] font-semibold text-primary">
                Khôi phục
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    ) : null;
  const [preview, setPreview] = useState<Readonly<Record<string, number>>>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const [filter, setFilter] = useState<ColumnFilter>(null);
  const [openSubs, toggleSub] = useOpenSubTables();
  const isPhone = useMediaQuery("(max-width: 767px)");
  // AVORA-65 · C: the page draws the one `Thẻ · Bảng · Theo trạng thái · Cây` row and passes the choice down.
  const mode: PhoneMode = forcedMode ?? readPhoneMode(tableId);
  const shown = visibleColumns(columns);
  const hidden = columns.filter((column) => column.hidden === true);

  const hasFiles = columns.some((column) => column.type === "file");
  const files = useQuery({ queryKey: boardFileKeys.table(tableId), queryFn: () => fetchBoardFiles(tableId), enabled: hasFiles });
  const fileCounts = useMemo(() => fileCountsByCell(files.data ?? []), [files.data]);
  const contacts = useContacts();
  const contactName = useMemo(() => new Map((contacts.data ?? []).map((contact) => [contact.id, contact.name] as const)), [contacts.data]);
  // The scroll box of the computer grid: a sub-table opened in place is exactly as wide as what is visible.
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const [visibleWidth, setVisibleWidth] = useState<number>(0);
  useEffect(() => {
    const element = scrollBoxRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setVisibleWidth(element.clientWidth));
    observer.observe(element);
    setVisibleWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [isPhone]);

  const handlePreview = useCallback((columnId: string, width: number | null): void => {
    setPreview((current) => {
      const next = { ...current };
      if (width === null) delete next[columnId];
      else next[columnId] = width;
      return next;
    });
  }, []);
  const handleResize = useCallback(
    (column: ColumnDef, width: number | null): void => {
      onResizeColumn?.(column, width);
      handlePreview(column.id, width);
    },
    [onResizeColumn, handlePreview],
  );

  const grid: GridColumn[] = useMemo(() => {
    const filled = (value: string | null | undefined): boolean => value !== null && value !== undefined && value.trim() !== "";
    const system: GridColumn[] = [
      {
        id: "status",
        fieldKey: "status",
        label: "Trạng thái",
        width: 150,
        def: null,
        render: (record) => (
          <span className="inline-flex rounded-full bg-accent/60 px-2.5 py-1 text-[12.5px] font-medium text-accent-foreground">{statusLabel(record.status)}</span>
        ),
        sortKey: (record) => plain(statusLabel(record.status)),
        isFilled: (record) => filled(record.status),
      },
      {
        id: "priority",
        fieldKey: "priority",
        label: "Độ ưu tiên",
        width: 150,
        def: null,
        render: (record) => priorityLabel(record.priority),
        // Cao first when ascending: what matters most reads first.
        sortKey: (record) => RECORD_PRIORITIES.length - RECORD_PRIORITIES.indexOf(record.priority),
        isFilled: () => true,
      },
      {
        id: "category",
        fieldKey: "category",
        label: "Phân loại",
        width: 140,
        def: null,
        render: (record) => <span className="text-muted-foreground">{record.category ?? ""}</span>,
        sortKey: (record) => (record.category === null ? "\uffff" : plain(record.category)),
        isFilled: (record) => filled(record.category),
      },
      {
        id: "next",
        fieldKey: "next_action_date",
        label: "Ngày cần làm tiếp",
        width: 200,
        def: null,
        render: (record) => (
          <span className={cn("tabular whitespace-nowrap", record.nextActionDate !== null && record.nextActionDate < today ? "font-medium text-destructive" : "text-muted-foreground")}>
            {record.nextActionDate ?? ""}
          </span>
        ),
        sortKey: (record) => record.nextActionDate ?? "9999",
        isFilled: (record) => record.nextActionDate !== null,
      },
      {
        id: "tags",
        fieldKey: "tags",
        label: "Nhãn",
        width: 150,
        def: null,
        render: (record) => (
          <span className="flex flex-wrap gap-1">
            {record.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </span>
        ),
        sortKey: (record) => (record.tags.length === 0 ? "\uffff" : plain(record.tags.join(" "))),
        isFilled: (record) => record.tags.length > 0,
      },
      {
        id: "notes",
        fieldKey: "notes",
        label: "Ghi chú",
        width: 200,
        def: null,
        render: (record) => <span className="line-clamp-2 text-muted-foreground">{record.notes ?? ""}</span>,
        sortKey: (record) => (record.notes === null ? "\uffff" : plain(record.notes)),
        isFilled: (record) => filled(record.notes),
      },
    ];
    const own: GridColumn[] = shown.map((def) => {
      const count = (record: ThinkRecord): number => fileCounts.get(`${record.id}:${def.key}`) ?? 0;
      const base = {
        id: def.id,
        fieldKey: `ext:${def.key}`,
        label: def.label,
        width: preview[def.id] ?? def.width ?? DEFAULT_COLUMN_WIDTH,
        def,
        sortKey: (record: ThinkRecord) =>
          def.type === "contact"
            ? plain(contactName.get(String(record.extensionFields[def.key] ?? "")) ?? record.contactLabels?.[def.key]?.name ?? "\uffff")
            : cellSortKey(record, def, count(record)),
        isFilled: (record: ThinkRecord) => (def.type === "file" ? count(record) > 0 : cellValue(record, def).trim() !== ""),
      };
      if (def.type === "checkbox") {
        return {
          ...base,
          isInteractive: onToggleCheckbox !== undefined,
          cellClass: (record: ThinkRecord) => (record.extensionFields[def.key] === "1" ? "bg-emerald-500/[0.14]" : undefined),
          render: (record: ThinkRecord) => {
            const isOn = record.extensionFields[def.key] === "1";
            return (
              <span className="flex items-center gap-2" data-checkbox-cell={isOn ? "on" : "off"}>
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={onToggleCheckbox === undefined}
                  aria-label={`${def.label}: ${record.title}`}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onToggleCheckbox?.(record, def, event.target.checked)}
                  className="h-[18px] w-[18px] accent-emerald-600"
                />
                <span className={cn("text-[13px]", isOn ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{isOn ? "Có" : ""}</span>
              </span>
            );
          },
        };
      }
      if (def.type === "link") {
        return {
          ...base,
          isInteractive: true,
          render: (record: ThinkRecord) => {
            const value = cellValue(record, def);
            if (!isHttpLink(value)) return <span className="text-muted-foreground">{value}</span>;
            const shownText = value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
            return (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate">{shownText}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            );
          },
        };
      }
      if (def.type === "contact") {
        return {
          ...base,
          isInteractive: onOpenContact !== undefined,
          render: (record: ThinkRecord) => {
            const id = String(record.extensionFields[def.key] ?? "");
            if (id === "") return null;
            // AVORA-65 · E: my own contact → my name for it, tap opens it. Someone else's → the
            // name they brought in + `của {người chọn}`; never their number or email.
            const shared = record.contactLabels?.[def.key];
            const name = contactName.get(id) ?? (shared !== undefined ? `${shared.name} · của ${shared.byName}` : "Liên hệ khác");
            return onOpenContact !== undefined && contactName.has(id) ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenContact(id);
                }}
                className="press inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[13px] text-foreground hover:bg-accent"
              >
                <ColumnTypeIcon type="contact" className="text-muted-foreground" />
                <span className="truncate">{name}</span>
              </button>
            ) : (
              <span className="text-muted-foreground">{name}</span>
            );
          },
        };
      }
      if (def.type === "file") {
        return {
          ...base,
          render: (record: ThinkRecord) => {
            const n = count(record);
            return n === 0 ? null : (
              <span className="inline-flex items-center gap-1 text-[13px] text-foreground">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {n} tệp
              </span>
            );
          },
        };
      }
      return { ...base, render: (record: ThinkRecord) => <span className="block truncate text-muted-foreground">{cellValue(record, def)}</span> };
    });
    const tally: GridColumn[] =
      taskTally === undefined
        ? []
        : [
            {
              id: TASK_TALLY_COLUMN,
              label: "Việc",
              width: 96,
              def: null,
              isInteractive: true,
              render: (record) => {
                const count = taskTally.of(record.id) ?? { done: 0, total: 0 };
                return (
                  <button
                    type="button"
                    data-task-tally={record.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      taskTally.onOpen(record);
                    }}
                    aria-label={`Việc của "${record.title}": ${count.done} xong / ${count.total}`}
                    className="press -mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[13px] font-semibold text-foreground hover:bg-accent/50"
                  >
                    <SquareCheck className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    <span className="tabular">
                      {count.done}/{count.total}
                    </span>
                  </button>
                );
              },
              sortKey: (record) => taskTally.of(record.id)?.total ?? 0,
              isFilled: (record) => (taskTally.of(record.id)?.total ?? 0) > 0,
            },
          ];
    return [...tally, ...system, ...own];
  }, [shown, preview, fileCounts, contactName, onToggleCheckbox, onOpenContact, today, taskTally]);

  const titleColumn: GridColumn = useMemo(
    () => ({
      id: "title",
      label: "Tiêu đề",
      width: 260,
      def: null,
      render: () => null,
      sortKey: (record) => plain(record.title),
      isFilled: () => true,
    }),
    [],
  );

  const rows: ThinkRecord[] = useMemo(() => {
    let list = [...records];
    if (filter !== null) {
      const column = filter.columnId === "title" ? titleColumn : grid.find((entry) => entry.id === filter.columnId);
      if (column !== undefined) list = list.filter((record) => column.isFilled(record) === (filter.mode === "filled"));
    }
    if (sort !== null) {
      const column = sort.columnId === "title" ? titleColumn : grid.find((entry) => entry.id === sort.columnId);
      if (column !== undefined) {
        const sign = sort.direction === "asc" ? 1 : -1;
        list.sort((a, b) => {
          const left = column.sortKey(a);
          const right = column.sortKey(b);
          if (typeof left === "number" && typeof right === "number") return (left - right) * sign;
          return String(left).localeCompare(String(right), "vi") * sign;
        });
      }
    }
    return list;
  }, [records, filter, sort, grid, titleColumn]);

  const menuActions: ColumnMenuActions = {
    ...(columnActions ?? { lockedReason: "Chỉ chủ Bảng đổi được cột." }),
    onWidth: columnActions?.onWidth === undefined ? undefined : handleResize,
    onHideSystem: taskTally === undefined ? undefined : (columnId) => columnId === TASK_TALLY_COLUMN && taskTally.onHide(),
    onSort: (column, direction) => setSort(direction === null ? null : { columnId: column.id, direction }),
    onFilter: (column, filterMode) => setFilter(filterMode === null ? null : { columnId: column.id, mode: filterMode }),
  };

  const subsOf = (record: ThinkRecord): readonly ThinkTable[] => subTablesFor?.(record.id) ?? [];
  const hiddenRow =
    hidden.length > 0 && onShowColumn !== undefined && !isNested ? (
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span>Cột đang ẩn:</span>
        {hidden.map((column) => (
          <button
            key={column.id}
            type="button"
            onClick={() => onShowColumn(column)}
            title="Hiện lại cột này"
            className="press inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 py-1 transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {column.label}
          </button>
        ))}
      </div>
    ) : null;
  const sortNote =
    sort !== null || filter !== null ? (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" role="status">
        {sort !== null ? <span>Sắp xếp theo {(sort.columnId === "title" ? titleColumn : grid.find((entry) => entry.id === sort.columnId))?.label}</span> : null}
        {filter !== null ? <span>· Đang lọc {(filter.columnId === "title" ? titleColumn : grid.find((entry) => entry.id === filter.columnId))?.label}</span> : null}
        <button type="button" onClick={() => { setSort(null); setFilter(null); }} className="press rounded px-1.5 font-medium text-primary">
          Bỏ
        </button>
      </div>
    ) : null;

  const subToggle = (record: ThinkRecord, compact: boolean): ReactNode => {
    const subs = subsOf(record);
    if (subs.length === 0) return null;
    const isOpen = openSubs.has(record.id);
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggleSub(record.id);
        }}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Thu" : "Mở"} bảng con của "${record.title}" (${subs.length})`}
        data-subtable-toggle={record.id}
        className={cn(
          "press inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background px-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground",
          compact ? "h-7" : "h-7",
          isOpen && "border-primary/40 text-primary",
        )}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="tabular">{subs.length}</span>
      </button>
    );
  };
  // AVORA-65 · H: the only difference between levels is an indent and a wash that deepens with depth.
  const subPanel = (record: ThinkRecord, childMode: PhoneMode): ReactNode =>
    openSubs.has(record.id) && renderSubTable !== undefined ? (
      <div
        data-subtable-of={record.id}
        data-depth={depth + 1}
        className={cn("border-l-2 border-primary/30 py-2 pl-3 pr-1", depth + 1 >= 3 ? "bg-secondary/70" : "bg-secondary/40")}
      >
        {subsOf(record).map((sub) => (
          <div key={sub.id}>{renderSubTable(sub, childMode)}</div>
        ))}
      </div>
    ) : null;

  const taskBadge = (record: ThinkRecord): ReactNode => {
    const taskCount = taskCountByRecord?.get(record.id) ?? 0;
    return taskCount > 0 ? (
      <span className="tabular shrink-0 whitespace-nowrap rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" title={`${taskCount} nhiệm vụ`}>
        {taskCount} việc
      </span>
    ) : null;
  };
  const starButton = (record: ThinkRecord): ReactNode => {
    if (onToggleStar === undefined) return null;
    const isOn = stars?.has(record.id) === true;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleStar(record);
        }}
        aria-pressed={isOn}
        aria-label={isOn ? `Bỏ quan trọng: ${record.title}` : `Đánh dấu quan trọng: ${record.title}`}
        data-record-star={record.id}
        className={cn(
          "press -my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-opacity",
          isOn ? "text-amber-500" : "text-muted-foreground opacity-60 hoverable:opacity-0 hoverable:group-hover/row:opacity-100",
        )}
      >
        <Star className={cn("h-4 w-4", isOn && "fill-amber-400")} aria-hidden="true" />
      </button>
    );
  };
  const quickTaskButton = (record: ThinkRecord, withLabel: boolean): ReactNode =>
    onQuickTask === undefined ? null : (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onQuickTask(record);
        }}
        aria-label={`Tạo nhiệm vụ từ "${record.title}"`}
        title="Tạo nhiệm vụ"
        data-quick-task={record.id}
        className="press inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground opacity-70 transition-colors hover:bg-accent/50 hover:text-foreground group-hover/row:opacity-100"
      >
        <ListPlus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        {withLabel ? <span className="hidden lg:inline">Tạo nhiệm vụ</span> : null}
      </button>
    );

  // ---------------------------------------------------------------- phone, upright
  if (isPhone) {
    return (
      <PhoneBoard
        tableId={tableId}
        rows={rows}
        grid={grid}
        titleColumn={titleColumn}
        mode={mode}
        canPickCardColumns={!isNested}
        sort={sort}
        filter={filter}
        menuActions={menuActions}
        onOpenRecord={onOpenRecord}
        onAddColumn={onAddColumn}
        subToggle={subToggle}
        subPanel={(record) => subPanel(record, mode)}
        taskBadge={taskBadge}
        starButton={starButton}
        quickTaskButton={quickTaskButton}
        defaultCardColumns={defaultCardColumns}
        header={
          <>
            {hiddenRow}
            {sortNote}
          </>
        }
        isNested={isNested}
        markClass={markClass}
        rowMark={rowMark}
        dot={dot}
        footer={deletedRows}
        emptyText={onQuickTask === undefined ? "Bảng này chưa có Hạng mục nào." : "Bảng này chưa có Hạng mục nào. Bấm “+” để ghi cái đầu tiên."}
      />
    );
  }

  // ---------------------------------------------------------------- computer, and a phone on its side
  const headClass = "whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground";
  const cellClass = "px-3 py-3 text-[14.5px] text-foreground align-top";
  const span = 2 + grid.length;
  // Every column has a real width (system ones too), so the table never squeezes a name into half a word.
  const titleWidth = isNested ? 240 : 280;
  const tableWidth = titleWidth + grid.reduce((sum, column) => sum + column.width, 0) + 140;
  return (
    <>
      {hiddenRow}
      {sortNote}
      <div ref={scrollBoxRef} data-board-grid={depth} className={cn("overflow-x-auto rounded-xl border border-border bg-card", isNested ? "mt-1" : "mt-5")}>
        <table className="w-full table-fixed border-collapse" style={{ minWidth: tableWidth }}>
          <thead className="border-b border-border">
            <tr>
              <th scope="col" style={{ width: titleWidth }} className={cn(headClass, "group sticky left-0 z-10 bg-card")}>
                <ColumnMenu column={null} columnId="title" label="Tiêu đề" isSystem sort={sort} filter={filter} actions={menuActions}>
                  Tiêu đề
                </ColumnMenu>
              </th>
              {grid.map((column) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  sort={sort}
                  filter={filter}
                  actions={menuActions}
                  width={column.width}
                  onPreview={handlePreview}
                  onResize={columnActions?.onWidth === undefined ? undefined : handleResize}
                />
              ))}
              <th scope="col" style={{ width: 140 }} className="px-2 py-2.5 text-right">
                {onAddColumn !== undefined ? (
                  <button
                    type="button"
                    onClick={onAddColumn}
                    className="press inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                  >
                    <Plus className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                    Thêm cột
                  </button>
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={span} className="px-3 py-8 text-center text-[14.5px] text-muted-foreground">
                  {onQuickTask === undefined
                    ? "Bảng này chưa có Hạng mục nào."
                    : "Bảng này chưa có Hạng mục nào. Bấm “+” để ghi cái đầu tiên."}
                  <span className="mt-1.5 block text-[12.5px] text-muted-foreground/80">Hạng mục là một dòng trong Bảng này.</span>
                </td>
              </tr>
            ) : null}
            {rows.map((record) => (
              <RowGroup key={record.id}>
                <tr
                  data-record-id={record.id}
                  onClick={() => onOpenRecord(record)}
                  className={cn("group/row cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/25", rowMark(record))}
                >
                  <td className={cn(cellClass, "sticky left-0 z-[1] bg-card font-medium group-hover/row:bg-[hsl(var(--card))]", markClass(record, null))}>
                    <span className="flex items-start gap-1.5">
                      {dot(record)}
                      {subToggle(record, false)}
                      <span className="min-w-0 flex-1 break-words pt-0.5" data-record-title="">
                        {record.title}
                        {/* The `N việc` chip lives inside the title cell, under the name — never over the next column. */}
                        {taskBadge(record) !== null ? <span className="mt-1 flex">{taskBadge(record)}</span> : null}
                      </span>
                      {starButton(record)}
                    </span>
                  </td>
                  {grid.map((column) => (
                    <td
                      key={column.id}
                      style={column.def !== null ? { width: column.width, minWidth: column.width, maxWidth: column.width } : undefined}
                      className={cn(cellClass, column.cellClass?.(record), markClass(record, column))}
                    >
                      {column.render(record)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right align-top">{quickTaskButton(record, true)}</td>
                </tr>
                {openSubs.has(record.id) && subsOf(record).length > 0 ? (
                  <tr className="border-b border-border/70">
                    <td colSpan={span} className="p-0">
                      <div className="sticky left-0" style={visibleWidth > 0 ? { width: visibleWidth } : undefined}>
                        {subPanel(record, "table")}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </RowGroup>
            ))}
          </tbody>
        </table>
      </div>
      {deletedRows}
    </>
  );
}

function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * The phone's two ways to read a board (AVORA-61 · G).
 *
 * `Thẻ`: a card per Hạng mục — title and up to three columns the reader picks (⚙ Cột trên thẻ).
 * `Bảng`: one sticky row of column names; each Hạng mục's title on its own line, wrapping, never
 * sliding; its cells beneath. Every row of cells and the names row share one horizontal position:
 * slide any of them and all of them follow. The title of the Hạng mục being read sticks under the
 * names row until its cells have passed, then gives way to the next (plain CSS sticky per group).
 */
function PhoneBoard({
  tableId,
  rows,
  grid,
  titleColumn,
  mode,
  canPickCardColumns,
  sort,
  filter,
  menuActions,
  onOpenRecord,
  onAddColumn,
  subToggle,
  subPanel,
  taskBadge,
  starButton,
  quickTaskButton,
  defaultCardColumns,
  header,
  isNested,
  emptyText,
  markClass,
  rowMark,
  dot,
  footer,
}: {
  markClass: (record: ThinkRecord, column: GridColumn | null) => string | undefined;
  rowMark: (record: ThinkRecord) => string | undefined;
  dot: (record: ThinkRecord) => ReactNode;
  footer: ReactNode;
  tableId: string;
  rows: readonly ThinkRecord[];
  grid: readonly GridColumn[];
  titleColumn: GridColumn;
  mode: PhoneMode;
  canPickCardColumns: boolean;
  sort: ColumnSort;
  filter: ColumnFilter;
  menuActions: ColumnMenuActions;
  onOpenRecord: (record: ThinkRecord) => void;
  onAddColumn?: () => void;
  subToggle: (record: ThinkRecord, compact: boolean) => ReactNode;
  subPanel: (record: ThinkRecord) => ReactNode;
  taskBadge: (record: ThinkRecord) => ReactNode;
  starButton: (record: ThinkRecord) => ReactNode;
  quickTaskButton: (record: ThinkRecord, withLabel: boolean) => ReactNode;
  defaultCardColumns: readonly string[];
  header: ReactNode;
  isNested: boolean;
  emptyText: string;
}) {
  const [cardColumns, setCardColumns] = useState<string[]>(() => {
    const saved = readStore<Record<string, string[]>>("local", CARD_COLUMNS_KEY, {})[tableId];
    if (saved !== undefined) return saved;
    const fromBoard = grid.filter((column) => defaultCardColumns.includes(column.def?.key ?? column.id)).map((column) => column.id);
    return (fromBoard.length > 0 ? fromBoard : ["status", "next"]).slice(0, 3);
  });
  const toggleCardColumn = (id: string): void => {
    setCardColumns((current) => {
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= 3 ? current : [...current, id];
      writeStore("local", CARD_COLUMNS_KEY, { ...readStore<Record<string, string[]>>("local", CARD_COLUMNS_KEY, {}), [tableId]: next });
      return next;
    });
  };

  // One horizontal position for the names row and every row of cells.
  const scrollers = useRef<Set<HTMLDivElement>>(new Set());
  const syncing = useRef<boolean>(false);
  const scrollLeft = useRef<number>(0);
  const register = useCallback((element: HTMLDivElement | null): void => {
    if (element === null) return;
    scrollers.current.add(element);
    element.scrollLeft = scrollLeft.current;
  }, []);
  const onRowScroll = useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    if (syncing.current) return;
    const source = event.currentTarget;
    scrollLeft.current = source.scrollLeft;
    syncing.current = true;
    for (const element of scrollers.current) {
      if (!element.isConnected) scrollers.current.delete(element);
      else if (element !== source && element.scrollLeft !== source.scrollLeft) element.scrollLeft = source.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);
  useEffect(() => () => scrollers.current.clear(), []);

  const totalWidth = grid.reduce((sum, column) => sum + column.width, 0) + (onAddColumn !== undefined ? 120 : 0);
  const nameRowRef = useRef<HTMLDivElement | null>(null);
  const [nameRowHeight, setNameRowHeight] = useState<number>(40);
  useEffect(() => {
    const element = nameRowRef.current;
    if (element === null) return;
    setNameRowHeight(element.getBoundingClientRect().height);
  }, [mode]);

  // AVORA-65 · C: the layout row lives on the page; here only `⚙ Cột trên thẻ`, right-aligned.
  const switcher =
    canPickCardColumns && mode === "cards" ? (
      <div className="mt-2 flex items-center justify-end">
        {mode === "cards" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="press inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-muted-foreground">
                <Settings2 className="h-4 w-4" aria-hidden="true" /> Cột trên thẻ
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" collisionPadding={12} className="max-h-[60dvh] w-60 overflow-y-auto">
              <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">Chọn tối đa 3 cột</DropdownMenuLabel>
              {grid.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={cardColumns.includes(column.id)}
                  disabled={!cardColumns.includes(column.id) && cardColumns.length >= 3}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleCardColumn(column.id)}
                  className="min-h-10"
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    ) : null;

  if (mode === "cards") {
    const picked = cardColumns.map((id) => grid.find((column) => column.id === id)).filter((column): column is GridColumn => column !== undefined);
    return (
      <div data-phone-board="cards">
        {switcher}
        {header}
        <ul className={cn("space-y-2", isNested ? "mt-1" : "mt-3")}>
          {rows.length === 0 ? <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">{emptyText}</li> : null}
          {rows.map((record) => (
            <li key={record.id}>
              <div
                role="button"
                tabIndex={0}
                data-record-id={record.id}
                onClick={() => onOpenRecord(record)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpenRecord(record);
                }}
                className={cn("press block rounded-xl border border-border bg-card px-4 py-3 text-left", rowMark(record), markClass(record, null))}
              >
                <span className="group/row flex items-start gap-2">
                  {dot(record)}
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">{record.title}</span>
                  {taskBadge(record)}
                  {starButton(record)}
                  {quickTaskButton(record, false)}
                </span>
                {picked.length > 0 ? (
                  <dl className="mt-2 space-y-1.5">
                    {picked.map((column) => (
                      <div key={column.id} className={cn("flex items-center gap-2 rounded-md text-[13.5px]", column.cellClass?.(record) !== undefined && "-mx-1.5 px-1.5 py-0.5", column.cellClass?.(record), markClass(record, column))}>
                        <dt className="w-[38%] shrink-0 truncate text-[12.5px] text-muted-foreground">{column.label}</dt>
                        <dd className="min-w-0 flex-1 truncate">{column.render(record)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
              {/* Outside the card's own tap target: ▸ opens the sub-table, never the Hạng mục. */}
              {subToggle(record, true) !== null ? (
                <span className="-mt-1 flex items-center gap-2 rounded-b-xl border border-t-0 border-border bg-card px-4 pb-2 pt-3 text-[13px] text-muted-foreground">
                  Bảng con · {subToggle(record, true)}
                </span>
              ) : null}
              {subPanel(record) !== null ? <div className="ml-3 mt-1.5">{subPanel(record)}</div> : null}
            </li>
          ))}
        </ul>
        {footer}
      </div>
    );
  }

  return (
    <div data-phone-board="table">
      {switcher}
      {header}
      <div className={cn("rounded-xl border border-border bg-card", isNested ? "mt-1" : "mt-3")}>
        {/* The names row: sticky at the top of the screen's scroll, slides with the cells. */}
        <div ref={nameRowRef} className="sticky top-0 z-20 rounded-t-xl border-b border-border bg-card">
          <div ref={register} onScroll={onRowScroll} data-sync-scroll="names" className={cn("no-scrollbar overflow-x-auto", EDGE_FADE)}>
            <div className="flex" style={{ width: totalWidth }}>
              {grid.map((column) => (
                <div
                  key={column.id}
                  role="columnheader"
                  style={{ width: column.width }}
                  className="group shrink-0 whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  <ColumnMenu column={column.def} columnId={column.id} label={column.label} isSystem={column.def === null} sort={sort} filter={filter} actions={menuActions}>
                    <span className="inline-flex items-center gap-1">
                      {column.def !== null ? <ColumnTypeIcon type={column.def.type} className="opacity-70" /> : null}
                      {column.label}
                    </span>
                  </ColumnMenu>
                </div>
              ))}
              {onAddColumn !== undefined ? (
                <div className="flex w-[120px] shrink-0 items-center px-2">
                  <button type="button" onClick={onAddColumn} className="press inline-flex min-h-8 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[12px] text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Thêm cột
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 px-3 py-1 text-[11.5px] text-muted-foreground">
            <span className="group inline-flex items-center gap-1">
              <ColumnMenu column={null} columnId="title" label="Tiêu đề" isSystem sort={sort} filter={filter} actions={menuActions}>
                Tiêu đề
              </ColumnMenu>
            </span>
            <span>Trượt ngang để xem thêm cột →</span>
          </div>
        </div>
        {rows.length === 0 ? <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">{emptyText}</p> : null}
        {rows.map((record) => (
          <section key={record.id} data-record-id={record.id} className={cn("border-b border-border/70 last:border-b-0", rowMark(record))}>
            {/* The title: its own full-width line, wraps, never slides; sticks under the names row while its cells pass. */}
            <div
              style={{ top: nameRowHeight }}
              className="group/row sticky z-10 flex items-start gap-2 bg-card/95 px-3 pb-1 pt-2.5 backdrop-blur-sm"
            >
              {dot(record)}
              {subToggle(record, true)}
              <button type="button" onClick={() => onOpenRecord(record)} data-record-title="" className="press min-w-0 flex-1 text-left text-[15px] font-semibold leading-snug text-foreground">
                {record.title}
              </button>
              {taskBadge(record)}
              {starButton(record)}
              {quickTaskButton(record, false)}
            </div>
            <div ref={register} onScroll={onRowScroll} data-sync-scroll="cells" className={cn("no-scrollbar overflow-x-auto pb-2", EDGE_FADE)}>
              <div className="flex" style={{ width: totalWidth }}>
                {grid.map((column) => (
                  <div
                    key={column.id}
                    role="cell"
                    style={{ width: column.width }}
                    onClick={column.isInteractive === true ? undefined : () => onOpenRecord(record)}
                    className={cn("min-h-9 shrink-0 truncate px-3 py-1.5 text-[14px]", column.cellClass?.(record), markClass(record, column))}
                  >
                    {column.render(record)}
                  </div>
                ))}
              </div>
            </div>
            {subPanel(record)}
          </section>
        ))}
      </div>
      {footer}
      <span className="sr-only">{titleColumn.label}</span>
    </div>
  );
}
