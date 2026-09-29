import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * AVORA-46 — this device's push subscription. The public VAPID key is public by design (the
 * browser hands it to its push service); the private half lives only in the Edge Function secret
 * AVORA_VAPID_KEYS.
 */
const DEFAULT_VAPID_PUBLIC_KEY = "BG9JkWzxyGf8mWqWVfipfftTZBO15TlAHjaHwtpHOrhxJwIK8-Qo0ZhEx5b3InIKYlfC4iEG9WzcGb851FS2wX0";
export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? DEFAULT_VAPID_PUBLIC_KEY;

export type PushSupport = "supported" | "unsupported" | "ios-needs-install";

type NavigatorLike = { userAgent: string; maxTouchPoints?: number; standalone?: boolean };

export function isIos(nav: NavigatorLike): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}

/** iPhone / iPad: web push only once AVORA is on the Home Screen (iOS 16.4+). */
export function pushSupport(
  env: { nav: NavigatorLike; hasPushManager: boolean; hasNotification: boolean; hasServiceWorker: boolean; isStandalone: boolean },
): PushSupport {
  if (isIos(env.nav) && !env.isStandalone) return "ios-needs-install";
  if (!env.hasPushManager || !env.hasNotification || !env.hasServiceWorker) return "unsupported";
  return "supported";
}

export function currentPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return pushSupport({
    nav: navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    hasServiceWorker: "serviceWorker" in navigator,
    isStandalone: standalone,
  });
}

/** "Chrome · Windows" — enough to tell one's own devices apart, nothing more. */
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Trình duyệt";
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iPhone/iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os === "" ? browser : `${browser} · ${os}`;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (currentPushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Only ever called after the person pressed "Bật" — the browser prompt follows their tap. */
export async function enablePush(): Promise<"granted" | "denied" | "unsupported"> {
  if (currentPushSupport() !== "supported") return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource }));
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_device_label: deviceLabel(navigator.userAgent),
  });
  if (error) {
    logError("push", { code: error.code, message: error.message });
    throw new Error("Chưa lưu được thiết bị này. Thử lại sau.");
  }
  return "granted";
}

/** Off on this device: the server forgets it and the browser subscription ends. */
export async function disablePushHere(): Promise<void> {
  const sub = await currentSubscription();
  if (sub === null) return;
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
  if (error) logError("push", { code: error.code, message: error.message });
  await sub.unsubscribe().catch(() => undefined);
}

export type PushDevice = { id: string; endpoint: string; deviceLabel: string; createdAt: string; lastOkAt: string | null };

export async function fetchPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, device_label, created_at, last_ok_at")
    .order("created_at", { ascending: false });
  if (error) {
    logError("push", { code: error.code, message: error.message });
    throw new Error("Chưa tải được danh sách thiết bị.");
  }
  return (data ?? []).map((row) => ({ id: row.id, endpoint: row.endpoint, deviceLabel: row.device_label, createdAt: row.created_at, lastOkAt: row.last_ok_at }));
}

export async function removePushDevice(endpoint: string): Promise<void> {
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  if (error) throw new Error("Chưa gỡ được thiết bị.");
  const here = await currentSubscription();
  if (here?.endpoint === endpoint) await here.unsubscribe().catch(() => undefined);
}

/** Once a conversation is read here, its notification on this device goes away (same tag). */
export async function closeNotificationsFor(tag: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const shown = (await reg?.getNotifications({ tag })) ?? [];
    shown.forEach((item) => item.close());
  } catch {
    // Not worth a message.
  }
}

// ------------------------------------------------------------------ when to ask
const ASK_KEY = "avora.push.ask";
export const ASK_AGAIN_DAYS = 7;

export type AskState = { laterAt: string | null };

export function readAskState(): AskState {
  try {
    const raw = window.localStorage.getItem(ASK_KEY);
    return raw === null ? { laterAt: null } : (JSON.parse(raw) as AskState);
  } catch {
    return { laterAt: null };
  }
}

export function rememberAskLater(now: Date = new Date()): void {
  try {
    window.localStorage.setItem(ASK_KEY, JSON.stringify({ laterAt: now.toISOString() }));
  } catch {
    // Asked again next time.
  }
}

/**
 * The card shows after a first message sent or a first reminder set — never on opening the app;
 * never again once the browser said no; "Để sau" waits 7 days.
 */
export function shouldOfferPush(input: {
  support: PushSupport;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  laterAt: string | null;
  now?: Date;
}): boolean {
  if (input.support === "unsupported") return false;
  if (input.subscribed) return false;
  if (input.permission === "denied") return false;
  if (input.laterAt !== null) {
    const waited = (input.now ?? new Date()).getTime() - new Date(input.laterAt).getTime();
    if (waited < ASK_AGAIN_DAYS * 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

export const PUSH_OFFER_EVENT = "avora:push-offer";

/** Called after the first sent message / first reminder: the card decides whether to show. */
export function offerPushSoon(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_OFFER_EVENT));
}
