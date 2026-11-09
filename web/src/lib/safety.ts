import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * 111-B · An toàn nội dung (ADR-093).
 *
 * The gate every signed-in screen passes through: a suspended account sees only the restricted
 * screen, an account that has not agreed to the current Điều khoản is asked once, and notices
 * (a warning, "your report was reviewed") are shown once and then acknowledged.
 */

/** Must equal `private.terms_version()` in the 111-B migration (a unit test reads both). */
export const TERMS_VERSION = "2026-11-10";

export const SUPPORT_EMAIL = "support@avorachat.com";
export const PRIVACY_EMAIL = "privacy@avorachat.com";
export const ABUSE_EMAIL = "abuse@avorachat.com";
export const SECURITY_EMAIL = "security@avorachat.com";

export type AccountNotice = { id: string; kind: "warning" | "report_reviewed"; createdAt: string };

export type AccountGate = {
  /** null = not suspended; "infinity" = suspended for good; otherwise an ISO instant. */
  suspendedUntil: string | null;
  termsVersion: string;
  termsAccepted: boolean;
  notices: AccountNotice[];
};

export const safetyKeys = {
  gate: (userId: string) => ["account-gate", userId] as const,
  opsReports: ["ops", "reports"] as const,
  opsTerms: ["ops", "blocked-terms"] as const,
  opsSupport: ["ops", "support"] as const,
};

export const NOTICE_TEXT: Record<AccountNotice["kind"], { title: string; body: string }> = {
  warning: {
    title: "Cảnh báo từ Avora",
    body: "Một báo cáo về tài khoản của bạn đã được xem xét và cho thấy vi phạm Quy tắc cộng đồng. Nếu tiếp tục, tài khoản có thể bị hạn chế.",
  },
  report_reviewed: {
    title: "Báo cáo của bạn đã được xem xét",
    body: "Cảm ơn bạn. Avora đã xem xét báo cáo bạn gửi và đã xử lý theo Quy tắc cộng đồng.",
  },
};

/** Restricted-screen headline. `until` is the gate's `suspendedUntil`. */
export function suspensionText(until: string, now: Date = new Date()): string {
  if (until === "infinity") return "Tài khoản của bạn đã bị khoá vĩnh viễn vì vi phạm Quy tắc cộng đồng.";
  const date = new Date(until);
  if (Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) return "Tài khoản của bạn đang bị hạn chế.";
  const label = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  return `Tài khoản đang bị hạn chế đến ${label}.`;
}

export const BLOCKED_TERM_MESSAGE = "Nội dung này không phù hợp với Quy tắc cộng đồng. Hãy thử cách viết khác.";

/** True when the server refused text through the public-name filter (`avora_blocked_term`). */
export function isBlockedTermError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return message.toLowerCase().includes("avora_blocked_term");
}

/** null when the answer is not a gate at all (an older server): the app then passes through. */
export function gateFrom(raw: unknown): AccountGate | null {
  if (typeof raw !== "object" || raw === null || typeof (raw as { termsVersion?: unknown }).termsVersion !== "string") return null;
  const value = raw as Partial<AccountGate>;
  return {
    suspendedUntil: typeof value.suspendedUntil === "string" ? value.suspendedUntil : null,
    termsVersion: typeof value.termsVersion === "string" ? value.termsVersion : TERMS_VERSION,
    termsAccepted: value.termsAccepted === true,
    notices: Array.isArray(value.notices) ? value.notices : [],
  };
}

export async function fetchAccountGate(): Promise<AccountGate | null> {
  const { data, error } = await supabase.rpc("my_account_gate" as never);
  if (error) {
    logError("safety-gate", { code: error.code, message: error.message });
    throw new Error("Chưa tải được trạng thái tài khoản.");
  }
  return gateFrom(data);
}

export async function acceptTerms(version: string = TERMS_VERSION): Promise<void> {
  const { error } = await supabase.rpc("accept_terms" as never, { p_version: version } as never);
  if (error) {
    logError("safety-terms", { code: error.code, message: error.message });
    throw new Error("Chưa ghi nhận được. Thử lại nhé.");
  }
}

export async function ackNotice(id: string): Promise<void> {
  const { error } = await supabase.rpc("ack_account_notice" as never, { p_id: id } as never);
  if (error) logError("safety-notice", { code: error.code, message: error.message });
}

export const SUPPORT_BODY_MAX = 2000;

export async function submitSupportRequest(input: { name: string; email: string; body: string }): Promise<void> {
  const { error } = await supabase.rpc("submit_support_request" as never, {
    p_name: input.name.trim(),
    p_email: input.email.trim(),
    p_body: input.body.trim(),
  } as never);
  if (error) {
    logError("support", { code: error.code, message: error.message });
    const text = error.message.toLowerCase();
    if (text.includes("avora_rate_limited")) throw new Error("Bạn đã gửi nhiều yêu cầu hôm nay. Hãy viết email cho chúng tôi.");
    if (text.includes("check") || error.code === "23514") throw new Error("Hãy kiểm tra lại tên, email và nội dung.");
    throw new Error("Chưa gửi được. Thử lại hoặc viết email cho chúng tôi.");
  }
}

// ───────────────────────── Ops (/quan-tri/bao-cao) ─────────────────────────

export type OpsReport = {
  id: string;
  kind: "user" | "message" | "group" | "file" | "avatar";
  reason: string;
  note: string | null;
  content: string | null;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  action: "dismiss" | "warn" | "suspend_temp" | "suspend_permanent" | null;
  createdAt: string;
  handledAt: string | null;
  reportedUserId: string | null;
  reportedName: string | null;
  groupName: string | null;
  priorCount: number;
  suspendedUntil: string | null;
};

export type OpsAction = "review" | "dismiss" | "warn" | "suspend_temp" | "suspend_permanent";

function opsError(scope: string, error: { code?: string; message: string }): Error {
  logError(scope, { code: error.code, message: error.message });
  const text = error.message.toLowerCase();
  if (text.includes("avora_not_allowed")) return new Error("Trang này chỉ dành cho nhóm vận hành Avora.");
  if (text.includes("avora_report_handled")) return new Error("Báo cáo này đã được xử lý.");
  if (text.includes("avora_report_no_person")) return new Error("Báo cáo nhóm không gắn với một người cụ thể.");
  if (text.includes("avora_report_days_invalid")) return new Error("Số ngày khoá phải từ 1 đến 365.");
  if (text.includes("avora_term_invalid")) return new Error("Từ cần 2–80 ký tự.");
  return new Error("Chưa thực hiện được. Thử lại nhé.");
}

export async function fetchOpsReports(): Promise<OpsReport[]> {
  const { data, error } = await supabase.rpc("ops_list_reports" as never);
  if (error) throw opsError("ops-reports", error);
  return (data ?? []) as unknown as OpsReport[];
}

export async function handleOpsReport(id: string, action: OpsAction, days?: number): Promise<void> {
  const { error } = await supabase.rpc("ops_handle_report" as never, { p_report_id: id, p_action: action, p_days: days ?? null } as never);
  if (error) throw opsError("ops-reports", error);
}

export type BlockedTerm = { id: number; term: string; locale: "vi" | "en"; severity: "high" | "medium" };

export async function opsBlockedTerms(
  op: "list" | "add" | "remove",
  input: { term?: string; locale?: "vi" | "en"; id?: number } = {},
): Promise<BlockedTerm[]> {
  const { data, error } = await supabase.rpc("ops_blocked_terms" as never, {
    p_op: op,
    p_term: input.term ?? null,
    p_locale: input.locale ?? null,
    p_id: input.id ?? null,
  } as never);
  if (error) throw opsError("ops-terms", error);
  return (data ?? []) as unknown as BlockedTerm[];
}

export type SupportRequest = { id: string; name: string; reply_email: string; body: string; created_at: string };

export async function fetchSupportRequests(): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from("support_requests" as never)
    .select("id,name,reply_email,body,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw opsError("ops-support", error);
  return (data ?? []) as unknown as SupportRequest[];
}
