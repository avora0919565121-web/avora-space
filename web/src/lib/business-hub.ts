import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Business HUB — the tables someone keeps for running their own work.
 *
 * A private ledger, like Tài chính and the opportunity book: a table belongs to exactly one
 * person, is never shared, and nobody else can read a row of it. There are no members, no
 * invitations and no roles here on purpose — sharing a table is a different product with
 * different questions (who may rename a column, whose record is whose), and answering them
 * halfway would be worse than not answering them at all.
 *
 * Deliberately NOT the opportunity book. An opportunity is a specific thing — a contact being
 * turned into business, with stages the app understands. A Business HUB table is whatever its
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
 * The kinds of extension column someone can add.
 *
 * Four, and they stay four in v1. Every extra kind (currency, checkbox, a link to a contact)
 * is a promise about how the value sorts, totals and validates — easy to add to a picker,
 * hard to take back once someone's data is in it.
 */
export type ColumnType = "text" | "number" | "date" | "select";

export const COLUMN_TYPES: readonly ColumnType[] = ["text", "number", "date", "select"];

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Chữ",
  number: "Số",
  date: "Ngày",
  select: "Chọn 1 trong danh sách",
};

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
  key: string;
  label: string;
  type: ColumnType;
  /** Only for `select`, and never empty — a list with no options is a cell nobody can fill. */
  options?: readonly string[];
};

/** A value a person typed into an extension column. Null is "nobody has filled this in". */
export type ExtensionValue = string | number | null;

export type BusinessTable = {
  id: string;
  ownerUserId: string;
  name: string;
  position: number;
  columns: readonly ColumnDef[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type BusinessRecord = {
  id: string;
  tableId: string;
  ownerUserId: string;
  title: string;
  /** The person's own word, not one of ours — Kanban builds its columns from these. */
  status: string;
  priority: RecordPriority;
  category: string | null;
  nextActionDate: string | null;
  tags: readonly string[];
  notes: string | null;
  extensionFields: Readonly<Record<string, ExtensionValue>>;
  /** Reserved. The Dự án module does not exist yet, so nothing writes this. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const businessHubKeys = {
  all: ["business-hub"] as const,
  tables: ["business-hub", "tables"] as const,
  records: ["business-hub", "records"] as const,
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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
  tags: string[] | null;
  notes: string | null;
  extension_fields: unknown;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

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

    if (item.type === "select") {
      const options = Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === "string")
        : [];
      if (options.length === 0) continue;
      defs.push({ key, label, type: "select", options });
    } else {
      defs.push({ key, label, type: item.type });
    }
    seen.add(key);
  }

  return defs;
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

function toTable(row: TableRow): BusinessTable {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    position: row.position,
    columns: parseColumnDefs(row.column_defs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRecord(row: RecordRow): BusinessRecord {
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
    tags: row.tags ?? [],
    notes: row.notes,
    extensionFields: parseExtensionFields(row.extension_fields),
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// ------------------------------------------------------------------ reading shapes

/** The tables to show, in the order they were arranged. Deleted ones stay out. */
export function visibleTables(tables: readonly BusinessTable[]): BusinessTable[] {
  return tables
    .filter((table) => table.deletedAt === null)
    .sort((left, right) =>
      left.position === right.position
        ? left.createdAt.localeCompare(right.createdAt)
        : left.position - right.position,
    );
}

/** The live records of one table, newest first. */
export function recordsOf(
  records: readonly BusinessRecord[],
  tableId: string,
): BusinessRecord[] {
  return records
    .filter((record) => record.tableId === tableId && record.deletedAt === null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** How full a table is — what the "+ Thêm mục" button reads before it refuses. */
export function recordCountOf(records: readonly BusinessRecord[], tableId: string): number {
  return records.filter((record) => record.tableId === tableId && record.deletedAt === null).length;
}

/** Whether this table can still take a new record. The server decides too; this only warns. */
export function isTableFull(records: readonly BusinessRecord[], tableId: string): boolean {
  return recordCountOf(records, tableId) >= RECORD_LIMIT;
}

export type StatusColumn = {
  status: string;
  label: string;
  records: readonly BusinessRecord[];
};

/**
 * The Kanban board: one column per status, built from the table's own records.
 *
 * The suggested statuses always appear, even empty, so a new table has somewhere to drag a
 * card TO. Statuses nobody uses beyond those four do not appear — a board of empty columns
 * is a board that says nothing. Anything a person actually typed gets its own column at the
 * end, in first-seen order, because the alternative is quietly hiding their records.
 */
export function groupByStatus(records: readonly BusinessRecord[]): StatusColumn[] {
  const buckets = new Map<string, BusinessRecord[]>();
  for (const status of SUGGESTED_STATUSES) buckets.set(status, []);

  for (const record of records) {
    const key = record.status.trim();
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [record]);
    else bucket.push(record);
  }

  return [...buckets.entries()].map(([status, items]) => ({
    status,
    label: statusLabel(status),
    records: items,
  }));
}

/** What a cell shows for one extension column of one record. */
export function cellValue(record: BusinessRecord, column: ColumnDef): string {
  const value = record.extensionFields[column.key];
  if (value === null || value === undefined) return "";
  if (column.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("vi-VN").format(value);
  }
  return String(value);
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
  records: readonly BusinessRecord[],
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

  if (normalized.includes("avora_business_hub_record_limit"))
    return `Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} mục, hãy dọn bớt trước khi thêm.`;
  if (normalized.includes("avora_business_hub_table_name_required"))
    return "Bảng cần một cái tên.";
  if (normalized.includes("avora_business_hub_record_title_required"))
    return "Mục này cần một tiêu đề.";
  if (normalized.includes("avora_business_hub_record_status_required"))
    return "Mục này cần một trạng thái.";
  if (normalized.includes("avora_business_hub_column_label_required"))
    return "Cột cần một cái tên.";
  if (normalized.includes("avora_business_hub_column_options_required"))
    return "Cột dạng chọn cần ít nhất một lựa chọn.";
  if (normalized.includes("avora_business_hub_column_type_invalid"))
    return "Kiểu cột này không hợp lệ.";
  if (normalized.includes("avora_business_hub_column_key_taken"))
    return "Cột này đã tồn tại trong bảng.";
  if (normalized.includes("avora_business_hub_column_limit"))
    return "Bảng đã đủ số cột mở rộng cho phép.";
  if (normalized.includes("avora_business_hub_value_not_number"))
    return "Cột này chỉ nhận số.";
  if (normalized.includes("avora_business_hub_value_not_date"))
    return "Cột này chỉ nhận ngày.";
  if (normalized.includes("avora_business_hub_value_not_option"))
    return "Giá trị này không nằm trong danh sách của cột.";
  if (normalized.includes("avora_business_hub_value_not_text"))
    return "Cột này chỉ nhận chữ.";
  if (normalized.includes("avora_business_hub_priority_invalid"))
    return "Độ ưu tiên này không hợp lệ.";
  if (normalized.includes("avora_business_hub_record_deleted"))
    return "Mục này đã được cất đi.";
  if (
    normalized.includes("avora_business_hub_table_not_yours") ||
    normalized.includes("avora_business_hub_table_missing")
  )
    return "Bảng này không còn nữa.";
  if (normalized.includes("avora_business_hub_record_not_yours"))
    return "Mục này không còn nữa.";
  if (normalized.includes("avora_business_hub_patch_field"))
    return "Không sửa được trường này.";
  if (normalized.includes("avora_not_signed_in"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với bảng này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[business-hub] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseHubError(code, message));
}

// ------------------------------------------------------------------ reading

/** Every table the viewer owns, deleted ones included so a restore has something to show. */
export async function fetchBusinessTables(): Promise<BusinessTable[]> {
  const { data, error } = await supabase
    .from("business_hub_table")
    .select("*")
    .order("position", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toTable(row as TableRow));
}

/** Every record the viewer owns, across all their tables. */
export async function fetchBusinessRecords(): Promise<BusinessRecord[]> {
  const { data, error } = await supabase
    .from("business_hub_record")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toRecord(row as RecordRow));
}

// ------------------------------------------------------------------ writing

/** The table someone lands in on their first visit. Safe to call on every visit. */
export async function ensureDefaultTable(): Promise<BusinessTable> {
  const { data, error } = await supabase.rpc("ensure_default_business_hub_table");
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** A new table, placed after the ones already there. */
export async function createBusinessTable(name: string): Promise<BusinessTable> {
  const { data, error } = await supabase.rpc("create_business_hub_table", {
    p_name: name.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Renames a table. */
export async function renameBusinessTable(
  tableId: string,
  name: string,
): Promise<BusinessTable> {
  const { data, error } = await supabase.rpc("rename_business_hub_table", {
    p_table_id: tableId,
    p_name: name.trim(),
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Puts a table away. Its records go with it and come back with it. */
export async function deleteBusinessTable(tableId: string): Promise<BusinessTable> {
  const { data, error } = await supabase.rpc("delete_business_hub_table", {
    p_table_id: tableId,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Takes a table back out. */
export async function restoreBusinessTable(tableId: string): Promise<BusinessTable> {
  const { data, error } = await supabase.rpc("restore_business_hub_table", {
    p_table_id: tableId,
  });
  if (error) throw fail(error.code, error.message);
  return toTable(data as unknown as TableRow);
}

/** Adds one extension column to one table. Existing records keep every value they had. */
export async function addBusinessColumn(input: {
  tableId: string;
  label: string;
  type: ColumnType;
  options?: readonly string[];
}): Promise<BusinessTable> {
  const options =
    input.type === "select"
      ? (input.options ?? []).map((option) => option.trim()).filter((option) => option.length > 0)
      : undefined;

  const { data, error } = await supabase.rpc("add_business_hub_column", {
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
  title: string;
  status?: string;
  priority?: RecordPriority;
  category?: string | null;
  nextActionDate?: string | null;
  tags?: readonly string[];
  notes?: string | null;
  extensionFields?: Readonly<Record<string, ExtensionValue>>;
};

/** A new record. The 1.000 ceiling is enforced server-side, not here. */
export async function createBusinessRecord(input: NewRecordInput): Promise<BusinessRecord> {
  const { data, error } = await supabase.rpc("create_business_hub_record", {
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
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}

export type RecordPatch = {
  title?: string;
  status?: string;
  priority?: RecordPriority;
  category?: string | null;
  nextActionDate?: string | null;
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
export async function updateBusinessRecord(
  recordId: string,
  patch: RecordPatch,
): Promise<BusinessRecord> {
  const body: Record<string, Json> = {};

  if (patch.title !== undefined) body.title = patch.title.trim();
  if (patch.status !== undefined) body.status = patch.status.trim();
  if (patch.priority !== undefined) body.priority = patch.priority;
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.nextActionDate !== undefined) body.next_action_date = patch.nextActionDate;
  if (patch.tags !== undefined) body.tags = [...patch.tags];
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.extensionFields !== undefined) body.extension_fields = { ...patch.extensionFields };

  if (Object.keys(body).length === 0) {
    throw new Error("Không có gì để lưu.");
  }

  const { data, error } = await supabase.rpc("update_business_hub_record", {
    p_record_id: recordId,
    p_patch: body,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}

/** Puts a record away. The space it held opens back up. */
export async function deleteBusinessRecord(recordId: string): Promise<BusinessRecord> {
  const { data, error } = await supabase.rpc("delete_business_hub_record", {
    p_record_id: recordId,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}

/** Takes a record back out, if the table still has room for it. */
export async function restoreBusinessRecord(recordId: string): Promise<BusinessRecord> {
  const { data, error } = await supabase.rpc("restore_business_hub_record", {
    p_record_id: recordId,
  });
  if (error) throw fail(error.code, error.message);
  return toRecord(data as unknown as RecordRow);
}
