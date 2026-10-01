import { logError } from "@/lib/log";

/**
 * Cloudflare Turnstile at the way in (AVORA-56 · D).
 *
 * Off until `VITE_TURNSTILE_SITE_KEY` is set: with no key nothing is loaded, no widget is shown
 * and every auth call runs exactly as before. With a key, each call asks Turnstile for a fresh
 * token first ("managed" mode, appearance `interaction-only`: a box appears only when Cloudflare
 * is unsure) and hands it to Supabase as `captchaToken`. The secret key lives in Supabase only.
 */

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 30_000;

export function turnstileSiteKey(): string | null {
  const key = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";
  return key === "" ? null : key;
}

export function isTurnstileEnabled(): boolean {
  return turnstileSiteKey() !== null;
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading !== null) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_missing")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** A centred, initially empty holder: it only takes space if Cloudflare decides to ask. */
function holder(): HTMLDivElement {
  const element = document.createElement("div");
  element.dataset.turnstile = "true";
  element.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;";
  document.body.appendChild(element);
  return element;
}

export const CAPTCHA_FAILED_MESSAGE = "Chưa xác nhận được bạn không phải máy. Thử lại nhé.";

/**
 * A fresh token, or `undefined` when Turnstile is off. Rejects with a Vietnamese sentence when
 * it is on but could not produce one (blocked script, timeout, challenge failed).
 */
export async function getCaptchaToken(action: string): Promise<string | undefined> {
  const siteKey = turnstileSiteKey();
  if (siteKey === null || typeof window === "undefined") return undefined;

  let api: TurnstileApi;
  try {
    api = await loadTurnstile();
  } catch (error) {
    logError("turnstile", error);
    throw new Error(CAPTCHA_FAILED_MESSAGE);
  }

  const container = holder();
  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    const finish = (run: () => void): void => {
      window.clearTimeout(timer);
      if (widgetId !== null) {
        try {
          api.remove(widgetId);
        } catch {
          // already gone
        }
      }
      container.remove();
      run();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error(CAPTCHA_FAILED_MESSAGE))), TOKEN_TIMEOUT_MS);
    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        language: "vi",
        callback: (token: string) => finish(() => resolve(token)),
        "error-callback": () => finish(() => reject(new Error(CAPTCHA_FAILED_MESSAGE))),
        "expired-callback": () => finish(() => reject(new Error(CAPTCHA_FAILED_MESSAGE))),
      });
    } catch (error) {
      logError("turnstile", error);
      finish(() => reject(new Error(CAPTCHA_FAILED_MESSAGE)));
    }
  });
}
