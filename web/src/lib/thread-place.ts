/**
 * Where the reader was in each thread (AVORA-49 · 3.1): the first message on screen and how far
 * it sat from the top, kept for this browser tab only. Coming back from a Bảng or a Dự án lands
 * on the same line instead of the end. Never sent anywhere (ADR-028).
 */
export type ThreadPlace = { messageId: string; offset: number; atBottom: boolean };

const PREFIX = "avora.thread.place.";

export function readThreadPlace(conversationId: string): ThreadPlace | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + conversationId);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ThreadPlace>;
    if (typeof parsed.messageId !== "string" || typeof parsed.offset !== "number") return null;
    return { messageId: parsed.messageId, offset: parsed.offset, atBottom: parsed.atBottom === true };
  } catch {
    return null;
  }
}

export function rememberThreadPlace(conversationId: string, place: ThreadPlace): void {
  try {
    window.sessionStorage.setItem(PREFIX + conversationId, JSON.stringify(place));
  } catch {
    // Landing at the newest message is the fallback.
  }
}

export function forgetThreadPlace(conversationId: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + conversationId);
  } catch {
    // Not important enough to report.
  }
}

/** The first message whose bottom is below the top edge of the scroller: the line being read. */
export function firstVisibleMessage(scroller: HTMLElement): { messageId: string; offset: number } | null {
  const top = scroller.getBoundingClientRect().top;
  const nodes = scroller.querySelectorAll<HTMLElement>('[id^="message-"]');
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom > top + 4) return { messageId: node.id.slice("message-".length), offset: rect.top - top };
  }
  return null;
}
