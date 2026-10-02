import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import type { OpportunityBoardRow, OpportunityStage } from "@/lib/opportunities";
import type { ColumnDef, ColumnType, ExtensionValue, RecordPatch, ThinkRecord, ThinkTable } from "@/lib/think-hub";

/**
 * AVORA-72 (ADR-045) — the synced columns of `Danh bạ | Danh sách cơ hội`. They are read live from
 * `crm_opportunity` + `contact` and folded into each Hạng mục for display only; nothing is copied into
 * the board. Edits go back to their source: contact fields to Danh bạ, opportunity fields to the opportunity.
 */
export const SYNC_PREFIX = "sync_";

type SyncColumn = { id: string; label: string; type: ColumnType; shown: boolean; source: "contact" | "opportunity" | "derived"; editable: boolean };

export const SYNC_COLUMNS: readonly SyncColumn[] = [
  { id: "contact", label: "Liên hệ", type: "text", shown: true, source: "derived", editable: false },
  { id: "value", label: "Giá trị ước tính", type: "number", shown: true, source: "opportunity", editable: true },
  { id: "next_date", label: "Bước tiếp theo · ngày", type: "date", shown: true, source: "opportunity", editable: true },
  { id: "next", label: "Bước tiếp theo", type: "text", shown: true, source: "opportunity", editable: true },
  { id: "last_contact", label: "Liên lạc gần nhất", type: "text", shown: true, source: "derived", editable: false },
  { id: "place", label: "Nơi trao đổi", type: "text", shown: true, source: "derived", editable: false },
  { id: "phone", label: "Điện thoại", type: "text", shown: true, source: "contact", editable: true },
  { id: "email", label: "Email", type: "text", shown: true, source: "contact", editable: true },
  { id: "company", label: "Công ty", type: "text", shown: true, source: "derived", editable: false },
  { id: "type", label: "Loại", type: "text", shown: false, source: "derived", editable: false },
  { id: "representative", label: "Người đại diện", type: "text", shown: false, source: "derived", editable: false },
  { id: "industry", label: "Ngành", type: "text", shown: false, source: "contact", editable: true },
  { id: "address", label: "Địa chỉ", type: "text", shown: false, source: "contact", editable: true },
  { id: "tax_code", label: "Mã số thuế", type: "text", shown: false, source: "contact", editable: true },
  { id: "relationship", label: "Quan hệ", type: "text", shown: false, source: "contact", editable: true },
  { id: "contact_note", label: "Ghi chú liên hệ", type: "text", shown: false, source: "contact", editable: true },
];

const CONTACT_FIELD: Readonly<Record<string, string>> = {
  phone: "phone",
  email: "email",
  industry: "industry",
  address: "business_address",
  tax_code: "tax_code",
  relationship: "relationship_tag",
  contact_note: "note",
};

export function isSyncBoard(table: Pick<ThinkTable, "syncSource"> | null | undefined): boolean {
  return table?.syncSource === "contact_opportunities";
}

export function isSyncColumnKey(key: string): boolean {
  return key.startsWith(SYNC_PREFIX);
}

/** The synced columns as ColumnDefs (🔗 in the label), folded away when the owner hid them. */
export function syncColumnDefs(table: Pick<ThinkTable, "syncHidden">): ColumnDef[] {
  const hidden = new Set(table.syncHidden ?? SYNC_COLUMNS.filter((c) => !c.shown).map((c) => c.id));
  const firstTime = (table.syncHidden ?? []).length === 0;
  return SYNC_COLUMNS.map((c) => ({
    id: `${SYNC_PREFIX}${c.id}`,
    key: `${SYNC_PREFIX}${c.id}`,
    label: `🔗 ${c.label}`,
    type: c.type,
    hidden: firstTime ? !c.shown : hidden.has(c.id),
  }));
}

export function relativeDays(at: string | null, now = Date.now()): string {
  if (at === null) return "";
  const days = Math.floor((now - new Date(at).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "Hôm nay";
  if (days === 1) return "Hôm qua";
  return `${days} ngày trước`;
}

/** Folds the live values into each Hạng mục (display only). */
export function withSyncValues(
  records: readonly ThinkRecord[],
  rows: readonly OpportunityBoardRow[],
  placeLabel: (conversationId: string) => string,
  taskCount: (recordId: string) => number,
): ThinkRecord[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  return records.map((record) => {
    const row = record.opportunityId == null ? undefined : byId.get(record.opportunityId);
    if (row === undefined) return record;
    const c = row.contact;
    const values: Record<string, string | null> = {
      contact: c === null ? "Liên hệ đã xoá" : `${c.name}${c.needsDetails ? " ·" : ""}`,
      value: row.estimatedValue === null ? null : String(row.estimatedValue),
      next_date: row.nextActionDate,
      next: row.nextActionNote,
      last_contact: relativeDays(row.lastContactAt),
      place: row.conversationId === null ? null : placeLabel(row.conversationId),
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      company: c === null ? null : c.contactType === "business" ? c.name : c.employerName,
      type: c === null ? null : c.contactType === "business" ? "Doanh nghiệp" : "Cá nhân",
      representative: c?.representative ?? null,
      industry: c?.industry ?? null,
      address: c?.address ?? null,
      tax_code: c?.taxCode ?? null,
      relationship: c?.relationship ?? null,
      contact_note: c?.note ?? null,
    };
    const count = taskCount(record.id);
    const ext: Record<string, ExtensionValue> = { ...record.extensionFields };
    for (const [k, v] of Object.entries(values)) ext[`${SYNC_PREFIX}${k}`] = v;
    if (count > 0) ext[`${SYNC_PREFIX}tasks`] = `${count} việc`;
    return { ...record, extensionFields: ext };
  });
}

/** Status chips: `Đang mở · Đối tác · Không thành · Tất cả` (default `Đang mở`; Luật 7). */
export type StageChip = "open" | "doi_tac" | "khong_thanh" | "all";
export const STAGE_CHIPS: readonly { id: StageChip; label: string }[] = [
  { id: "open", label: "Đang mở" },
  { id: "doi_tac", label: "Đối tác" },
  { id: "khong_thanh", label: "Không thành" },
  { id: "all", label: "Tất cả" },
];

export function matchesStageChip(stage: string, chip: StageChip): boolean {
  if (chip === "all") return true;
  if (chip === "open") return stage !== "doi_tac" && stage !== "khong_thanh";
  return stage === chip;
}

/** The total of `Giá trị ước tính` for the rows shown (72.12). */
export function totalValue(records: readonly ThinkRecord[]): number {
  return records.reduce((sum, r) => {
    const n = Number(r.extensionFields[`${SYNC_PREFIX}value`] ?? "");
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
}

/** Splits a record patch: synced fields go back to their source; the rest stays on the board. */
export function splitSyncPatch(patch: RecordPatch): { board: RecordPatch; contact: Record<string, string | null>; opportunity: Record<string, string | number | null> } {
  const contact: Record<string, string | null> = {};
  const opportunity: Record<string, string | number | null> = {};
  if (patch.extensionFields === undefined) return { board: patch, contact, opportunity };
  const rest: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(patch.extensionFields)) {
    if (!isSyncColumnKey(key)) {
      rest[key] = raw as string | null;
      continue;
    }
    const id = key.slice(SYNC_PREFIX.length);
    const col = SYNC_COLUMNS.find((c) => c.id === id);
    if (col === undefined || !col.editable) continue;
    const value = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
    if (col.source === "contact" && CONTACT_FIELD[id] !== undefined) contact[CONTACT_FIELD[id]] = value;
    if (id === "value") opportunity.estimated_value = value === null ? null : Math.max(0, Number(value.replace(/[^\d]/g, "")) || 0);
    if (id === "next_date") opportunity.next_action_date = value;
    if (id === "next") opportunity.next_action_note = value === null ? null : value.slice(0, 200);
  }
  return { board: { ...patch, extensionFields: rest }, contact, opportunity };
}

/** Writes the synced edits to Danh bạ / the opportunity (`Sửa ở đây là sửa trong Danh bạ`). */
export async function saveSyncEdits(row: OpportunityBoardRow, contact: Record<string, string | null>, opportunity: Record<string, string | number | null>): Promise<void> {
  // Only fields that really changed — an untouched synced value is not rewritten.
  const current = row.contact;
  const contactPatch = Object.fromEntries(
    Object.entries(contact).filter(([field, value]) => {
      const before = { phone: current?.phone, email: current?.email, industry: current?.industry, business_address: current?.address, tax_code: current?.taxCode, relationship_tag: current?.relationship, note: current?.note }[field] ?? null;
      return (before ?? null) !== value;
    }),
  );
  if (Object.keys(contactPatch).length > 0 && row.contactId !== null) {
    const { error } = await supabase.from("contact").update(contactPatch as never).eq("id", row.contactId);
    if (error) {
      logError("opportunity-board", { code: error.code });
      throw new Error("Không lưu được vào Danh bạ.");
    }
  }
  const oppPatch = Object.fromEntries(
    Object.entries(opportunity).filter(([field, value]) => {
      const before = field === "estimated_value" ? row.estimatedValue : field === "next_action_date" ? row.nextActionDate : row.nextActionNote;
      return (before ?? null) !== value;
    }),
  );
  if (Object.keys(oppPatch).length > 0) {
    const { error } = await supabase.from("crm_opportunity").update(oppPatch as never).eq("id", row.id);
    if (error) {
      logError("opportunity-board", { code: error.code });
      throw new Error("Không lưu được cơ hội.");
    }
  }
}

export async function fetchOpportunityBoardId(): Promise<string> {
  const { data, error } = await supabase.rpc("opportunity_board" as never);
  if (error) throw new Error("Không mở được Danh sách cơ hội.");
  return String(data);
}

export async function setBoardView(input: { hiddenInList?: boolean; syncHidden?: readonly string[] }): Promise<void> {
  const { error } = await supabase.rpc("set_opportunity_board_view" as never, {
    p_hidden_in_list: input.hiddenInList ?? null,
    p_sync_hidden: input.syncHidden === undefined ? null : input.syncHidden.map((k) => (k.startsWith(SYNC_PREFIX) ? k.slice(SYNC_PREFIX.length) : k)),
  } as never);
  if (error) throw new Error("Không đổi được.");
}

export const STAGE_OF = (value: string): OpportunityStage =>
  (["lead", "tiem_nang", "dang_cham_soc", "doi_tac", "khong_thanh"].includes(value) ? value : "lead") as OpportunityStage;
