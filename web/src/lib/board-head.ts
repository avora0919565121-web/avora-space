import { supabase } from "@/integrations/supabase/client";
import { hubFail, type ThinkTable } from "@/lib/think-hub";
import type { ThinkingType } from "@/lib/think-hub-shelf";

/**
 * AVORA-77 · A4 — the head of an open board: its question (the `purpose` column, shown as
 * `Câu hỏi của Bảng`), its conclusion (append-only, newest wins) and its lifecycle.
 *
 * The lifecycle only measures how far the thinking has gone. Only the person marks it; Avora
 * never infers it. `Đang chờ` is also what "not marked yet" looks like.
 */
export type Lifecycle = "waiting" | "thinking" | "concluded" | "archived";

export const LIFECYCLES: readonly { id: Exclude<Lifecycle, "archived">; label: string; short: string }[] = [
  { id: "waiting", label: "Đang chờ", short: "Chờ" },
  { id: "thinking", label: "Đang suy nghĩ", short: "Nghĩ" },
  { id: "concluded", label: "Đã chốt", short: "Chốt" },
];

export function lifecycleLabel(lifecycle: Lifecycle | undefined): string {
  if (lifecycle === "archived") return "Lưu trữ";
  return LIFECYCLES.find((item) => item.id === lifecycle)?.label ?? "Đang chờ";
}

/** A board with no lifecycle at all: Bảng Avora mặc định, Kệ sách, sub-tables (they follow their root). */
export function hasLifecycle(table: ThinkTable): boolean {
  return table.syncSource == null && table.kind !== "bookshelf" && table.parentRecordId === null;
}

/** Whether this board's question may be written (UI mirror of the server rule). */
export function canEditQuestion(table: ThinkTable, userId: string | undefined): boolean {
  if (table.syncSource != null || table.kind === "bookshelf") return false;
  if (table.projectId !== null && table.parentRecordId === null) return false;
  return table.ownerUserId === userId;
}

/** Whether this person may change the conclusion / lifecycle (server: `can_edit_board_head`). */
export function canEditHead(table: ThinkTable, userId: string | undefined, isReadOnly: boolean): boolean {
  if (!hasLifecycle(table) || isReadOnly || userId === undefined) return false;
  return table.shareMode !== "view" || table.ownerUserId === userId;
}

export type Conclusion = { id: string; tableId: string; body: string; createdBy: string; createdAt: string };

export const boardHeadKeys = {
  conclusions: ["think-hub", "conclusions"] as const,
};

/** Every conclusion I can see, newest first. Small: one short line each. */
export async function fetchConclusions(): Promise<Conclusion[]> {
  const { data, error } = await supabase
    .from("think_hub_conclusions")
    .select("id, table_id, body, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw hubFail(error.code, error.message);
  return (data ?? []).map((row) => ({ id: row.id, tableId: row.table_id, body: row.body, createdBy: row.created_by, createdAt: row.created_at }));
}

export async function saveConclusion(tableId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("set_board_conclusion", { p_table_id: tableId, p_body: body.trim() });
  if (error) throw hubFail(error.code, error.message);
}

export async function setLifecycle(tableId: string, lifecycle: Lifecycle): Promise<void> {
  const { error } = await supabase.rpc("set_board_lifecycle", { p_table_id: tableId, p_lifecycle: lifecycle });
  if (error) throw hubFail(error.code, error.message);
}

export async function setThinkingType(tableId: string, type: ThinkingType | null): Promise<void> {
  const { error } = await supabase.rpc("set_board_thinking_type", { p_table_id: tableId, p_type: type as string });
  if (error) throw hubFail(error.code, error.message);
}

/** Latest conclusion per board. */
export function latestConclusions(conclusions: readonly Conclusion[]): Map<string, Conclusion> {
  const map = new Map<string, Conclusion>();
  for (const item of conclusions) {
    const known = map.get(item.tableId);
    if (known === undefined || known.createdAt < item.createdAt) map.set(item.tableId, item);
  }
  return map;
}

/** "30/09" — the short date a conclusion line carries. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "sửa hôm nay" / "sửa 3 ngày trước". */
export function editedAgo(iso: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "sửa hôm nay" : `sửa ${days} ngày trước`;
}

/** The suggestion `Đánh dấu Đã chốt?` is offered once per board, on its first conclusion. */
const SUGGESTED_KEY = "avora.board-concluded-suggested.v1";

export function wasConcludeSuggested(tableId: string): boolean {
  try {
    return (window.localStorage.getItem(SUGGESTED_KEY) ?? "").split(",").includes(tableId);
  } catch {
    return false;
  }
}

export function markConcludeSuggested(tableId: string): void {
  try {
    const list = (window.localStorage.getItem(SUGGESTED_KEY) ?? "").split(",").filter((id) => id !== "");
    if (!list.includes(tableId)) window.localStorage.setItem(SUGGESTED_KEY, [...list.slice(-300), tableId].join(","));
  } catch {
    // A second offer is the worst that can happen.
  }
}
