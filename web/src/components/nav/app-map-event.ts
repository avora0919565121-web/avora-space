/** AVORA-100 · C (luật 4): only holding the logo A opens Toàn bộ AVORA; a held `‹` goes to the top of its tab. */
export const OPEN_APP_MAP_EVENT = "avora_open_app_map";

export function openAppMap(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_APP_MAP_EVENT));
}
