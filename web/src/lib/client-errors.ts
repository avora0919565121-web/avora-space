import { APP_VERSION } from "@/lib/app-version";

/**
 * 112-F · lỗi từ máy người dùng → `client_errors` (chỉ đội Avora đọc). Only what `lib/log.ts` already lets out:
 * the scope, a machine code, the error class — never message text, names, emails or message content. The
 * route keeps its shape, not its ids. One report per distinct error per session; at most 20 an hour from
 * this device (the server keeps its own limit too). A failed report is dropped quietly: reporting must never
 * become a second failure the person sees.
 */
export type ClientErrorReport = { scope: string; code: string; name: string | null };

const SENT = new Set<string>();
const recent: number[] = [];
const HOURLY_LIMIT = 20;

/** FNV-1a, hex — a stable fingerprint of scope + code + class (no stack text leaves the device). */
export function stackHash(report: ClientErrorReport): string {
  let hash = 0x811c9dc5;
  for (const char of `${report.scope}|${report.code}|${report.name ?? ""}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** `/tin-nhan/<uuid>?q=…` → `/tin-nhan/:id` (the server does it again). */
export function routeShape(pathname: string): string {
  return pathname
    .split("?")[0]
    .split("#")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/[0-9]{3,}/g, ":id")
    .slice(0, 120);
}

export function platformName(): string {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

let clientModule: Promise<typeof import("@/integrations/supabase/client")> | null = null;
/** One shared import of the client, made on the first report. */
function loadClient(): Promise<typeof import("@/integrations/supabase/client")> {
  clientModule ??= import("@/integrations/supabase/client");
  return clientModule;
}

/** Scopes that are about the report itself (never reported, or a failure would report itself forever). */
const SILENT_SCOPES = new Set(["client-errors"]);

export function reportClientError(report: ClientErrorReport, now: number = Date.now()): boolean {
  try {
    if (SILENT_SCOPES.has(report.scope)) return false;
    const hash = stackHash(report);
    if (SENT.has(hash)) return false;
    while (recent.length > 0 && now - recent[0] > 3_600_000) recent.shift();
    if (recent.length >= HOURLY_LIMIT) return false;
    SENT.add(hash);
    recent.push(now);
    const pathname = typeof window !== "undefined" && window.location !== undefined ? window.location.pathname : "/";
    const args = {
      p_app_version: APP_VERSION,
      p_platform: platformName(),
      p_route: routeShape(pathname),
      p_error_name: report.scope,
      p_message_short: `${report.code}${report.name !== null && report.name !== "Error" ? ` ${report.name}` : ""}`.slice(0, 120),
      p_stack_hash: hash,
    };
    // Loaded on first use: logging must never be what creates (or breaks for want of) the client.
    void loadClient()
      .then(({ supabase }) => supabase.rpc("log_client_error" as never, args as never))
      .catch(() => undefined);
    return true;
  } catch {
    // Reporting is never a second failure.
    return false;
  }
}

/** For tests: forget what this session already sent. */
export function resetClientErrorReportsForTests(): void {
  SENT.clear();
  recent.length = 0;
}
