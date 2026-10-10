import { supabase } from "@/integrations/supabase/client";

/**
 * AVORA-89 · PHẦN 1 (ADR-052) — `@` / `#` / `@@` only inside the context the person stands in.
 * Suggestions come from server RPCs that check membership; the server re-checks every saved ref.
 */

export type RefContext = `conversation:${string}` | `project:${string}` | "journal";
export type RefKind = "file" | "record" | "board" | "note" | "contact";
export type RefChoice = { kind: RefKind; id: string; label: string };
export type CardSuggestion = { userId: string; name: string; pin: string | null; hasPin: boolean };
export type Trigger = { kind: "at" | "atat" | "hash"; query: string; start: number };

/** The `@`, `@@` or `#` being typed right before the caret; only at the start of a word. */
export function activeTrigger(text: string, caret: number): Trigger | null {
  const upTo = text.slice(0, caret);
  const match = /(^|\s)(@@|@|#)([^\s@#]*)$/u.exec(upTo);
  if (match === null) return null;
  const sign = match[2];
  const start = upTo.length - sign.length - match[3].length;
  return { kind: sign === "@@" ? "atat" : sign === "@" ? "at" : "hash", query: match[3], start };
}

/** Replaces the trigger with `#label ` and returns the new text + caret. */
export function applyRef(text: string, trigger: Trigger, caret: number, label: string): { text: string; caret: number } {
  const before = text.slice(0, trigger.start);
  const inserted = `#${label} `;
  return { text: `${before}${inserted}${text.slice(caret)}`, caret: before.length + inserted.length };
}

/** Removes the `@@…` that was typed (the card leaves as its own message). */
export function removeTrigger(text: string, trigger: Trigger, caret: number): { text: string; caret: number } {
  return { text: `${text.slice(0, trigger.start)}${text.slice(caret)}`, caret: trigger.start };
}

/** Refs still written in the finished text — deleting `#name` un-refs it, like a mention. */
export function refsInText(text: string, chosen: readonly RefChoice[]): RefChoice[] {
  const seen = new Set<string>();
  return chosen.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key) || !text.includes(`#${ref.label}`)) return false;
    seen.add(key);
    return true;
  });
}

/** Accent-free compare for local filtering (Vietnamese typed without marks). */
export function foldVi(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export async function suggestRefs(context: RefContext, kind: "all" | "file" | "record" | "note", query: string): Promise<RefChoice[]> {
  const { data, error } = await supabase.rpc("suggest_refs", { p_context: context, p_kind: kind, p_query: "" });
  if (error) throw new Error("Không tải được gợi ý.");
  const needle = foldVi(query);
  return (data ?? [])
    .filter((row) => needle === "" || foldVi(row.label ?? "").includes(needle))
    .map((row) => ({ kind: row.kind as RefKind, id: row.id, label: row.label ?? "" }));
}

export async function suggestContactCards(context: RefContext, query: string): Promise<CardSuggestion[]> {
  const { data, error } = await supabase.rpc("suggest_contact_cards", { p_context: context, p_query: "" });
  if (error) throw new Error("Không tải được gợi ý.");
  const needle = foldVi(query);
  return (data ?? [])
    .filter((row) => needle === "" || foldVi(row.name ?? "").includes(needle))
    .map((row) => ({ userId: row.user_id, name: row.name ?? "", pin: row.pin, hasPin: row.has_pin === true }));
}

export async function shareContactCard(context: RefContext, userId: string): Promise<void> {
  const { error } = await supabase.rpc("share_contact_card", { p_context: context, p_user_id: userId });
  if (error) throw new Error(error.message.includes("avora_contact_card_not_allowed") ? "Không giới thiệu được người này ở đây." : "Chưa gửi được thẻ giới thiệu.");
}

export type ContactCardView = { userId: string; name: string; pin: string; avatarUrl: string | null; isFriend: boolean; isSelf: boolean };

export async function fetchContactCard(messageId: string): Promise<ContactCardView | null> {
  const { data, error } = await supabase.rpc("contact_card_view", { p_message_id: messageId });
  if (error) throw new Error("Không mở được thẻ.");
  const row = (data ?? [])[0];
  if (row === undefined) return null;
  return { userId: row.user_id, name: row.name ?? "", pin: row.pin ?? "", avatarUrl: row.avatar_url, isFriend: row.is_friend === true, isSelf: row.is_self === true };
}

export async function fetchMessageRefs(messageId: string): Promise<{ kind: RefKind; id: string; label: string | null }[]> {
  const { data, error } = await supabase.rpc("resolve_message_refs", { p_message_id: messageId });
  if (error) return [];
  return (data ?? []).map((row) => ({ kind: row.kind as RefKind, id: row.id, label: row.label }));
}

export const REF_KIND_LABEL: Readonly<Record<RefKind, string>> = { file: "File", record: "Hạng mục", board: "Bảng", note: "Ghi chép", contact: "Liên hệ" };

/** K4 · 5 (ADR-052): `@` in Nhật ký — the person's own Liên hệ. Writes a name; notifies nobody. */
export async function suggestJournalContacts(): Promise<{ userId: string; name: string }[]> {
  const { data, error } = await supabase.rpc("suggest_mentions", { p_context: "journal", p_query: "" });
  if (error) throw new Error("Không tải được Liên hệ.");
  return (data ?? []).filter((row) => row.kind === "contact").map((row) => ({ userId: row.id, name: row.label }));
}
