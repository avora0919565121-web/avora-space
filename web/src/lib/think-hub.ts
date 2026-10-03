import { logError } from "@/lib/log";
import { CONTACT_UNAVAILABLE_MESSAGE, isContactUnavailable } from "@/lib/blocks";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Think Hub ("Kế hoạch" on screen) — the tables people keep to think their work through.
 *
 * A table belongs to exactly one scope, and the scope is the whole permission model:
 *   - personal (the Diary): only its owner reads it;
 *   - a conversation (1-1 or group): everyone in that conversation reads it;
 *   - a project: everyone in the project's group reads it, and each project has exactly one root.
 * A sub-table grows out of one record ("Hạng mục"), inherits its parent's scope, and stops at
 * three levels deep. Writes go only through server functions that re-check all of this.
 *
 * Deliberately NOT the opportunity book. An opportunity is a specific thing — a contact being
 * turned into business, with stages the app understands. A Think Hub table is whatever its
 * owner says it is: a list of building sites, of suppliers, of machines being repaired. The
 * app supplies the shape, the person supplies the meaning.
 */

/** What a record is called, priced and filed under — the seven columns every table starts with. */
export type RecordPriority = "thap" | "trung_binh" | "cao";

export const RECORD_PRIORITIES: readonly RecordPriority[] = ["thap", "trung_binh", "cao"];

const PRIORITY_LABELS: Record<RecordPriority, string> = {
  thap: "Thấp",
  trung_binh: "Trung bình",
  cao: "Cao",
};

/** What a priority is called on screen. */
export function priorityLabel(priority: RecordPriority): string {
  return PRIORITY_LABELS[priority];
}

function isRecordPriority(value: string): value is RecordPriority {
  return (RECORD_PRIORITIES as readonly string[]).includes(value);
}

/**
 * The kinds of extension column someone can add (AVORA-61 · D: eight).
 *
 * Each kind is a promise about how the value sorts, filters and validates: Liên kết sorts as
 * words, Có / Không as true-before-false, Tệp by how many files the cell holds.
 */
export type ColumnType = "text" | "number" | "date" | "select" | "link" | "contact" | "checkbox" | "file";

export const COLUMN_TYPES: readonly ColumnType[] = ["text", "number", "date", "select", "link", "contact", "checkbox", "file"];

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Chữ",
  number: "Số",
  date: "Ngày",
  select: "Chọn 1 trong danh sách",
  link: "Liên kết",
  contact: "Liên hệ",
  checkbox: "Có / Không",
  file: "Tệp",
};

/** AVORA-61 · F: what each field says before anything is typed into it. */
export const COLUMN_PLACEHOLDERS: Record<ColumnType, string> = {
  text: "Nhập chữ",
  number: "Nhập số, vd. 1.000.000",
  date: "Chọn ngày",
  select: "Chọn một mục",
  link: "Dán link https://…",
  contact: "Chọn từ Liên hệ",
  checkbox: "Có / Không",
  file: "Thêm tệp",
};

/**
 * Kind changes that cannot lose or garble a value (AVORA-61 · E) — the same list the server
 * enforces. Anything readable as words may become Chữ; Chữ may become Liên kết when every
 * filled cell already is a link.
 */
export function safeTypeChanges(column: ColumnDef, values: readonly ExtensionValue[]): ColumnType[] {
  if (column.type === "text") {
    const filled = values.filter((value): value is string | number => value !== null && String(value).trim() !== "");
    return filled.every((value) => isHttpLink(String(value))) ? ["link"] : [];
  }
  if (column.type === "number" || column.type === "date" || column.type === "select" || column.type === "link") return ["text"];
  return [];
}

/** An http(s) link with something after the scheme, nothing else. */
export function isHttpLink(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim());
}

/**
 * Reads what a person typed for one column. Wrong kind → an error to show under the field,
 * and the text stays exactly as typed (the caller keeps the draft).
 */
export function parseColumnInput(column: Pick<ColumnDef, "type" | "label">, raw: string): { value: ExtensionValue } | { error: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  if (column.type === "number") {
    // "1.000.000" and "1 000 000" read as thousands; a comma is the decimal mark.
    const normalized = text.replace(/[\s.]/g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    if (normalized === "" || !Number.isFinite(parsed)) return { error: `Cột "${column.label}" chỉ nhận số, vd. 1.000.000.` };
    return { value: parsed };
  }
  if (column.type === "link") {
    if (!isHttpLink(text)) return { error: "Link cần bắt đầu bằng https:// hoặc http://." };
    return { value: text };
  }
  if (column.type === "checkbox") return { value: text === "1" || text === "true" ? "1" : null };
  return { value: text };
}

/** Sorting key for a cell, by kind (AVORA-61 · D). */
export function cellSortKey(record: ThinkRecord, column: ColumnDef, fileCount: number = 0): string | number {
  const value = record.extensionFields[column.key];
  if (column.type === "checkbox") return value === "1" ? 0 : 1;
  if (column.type === "file") return -fileCount;
  if (column.type === "number") return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
  if (value === null || value === undefined || String(value).trim() === "") return "\uffff";
  return normalizeForSort(String(value));
}

function normalizeForSort(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function columnTypeLabel(type: ColumnType): string {
  return COLUMN_TYPE_LABELS[type];
}

/**
 * One extension column, as the table's own shape defines it.
 *
 * `key` is issued by the server and never derived from the label: labels get renamed and two
 * columns may honestly share one ("Ghi chú" twice), while the key is what every record's
 * stored value points at. A key built from the label would turn renaming a column into
 * silently emptying it.
 */
export type ColumnDef = {
  /** Issued once when the column is made and never changed; renaming a column only changes its label. */
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  /** Only for `select`, and never empty — a list with no options is a cell nobody can fill. */
  options?: readonly string[];
  /** Chosen by the table's owner by dragging the column edge; absent = default width. */
  width?: number;
  /** Hidden for everyone reading the table; the values stay, only the column is folded away. */
  hidden?: boolean;
};

/** Narrowest and widest a column may be dragged to — the same bounds the server clamps to. */
export const COLUMN_WIDTH_MIN = 60;
export const COLUMN_WIDTH_MAX = 800;

export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, width)));
}

/** The columns a reader sees, in order — hidden ones folded away. */
export function visibleColumns(columns: readonly ColumnDef[]): ColumnDef[] {
  return columns.filter((column) => column.hidden !== true);
}

/** A value a person typed into an extension column. Null is "nobody has filled this in". */
export type ExtensionValue = string | number | null;

/** Which scope a table lives in — derived from its columns, never stored separately. */
export type TableScope = "personal" | "conversation" | "project";

/** Deepest a sub-table chain may go: a root table is level 1. */
export const MAX_TABLE_DEPTH = 3;

/** A column in the board's bin: back with its values for 30 days (AVORA-61 · E). */
export type TrashedColumn = {
  column: ColumnDef;
  deletedAt: string;
  /** How many Hạng mục had something in it. */
  filledCount: number;
};

export type ThinkTable = {
  id: string;
  ownerUserId: string;
  name: string;
  position: number;
  columns: readonly ColumnDef[];
  /** AVORA-61 · E: deleted columns still restorable. */
  columnTrash?: readonly TrashedColumn[];
  projectId: string | null;
  conversationId: string | null;
  /** The record this sub-table grew out of. Null for a root table. */
  parentRecordId: string | null;
  depth: number;
  purpose: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Đợt gộp 2 · C1: the table's own statuses; null = the four defaults. */
  statusOptions: readonly StatusOption[] | null;
  /** AVORA-62 · F: who may press Báo nhóm, and how a shared board reports changes. */
  announceWho?: "members" | "admins";
  announceMode?: "manual" | "daily" | "silent";
  /** What the title column is called, e.g. "Khách hàng". */
  titleLabel: string | null;
  defaultView: "table" | "kanban" | "tree" | null;
  /** Column keys shown on a phone beside the title (≤ 2). */
  mobileColumns: readonly string[];
  sourceTemplateKey: string | null;
  /** C10: read-only for everyone until reopened. */
  archivedAt: string | null;
  /** C6: "bookshelf" for the one Kệ sách per person. */
  kind: "bookshelf" | null;
  /** C9: "Từng thuộc nhóm …" on a copy taken out of a dissolved group. */
  orphanOrigin: string | null;
  /** AVORA-69: a shared board is `Cùng sửa` (edit) or `Chỉ xem` (view: the owner changes it). */
  shareMode?: "edit" | "view";
  /** AVORA-72 (ADR-045): a system board fed by a source (`contact_opportunities`). */
  syncSource?: "contact_opportunities" | null;
  /** AVORA-72: `Ẩn khỏi danh sách` (the synced board only). */
  hiddenInList?: boolean;
  /** AVORA-72: synced columns the owner folded away. */
  syncHidden?: readonly string[];
  /** AVORA-77 · A5: how this board thinks (`null` = made without a template). */
  thinkingType?: "track" | "progress" | "breakdown" | "weigh" | "learn" | null;
  /** AVORA-77 · A4: how far the thinking has gone — marked by people only. */
  lifecycle?: "waiting" | "thinking" | "concluded" | "archived";
};

/** One status a table offers; `done` ones count as finished for the ★ tile. */
export type StatusOption = { key: string; label: string; done?: boolean };

export type ThinkRecord = {
  id: string;
  tableId: string;
  ownerUserId: string;
  title: string;
  /** The person's own word, not one of ours — Kanban builds its columns from these. */
  status: string;
  priority: RecordPriority;
  category: string | null;
  nextActionDate: string | null;
  /**
   * When the owner asked to have this record brought back on Avora Space. Separate from
   * `nextActionDate`: one is when the work is due, the other is when to think about it.
   */
  remindAt: string | null;
  tags: readonly string[];
  notes: string | null;
  extensionFields: Readonly<Record<string, ExtensionValue>>;
  /** Names in Liên hệ cells as the picker brought them in — written by the server only. */
  contactLabels?: Readonly<Record<string, ContactLabel>>;
  /** Legacy column, unused: a record's project comes from its table. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** C11: "Chuyển từ Bảng … · dd/mm". */
  movedFrom: { tableName: string; at: string } | null;
  /** AVORA-72: the opportunity this Hạng mục mirrors on the synced board. */
  opportunityId?: string | null;
};

export const thinkHubKeys = {
  all: ["think-hub"] as const,
  tables: ["think-hub", "tables"] as const,
  records: ["think-hub", "records"] as const,
  recordTasks: ["think-hub", "record-tasks"] as const,
};

/** How many records one table holds before it stops accepting new ones. */
export const RECORD_LIMIT = 1000;

// ------------------------------------------------------------------ statuses

/**
 * The statuses a new table suggests, and the order Kanban reads them in.
 *
 * Suggestions, not a schema. The database stores whatever word the person uses, so a table
 * about building sites can run on "Đang thi công" without asking anyone's permission. These
 * four are here so an empty table has columns to drag between on day one.
 */
export const SUGGESTED_STATUSES: readonly string[] = ["moi", "dang_lam", "cho_phan_hoi", "xong"];

const STATUS_LABELS: Readonly<Record<string, string>> = {
  moi: "Mới",
  dang_lam: "Đang làm",
  cho_phan_hoi: "Chờ phản hồi",
  xong: "Xong",
  /** Nhìn lại · Còn treo › Bỏ: set aside, not deleted (C7). Counts as finished. */
  khong_lam: "Không làm nữa",
};

/**
 * What a status is called on screen.
 *
 * A word we know gets its proper Vietnamese; anything else is shown exactly as typed. Falling
 * back to the raw value rather than to "Khác" matters: the status a person invented is the
 * one they want to read back, and a catch-all label would merge three of their columns into
 * one on the board.
 */
export function statusLabel(status: string): string {
  const trimmed = status.trim();
  if (trimmed.length === 0) return "Chưa đặt";
  return STATUS_LABELS[trimmed] ?? trimmed;
}

// ------------------------------------------------------------------ rows

type TableRow = {
  id: string;
  owner_user_id: string;
  name: string;
  position: number;
  column_defs: unknown;
  column_trash?: unknown;
  project_id?: string | null;
  conversation_id?: string | null;
  parent_record_id?: string | null;
  depth?: number | null;
  purpose?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  status_options?: unknown;
  announce_who?: string | null;
  announce_mode?: string | null;
  title_label?: string | null;
  default_view?: string | null;
  mobile_columns?: string[] | null;
  source_template_key?: string | null;
  archived_at?: string | null;
  kind?: string | null;
  orphan_origin?: string | null;
  share_mode?: string | null;
  sync_source?: string | null;
  hidden_in_list?: boolean | null;
  sync_hidden?: string[] | null;
  thinking_type?: string | null;
  lifecycle?: string | null;
};

type RecordRow = {
  id: string;
  table_id: string;
  owner_user_id: string;
  title: string;
  status: string;
  priority: string;
  category: string | null;
  next_action_date: string | null;
  remind_at?: string | null;
  tags: string[] | null;
  notes: string | null;
  extension_fields: unknown;
  contact_labels?: unknown;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  moved_from?: unknown;
  opportunity_id?: string | null;
};

/** AVORA-65 · E: the name a picker brought into a shared Liên hệ cell, and who picked it. */
export type ContactLabel = { name: string; by: string; byName: string };

function parseContactLabels(raw: unknown): Readonly<Record<string, ContactLabel>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ContactLabel> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const entry = value as { name?: unknown; by?: unknown; by_name?: unknown };
    if (typeof entry.name === "string" && typeof entry.by === "string") {
      out[key] = { name: entry.name, by: entry.by, byName: typeof entry.by_name === "string" ? entry.by_name : "" };
    }
  }
  return out;
}

/** Reads `[{key,label,done?}]`, skipping anything unreadable; null when nothing usable is left. */
export function parseStatusOptions(raw: unknown): StatusOption[] | null {
  if (!Array.isArray(raw)) return null;
  const options: StatusOption[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.key !== "string" || typeof item.label !== "string") continue;
    if (item.key.trim() === "" || item.label.trim() === "") continue;
    options.push(item.done === true ? { key: item.key, label: item.label, done: true } : { key: item.key, label: item.label });
  }
  return options.length === 0 ? null : options;
}

function parseMovedFrom(raw: unknown): ThinkRecord["movedFrom"] {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.table_name !== "string" || typeof item.at !== "string") return null;
  return { tableName: item.table_name, at: item.at };
}

function isColumnType(value: unknown): value is ColumnType {
  return typeof value === "string" && (COLUMN_TYPES as readonly string[]).includes(value);
}

/**
 * Reads the stored column shape, skipping anything unreadable.
 *
 * One malformed definition costs that column, never the table: a screen that refuses to open
 * because of a single bad entry hides every record behind it, and the records are the part
 * that matters.
 */
export function parseColumnDefs(raw: unknown): ColumnDef[] {
  if (!Array.isArray(raw)) return [];
  const defs: ColumnDef[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : "";
    const label = typeof item.label === "string" ? item.label : "";
    if (key.length === 0 || label.trim().length === 0) continue;
    if (seen.has(key)) continue;
    if (!isColumnType(item.type)) continue;
    // Columns made before ids existed were given their key as id by the migration.
    const id = typeof item.id === "string" && item.id.length > 0 ? item.id : key;
    const presentation: { width?: number; hidden?: boolean } = {};
    if (typeof item.width === "number" && Number.isFinite(item.width)) presentation.width = clampColumnWidth(item.width);
    if (item.hidden === true) presentation.hidden = true;

    if (item.type === "select") {
      const options = Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === "string")
        : [];
      if (options.length === 0) continue;
      defs.push({ id, key, label, type: "select", options, ...presentation });
    } else {
      defs.push({ id, key, label, type: item.type, ...presentation });
    }
    seen.add(key);
  }

  return defs;
}

/** Reads the board's column bin, keeping only entries still inside their 30 days. */
export function parseColumnTrash(raw: unknown, now: Date = new Date()): TrashedColumn[] {
  if (!Array.isArray(raw)) return [];
  const out: TrashedColumn[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const [column] = parseColumnDefs([item.def]);
    const deletedAt = typeof item.deleted_at === "string" ? item.deleted_at : null;
    if (column === undefined || deletedAt === null) continue;
    if (now.getTime() - new Date(deletedAt).getTime() > 30 * 86_400_000) continue;
    const values = item.values !== null && typeof item.values === "object" ? Object.keys(item.values as object).length : 0;
    out.push({ column, deletedAt, filledCount: values });
  }
  return out;
}

/** Reads stored extension values, keeping only what a cell can actually display. */
export function parseExtensionFields(raw: unknown): Record<string, ExtensionValue> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const values: Record<string, ExtensionValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") values[key] = value;
  }
  return values;
}

function toTable(row: TableRow): ThinkTable {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    position: row.position,
    columns: parseColumnDefs(row.column_defs),
    columnTrash: parseColumnTrash(row.column_trash),
    projectId: row.project_id ?? null,
    conversationId: row.conversation_id ?? null,
    parentRecordId: row.parent_record_id ?? null,
    depth: row.depth ?? 1,
    purpose: row.purpose ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    statusOptions: parseStatusOptions(row.status_options),
    announceWho: row.announce_who === "admins" ? "admins" : "members",
    announceMode: row.announce_mode === "daily" ? "daily" : row.announce_mode === "silent" ? "silent" : "manual",
    titleLabel: row.title_label ?? null,
    defaultView: row.default_view === "kanban" || row.default_view === "tree" || row.default_view === "table" ? row.default_view : null,
    mobileColumns: row.mobile_columns ?? [],
    sourceTemplateKey: row.source_template_key ?? null,
    archivedAt: row.archived_at ?? null,
    kind: row.kind === "bookshelf" ? "bookshelf" : null,
    orphanOrigin: row.orphan_origin ?? null,
    shareMode: row.share_mode === "view" ? "view" : "edit",
    syncSource: row.sync_source === "contact_opportunities" ? "contact_opportunities" : null,
    hiddenInList: row.hidden_in_list === true,
    syncHidden: row.sync_hidden ?? [],
    thinkingType:
      row.thinking_type === "track" || row.thinking_type === "progress" || row.thinking_type === "breakdown" || row.thinking_type === "weigh" || row.thinking_type === "learn"
        ? row.thinking_type
        : null,
    lifecycle:
      row.archived_at != null
        ? "archived"
        : row.lifecycle === "thinking" || row.lifecycle === "concluded"
          ? row.lifecycle
          : "waiting",
  };
}

function toRecord(row: RecordRow): ThinkRecord {
  return {
    id: row.id,
    tableId: row.table_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    status: row.status,
    // An unreadable priority reads as the middle one rather than throwing: the record exists
    // and deserves to be shown, and "trung_binh" is the value that claims nothing.
    priority: isRecordPriority(row.priority) ? row.priority : "trung_binh",
    category: row.category,
    nextActionDate: row.next_action_date,
    remindAt: row.remind_at ?? null,
    tags: row.tags ?? [],
    notes: row.notes,
    extensionFields: parseExtensionFields(row.extension_fields),
    contactLabels: parseContactLabels(row.contact_labels),
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    movedFrom: parseMovedFrom(row.moved_from),
    opportunityId: row.opportunity_id ?? null,
  };
}

// ------------------------------------------------------------------ reading shapes

/** The tables to show, in the order they were arranged. Deleted ones stay out. */
export function visibleTables(tables: readonly ThinkTable[]): ThinkTable[] {
  return tables
    .filter((table) => table.deletedAt === null)
    .sort((left, right) =>
      left.position === right.position
        ? left.createdAt.localeCompare(right.createdAt)
        : left.position - right.position,
    );
}

/** Which scope a table belongs to. */
export function tableScope(table: Pick<ThinkTable, "projectId" | "conversationId">): TableScope {
  if (table.projectId !== null) return "project";
  if (table.conversationId !== null) return "conversation";
  return "personal";
}

/**
 * Where a record is being written: the Diary (both null), one conversation, or one project.
 * The server refuses a record whose table does not sit in exactly this scope.
 */
export type RecordScope = {
  conversationId: string | null;
  projectId: string | null;
};

export const PERSONAL_SCOPE: RecordScope = { conversationId: null, projectId: null };

/** The scope a record written into this table must declare. */
export function scopeOfTable(table: Pick<ThinkTable, "projectId" | "conversationId">): RecordScope {
  return { conversationId: table.conversationId, projectId: table.projectId };
}

/** Only the tables a record may be filed into from this scope — the same rule the server applies. */
export function tablesInScope(tables: readonly ThinkTable[], scope: RecordScope): ThinkTable[] {
  return visibleTables(tables).filter(
    (table) => table.conversationId === scope.conversationId && table.projectId === scope.projectId,
  );
}

/** Root tables only — what a list of "tables" shows before anything is unfolded. */
export function rootTables(tables: readonly ThinkTable[]): ThinkTable[] {
  return visibleTables(tables).filter((table) => table.parentRecordId === null);
}

/** The sub-tables grown from one record. */
export function subTablesOf(tables: readonly ThinkTable[], recordId: string): ThinkTable[] {
  return visibleTables(tables).filter((table) => table.parentRecordId === recordId);
}

/** Whether a record in this table can grow a sub-table. The server decides too. */
export function canGrowSubTable(table: Pick<ThinkTable, "depth">): boolean {
  return table.depth < MAX_TABLE_DEPTH;
}

/** The purpose a new sub-table suggests, editable before it is saved. */
export function suggestedSubTablePurpose(recordTitle: string): string {
  return `Theo dõi cho: ${recordTitle.trim()}`;
}

/** The query parameter that opens one Hạng mục inside a table (AVORA-39 / Phần 1 · D4). */
export const HUB_RECORD_PARAM = "hang-muc";

/** Kế hoạch opened on one Hạng mục — and, when given, pointing at one of its tasks. */
export function recordLink(tableId: string, recordId: string, taskId?: string | null): string {
  const params = new URLSearchParams();
  params.set("bang", tableId);
  params.set(HUB_RECORD_PARAM, recordId);
  if (typeof taskId === "string" && taskId.length > 0) params.set("nhiem-vu", taskId);
  return `/ke-hoach?${params.toString()}`;
}

/**
 * "Bảng › Hạng mục", or for a sub-table "Hạng mục cha › Bảng con › Hạng mục" — the heading a
 * planned task sits under in a project's task list. Stops at anything the viewer cannot see.
 */
export function recordPath(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  recordId: string,
): { label: string; tableId: string } | null {
  const record = records.find((entry) => entry.id === recordId);
  if (record === undefined) return null;
  const steps = tableAncestry(tables, records, record.tableId);
  if (steps.length === 0) return null;
  const parts: string[] = [];
  if (steps.length === 1) parts.push(steps[0].table.name);
  else {
    const parentRecord = steps[steps.length - 2].viaRecord;
    if (parentRecord !== null) parts.push(parentRecord.title);
    parts.push(steps[steps.length - 1].table.name);
  }
  parts.push(record.title);
  return { label: parts.join(" › "), tableId: record.tableId };
}

export type AncestryStep = {
  table: ThinkTable;
  /** The Hạng mục in this table that the next step grew from; null on the last step. */
  viaRecord: ThinkRecord | null;
};

/**
 * The chain from a table's root down to the table itself, for the breadcrumb above a sub-table.
 * Stops quietly at anything it cannot see rather than guessing a parent.
 */
export function tableAncestry(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  tableId: string,
): AncestryStep[] {
  const byId = new Map(tables.map((table) => [table.id, table] as const));
  const recordById = new Map(records.map((record) => [record.id, record] as const));
  const steps: AncestryStep[] = [];
  let current = byId.get(tableId);
  let via: ThinkRecord | null = null;
  for (let guard = 0; current !== undefined && guard < MAX_TABLE_DEPTH + 1; guard += 1) {
    steps.unshift({ table: current, viaRecord: via });
    if (current.parentRecordId === null) break;
    const parentRecord = recordById.get(current.parentRecordId);
    if (parentRecord === undefined) break;
    via = parentRecord;
    current = byId.get(parentRecord.tableId);
  }
  return steps;
}

/** The line shown when the three-level limit is reached. */
export const DEPTH_LIMIT_MESSAGE =
  "Đã đạt giới hạn 3 tầng, dùng thêm cột hoặc Hạng mục mới thay vì tầng sâu hơn.";

/**
 * "Bảng của tôi": the viewer's personal tables plus the tables of their 1-1 conversations,
 * roots only. Group and project tables belong to the room and are listed there instead.
 */
export function myTables(
  tables: readonly ThinkTable[],
  userId: string | undefined,
  isDirect: (conversationId: string) => boolean,
): ThinkTable[] {
  return rootTables(tables).filter((table) => {
    if (table.projectId !== null) return false;
    if (table.conversationId === null) return table.ownerUserId === userId;
    return isDirect(table.conversationId);
  });
}

/** The three Connect Hub layers "Bảng của tôi" is read in, in display order. */
export type TableLayer = "personal" | "direct" | "group";

export const TABLE_LAYERS: readonly { id: TableLayer; label: string; empty: string }[] = [
  { id: "personal", label: "Bảng của tôi", empty: "Chưa có bảng riêng nào." },
  { id: "direct", label: "Bảng 1-1", empty: "Chưa có bảng chung với ai." },
  { id: "group", label: "Bảng nhóm", empty: "Chưa có bảng nào trong nhóm." },
];

/**
 * "Bảng của tôi" split into the Connect Hub layers: personal tables I own, tables shared in a
 * 1-1, and tables kept in a group. Roots only; a project's tables stay with the project, and a
 * conversation the viewer cannot see (kind unknown) is left out rather than guessed.
 */
export function tablesByLayer(
  tables: readonly ThinkTable[],
  userId: string | undefined,
  kindOf: (conversationId: string) => "direct" | "group" | "personal" | undefined,
): Record<TableLayer, ThinkTable[]> {
  const layers: Record<TableLayer, ThinkTable[]> = { personal: [], direct: [], group: [] };
  for (const table of rootTables(tables)) {
    if (table.projectId !== null) continue;
    if (table.conversationId === null) {
      if (table.ownerUserId === userId) layers.personal.push(table);
      continue;
    }
    const kind = kindOf(table.conversationId);
    if (kind === "direct") layers.direct.push(table);
    else if (kind === "group") layers.group.push(table);
  }
  return layers;
}

/** The live records of one table, newest first. */
export function recordsOf(
  records: readonly ThinkRecord[],
  tableId: string,
): ThinkRecord[] {
  return records
    .filter((record) => record.tableId === tableId && record.deletedAt === null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** How full a table is — what the "+ Thêm mục" button reads before it refuses. */
export function recordCountOf(records: readonly ThinkRecord[], tableId: string): number {
  return records.filter((record) => record.tableId === tableId && record.deletedAt === null).length;
}

/** Whether this table can still take a new record. The server decides too; this only warns. */
export function isTableFull(records: readonly ThinkRecord[], tableId: string): boolean {
  return recordCountOf(records, tableId) >= RECORD_LIMIT;
}

export type StatusColumn = {
  status: string;
  label: string;
  records: readonly ThinkRecord[];
};

/**
 * The Kanban board: one column per status, built from the table's own records.
 *
 * The suggested statuses always appear, even empty, so a new table has somewhere to drag a
 * card TO. Statuses nobody uses beyond those four do not appear — a board of empty columns
 * is a board that says nothing. Anything a person actually typed gets its own column at the
 * end, in first-seen order, because the alternative is quietly hiding their records.
 */
export function groupByStatus(
  records: readonly ThinkRecord[],
  statusOptions: readonly StatusOption[] | null = null,
): StatusColumn[] {
  const buckets = new Map<string, ThinkRecord[]>();
  const labels = new Map<string, string>((statusOptions ?? []).map((option) => [option.key, option.label] as const));
  // C1: Kanban reads the table's own statuses when it has them.
  for (const status of statusOptions === null ? SUGGESTED_STATUSES : statusOptions.map((option) => option.key)) buckets.set(status, []);

  for (const record of records) {
    const key = record.status.trim();
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [record]);
    else bucket.push(record);
  }

  return [...buckets.entries()].map(([status, items]) => ({
    status,
    label: labels.get(status) ?? statusLabel(status),
    records: items,
  }));
}

/** A status's label in this table — its own word first, then the defaults, then as typed. */
export function statusLabelIn(table: Pick<ThinkTable, "statusOptions"> | null | undefined, status: string): string {
  const own = table?.statusOptions?.find((option) => option.key === status);
  return own?.label ?? statusLabel(status);
}

/** Whether a status means finished in this table ("Xong" by default). */
export function isDoneStatus(table: Pick<ThinkTable, "statusOptions"> | null | undefined, status: string): boolean {
  // "Không làm nữa" (Nhìn lại · Còn treo › Bỏ) is set aside in every table, whatever its own statuses.
  if (status === "khong_lam") return true;
  const own = table?.statusOptions?.find((option) => option.key === status);
  if (own !== undefined) return own.done === true;
  return status === "xong" || status === "khong_lam";
}

/** What a cell shows for one extension column of one record. */
export function cellValue(record: ThinkRecord, column: ColumnDef): string {
  const value = record.extensionFields[column.key];
  if (value === null || value === undefined) return "";
  if (column.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("vi-VN").format(value);
  }
  if (column.type === "checkbox") return value === "1" ? "Có" : "";
  return String(value);
}

/** How many Hạng mục have something in a column — what deleting it would take away. */
export function filledCountOf(records: readonly ThinkRecord[], column: ColumnDef): number {
  return records.filter((record) => {
    const value = record.extensionFields[column.key];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
}

// ------------------------------------------------------------------ what needs attention

export type HubAttention = {
  overdue: number;
  today: number;
  week: number;
  /** The three above, added up. */
  total: number;
};

/**
 * How much of the HUB is asking to be looked at.
 *
 * Deliberately the same three windows and the same shape as `obligationAttention` in Tài
 * chính — late, due today, due within the week — so the overview reads the same way whichever
 * part of the app it is describing. A record with no next date is never pressing: nothing was
 * promised about when.
 */
export function hubAttention(
  records: readonly ThinkRecord[],
  today: string,
  withinDays: number = 7,
): HubAttention {
  const attention: HubAttention = { overdue: 0, today: 0, week: 0, total: 0 };
  const horizon = addDaysIso(today, withinDays);

  for (const record of records) {
    if (record.deletedAt !== null) continue;
    const due = record.nextActionDate;
    if (due === null) continue;

    if (due < today) attention.overdue += 1;
    else if (due === today) attention.today += 1;
    else if (due <= horizon) attention.week += 1;
    else continue;

    attention.total += 1;
  }

  return attention;
}

/** A date `days` after an ISO day, staying in calendar days rather than clock hours. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today, as the ISO day the records are stored in. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * The one sentence the overview leads with.
 *
 * It names the most pressing fact rather than restating the numbers beside it, and an empty
 * HUB is said as room to start, not as zero.
 */
export function attentionSentence(attention: HubAttention, tableCount: number): string {
  if (tableCount === 0) return "Chưa có bảng nào. Tạo bảng đầu tiên để bắt đầu.";
  if (attention.total === 0) return "Không có mục nào tới hạn trong tuần này.";
  if (attention.overdue > 0)
    return `${attention.total} mục cần theo dõi, trong đó ${attention.overdue} mục đã quá hạn.`;
  if (attention.today > 0)
    return `${attention.total} mục cần theo dõi, ${attention.today} mục đến hạn hôm nay.`;
  return `${attention.total} mục cần theo dõi trong tuần này.`;
}

// ------------------------------------------------------------------ errors

/** The database's refusals, in words someone can act on. */
export function toVietnameseHubError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (isContactUnavailable(normalized)) return CONTACT_UNAVAILABLE_MESSAGE;

  if (normalized.includes("avora_think_hub_record_limit"))
    return `Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} mục, hãy dọn bớt trước khi thêm.`;
  if (normalized.includes("avora_think_hub_table_name_required"))
    return "Bảng cần một cái tên.";
  if (normalized.includes("avora_think_hub_record_title_required"))
    return "Mục này cần một tiêu đề.";
  if (normalized.includes("avora_think_hub_record_status_required"))
    return "Mục này cần một trạng thái.";
  if (normalized.includes("avora_think_hub_column_label_required"))
    return "Cột cần một cái tên.";
  if (normalized.includes("avora_think_hub_column_options_required"))
    return "Cột dạng chọn cần ít nhất một lựa chọn.";
  if (normalized.includes("avora_think_hub_column_type_invalid"))
    return "Kiểu cột này không hợp lệ.";
  if (normalized.includes("avora_think_hub_column_type_unsafe"))
    return "Đổi loại này có thể làm mất dữ liệu, nên chưa đổi được.";
  if (normalized.includes("avora_think_hub_column_key_taken"))
    return "Cột này đã tồn tại trong bảng.";
  if (normalized.includes("avora_think_hub_column_limit"))
    return "Bảng đã đủ số cột mở rộng cho phép.";
  if (normalized.includes("avora_think_hub_value_not_number"))
    return "Cột này chỉ nhận số.";
  if (normalized.includes("avora_think_hub_value_not_date"))
    return "Cột này chỉ nhận ngày.";
  if (normalized.includes("avora_think_hub_value_not_option"))
    return "Giá trị này không nằm trong danh sách của cột.";
  if (normalized.includes("avora_think_hub_value_not_text"))
    return "Cột này chỉ nhận chữ.";
  if (normalized.includes("avora_think_hub_priority_invalid"))
    return "Độ ưu tiên này không hợp lệ.";
  if (normalized.includes("avora_think_hub_record_deleted"))
    return "Mục này đã được cất đi.";
  if (
    normalized.includes("avora_think_hub_table_not_yours") ||
    normalized.includes("avora_think_hub_table_missing")
  )
    return "Bảng này không còn nữa.";
  if (normalized.includes("avora_think_hub_record_not_yours"))
    return "Mục này không còn nữa.";
  if (normalized.includes("avora_think_hub_patch_field"))
    return "Không sửa được trường này.";
  if (normalized.includes("avora_think_hub_depth_limit")) return DEPTH_LIMIT_MESSAGE;
  if (normalized.includes("avora_think_hub_table_out_of_scope"))
    return "Bảng này thuộc một nơi khác. Hãy chọn bảng của đúng cuộc trò chuyện hoặc dự án này.";
  if (normalized.includes("avora_think_hub_scope_invalid"))
    return "Bảng chung chỉ mở được trong cuộc 1-1 hoặc Nhóm.";
  if (normalized.includes("avora_think_hub_purpose_inherited"))
    return "Bảng gốc của dự án dùng Kim chỉ nam và Mục tiêu của dự án.";
  if (normalized.includes("avora_think_hub_project_root_locked"))
    return "Bảng gốc của dự án không cất đi được.";
  if (normalized.includes("avora_think_hub_column_missing")) return "Cột này không còn nữa.";
  if (normalized.includes("avora_think_hub_sub_table_exists"))
    return "Hạng mục này đã có bảng con — mở bảng con đó thay vì tạo thêm.";
  if (normalized.includes("avora_think_hub_column_width_invalid")) return "Độ rộng cột không hợp lệ.";
  if (normalized.includes("avora_think_hub_task_out_of_scope"))
    return "Việc này thuộc một nơi khác với Hạng mục.";
  if (normalized.includes("avora_project_closed")) return "Dự án đã đóng, bảng chỉ còn để đọc.";
  if (normalized.includes("avora_task_assignee_required") || normalized.includes("avora_task_assignee_not_participant"))
    return "Hãy chọn một thành viên để giao việc.";
  if (normalized.includes("avora_task_self_assign")) return "Việc giao đi cần một người khác nhận.";
  if (normalized.includes("avora_task_deadline_past")) return "Hạn không được ở quá khứ.";
  if (normalized.includes("avora_task_title_blank")) return "Việc cần một tiêu đề.";
  if (normalized.includes("avora_task_description_required")) return "Việc cần một dòng mô tả.";
  if (normalized.includes("avora_think_hub_column_id_immutable"))
    return "Không đổi được kiểu của một cột đã có dữ liệu.";
  const extra = extraHubError(normalized);
  if (extra !== null) return extra;
  if (normalized.includes("avora_not_a_participant"))
    return "Bạn không còn trong cuộc trò chuyện này.";
  if (normalized.includes("avora_not_signed_in"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với bảng này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  // The app asked for a server function the server does not have in that shape (an app/server
  // mismatch, not the person's fault). Said plainly so it gets reported, not retried forever.
  if (code === "PGRST202" || code === "PGRST203")
    return "Ứng dụng và máy chủ chưa khớp nhau. Hãy tải lại trang; nếu vẫn lỗi, báo cho chúng tôi.";
  if (normalized.includes("avora_")) logError("think-hub", { code: "unmapped", message: normalized.match(/avora_[a-z_]+/)?.[0] ?? "avora" });
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

/** Đợt gộp 2 · C refusals (templates, archive, proposals, move/copy). */
function extraHubError(normalized: string): string | null {
  const table: readonly (readonly [string, string])[] = [
    ["avora_template_table_not_empty", "Chỉ áp mẫu được cho Bảng chưa có Hạng mục nào."],
    ["avora_template_missing", "Mẫu này không còn nữa."],
    ["avora_template_limit", "Bạn đã có 50 mẫu. Xoá bớt trước khi lưu thêm."],
    ["avora_template_bookshelf_only", "Mẫu Kệ sách chỉ dùng cho Kệ sách của bạn."],
    ["avora_template_source_required", "Hãy chọn một mẫu trước khi tạo Bảng."],
    ["avora_table_archived", "Bảng này đã lưu trữ — chỉ xem. Đề nghị mở lại để sửa."],
    ["avora_shared_needs_proposal", "Đây là tài sản chung — cần đề nghị và mọi bên liên quan đồng ý."],
    ["avora_shared_use_restore_shared", "Bảng chung khôi phục từ Thùng rác chung."],
    ["avora_shared_restore_not_party", "Chỉ bên liên quan của đề nghị mới khôi phục được."],
    ["avora_shared_no_purge", "Tài sản chung không xoá vĩnh viễn được."],
    ["avora_confirm_name_mismatch", "Tên gõ lại chưa khớp."],
    ["avora_bookshelf_locked", "Kệ sách luôn ở đây, không xoá hay lưu trữ."],
    ["avora_think_hub_sub_table_follows_root", "Bảng con theo trạng thái của Bảng gốc."],
    ["avora_proposal_already_open", "Đã có một đề nghị đang chờ cho mục này."],
    ["avora_proposal_reason_required", "Hãy ghi lý do."],
    ["avora_proposal_reason_too_long", "Lý do tối đa 300 ký tự."],
    ["avora_proposal_closed", "Đề nghị này đã khép."],
    ["avora_proposal_not_stakeholder", "Bạn không nằm trong danh sách được hỏi."],
    ["avora_proposal_personal_table", "Bảng cá nhân tự xoá hoặc lưu trữ được, không cần đề nghị."],
    ["avora_proposal_action_invalid", "Không đề nghị được việc này cho mục này."],
    ["avora_record_has_subtable", "Hạng mục này có bảng con. Gỡ bảng con trước, hoặc sao chép thay vì di chuyển."],
    ["avora_record_move_shared", "Hạng mục chung chỉ di chuyển được khi hoàn toàn là của bạn. Hãy sao chép."],
    ["avora_record_move_unmatched", "Có cột không khớp — xác nhận ghi vào Ghi chú trước."],
    ["avora_record_move_same_table", "Hạng mục đã ở Bảng này."],
    ["avora_record_move_bookshelf", "Kệ sách chỉ nhận sách."],
    // AVORA-77
    ["avora_think_hub_view_only", "Bảng này đang Chỉ xem — chỉ chủ Bảng đổi được."],
    ["avora_sync_board_locked", "Bảng Avora mặc định do Avora tự lập — không đổi được phần này."],
    ["avora_conclusion_length", "Kết luận dài 1–500 ký tự."],
    ["avora_lifecycle_archive_via_archive", "Lưu trữ Bảng ở menu ⋯ cạnh tên Bảng."],
    ["avora_book_not_yours", "Cuốn này không còn trên Kệ sách của bạn."],
  ];
  for (const [code, text] of table) if (normalized.includes(code)) return text;
  return null;
}

function fail(code: string | undefined, message: string): Error {
  logError("think-hub", { code, message });
  return new Error(toVietnameseHubError(code, message));
}

/** Shared failure mapper for the Đợt gộp 2 companion module. */
export function hubFail(code: string | undefined, message: string): Error {
  return fail(code, message);
}

/** Maps a raw row (from an RPC) to the screen shape. */
export function tableFromRow(row: unknown): ThinkTable {
  return toTable(row as TableRow);
}

export function recordFromRow(row: unknown): ThinkRecord {
  return toRecord(row as RecordRow);
}

// ------------------------------------------------------------------ reading

/** Every table the viewer can read — their own, their conversations', their projects'. Deleted ones included. */
export async function fetchThinkTables(): Promise<ThinkTable[]> {
  const { data, error } = await supabase
    .from("think_hub_table")
    .select("*")
    .order("position", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toTable(row as TableRow));
}

/** Every live record in every table the viewer can read. */
export async function fetchThinkRecords(): Promise<ThinkRecord[]> {
  const { data, error } = await supabase
    .from("think_hub_record")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw fail(error.code, error.message);
  // AVORA-69: `Nhắc tôi xem lại` is each person's own (RLS returns only mine).
  const reminders = await supabase.from("think_hub_record_reminders" as never).select("record_id, remind_at");
  const mine = new Map(((reminders.data ?? []) as { record_id: string; remind_at: string }[]).map((row) => [row.record_id, row.remind_at] as const));
  return (data ?? []).map((row) => {
    const record = toRecord(row as RecordRow);
    return { ...record, remindAt: mine.get(record.id) ?? null };
  });
}

// ------------------------------------------------------------------ writing

/** The table someone lands in on their first visit. Safe to call on every visit. */
export async function ensureDefaultTable(): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("ensure_default_think_hub_table");
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/**
 * A new standalone table — personal when `conversationId` is null, otherwise shared with that
 * 1-1 or group. A project's root table is made with the project, never here.
 */
export async function createThinkTable(input: {
  name: string;
  purpose?: string | null;
  conversationId?: string | null;
}): Promise<ThinkTable> {
  const purpose = input.purpose?.trim() ?? "";
  const { data, error } = await supabase.rpc("create_think_hub_table", {
    p_name: input.name.trim(),
    p_purpose: purpose.length === 0 ? undefined : purpose,
    p_conversation_id: input.conversationId ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/**
 * A sub-table grown from one record. It inherits the parent's scope on the server. `purpose`
 * undefined takes the suggested "Theo dõi cho: …"; an empty string deliberately leaves it blank.
 */
export async function createThinkSubTable(input: {
  recordId: string;
  name?: string;
  purpose?: string;
}): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("create_think_hub_sub_table", {
    p_record_id: input.recordId,
    p_name: input.name?.trim() || undefined,
    p_purpose: input.purpose === undefined ? undefined : input.purpose.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Rewrites a table's purpose. A project's root table has none of its own and is refused. */
export async function setThinkTablePurpose(tableId: string, purpose: string): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("set_think_hub_table_purpose", {
    p_table_id: tableId,
    p_purpose: purpose.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Sets a column's width (owner only). Null gives the default back. */
export async function setThinkColumnWidth(input: {
  tableId: string;
  columnId: string;
  width: number | null;
}): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("set_think_hub_column_width", {
    p_table_id: input.tableId,
    p_column_id: input.columnId,
    // Null (not a missing key) resets the width: the function has no default for p_width.
    p_width: input.width === null ? null : clampColumnWidth(input.width),
  } as unknown as Database["public"]["Functions"]["set_think_hub_column_width"]["Args"]);
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Hides or shows a column for everyone reading the table (owner only). */
export async function setThinkColumnHidden(input: {
  tableId: string;
  columnId: string;
  hidden: boolean;
}): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("set_think_hub_column_hidden", {
    p_table_id: input.tableId,
    p_column_id: input.columnId,
    p_hidden: input.hidden,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Which task hangs under which Hạng mục, for tables outside a project. */
export type RecordTaskLink = { taskId: string; recordId: string };

export async function fetchRecordTaskLinks(): Promise<RecordTaskLink[]> {
  const { data, error } = await supabase.from("think_hub_record_tasks").select("task_id, record_id");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({ taskId: row.task_id, recordId: row.record_id }));
}

/**
 * Makes one Task from a Hạng mục outside a project: a personal task from a Diary table, a shared
 * one (waiting for the assignee to confirm) from a 1-1 or group table. Project tables use
 * `createProjectTask` instead.
 */
export async function createRecordTask(input: {
  recordId: string;
  title: string;
  description: string;
  deadline: string;
  assigneeId: string | null;
  deadlineTz: string;
  deadlineTime?: string | null;
}): Promise<string> {
  const taskId = crypto.randomUUID();
  const { error } = await supabase.rpc("create_record_task", {
    p_record_id: input.recordId,
    p_task_id: taskId,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_deadline: input.deadline,
    p_assignee_id: input.assigneeId ?? undefined,
    p_deadline_time: input.deadlineTime ?? undefined,
    p_deadline_tz: input.deadlineTz,
  });
  if (error) throw fail(error.code, error.message);
  return taskId;
}

/** Renames a column by its permanent id. The values stored under it are untouched. */
export async function renameThinkColumn(input: {
  tableId: string;
  columnId: string;
  label: string;
}): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("rename_think_hub_column", {
    p_table_id: input.tableId,
    p_column_id: input.columnId,
    p_label: input.label.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Changes a column's kind — only the safe changes; the server refuses the rest (AVORA-61 · E). */
export async function changeThinkColumnType(input: { tableId: string; columnId: string; type: ColumnType }): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("change_think_hub_column_type", {
    p_table_id: input.tableId,
    p_column_id: input.columnId,
    p_type: input.type,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Moves a column into the board's bin, values and all (owner only). */
export async function deleteThinkColumn(input: { tableId: string; columnId: string }): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("delete_think_hub_column", { p_table_id: input.tableId, p_column_id: input.columnId });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Brings a column back from the bin with every value it had. */
export async function restoreThinkColumn(input: { tableId: string; columnId: string }): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("restore_think_hub_column", { p_table_id: input.tableId, p_column_id: input.columnId });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** A member of a shared board asks its owner to delete a column (ADR-031), in the conversation. */
export async function requestThinkColumnDelete(input: { tableId: string; columnId: string; reason: string }): Promise<void> {
  const { error } = await supabase.rpc("request_think_hub_column_delete", {
    p_table_id: input.tableId,
    p_column_id: input.columnId,
    p_reason: input.reason.trim(),
  });
  if (error) throw fail(error.code, error.message);
}

/** Renames a table. */
export async function renameThinkTable(
  tableId: string,
  name: string,
): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("rename_think_hub_table", {
    p_table_id: tableId,
    p_name: name.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Puts a table away. Its records go with it and come back with it. */
export async function deleteThinkTable(tableId: string): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("delete_think_hub_table", {
    p_table_id: tableId,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Takes a table back out. */
export async function restoreThinkTable(tableId: string): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("restore_think_hub_table", {
    p_table_id: tableId,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Adds one extension column to one table. Existing records keep every value they had. */
export async function addThinkColumn(input: {
  tableId: string;
  label: string;
  type: ColumnType;
  options?: readonly string[];
}): Promise<ThinkTable> {
  const options =
    input.type === "select"
      ? (input.options ?? []).map((option) => option.trim()).filter((option) => option.length > 0)
      : undefined;

  const { data, error } = await supabase.rpc("add_think_hub_column", {
    p_table_id: input.tableId,
    p_label: input.label.trim(),
    p_type: input.type,
    p_options: options,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

export type NewRecordInput = {
  tableId: string;
  /** Where this record is being written from. The server checks it against the table's own scope. */
  scope: RecordScope;
  title: string;
  status?: string;
  priority?: RecordPriority;
  category?: string | null;
  nextActionDate?: string | null;
  /** Set in a second call: the create RPC's signature is left untouched. */
  remindAt?: string | null;
  tags?: readonly string[];
  notes?: string | null;
  extensionFields?: Readonly<Record<string, ExtensionValue>>;
};

/** A new record. The 1.000 ceiling is enforced server-side, not here. */
export async function createThinkRecord(input: NewRecordInput): Promise<ThinkRecord> {
  const { data, error } = await supabase.rpc("create_think_hub_record", {
    p_table_id: input.tableId,
    p_title: input.title.trim(),
    p_status: input.status ?? undefined,
    p_priority: input.priority ?? undefined,
    p_category: input.category ?? undefined,
    p_next_action_date: input.nextActionDate ?? undefined,
    p_tags: input.tags === undefined ? undefined : [...input.tags],
    p_notes: input.notes ?? undefined,
    p_extension_fields:
      input.extensionFields === undefined ? undefined : { ...input.extensionFields },
    p_scope_conversation_id: input.scope.conversationId ?? undefined,
    p_scope_project_id: input.scope.projectId ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  const created = toRecord(data as unknown as RecordRow);
  if (input.remindAt === undefined || input.remindAt === null) return created;
  return updateThinkRecord(created.id, { remindAt: input.remindAt });
}

export type RecordPatch = {
  title?: string;
  status?: string;
  priority?: RecordPriority;
  category?: string | null;
  nextActionDate?: string | null;
  /** An ISO instant, or null to clear. */
  remindAt?: string | null;
  tags?: readonly string[];
  notes?: string | null;
  extensionFields?: Readonly<Record<string, ExtensionValue>>;
};

/**
 * Edits a record.
 *
 * A key that is present is written — including written empty — and a key that is absent is
 * left alone. That distinction is the whole point of sending a patch: with eight nullable
 * arguments, "leave the note as it was" and "clear the note" are the same call.
 */
export async function updateThinkRecord(
  recordId: string,
  patch: RecordPatch,
): Promise<ThinkRecord> {
  const body: Record<string, Json> = {};

  if (patch.title !== undefined) body.title = patch.title.trim();
  if (patch.status !== undefined) body.status = patch.status.trim();
  if (patch.priority !== undefined) body.priority = patch.priority;
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.nextActionDate !== undefined) body.next_action_date = patch.nextActionDate;
  if (patch.remindAt !== undefined) body.remind_at = patch.remindAt;
  if (patch.tags !== undefined) body.tags = [...patch.tags];
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.extensionFields !== undefined) body.extension_fields = { ...patch.extensionFields };

  if (Object.keys(body).length === 0) {
    throw new Error("Không có gì để lưu.");
  }

  const { data, error } = await supabase.rpc("update_think_hub_record", {
    p_record_id: recordId,
    p_patch: body,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}

/** Puts a record away. The space it held opens back up. */
export async function deleteThinkRecord(recordId: string): Promise<ThinkRecord> {
  const { data, error } = await supabase.rpc("delete_think_hub_record", {
    p_record_id: recordId,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}

/** Takes a record back out, if the table still has room for it. */
export async function restoreThinkRecord(recordId: string): Promise<ThinkRecord> {
  const { data, error } = await supabase.rpc("restore_think_hub_record", {
    p_record_id: recordId,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}


// ------------------------------------------------------------------ AVORA-69: Di chuyển Bảng

export type MoveBoardResult = { status: "moved" | "proposed" | "mode_changed"; proposalId?: string };

/** Moves (or shares) a board with everything under it. Becomes a proposal once others have contributed. */
export async function moveThinkTable(input: { tableId: string; conversationId: string | null; mode: "edit" | "view" }): Promise<MoveBoardResult> {
  const { data, error } = await supabase.rpc("move_think_hub_table" as never, {
    p_table_id: input.tableId,
    p_conversation_id: input.conversationId,
    p_mode: input.mode,
  } as never);
  if (error) throw moveFail(error.code, error.message);
  const row = (data ?? {}) as { status?: string; proposal_id?: string };
  return { status: row.status === "proposed" ? "proposed" : row.status === "mode_changed" ? "mode_changed" : "moved", proposalId: row.proposal_id };
}

function moveFail(code: string | undefined, message: string): Error {
  if (message.includes("avora_not_connected")) return new Error("Chỉ chia sẻ được vào cuộc 1-1 với bạn bè.");
  if (message.includes("avora_board_move_owner_only")) return new Error("Chỉ chủ Bảng di chuyển được Bảng.");
  if (message.includes("avora_board_move_locked")) return new Error("Kệ sách và bảng gốc của Dự án không di chuyển được.");
  if (message.includes("avora_board_move_sub_table")) return new Error("Bảng con đi theo bảng cha — hãy di chuyển bảng cha.");
  if (message.includes("avora_proposal_already_open")) return new Error("Bảng này đang có một đề nghị chờ mọi người trả lời.");
  if (message.includes("avora_board_move_same")) return new Error("Bảng đã ở đó rồi.");
  if (message.includes("avora_not_a_participant")) return new Error("Bạn không còn ở trong cuộc trò chuyện đó.");
  if (message.includes("avora_contact_unavailable")) return new Error("Không chia sẻ được với người này.");
  return fail(code, message);
}
