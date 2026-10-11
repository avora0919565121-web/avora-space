import { supabase } from "@/integrations/supabase/client";
import { redrawImage, redrawnExt } from "@/lib/redraw-image";

/**
 * AVORA-100 · PHẦN G — Góp ý cho Avora, inside the app and at `/gop-y`.
 *
 * What travels with a note is only about the app and the device (version, browser, screen size,
 * the page path without its query, language) — never a message, a name, or anything on the page.
 */
export type FeedbackKind = "loi" | "y_tuong" | "kho_dung";
export type FeedbackStatus = "moi" | "dang_xem" | "da_lam" | "khong_lam";

export const FEEDBACK_KINDS: readonly { id: FeedbackKind; label: string }[] = [
  { id: "loi", label: "Lỗi" },
  { id: "y_tuong", label: "Ý tưởng" },
  { id: "kho_dung", label: "Khó dùng" },
];

export const FEEDBACK_MAX_CHARS = 2000;
export const FEEDBACK_SHOT_MAX_BYTES = 5 * 1024 * 1024;
const SHOT_SIDE = 1600;

/** What the sender sees for their own notes; the team sees all four. */
export function feedbackStatusLabel(status: FeedbackStatus, forTeam: boolean = false): string {
  if (status === "moi") return forTeam ? "Mới" : "Đã gửi";
  if (status === "dang_xem") return "Đang xem";
  if (status === "da_lam") return "Đã làm";
  return forTeam ? "Không làm" : "Đã xem";
}

export function feedbackKindLabel(kind: FeedbackKind): string {
  return FEEDBACK_KINDS.find((k) => k.id === kind)?.label ?? "Góp ý";
}

declare const __AVORA_VERSION__: string | undefined;

/** `1.0.0+2026-10-11` in a build; `dev` in tests. */
export function appVersion(): string {
  return typeof __AVORA_VERSION__ === "string" ? __AVORA_VERSION__ : "dev";
}

/** A short, human name for the browser and system — not the full user-agent string. */
export function describeDevice(userAgent: string): string {
  const ua = userAgent;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? `iOS ${(/OS (\d+)[_.](\d+)/.exec(ua) ?? []).slice(1, 3).join(".")}`.trim()
    : /Android (\d+)/.test(ua)
      ? `Android ${/Android (\d+)/.exec(ua)?.[1] ?? ""}`
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Khác";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Trình duyệt khác";
  const installed = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches ? " · đã cài" : "";
  return `${browser} · ${os}${installed}`;
}

/** The page path, query dropped entirely (`tu` and anything else may carry ids or words). */
export function feedbackPage(pathname: string): string {
  return pathname.split("?")[0].split("#")[0].slice(0, 300) || "/";
}

export type FeedbackContext = { page: string; appVersion: string; device: string; screen: string; locale: string };

export function feedbackContext(pathname: string): FeedbackContext {
  return {
    page: feedbackPage(pathname),
    appVersion: appVersion(),
    device: describeDevice(typeof navigator !== "undefined" ? navigator.userAgent : ""),
    screen: typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight}` : "",
    locale: typeof document !== "undefined" ? document.documentElement.lang || "vi" : "vi",
  };
}

/** Why a screenshot cannot go, or null. Pictures only; redrawn before upload (EXIF dropped). */
export function feedbackShotRejection(file: { size: number; type: string }): string | null {
  if (!file.type.startsWith("image/")) return "Chỉ đính kèm được ảnh màn hình.";
  if (file.size > FEEDBACK_SHOT_MAX_BYTES * 4) return "Ảnh quá lớn (tối đa 5 MB sau khi thu nhỏ).";
  return null;
}

export type FeedbackDraft = { kind: FeedbackKind; body: string; shot: File | null };

const ERRORS: Record<string, string> = {
  avora_rate_limited: "Bạn vừa gửi nhiều góp ý liền. Thử lại sau ít phút nhé.",
  avora_attachment_too_large: "Ảnh quá lớn (tối đa 5 MB).",
  avora_attachment_blocked: "Chỉ đính kèm được ảnh màn hình.",
};

function friendly(message: string | undefined): string {
  const key = Object.keys(ERRORS).find((k) => (message ?? "").includes(k));
  return key !== undefined ? ERRORS[key] : "Chưa gửi được góp ý. Thử lại nhé.";
}

/** In the app: the screenshot goes to my own folder first, then the note references it. */
export async function submitFeedback(userId: string, draft: FeedbackDraft, ctx: FeedbackContext): Promise<string> {
  let path: string | null = null;
  if (draft.shot !== null) {
    const blob = await redrawImage(draft.shot, SHOT_SIDE, 0.8);
    if (blob.size > FEEDBACK_SHOT_MAX_BYTES) throw new Error("Ảnh quá lớn (tối đa 5 MB).");
    path = `${userId}/${crypto.randomUUID()}.${redrawnExt(blob)}`;
    const { error } = await supabase.storage.from("feedback-shots").upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error("Chưa tải được ảnh lên. Thử lại nhé.");
  }
  const { data, error } = await supabase.rpc("submit_feedback" as never, {
    p_kind: draft.kind,
    p_body: draft.body.trim(),
    p_page: ctx.page,
    p_app_version: ctx.appVersion,
    p_device: ctx.device,
    p_screen: ctx.screen,
    p_locale: ctx.locale,
    p_attachment_path: path,
  } as never);
  if (error) {
    if (path !== null) await supabase.storage.from("feedback-shots").remove([path]);
    throw new Error(friendly(error.message));
  }
  return String(data);
}

/** `/gop-y`: no sign-in, no picture. `trap` is the hidden field a person never fills. */
export async function submitPublicFeedback(input: { kind: FeedbackKind; body: string; email: string; trap: string }, ctx: FeedbackContext): Promise<void> {
  const { error } = await supabase.rpc("submit_public_feedback" as never, {
    p_kind: input.kind,
    p_body: input.body.trim(),
    p_email: input.email.trim() === "" ? null : input.email.trim(),
    p_trap: input.trap,
    p_page: ctx.page,
    p_app_version: ctx.appVersion,
    p_device: ctx.device,
    p_screen: ctx.screen,
    p_locale: ctx.locale,
  } as never);
  if (error) throw new Error(friendly(error.message));
}

export type FeedbackRow = {
  id: string;
  user_id: string | null;
  kind: FeedbackKind;
  body: string;
  page: string | null;
  app_version: string | null;
  device: string | null;
  screen: string | null;
  locale: string | null;
  attachment_path: string | null;
  email: string | null;
  source: "app" | "web";
  status: FeedbackStatus;
  created_at: string;
};

export const feedbackKeys = {
  mine: (userId: string) => ["feedback", "mine", userId] as const,
  all: ["feedback", "all"] as const,
  ops: (userId: string) => ["feedback", "am-i-ops", userId] as const,
  invites: ["invite-codes"] as const,
};

/** RLS answers: my own notes, or — for the team — everyone's. */
export async function fetchFeedback(onlyUserId: string | null): Promise<FeedbackRow[]> {
  let query = supabase.from("feedback" as never).select("*").order("created_at", { ascending: false }).limit(200);
  if (onlyUserId !== null) query = query.eq("user_id" as never, onlyUserId as never);
  const { data, error } = await query;
  if (error) throw new Error("Chưa tải được góp ý.");
  return (data ?? []) as unknown as FeedbackRow[];
}

export async function amIOps(): Promise<boolean> {
  const { data, error } = await supabase.rpc("am_i_ops" as never);
  if (error) return false;
  return data === true;
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  const { error } = await supabase.rpc("set_feedback_status" as never, { p_id: id, p_status: status } as never);
  if (error) throw new Error("Chưa đổi được trạng thái.");
}
