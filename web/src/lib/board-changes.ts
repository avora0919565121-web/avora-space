import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/** One logged change on a shared Bảng (AVORA-62 · A). */
export type BoardChange = {
  id: string;
  tableId: string;
  actorId: string;
  kind: "record_add" | "record_edit" | "record_delete" | "column_add" | "column_edit" | "column_delete" | "task_link" | "task_unlink";
  recordId: string | null;
  columnId: string | null;
  recordOwnerId: string | null;
  recordTitle: string | null;
  cells: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  announcedAt: string | null;
  announcementId: string | null;
};

export type BoardAnnouncement = {
  id: string;
  tableId: string;
  conversationId: string;
  messageId: string | null;
  actorId: string;
  kind: "update" | "digest" | "created" | "shared";
  changeIds: string[];
  note: string | null;
  updatedAt: string;
};

export type BoardNudge = {
  id: string;
  tableId: string;
  recordId: string | null;
  actorId: string;
  content: string;
  createdAt: string;
};

export type ChangeSummary = { added: number; cells: number; deleted: number; columns: number; tasks?: number; total: number };

/** `?thay-doi=1` (or `=<announcement id>`) opens a board with its changes marked (AVORA-62 · C). */
export const BOARD_CHANGES_PARAM = "thay-doi";

export const boardChangeKeys = {
  all: ["board-changes"] as const,
  table: (tableId: string) => ["board-changes", tableId] as const,
  announcements: (conversationId: string) => ["board-changes", "announcements", conversationId] as const,
  nudges: ["board-changes", "nudges"] as const,
};

function fail(code: string | undefined, message: string): Error {
  logError("board-changes", { code, message });
  const text = message.toLowerCase();
  if (text.includes("avora_board_nothing_to_announce")) return new Error("Không còn thay đổi nào chưa báo.");
  if (text.includes("avora_board_announce_not_allowed")) return new Error("Bảng này chỉ cho chủ bảng và quản trị bấm Báo nhóm.");
  if (text.includes("avora_board_announce_off")) return new Error("Bảng này đang đặt Chỉ đánh dấu, không báo.");
  if (text.includes("avora_board_note_too_long")) return new Error("Ghi chú tối đa 500 ký tự.");
  if (text.includes("avora_not_a_participant") || text.includes("not_yours")) return new Error("Bạn không còn ở trong cuộc trò chuyện của Bảng này.");
  return new Error("Chưa làm được. Vui lòng thử lại.");
}

type ChangeRow = {
  id: string;
  table_id: string;
  actor_id: string;
  kind: BoardChange["kind"];
  record_id: string | null;
  column_id: string | null;
  record_owner_id: string | null;
  record_title: string | null;
  cells: number;
  before: unknown;
  after: unknown;
  created_at: string;
  announced_at: string | null;
  announcement_id: string | null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function toChange(row: ChangeRow): BoardChange {
  return {
    id: row.id,
    tableId: row.table_id,
    actorId: row.actor_id,
    kind: row.kind,
    recordId: row.record_id,
    columnId: row.column_id,
    recordOwnerId: row.record_owner_id,
    recordTitle: row.record_title,
    cells: row.cells,
    before: asObject(row.before),
    after: asObject(row.after),
    createdAt: row.created_at,
    announcedAt: row.announced_at,
    announcementId: row.announcement_id,
  };
}

/** The last 90 days of changes on a board (RLS: members only). */
export async function fetchBoardChanges(tableId: string): Promise<BoardChange[]> {
  const { data, error } = await supabase
    .from("think_hub_change_log")
    .select("id, table_id, actor_id, kind, record_id, column_id, record_owner_id, record_title, cells, before, after, created_at, announced_at, announcement_id")
    .eq("table_id", tableId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toChange(row as ChangeRow));
}

/** Remembers that I opened this board now; returns when I had opened it before (null = first time). */
export async function markBoardSeen(tableId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("mark_think_hub_table_seen", { p_table_id: tableId });
  if (error) throw fail(error.code, error.message);
  return (data as string | null) ?? null;
}

export async function announceBoardChanges(input: { tableId: string; note: string; notify: readonly string[]; mentions: readonly string[] }): Promise<string> {
  const { data, error } = await supabase.rpc("announce_think_hub_changes", {
    p_table_id: input.tableId,
    p_note: input.note.trim() === "" ? undefined : input.note.trim(),
    p_notify: [...input.notify],
    p_mentions: [...input.mentions],
  });
  if (error) throw fail(error.code, error.message);
  return data as string;
}

export async function setAnnounceSettings(input: { tableId: string; who: "members" | "admins"; mode: "manual" | "daily" | "silent" }): Promise<void> {
  const { error } = await supabase.rpc("set_think_hub_announce_settings", { p_table_id: input.tableId, p_who: input.who, p_mode: input.mode });
  if (error) throw fail(error.code, error.message);
}

export async function fetchAnnouncements(conversationId: string): Promise<BoardAnnouncement[]> {
  const { data, error } = await supabase
    .from("think_hub_announcements")
    .select("id, table_id, conversation_id, message_id, actor_id, kind, change_ids, note, updated_at")
    .eq("conversation_id", conversationId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    tableId: row.table_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    actorId: row.actor_id,
    kind: row.kind as BoardAnnouncement["kind"],
    changeIds: row.change_ids ?? [],
    note: row.note,
    updatedAt: row.updated_at,
  }));
}

export async function fetchNudges(): Promise<BoardNudge[]> {
  const { data, error } = await supabase
    .from("think_hub_nudges")
    .select("id, table_id, record_id, actor_id, content, created_at")
    .is("seen_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    tableId: row.table_id,
    recordId: row.record_id,
    actorId: row.actor_id,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function dismissNudge(id: string): Promise<void> {
  const { error } = await supabase.rpc("dismiss_think_hub_nudge", { p_id: id });
  if (error) throw fail(error.code, error.message);
}

// ------------------------------------------------------------------ pure helpers (tested)

/** The same counting the server writes into the card: Thêm · Sửa ô · Xoá · cột. */
export function summarizeChanges(changes: readonly BoardChange[]): ChangeSummary {
  let added = 0;
  let cells = 0;
  let deleted = 0;
  let columns = 0;
  let tasks = 0;
  for (const change of changes) {
    if (change.kind === "record_add") added += 1;
    else if (change.kind === "record_edit") cells += change.cells;
    else if (change.kind === "record_delete") deleted += 1;
    else if (change.kind === "task_link" || change.kind === "task_unlink") tasks += 1;
    else columns += 1;
  }
  return { added, cells, deleted, columns, tasks, total: added + cells + deleted + columns + tasks };
}

export function summaryWords(summary: ChangeSummary): string {
  const parts: string[] = [];
  if (summary.added > 0) parts.push(`Thêm ${summary.added} Hạng mục`);
  if (summary.cells > 0) parts.push(`Sửa ${summary.cells} ô`);
  if (summary.deleted > 0) parts.push(`Xoá ${summary.deleted} Hạng mục`);
  if (summary.columns > 0) parts.push(`Đổi ${summary.columns} cột`);
  if ((summary.tasks ?? 0) > 0) parts.push(`Gắn/bỏ ${summary.tasks} việc`);
  return parts.length === 0 ? "Không có thay đổi mới" : parts.join(" · ");
}

/** My changes not announced yet — what `Báo nhóm · N` counts. */
export function myPendingChanges(changes: readonly BoardChange[], userId: string | undefined): BoardChange[] {
  if (userId === undefined) return [];
  return changes.filter((change) => change.actorId === userId && change.announcedAt === null);
}

/**
 * The people a set of changes concerns: whoever made a Hạng mục that someone else edited or
 * deleted. Pre-ticked under `Báo riêng cho` (AVORA-62 · B); never the editor themself.
 */
export function affectedOwners(changes: readonly BoardChange[], userId: string | undefined): string[] {
  const owners = new Set<string>();
  for (const change of changes) {
    if ((change.kind === "record_edit" || change.kind === "record_delete") && change.recordOwnerId !== null && change.recordOwnerId !== userId) {
      owners.add(change.recordOwnerId);
    }
  }
  return [...owners];
}

/** Whether leaving the board should remind the editor (D): only for others' Hạng mục, or a deletion. */
export function needsLeaveReminder(changes: readonly BoardChange[], userId: string | undefined): boolean {
  return changes.some(
    (change) =>
      change.kind === "record_delete" ||
      change.kind === "column_delete" ||
      ((change.kind === "record_edit" || change.kind === "record_add") && change.recordOwnerId !== null && change.recordOwnerId !== userId),
  );
}

/** One short line per change for the preview (max 5, the rest counted). */
export function changeLine(change: BoardChange, columnLabel: (key: string) => string): string {
  const title = change.recordTitle ?? "Hạng mục";
  if (change.kind === "record_add") return `Thêm "${title}"`;
  if (change.kind === "task_link") return `Gắn việc "${String(change.after?.task ?? "")}" vào "${title}"`;
  if (change.kind === "task_unlink") return `Bỏ việc "${String(change.after?.task ?? "")}" khỏi "${title}"`;
  if (change.kind === "record_delete") return `Xoá "${title}"`;
  if (change.kind === "column_add") return `Thêm cột "${String(change.after?.label ?? "")}"`;
  if (change.kind === "column_delete") return `Xoá cột "${String(change.before?.label ?? "")}"`;
  if (change.kind === "column_edit") return `Sửa cột "${String(change.after?.label ?? change.before?.label ?? "")}"`;
  const fields = Object.keys(change.after ?? {}).map((key) => columnLabel(key));
  return `Sửa "${title}": ${fields.slice(0, 3).join(", ")}${fields.length > 3 ? "…" : ""}`;
}

/** What changed since a moment, keyed for marking: whole Hạng mục, single cells, deletions. */
export type ChangeMarks = {
  newRecords: ReadonlySet<string>;
  /** `${recordId}:${fieldKey}` — fieldKey is a built-in name or `ext:<column key>`. */
  cells: ReadonlySet<string>;
  /** Changed in any way (for the small dot on a row / card). */
  records: ReadonlySet<string>;
  deleted: readonly { recordId: string; title: string }[];
  count: number;
};

export function marksSince(
  changes: readonly BoardChange[],
  since: string | null,
  exceptActor?: string,
  onlyAnnouncement?: string,
): ChangeMarks {
  const newRecords = new Set<string>();
  const cells = new Set<string>();
  const records = new Set<string>();
  const deleted = new Map<string, string>();
  let count = 0;
  for (const change of changes) {
    if (onlyAnnouncement !== undefined) {
      if (change.announcementId !== onlyAnnouncement) continue;
    } else if (since !== null && change.createdAt <= since) continue;
    if (exceptActor !== undefined && change.actorId === exceptActor) continue;
    if (change.recordId === null) {
      count += 1;
      continue;
    }
    records.add(change.recordId);
    if (change.kind === "record_add") {
      newRecords.add(change.recordId);
      count += 1;
    } else if (change.kind === "record_delete") {
      deleted.set(change.recordId, change.recordTitle ?? "Hạng mục");
      count += 1;
    } else {
      for (const key of Object.keys(change.after ?? {})) cells.add(`${change.recordId}:${key}`);
      count += change.cells;
    }
  }
  return { newRecords, cells, records, deleted: [...deleted].map(([recordId, title]) => ({ recordId, title })), count };
}
