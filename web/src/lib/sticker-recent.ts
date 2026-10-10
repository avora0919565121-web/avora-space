import { STICKERS } from "@/lib/stickers";

/** K5: the last 8 stickers sent from this device (the tray's Gần đây). */
const RECENT_KEY = "avora.stickers.recent.v1";

export function readRecentStickers(): string[] {
  try {
    return (window.localStorage.getItem(RECENT_KEY) ?? "").split(",").filter((id) => STICKERS.some((s) => s.id === id)).slice(0, 8);
  } catch {
    return [];
  }
}

export function rememberSticker(id: string): void {
  try {
    const next = [id, ...readRecentStickers().filter((item) => item !== id)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, next.join(","));
  } catch {
    // Not remembered on this device.
  }
}

