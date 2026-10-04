/** AVORA-94B · luật 3: holding the logo A or `‹` opens Toàn bộ AVORA — from every screen. */
export const OPEN_APP_MAP_EVENT = "avora_open_app_map";

export function openAppMap(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_APP_MAP_EVENT));
}
