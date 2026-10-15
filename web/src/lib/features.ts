import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * AVORA-112-B · công tắc tính năng (ADR-090). One key per feature a person can see; the same keys are seeded
 * in `public.app_features`. Default when nothing can be read: the cached copy, else `stable` — a switch
 * must never turn off a working feature by accident.
 */
export const FEATURE_KEYS = [
  { key: "journal", label: "Nhật ký" },
  { key: "chat_direct", label: "Chat 1-1" },
  { key: "groups", label: "Nhóm" },
  { key: "contacts", label: "Liên hệ" },
  { key: "contact_import", label: "Nhập danh bạ" },
  { key: "contact_link", label: "Liên kết liên hệ ↔ tài khoản" },
  { key: "projects", label: "Dự án" },
  { key: "tasks", label: "Nhiệm vụ" },
  { key: "calendar", label: "Lịch" },
  { key: "think_hub", label: "Kế hoạch" },
  { key: "meeting_notes", label: "Biên bản họp" },
  { key: "habits", label: "Thói quen" },
  { key: "finance", label: "Tài chính" },
  { key: "vault_passwords", label: "Két sắt · Mật khẩu" },
  { key: "vault_certificates", label: "Két sắt · Chứng chỉ" },
  { key: "vault_documents", label: "Két sắt · Tài liệu" },
  { key: "vault_assets", label: "Két sắt · Tài sản" },
  { key: "books", label: "Sách" },
  { key: "feedback", label: "Góp ý" },
  { key: "invite_codes", label: "Mã mời" },
  { key: "reactions", label: "Cảm xúc nổi" },
  { key: "read_receipts", label: "Đã xem" },
  { key: "disappearing", label: "Tin tự biến mất" },
  { key: "scheduled_messages", label: "Hẹn giờ gửi" },
  { key: "chat_lock", label: "Khoá Kết nối" },
  { key: "message_sound", label: "Âm báo tin nhắn" },
  { key: "avatars", label: "Ảnh đại diện" },
  { key: "avora_ai", label: "Avora AI" },
  { key: "push", label: "Thông báo đẩy" },
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number]["key"];
export type FeatureStatus = "stable" | "soon" | "hidden";
export type FeatureRow = { key: string; status: FeatureStatus; minAppVersion: string | null; note: string | null; updatedAt: string | null };
export type FeatureMap = Readonly<Record<string, FeatureStatus>>;

/** The version this build reports to `min_app_version`. */
export const APP_VERSION = "1.12.0";

export const featureKeys = {
  all: ["app-features"] as const,
  changes: ["app-features", "changes"] as const,
};

const CACHE_KEY = "avora.features.v1";

export function isFeatureStatus(value: unknown): value is FeatureStatus {
  return value === "stable" || value === "soon" || value === "hidden";
}

/** "1.2" < "1.10"; missing parts read as 0. */
export function versionBelow(current: string, minimum: string): boolean {
  const a = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** What this build should do with each key: a build older than `min_app_version` does not show the feature. */
export function toFeatureMap(rows: readonly FeatureRow[], appVersion: string = APP_VERSION): FeatureMap {
  const map: Record<string, FeatureStatus> = {};
  for (const row of rows) {
    map[row.key] = row.minAppVersion !== null && versionBelow(appVersion, row.minAppVersion) ? "hidden" : row.status;
  }
  return map;
}

/** One key's state; anything unknown is `stable`. */
export function statusOf(map: FeatureMap | undefined, key: FeatureKey): FeatureStatus {
  return map?.[key] ?? "stable";
}

export function readCachedFeatures(): FeatureMap | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return undefined;
    const map: Record<string, FeatureStatus> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (isFeatureStatus(value)) map[key] = value;
    return map;
  } catch {
    return undefined;
  }
}

export function writeCachedFeatures(map: FeatureMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked: the next start reads the server again.
  }
}

type Raw = { key: string; status: string; min_app_version: string | null; note: string | null; updated_at: string | null };

function toRow(raw: Raw): FeatureRow {
  return {
    key: raw.key,
    status: isFeatureStatus(raw.status) ? raw.status : "stable",
    minAppVersion: raw.min_app_version,
    note: raw.note,
    updatedAt: raw.updated_at,
  };
}

export async function fetchFeatureRows(): Promise<FeatureRow[]> {
  const { data, error } = await supabase
    .from("app_features" as never)
    .select("key, status, min_app_version, note, updated_at")
    .order("key")
    .limit(200); // rows-bounded: one row per feature
  if (error) {
    logError("features", { code: error.code, message: error.message });
    throw new Error("Chưa đọc được danh sách tính năng.");
  }
  return ((data ?? []) as Raw[]).map(toRow);
}

/** The map this device should use now, cached for the next start (and for offline). */
export async function fetchFeatureMap(): Promise<FeatureMap> {
  const map = toFeatureMap(await fetchFeatureRows());
  writeCachedFeatures(map);
  return map;
}

export type FeatureChange = { id: string; key: string; fromStatus: string | null; toStatus: string; note: string | null; at: string };

export async function fetchFeatureChanges(): Promise<FeatureChange[]> {
  const { data, error } = await supabase
    .from("app_feature_changes" as never)
    .select("id, key, from_status, to_status, note, at")
    .order("at", { ascending: false })
    .limit(100); // rows-bounded: the latest hundred switches
  if (error) {
    logError("features", { code: error.code, message: error.message });
    throw new Error("Chưa đọc được lịch sử đổi.");
  }
  return ((data ?? []) as { id: string; key: string; from_status: string | null; to_status: string; note: string | null; at: string }[]).map((row) => ({
    id: row.id,
    key: row.key,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    at: row.at,
  }));
}

export async function setFeatureStatus(key: FeatureKey, status: FeatureStatus, note: string | null): Promise<void> {
  const { error } = await supabase.rpc("ops_set_feature" as never, { p_key: key, p_status: status, p_note: note } as never);
  if (error) {
    logError("features", { code: error.code, message: error.message });
    if (error.message.includes("avora_not_allowed")) throw new Error("Chỉ nhóm vận hành Avora đổi được trạng thái.");
    throw new Error("Chưa đổi được trạng thái. Vui lòng thử lại.");
  }
}

/** Which feature owns a route, for the route gate (hidden → not reachable by link either). */
export function routeFeature(pathname: string): FeatureKey | null {
  const rules: readonly [RegExp, FeatureKey][] = [
    [/^\/nhiem-vu(\/|$)/, "tasks"],
    [/^\/du-an\//, "projects"],
    [/^\/ke-hoach\/ke-sach(\/|$)/, "books"],
    [/^\/ke-hoach(\/|$)/, "think_hub"],
    [/^\/ket-sat\/mat-khau(\/|$)/, "vault_passwords"],
    [/^\/ket-sat\/chung-chi(\/|$)/, "vault_certificates"],
    [/^\/ket-sat\/tai-lieu(\/|$)/, "vault_documents"],
    [/^\/ket-sat\/tai-san(\/|$)/, "vault_assets"],
    [/^\/ket-sat(\/|$)/, "finance"],
    [/^\/lien-he(\/|$)/, "contacts"],
    [/^\/cai-dat\/gop-y(\/|$)/, "feedback"],
    [/^\/cai-dat\/avora-ai(\/|$)/, "avora_ai"],
  ];
  for (const [pattern, key] of rules) if (pattern.test(pathname)) return key;
  return null;
}
