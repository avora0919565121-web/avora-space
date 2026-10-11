import { supabase } from "@/integrations/supabase/client";

/**
 * AVORA-100 · G.3 — mã mời theo nước / đối tác (ba đợt). A code sets the account's country and its
 * starting language; whether a code is required at all is one flag the team turns on (off today),
 * and turning it on never touches accounts that already exist.
 */
export const INVITE_COUNTRIES = ["VN", "US", "CA", "AU", "NZ", "DE", "FI"] as const;
export type InviteCountry = (typeof INVITE_COUNTRIES)[number];

export const COUNTRY_NAME: Record<InviteCountry, string> = {
  VN: "Việt Nam",
  US: "Hoa Kỳ",
  CA: "Canada",
  AU: "Úc",
  NZ: "New Zealand",
  DE: "Đức",
  FI: "Phần Lan",
};

export type InviteCheck = { ok: true; country: InviteCountry; locale: "vi" | "en" } | { ok: false; reason: "not_found" | "used_up" | "error" };

export type InviteCodeRow = {
  code: string;
  country: InviteCountry;
  partner: string | null;
  wave: number;
  locale: "vi" | "en";
  max_uses: number;
  used: number;
  active: boolean;
  created_at: string;
};

/** Upper-case, spaces dropped — what people paste from a message. */
export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

export function inviteMessage(reason: "not_found" | "used_up" | "error" | "already"): string {
  if (reason === "used_up") return "Mã mời đã dùng hết.";
  if (reason === "not_found") return "Mã mời không đúng hoặc đã tắt.";
  if (reason === "already") return "Tài khoản này đã dùng một mã mời khác.";
  return "Chưa kiểm được mã mời. Thử lại nhé.";
}

export async function checkInvite(code: string): Promise<InviteCheck> {
  const { data, error } = await supabase.rpc("check_invite" as never, { p_code: normalizeInviteCode(code) } as never);
  if (error || data === null || typeof data !== "object") return { ok: false, reason: "error" };
  const r = data as { ok?: boolean; reason?: string; country?: string; locale?: string };
  if (r.ok === true) return { ok: true, country: (r.country ?? "VN") as InviteCountry, locale: r.locale === "en" ? "en" : "vi" };
  return { ok: false, reason: r.reason === "used_up" ? "used_up" : "not_found" };
}

/** Uses the code for the signed-in account. Throws a Vietnamese sentence. */
export async function redeemInvite(code: string): Promise<void> {
  const { error } = await supabase.rpc("redeem_invite" as never, { p_code: normalizeInviteCode(code) } as never);
  if (!error) return;
  const m = error.message ?? "";
  if (m.includes("used_up")) throw new Error(inviteMessage("used_up"));
  if (m.includes("not_found")) throw new Error(inviteMessage("not_found"));
  if (m.includes("already")) throw new Error(inviteMessage("already"));
  if (m.includes("rate_limited")) throw new Error("Bạn thử nhiều lần quá. Đợi ít phút rồi nhập lại nhé.");
  throw new Error(inviteMessage("error"));
}

export async function isInviteRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc("invite_required" as never);
  return !error && data === true;
}

/** Whether this account is held at `Nhập mã mời để vào Avora`. */
export async function myInviteGate(): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_invite_gate" as never);
  if (error || data === null || typeof data !== "object") return false;
  return (data as { blocked?: boolean }).blocked === true;
}

// ------------------------------------------------------------------ team (ops) only
export async function fetchInviteCodes(): Promise<InviteCodeRow[]> {
  const { data, error } = await supabase.from("invite_code" as never).select("*").order("created_at", { ascending: false });
  if (error) throw new Error("Chưa tải được mã mời.");
  return (data ?? []) as unknown as InviteCodeRow[];
}

export async function createInviteCode(input: { code: string; country: InviteCountry; partner: string; wave: number; locale: "vi" | "en"; maxUses: number }): Promise<void> {
  const { error } = await supabase.rpc("create_invite_code" as never, {
    p_code: normalizeInviteCode(input.code),
    p_country: input.country,
    p_partner: input.partner.trim() === "" ? null : input.partner.trim(),
    p_wave: input.wave,
    p_locale: input.locale,
    p_max_uses: input.maxUses,
  } as never);
  if (error) throw new Error(error.message.includes("duplicate") ? "Mã này đã có." : "Chưa tạo được mã.");
}

export async function setInviteCodeActive(code: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_invite_code_active" as never, { p_code: code, p_active: active } as never);
  if (error) throw new Error("Chưa đổi được mã.");
}

export async function setInviteRequired(on: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_invite_required" as never, { p_on: on } as never);
  if (error) throw new Error("Chưa đổi được.");
}

/** Used / allowed, grouped by country then wave — the team's one table. */
export function inviteUsage(rows: readonly InviteCodeRow[]): { country: InviteCountry; wave: number; used: number; max: number; codes: number }[] {
  const map = new Map<string, { country: InviteCountry; wave: number; used: number; max: number; codes: number }>();
  for (const row of rows) {
    const key = `${row.country}:${row.wave}`;
    const cur = map.get(key) ?? { country: row.country, wave: row.wave, used: 0, max: 0, codes: 0 };
    cur.used += row.used;
    cur.max += row.max_uses;
    cur.codes += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => INVITE_COUNTRIES.indexOf(a.country) - INVITE_COUNTRIES.indexOf(b.country) || a.wave - b.wave);
}
