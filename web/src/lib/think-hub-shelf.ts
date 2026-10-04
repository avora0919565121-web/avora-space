import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { normalizeSearch } from "@/lib/normalize-search";
import {
  hubFail,
  isDoneStatus,
  recordFromRow,
  rootTables,
  tableFromRow,
  type ThinkRecord,
  type ThinkTable,
} from "@/lib/think-hub";

/**
 * Đợt gộp 2 · Phần C — what sits around a table: templates, the four-drawer shelf, stars,
 * archive, bins, proposals and moving a Hạng mục. The rules live on the server; this file only
 * reads their answers and arranges them for the screen.
 */

// ------------------------------------------------------------------ templates (C1/C2)

export type ThinkingType = "track" | "progress" | "breakdown" | "weigh" | "learn";

/**
 * AVORA-77 · A5 — the five ways a board thinks. The one source of these words: the template
 * gallery, `⋯ › Kiểu tư duy`, and the faint guide in an empty Hạng mục note all read from here.
 */
export const THINKING_TYPES: readonly { id: ThinkingType; label: string; description: string; question: string }[] = [
  { id: "track", label: "Theo dõi", description: "Nắm những thứ đang diễn ra — khách hàng, việc nhà, sức khoẻ, người thân.", question: "Điều gì cần để mắt tới?" },
  { id: "progress", label: "Đi từng bước", description: "Đi từng bước tới đích — một dự án, một kỹ năng, một sự kiện.", question: "Mỗi phần đang ở bước nào?" },
  { id: "breakdown", label: "Chia nhỏ", description: "Chia điều lớn thành phần nhỏ, làm được từng phần.", question: "Điều này gồm những phần nào?" },
  { id: "weigh", label: "Quyết định", description: "Đặt các lựa chọn cạnh nhau để quyết định — mua gì, chọn ai, đi đâu.", question: "Nếu chọn cái này mà sai thì vì sao?" },
  { id: "learn", label: "Học hỏi", description: "Giữ lại điều học được và đem ra dùng — sách, khoá học, bài học từ sai lầm.", question: "Điều này áp dụng vào đâu?" },
];

/** The guiding question a board's type asks, or null for a board made without a template. */
export function guideQuestionOf(type: ThinkingType | null | undefined): string | null {
  return THINKING_TYPES.find((item) => item.id === type)?.question ?? null;
}

export type TemplateScope = "journal" | "direct" | "group" | "project";

export type BoardTemplate = {
  /** System key, or the id of "Mẫu của tôi". */
  id: string;
  source: "system" | "mine";
  name: string;
  thinkingType: ThinkingType | null;
  guidingQuestion: string | null;
  description: string | null;
  scopes: readonly TemplateScope[];
  columns: readonly { label: string; type: string; options?: readonly string[] }[];
  statuses: readonly string[];
  titleLabel: string;
  subTemplateName: string | null;
  sortOrder: number;
  /** AVORA-89 · 2.4b: who usually uses it (one or more of TEMPLATE_AUDIENCES). */
  audiences: readonly TemplateAudience[];
  whenToUse: string | null;
  /** Two example Hạng mục, shown in the preview only — never saved. */
  exampleRows: readonly Record<string, string>[];
};

export type TemplateAudience = "moi_nguoi" | "hoc_sinh" | "gia_dinh" | "doanh_nhan" | "sales" | "ke_toan" | "ky_thuat";
export const TEMPLATE_AUDIENCES: readonly { id: TemplateAudience; label: string }[] = [
  { id: "moi_nguoi", label: "Mọi người" },
  { id: "hoc_sinh", label: "Học sinh · Sinh viên" },
  { id: "gia_dinh", label: "Gia đình · Nội trợ" },
  { id: "doanh_nhan", label: "Doanh nhân" },
  { id: "sales", label: "Sales" },
  { id: "ke_toan", label: "Kế toán" },
  { id: "ky_thuat", label: "Kỹ thuật · Thi công" },
];
export function isTemplateAudience(value: unknown): value is TemplateAudience {
  return typeof value === "string" && TEMPLATE_AUDIENCES.some((item) => item.id === value);
}

/**
 * Library order (2.4b · D): used most recently → matches my audiences → sort_order. Filters: what
 * for (thinking type) × who for (audiences; `Mọi người` templates stay when other groups are picked
 * only if `moi_nguoi` is chosen too).
 */
export function libraryTemplates(
  templates: readonly BoardTemplate[],
  filter: { type: ThinkingType | null; audiences: readonly TemplateAudience[] },
  mine: readonly TemplateAudience[],
  usedAt: ReadonlyMap<string, string>,
): BoardTemplate[] {
  const listed = templates.filter(
    (template) =>
      template.source === "system" &&
      template.id !== "blank" &&
      template.columns.length + template.statuses.length > 0 &&
      (filter.type === null || template.thinkingType === filter.type) &&
      (filter.audiences.length === 0 || template.audiences.some((audience) => filter.audiences.includes(audience))),
  );
  const fits = (template: BoardTemplate): number => (template.audiences.some((audience) => mine.includes(audience)) ? 1 : 0);
  return [...listed].sort((a, b) => {
    const ua = usedAt.get(a.id) ?? "";
    const ub = usedAt.get(b.id) ?? "";
    if (ua !== ub) return ub.localeCompare(ua);
    if (fits(a) !== fits(b)) return fits(b) - fits(a);
    return a.sortOrder - b.sortOrder;
  });
}

function readColumns(raw: unknown): BoardTemplate["columns"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.label !== "string" || typeof item.type !== "string") return [];
    const options = Array.isArray(item.options) ? item.options.filter((o): o is string => typeof o === "string") : undefined;
    return [{ label: item.label, type: item.type, options }];
  });
}

function readStatuses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["Mới", "Đang làm", "Chờ phản hồi", "Xong"];
  return raw.flatMap((entry) =>
    entry !== null && typeof entry === "object" && typeof (entry as { label?: unknown }).label === "string"
      ? [(entry as { label: string }).label]
      : [],
  );
}

function isThinkingType(value: unknown): value is ThinkingType {
  return typeof value === "string" && THINKING_TYPES.some((item) => item.id === value);
}

export async function fetchTemplates(): Promise<BoardTemplate[]> {
  const [system, mine] = await Promise.all([
    supabase.from("think_hub_template").select("*").order("sort_order"),
    supabase.from("think_hub_user_template").select("*").order("created_at", { ascending: false }),
  ]);
  if (system.error) throw hubFail(system.error.code, system.error.message);
  if (mine.error) throw hubFail(mine.error.code, mine.error.message);
  const names = new Map((system.data ?? []).map((row) => [row.key, row.name] as const));
  const systemTemplates: BoardTemplate[] = (system.data ?? [])
    .filter((row) => row.is_active && row.key !== "reading")
    .map((row) => ({
      id: row.key,
      source: "system",
      name: row.name,
      thinkingType: isThinkingType(row.thinking_type) ? row.thinking_type : null,
      guidingQuestion: row.guiding_question,
      description: row.description,
      scopes: row.scopes.filter((scope): scope is TemplateScope => ["journal", "direct", "group", "project"].includes(scope)),
      columns: readColumns(row.column_defs),
      statuses: readStatuses(row.status_options),
      titleLabel: row.title_label,
      subTemplateName: row.sub_template_key === null ? null : names.get(row.sub_template_key) ?? null,
      sortOrder: row.sort_order,
      audiences: (row.audiences ?? ["moi_nguoi"]).filter(isTemplateAudience),
      whenToUse: row.when_to_use ?? null,
      exampleRows: Array.isArray(row.example_rows) ? (row.example_rows as Record<string, string>[]) : [],
    }));
  const mineTemplates: BoardTemplate[] = (mine.data ?? []).map((row) => ({
    id: row.id,
    source: "mine",
    name: row.name,
    thinkingType: isThinkingType(row.thinking_type) ? row.thinking_type : null,
    guidingQuestion: row.guiding_question,
    description: null,
    scopes: ["journal", "direct", "group", "project"],
    columns: readColumns(row.column_defs),
    statuses: readStatuses(row.status_options),
    titleLabel: row.title_label ?? "Tiêu đề",
    subTemplateName: null,
    sortOrder: 0,
    audiences: ["moi_nguoi"],
    whenToUse: null,
    exampleRows: [],
  }));
  return [...mineTemplates, ...systemTemplates];
}

/** Templates that fit where the person stands first; the rest after, still choosable (C2.2). */
export function orderTemplates(
  templates: readonly BoardTemplate[],
  scope: TemplateScope,
  type: ThinkingType | null,
): { fitting: BoardTemplate[]; others: BoardTemplate[]; mine: BoardTemplate[] } {
  const matchesType = (template: BoardTemplate): boolean => type === null || template.thinkingType === type;
  const system = templates.filter((template) => template.source === "system" && template.id !== "blank" && matchesType(template));
  return {
    fitting: system.filter((template) => template.scopes.includes(scope)),
    others: system.filter((template) => !template.scopes.includes(scope)),
    mine: templates.filter((template) => template.source === "mine" && matchesType(template)),
  };
}

/**
 * The arguments for creating a table from a template. Every key is always sent — `null` rather
 * than left out — because the server function has no defaults: a missing key makes PostgREST
 * look for a different signature and answer PGRST202 ("Có lỗi xảy ra" on screen).
 */
export function templateTableArgs(input: { template: BoardTemplate; conversationId: string | null; name: string }): {
  p_template_key: string | null;
  p_user_template_id: string | null;
  p_conversation_id: string | null;
  p_name: string;
} {
  return {
    p_template_key: input.template.source === "system" ? input.template.id : null,
    p_user_template_id: input.template.source === "mine" ? input.template.id : null,
    p_conversation_id: input.conversationId,
    p_name: input.name.trim(),
  };
}

type TemplateArgs = Database["public"]["Functions"]["create_think_hub_table_from_template"]["Args"];
type ApplyArgs = Database["public"]["Functions"]["apply_template_to_table"]["Args"];

export async function createTableFromTemplate(input: {
  template: BoardTemplate;
  conversationId: string | null;
  name: string;
}): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc(
    "create_think_hub_table_from_template",
    templateTableArgs(input) as unknown as TemplateArgs,
  );
  if (error) throw hubFail(error.code, error.message);
  return tableFromRow(data);
}

export async function applyTemplate(tableId: string, template: BoardTemplate): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("apply_template_to_table", {
    p_table_id: tableId,
    p_template_key: template.source === "system" ? template.id : null,
    p_user_template_id: template.source === "mine" ? template.id : null,
  } as unknown as ApplyArgs);
  if (error) throw hubFail(error.code, error.message);
  return tableFromRow(data);
}

export async function saveTableAsTemplate(tableId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc("save_table_as_template", { p_table_id: tableId, p_name: name.trim() });
  if (error) throw hubFail(error.code, error.message);
}

export async function deleteUserTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_user_template", { p_id: id });
  if (error) throw hubFail(error.code, error.message);
}

// ------------------------------------------------------------------ the shelf (C3)

export type Drawer = "personal" | "direct" | "group" | "project";

export const DRAWERS: readonly { id: Drawer; label: string }[] = [
  // AVORA-52 · E: one way to name the four shelves everywhere in AVORA.
  { id: "personal", label: "Bảng của tôi" },
  { id: "direct", label: "Bảng 1-1" },
  { id: "group", label: "Bảng nhóm" },
  { id: "project", label: "Bảng dự án" },
];

export function drawerLabel(drawer: Drawer): string {
  return DRAWERS.find((item) => item.id === drawer)?.label ?? "";
}

export type ShelfTable = {
  table: ThinkTable;
  drawer: Drawer;
  /** The conversation or project it belongs to — so nobody has to prefix table names by hand. */
  placeName: string | null;
  recordCount: number;
  hasOverdue: boolean;
};

/**
 * The four drawers: roots only, the bookshelf left out (it has its own door), archived tables
 * kept apart at the bottom of each drawer.
 */
export function arrangeShelf(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  userId: string | undefined,
  kindOf: (conversationId: string) => "direct" | "group" | "personal" | undefined,
  placeOf: (table: ThinkTable) => string | null,
  today: string,
): Record<Drawer, { live: ShelfTable[]; archived: ShelfTable[] }> {
  const shelf: Record<Drawer, { live: ShelfTable[]; archived: ShelfTable[] }> = {
    personal: { live: [], archived: [] },
    direct: { live: [], archived: [] },
    group: { live: [], archived: [] },
    project: { live: [], archived: [] },
  };
  const counts = new Map<string, { n: number; late: boolean }>();
  for (const record of records) {
    if (record.deletedAt !== null) continue;
    const entry = counts.get(record.tableId) ?? { n: 0, late: false };
    entry.n += 1;
    if (record.nextActionDate !== null && record.nextActionDate < today) entry.late = true;
    counts.set(record.tableId, entry);
  }
  for (const table of rootTables(tables)) {
    if (table.kind === "bookshelf") continue;
    let drawer: Drawer | null = null;
    if (table.projectId !== null) drawer = "project";
    else if (table.conversationId === null) drawer = table.ownerUserId === userId ? "personal" : null;
    else {
      const kind = kindOf(table.conversationId);
      drawer = kind === "direct" ? "direct" : kind === "group" ? "group" : null;
    }
    if (drawer === null) continue;
    const count = counts.get(table.id);
    const item: ShelfTable = {
      table,
      drawer,
      placeName: drawer === "personal" ? null : placeOf(table),
      recordCount: count?.n ?? 0,
      hasOverdue: count?.late ?? false,
    };
    (table.archivedAt === null ? shelf[drawer].live : shelf[drawer].archived).push(item);
  }
  return shelf;
}

export function drawerOfTable(table: ThinkTable, kindOf: (conversationId: string) => string | undefined): Drawer {
  if (table.projectId !== null) return "project";
  if (table.conversationId === null) return "personal";
  return kindOf(table.conversationId) === "group" ? "group" : "direct";
}

export function searchShelf(items: readonly ShelfTable[], query: string): ShelfTable[] {
  const needle = normalizeSearch(query.trim());
  if (needle === "") return [...items];
  return items.filter((item) => normalizeSearch(`${item.table.name} ${item.placeName ?? ""}`).includes(needle));
}

export type ReminderTile = "overdue" | "today" | "week" | "starred";

/**
 * AVORA-77 · A1 — the four tiles' words, one source for Kế hoạch and Avora Space's `Góc kế hoạch`.
 * Soft on purpose: each says what the moment asks of the thinking, not a verdict. Nhiệm vụ keeps its own.
 */
export const REMINDER_TILES: readonly { id: ReminderTile; label: string; ask: string }[] = [
  { id: "overdue", label: "Quá hạn", ask: "cần chốt" },
  { id: "today", label: "Hôm nay", ask: "cần tập trung" },
  { id: "week", label: "Trong tuần", ask: "cần sắp xếp" },
  { id: "starred", label: "★ Quan trọng", ask: "cần ưu tiên" },
];

/** The query parameter that opens Kế hoạch with one tile unfolded (`?o=overdue`). */
export const HUB_TILE_PARAM = "o";

export function isReminderTile(value: string | null): value is ReminderTile {
  return value === "overdue" || value === "today" || value === "week" || value === "starred";
}

export type ReminderLine = { record: ThinkRecord; table: ThinkTable; when: string | null };

/**
 * The three reminder tiles plus ★ (C3 ①, C8). Archived tables and projects that are not open
 * are left out. "Trong tuần" is the next seven days after today. ★ counts starred Hạng mục not
 * yet finished.
 */
export function reminderTiles(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  stars: ReadonlySet<string>,
  today: string,
  isTableQuiet: (table: ThinkTable) => boolean,
): Record<ReminderTile, ReminderLine[]> {
  const byId = new Map(tables.map((table) => [table.id, table] as const));
  const horizon = addDays(today, 7);
  const tiles: Record<ReminderTile, ReminderLine[]> = { overdue: [], today: [], week: [], starred: [] };
  for (const record of records) {
    if (record.deletedAt !== null) continue;
    const table = byId.get(record.tableId);
    if (table === undefined || table.deletedAt !== null || isTableQuiet(table)) continue;
    const done = isDoneStatus(table, record.status);
    const due = record.nextActionDate;
    if (stars.has(record.id) && !done) tiles.starred.push({ record, table, when: due });
    if (due === null || done) continue;
    if (due < today) tiles.overdue.push({ record, table, when: due });
    else if (due === today) tiles.today.push({ record, table, when: due });
    else if (due <= horizon) tiles.week.push({ record, table, when: due });
  }
  for (const list of Object.values(tiles)) list.sort((a, b) => (a.when ?? "9999").localeCompare(b.when ?? "9999"));
  return tiles;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "quá 2 ngày" / "hôm nay" / "T6" — what a reminder line says about its date. */
export function whenLabel(due: string | null, today: string): string {
  if (due === null) return "";
  if (due === today) return "hôm nay";
  const diff = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff < 0) return `quá ${-diff} ngày`;
  if (diff <= 6) return ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(`${due}T00:00:00Z`).getUTCDay()];
  return `${due.slice(8, 10)}/${due.slice(5, 7)}`;
}

/** Remembered on this device: the table last opened on Kế hoạch (C3 ③). */
const LAST_TABLE_KEY = "avora.kehoach.last-table.v1";

export function readLastTable(userId: string | undefined): string | null {
  if (userId === undefined) return null;
  try {
    return window.localStorage.getItem(`${LAST_TABLE_KEY}:${userId}`);
  } catch {
    return null;
  }
}

export function rememberLastTable(userId: string | undefined, tableId: string): void {
  if (userId === undefined) return;
  try {
    window.localStorage.setItem(`${LAST_TABLE_KEY}:${userId}`, tableId);
  } catch {
    // No storage: the first table opens next time instead.
  }
}

// ------------------------------------------------------------------ stars (C8)

export async function fetchStars(): Promise<Set<string>> {
  const { data, error } = await supabase.from("think_hub_record_stars").select("record_id");
  if (error) throw hubFail(error.code, error.message);
  return new Set((data ?? []).map((row) => row.record_id));
}

export async function toggleStar(recordId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("toggle_record_star", { p_record_id: recordId });
  if (error) throw hubFail(error.code, error.message);
  return data === true;
}

// ------------------------------------------------------------------ archive, bin (C5, C10)

export async function setTableArchived(tableId: string, archived: boolean): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("set_think_hub_table_archived", { p_table_id: tableId, p_archived: archived });
  if (error) throw hubFail(error.code, error.message);
  return tableFromRow(data);
}

export type DeletePreview = { records: number; subTables: number; tasks: number; tasksKeptByAssignee: number };

export async function previewTableDelete(tableId: string): Promise<DeletePreview> {
  const { data, error } = await supabase.rpc("preview_think_hub_table_delete", { p_table_id: tableId });
  if (error) throw hubFail(error.code, error.message);
  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string): number => (typeof raw[key] === "number" ? (raw[key] as number) : 0);
  return { records: num("records"), subTables: num("sub_tables"), tasks: num("tasks"), tasksKeptByAssignee: num("tasks_kept_by_assignee") };
}

export async function purgeTable(tableId: string, confirmName: string): Promise<void> {
  const { error } = await supabase.rpc("purge_think_hub_table", { p_table_id: tableId, p_confirm_name: confirmName });
  if (error) throw hubFail(error.code, error.message);
}

export type SharedTrashItem = { tableId: string; name: string; deletedAt: string; proposedByName: string };

export async function fetchSharedTrash(): Promise<SharedTrashItem[]> {
  const { data, error } = await supabase.rpc("list_shared_trash");
  if (error) throw hubFail(error.code, error.message);
  return (data ?? []).map((row) => ({ tableId: row.table_id, name: row.name, deletedAt: row.deleted_at, proposedByName: row.proposed_by_name }));
}

export async function restoreSharedTable(tableId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_shared_table", { p_table_id: tableId });
  if (error) throw hubFail(error.code, error.message);
}

export async function copyTableToJournal(tableId: string): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("copy_table_to_journal", { p_table_id: tableId });
  if (error) throw hubFail(error.code, error.message);
  return tableFromRow(data);
}

export async function ensureBookshelf(): Promise<ThinkTable> {
  const { data, error } = await supabase.rpc("ensure_bookshelf");
  if (error) throw hubFail(error.code, error.message);
  return tableFromRow(data);
}

/** Whether a table is read-only because it (or the root it grew from) is archived. */
export function isArchivedTree(tables: readonly ThinkTable[], records: readonly ThinkRecord[], tableId: string): boolean {
  const byId = new Map(tables.map((table) => [table.id, table] as const));
  const recordTable = new Map(records.map((record) => [record.id, record.tableId] as const));
  let current = byId.get(tableId);
  for (let guard = 0; current !== undefined && guard < 5; guard += 1) {
    if (current.archivedAt !== null) return true;
    if (current.parentRecordId === null) return false;
    const parentTableId = recordTable.get(current.parentRecordId);
    current = parentTableId === undefined ? undefined : byId.get(parentTableId);
  }
  return false;
}

// ------------------------------------------------------------------ proposals (C9, C10)

export type ProposalAction = "delete" | "archive" | "reopen";
export type ProposalTarget = "think_hub_table" | "group" | "project";
export type ProposalStatus = "open" | "approved" | "rejected" | "withdrawn" | "expired";

export type SharedProposal = {
  id: string;
  action: ProposalAction;
  targetType: ProposalTarget;
  targetId: string;
  targetName: string;
  conversationId: string;
  proposedBy: string;
  reason: string;
  status: ProposalStatus;
  messageId: string | null;
  createdAt: string;
  votes: readonly { userId: string; vote: "agree" | "disagree" | null; reason: string | null }[];
};

export const proposalKeys = { all: ["shared-proposals"] as const, stakeholders: ["shared-proposals", "stakeholders"] as const };

export async function fetchProposals(): Promise<SharedProposal[]> {
  const { data, error } = await supabase
    .from("shared_proposals")
    .select("*, shared_proposal_votes(user_id, vote, reason)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw hubFail(error.code, error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action as ProposalAction,
    targetType: row.target_type as ProposalTarget,
    targetId: row.target_id,
    targetName: row.target_name,
    conversationId: row.conversation_id,
    proposedBy: row.proposed_by,
    reason: row.reason,
    status: row.status as ProposalStatus,
    messageId: row.message_id,
    createdAt: row.created_at,
    votes: (row.shared_proposal_votes ?? []).map((vote) => ({
      userId: vote.user_id,
      vote: vote.vote === "agree" || vote.vote === "disagree" ? vote.vote : null,
      reason: vote.reason,
    })),
  }));
}

export async function previewStakeholders(targetType: ProposalTarget, targetId: string): Promise<{ userId: string; name: string }[]> {
  const { data, error } = await supabase.rpc("preview_shared_stakeholders", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw hubFail(error.code, error.message);
  return (data ?? []).map((row) => ({ userId: row.user_id, name: row.display_name }));
}

export async function proposeShared(input: { action: ProposalAction; targetType: ProposalTarget; targetId: string; reason: string }): Promise<SharedProposal["status"]> {
  const { data, error } = await supabase.rpc("propose_shared_action", {
    p_action: input.action,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason: input.reason.trim(),
  });
  if (error) throw hubFail(error.code, error.message);
  return (data as { status: ProposalStatus }).status;
}

export async function voteProposal(proposalId: string, vote: "agree" | "disagree", reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("vote_shared_proposal", {
    p_proposal_id: proposalId,
    p_vote: vote,
    p_reason: reason?.trim() || undefined,
  });
  if (error) throw hubFail(error.code, error.message);
}

export async function withdrawProposal(proposalId: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_shared_proposal", { p_proposal_id: proposalId });
  if (error) throw hubFail(error.code, error.message);
}

/** "Đã đồng ý 2/4 · Chờ: Bình, Châu". */
export function proposalProgress(proposal: SharedProposal, nameOf: (userId: string) => string): string {
  const agreed = proposal.votes.filter((vote) => vote.vote === "agree").length;
  const waiting = proposal.votes.filter((vote) => vote.vote === null).map((vote) => nameOf(vote.userId));
  const head = `Đã đồng ý ${agreed}/${proposal.votes.length}`;
  return waiting.length === 0 ? head : `${head} · Chờ: ${waiting.join(", ")}`;
}

export function proposalVerb(action: ProposalAction, targetType: ProposalTarget): string {
  if (targetType === "group") return "giải tán Nhóm";
  const what = targetType === "project" ? "Dự án" : "Bảng";
  return `${action === "delete" ? "xoá" : action === "archive" ? "lưu trữ" : "mở lại"} ${what}`;
}

// ------------------------------------------------------------------ move / copy (C11)

export type TransferPreview = {
  canMove: boolean;
  canCopy: boolean;
  moveBlock: "has_subtable" | "shared" | "not_owner" | "target_full" | null;
  subTableName: string | null;
  scope: "same" | "to_shared" | "from_shared" | "personal";
  sourceTableName: string;
  targetTableName: string;
  targetScopeName: string;
  statusFrom: string;
  statusTo: string;
  statusChanged: boolean;
  keptColumns: readonly string[];
  unmatched: readonly { label: string; value: string }[];
  tasks: number;
  projectLinksDropped: number;
  recordLinksDropped: number;
};

export async function previewTransfer(recordId: string, targetTableId: string): Promise<TransferPreview> {
  const { data, error } = await supabase.rpc("preview_think_hub_record_transfer", { p_record_id: recordId, p_target_table_id: targetTableId });
  if (error) throw hubFail(error.code, error.message);
  const raw = (data ?? {}) as Record<string, unknown>;
  const str = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const num = (key: string): number => (typeof raw[key] === "number" ? (raw[key] as number) : 0);
  const block = str("move_block");
  const scope = str("scope");
  return {
    canMove: raw.can_move === true,
    canCopy: raw.can_copy === true,
    moveBlock: block === "has_subtable" || block === "shared" || block === "not_owner" || block === "target_full" ? block : null,
    subTableName: typeof raw.sub_table_name === "string" ? raw.sub_table_name : null,
    scope: scope === "same" || scope === "to_shared" || scope === "from_shared" ? scope : "personal",
    sourceTableName: str("source_table_name"),
    targetTableName: str("target_table_name"),
    targetScopeName: str("target_scope_name"),
    statusFrom: str("status_from"),
    statusTo: str("status_to"),
    statusChanged: raw.status_changed === true,
    keptColumns: Array.isArray(raw.kept_columns) ? raw.kept_columns.filter((c): c is string => typeof c === "string") : [],
    unmatched: Array.isArray(raw.unmatched)
      ? raw.unmatched.flatMap((u) =>
          u !== null && typeof u === "object" && typeof (u as { label?: unknown }).label === "string"
            ? [{ label: (u as { label: string }).label, value: String((u as { value?: unknown }).value ?? "") }]
            : [],
        )
      : [],
    tasks: num("tasks"),
    projectLinksDropped: num("project_links_dropped"),
    recordLinksDropped: num("record_links_dropped"),
  };
}

export async function moveRecord(recordId: string, targetTableId: string): Promise<ThinkRecord> {
  const { data, error } = await supabase.rpc("move_think_hub_record", {
    p_record_id: recordId,
    p_target_table_id: targetTableId,
    p_append_unmatched_to_notes: true,
  });
  if (error) throw hubFail(error.code, error.message);
  return recordFromRow(data);
}

export async function copyRecord(recordId: string, targetTableId: string): Promise<ThinkRecord> {
  const { data, error } = await supabase.rpc("copy_think_hub_record", { p_record_id: recordId, p_target_table_id: targetTableId });
  if (error) throw hubFail(error.code, error.message);
  return recordFromRow(data);
}

/**
 * Tables a Hạng mục may go to (C11): live, not archived, not the bookshelf, not where it already
 * is. Sub-tables at level 2–3 are valid targets.
 */
export function transferTargets(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  sourceTableId: string,
): ThinkTable[] {
  return tables.filter(
    (table) =>
      table.deletedAt === null &&
      table.id !== sourceTableId &&
      table.kind !== "bookshelf" &&
      !isArchivedTree(tables, records, table.id),
  );
}
