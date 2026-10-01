import { logError } from "@/lib/log";
import { supabase } from "@/integrations/supabase/client";
import { CONTACT_UNAVAILABLE_MESSAGE } from "@/lib/blocks";
import { matchesSearch } from "@/lib/normalize-search";

/**
 * Bạn bè (AVORA-38 / ADR-029).
 *
 * Two accounts are "bạn" once both agreed — through a PIN, a shared Nhóm, or a contact invite.
 * Strangers find each other only by PIN; bạn can be found by PIN, alias, display name, email or
 * a saved phone. Either side may remove the connection, and nobody is told who did.
 */
export type Connection = {
  userId: string;
  displayName: string | null;
  /** `A-XXXXXXXX`, or null while that person has not chosen a PIN. */
  pin: string | null;
  createdAt: string;
};

export const connectionKeys = {
  all: ["connections"] as const,
  list: ["connections", "list"] as const,
};

/** Path encoded in the QR code. The PIN is an identifier, not a secret (ADR-019). */
export const CONNECT_PATH = "/ket-noi";

export const NO_PIN_LABEL = "Chưa có PIN";
export const PIN_NOT_FOUND_MESSAGE = "Không tìm thấy ai với PIN này.";
export const NEEDS_OWN_PIN_MESSAGE = "Chưa có PIN thì người khác chưa thể tìm và kết bạn với bạn.";
export const NOT_CONNECTED_NOTICE = "Hai bạn không còn kết nối.";

/** Accepts `A-XXXXXXXX`, `a-xxxxxxxx` or just the 8 characters, with or without spaces. */
export function normalizePinInput(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (compact.length === 0) return "";
  return compact.startsWith("A-") ? compact : `A-${compact}`;
}

/** Loose shape check before calling the server; the server stays the judge. */
export function looksLikePin(value: string): boolean {
  return /^A-[A-Z0-9]{8}$/.test(normalizePinInput(value));
}

/** The link a QR code carries: `${origin}/ket-noi/A-XXXXXXXX`. */
export function connectLink(pin: string, origin: string = typeof window === "undefined" ? "" : window.location.origin): string {
  return `${origin}${CONNECT_PATH}/${encodeURIComponent(pin)}`;
}

/** Reads a PIN out of whatever a QR code held: a full link, a path, or the bare PIN. */
export function pinFromScan(raw: string): string | null {
  const text = raw.trim();
  const match = /\/ket-noi\/([^/?#\s]+)/i.exec(text);
  const candidate = match !== null ? decodeURIComponent(match[1]) : text;
  return looksLikePin(candidate) ? normalizePinInput(candidate) : null;
}

/** Bạn bè search: PIN, the alias saved in Liên hệ, display name, email and saved phones. */
export function matchesConnection(
  connection: Connection,
  query: string,
  extra: readonly (string | null | undefined)[] = [],
): boolean {
  return matchesSearch(query, [connection.displayName, connection.pin, ...extra]);
}

/** Vietnamese wording for every refusal the connection RPCs can raise. */
export function toVietnameseConnectionError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_pin_required")) return NEEDS_OWN_PIN_MESSAGE;
  if (normalized.includes("avora_pin_not_found")) return PIN_NOT_FOUND_MESSAGE;
  if (normalized.includes("avora_pin_self")) return "Đây là PIN của chính bạn.";
  if (normalized.includes("avora_pin_rate_limited")) return "Bạn đã thử nhiều lần trong một giờ. Thử lại sau nhé.";
  if (normalized.includes("avora_group_connection_off")) return "Hãy xin PIN trong nhóm.";
  if (normalized.includes("avora_group_connection_daily_limit"))
    return "Hôm nay bạn đã mở nhiều khung kết bạn qua nhóm. Thử lại vào ngày mai nhé.";
  if (normalized.includes("avora_contact_unavailable")) return CONTACT_UNAVAILABLE_MESSAGE;
  if (normalized.includes("avora_verification_closed")) return "Khung kết bạn này đã đóng.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (normalized.includes("failed to fetch")) return "Cần kết nối mạng để kết bạn.";
  return "Chưa làm được. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  logError("connections", { code, message });
  return new Error(toVietnameseConnectionError(message));
}

export async function fetchMyConnections(): Promise<Connection[]> {
  const { data, error } = await supabase.rpc("list_my_connections");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    pin: row.pin,
    createdAt: row.created_at,
  }));
}

/**
 * Opens the verification frame for a PIN (or the ordinary 1-1 when already bạn) and returns
 * the conversation id. Every miss — unknown PIN, owner without PIN — reads as "không tìm thấy".
 */
export async function startPinConnection(pin: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_pin_connection", { p_pin: normalizePinInput(pin) });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error(PIN_NOT_FOUND_MESSAGE);
  return data;
}

/**
 * AVORA-55 · 3.4 — opens the "Từ nhóm" frame with a group member (ADR-029: a shared Nhóm alone
 * does not make two people bạn). Already bạn → the ordinary 1-1; a live frame → that frame.
 */
export async function startGroupConnection(groupId: string, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_group_connection", { p_group_id: groupId, p_user_id: userId });
  if (error) throw fail(error.code, error.message);
  return data as string;
}

export async function confirmVerification(conversationId: string): Promise<"connected" | "waiting"> {
  const { data, error } = await supabase.rpc("confirm_verification", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);
  return data === "connected" ? "connected" : "waiting";
}

export async function declineVerification(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_verification", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);
}

export async function removeConnection(userId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_connection", { p_user_id: userId });
  if (error) throw fail(error.code, error.message);
}

/** Only the owner can write their own switch (column-level grant). */
export async function setAllowGroupConnection(userId: string, allow: boolean): Promise<void> {
  const { error } = await supabase.from("profiles").update({ allow_group_connection: allow }).eq("id", userId);
  if (error) throw fail(error.code, error.message);
}

export async function fetchAllowGroupConnection(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("allow_group_connection").eq("id", userId).maybeSingle();
  if (error) throw fail(error.code, error.message);
  return data?.allow_group_connection ?? true;
}
