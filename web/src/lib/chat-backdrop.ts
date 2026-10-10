import { useSyncExternalStore } from "react";

/**
 * 101B · 4 — Nền trò chuyện, the person's own choice for every chat on this device.
 * A conversation's shared backdrop from Không khí (K5) wins over this when one is set.
 * Pure CSS from colour tokens (light / dark / every tone), no images.
 */
export type ChatBackdrop = "tron" | "cham-bi" | "giay";

export const CHAT_BACKDROPS: readonly { value: ChatBackdrop; label: string }[] = [
  { value: "tron", label: "Trơn" },
  { value: "cham-bi", label: "Chấm bi" },
  { value: "giay", label: "Giấy" },
];
export const DEFAULT_CHAT_BACKDROP: ChatBackdrop = "tron";
const STORAGE_KEY = "avora.chat-backdrop.v1";
const listeners = new Set<() => void>();

export function isChatBackdrop(value: unknown): value is ChatBackdrop {
  return value === "tron" || value === "cham-bi" || value === "giay";
}

export function readChatBackdrop(): ChatBackdrop {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isChatBackdrop(stored) ? stored : DEFAULT_CHAT_BACKDROP;
  } catch {
    return DEFAULT_CHAT_BACKDROP;
  }
}

export function writeChatBackdrop(value: ChatBackdrop): void {
  try {
    if (value === DEFAULT_CHAT_BACKDROP) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Not remembered on this device; the choice still applies until reload.
  }
  listeners.forEach((listener) => listener());
}

export function useChatBackdrop(): ChatBackdrop {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readChatBackdrop,
    () => DEFAULT_CHAT_BACKDROP,
  );
}

/** The class that draws a backdrop on the thread's scroll area. */
export function chatBackdropClass(value: string | null | undefined): string {
  return value !== null && value !== undefined && value !== "tron" ? `chat-backdrop chat-backdrop-${value}` : "";
}
