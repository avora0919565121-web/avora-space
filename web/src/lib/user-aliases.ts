import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * AVORA-71 · E (ADR-044): a name I give someone — seen by me only, never by them. RLS lets only
 * the owner read or write a row; the table is not in anyone's realtime feed.
 */
export const ALIAS_MAX = 40;

export const aliasKeys = { all: ["user-aliases"] as const };

type AliasRow = { target_user_id: string; alias: string };

function fail(code: string | undefined, message: string): Error {
  logError("user-aliases", { code, message });
  if (message.includes("user_aliases_len")) return new Error(`Tên gợi nhớ dài 1–${ALIAS_MAX} ký tự.`);
  return new Error("Không lưu được tên gợi nhớ. Vui lòng thử lại.");
}

/** Every name I have given, keyed by the person. */
export async function fetchMyAliases(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("user_aliases" as never).select("target_user_id, alias");
  if (error) throw fail(error.code, error.message);
  return new Map(((data ?? []) as AliasRow[]).map((row) => [row.target_user_id, row.alias] as const));
}

/** Sets (or, with an empty name, removes) the name I keep for one person. */
export async function saveAlias(ownerId: string, targetId: string, alias: string): Promise<void> {
  const clean = alias.trim().replace(/\s+/g, " ");
  if (clean === "") {
    const { error } = await supabase.from("user_aliases" as never).delete().eq("owner_user_id", ownerId).eq("target_user_id", targetId);
    if (error) throw fail(error.code, error.message);
    return;
  }
  if (clean.length > ALIAS_MAX) throw new Error(`Tên gợi nhớ dài 1–${ALIAS_MAX} ký tự.`);
  const { error } = await supabase
    .from("user_aliases" as never)
    .upsert({ owner_user_id: ownerId, target_user_id: targetId, alias: clean, updated_at: new Date().toISOString() } as never, { onConflict: "owner_user_id,target_user_id" });
  if (error) throw fail(error.code, error.message);
}

/**
 * "My name" for a person, one per person: my Liên hệ name first (then the alias input becomes
 * `Sửa tên trong Liên hệ`), then my alias, then the name they go by.
 */
export function myNameFor(input: { contactName?: string | null; alias?: string | null; shownName: string }): string {
  const contact = input.contactName?.trim() ?? "";
  if (contact !== "") return contact;
  const alias = input.alias?.trim() ?? "";
  return alias !== "" ? alias : input.shownName;
}

/** Search matches my name for them and their own name alike, without accents. */
export function matchesPersonSearch(query: string, names: readonly (string | null | undefined)[]): boolean {
  const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const needle = fold(query.trim());
  if (needle === "") return true;
  return names.some((name) => name != null && fold(name).includes(needle));
}
