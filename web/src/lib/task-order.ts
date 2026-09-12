import type { TaskViewMode } from "@/lib/tasks";

/** The order the three readings ship in. First one is what opens when you arrive. */
export const DEFAULT_VIEW_ORDER: readonly TaskViewMode[] = ["deadline", "relationship", "important"];

const VIEW_MODES: readonly TaskViewMode[] = ["deadline", "relationship", "important"];

export const VIEW_ORDER_STORAGE_KEY = "avora.tasks.viewOrder";
export const SHARED_ORDER_STORAGE_KEY = "avora.tasks.sharedOrder";

/**
 * Moves one entry of a list to another position, the way a dragged row lands where it was
 * dropped. Out-of-range indexes leave the list untouched rather than throwing, because a
 * drop can finish outside the list.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...list];
  if (from < 0 || from >= list.length) return [...list];
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...list];
  next.splice(to, 0, moved);
  return next;
}

/** Same move, addressed by value rather than index — what a drop between two ids means. */
export function moveBefore<T>(list: readonly T[], moved: T, target: T): T[] {
  const from = list.indexOf(moved);
  const to = list.indexOf(target);
  if (from === -1 || to === -1) return [...list];
  return moveItem(list, from, to);
}

/**
 * Repairs a stored view order. Anything unrecognised is dropped and anything missing is
 * appended in its shipped position, so a stale or hand-edited value can never leave the
 * screen with a mode it cannot show — or with none at all.
 */
export function normalizeViewOrder(raw: unknown): TaskViewMode[] {
  const seen: TaskViewMode[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const mode = entry as TaskViewMode;
      if (!VIEW_MODES.includes(mode)) continue;
      if (seen.includes(mode)) continue;
      seen.push(mode);
    }
  }
  for (const mode of DEFAULT_VIEW_ORDER) {
    if (!seen.includes(mode)) seen.push(mode);
  }
  return seen;
}

/** The reading that opens on arrival: whichever tab the person dragged to the front. */
export function defaultViewMode(order: readonly TaskViewMode[]): TaskViewMode {
  return order[0] ?? "deadline";
}

/**
 * Applies a hand-made order to a list of tasks.
 *
 * This is display order only — it says nothing about the task itself and is never sent to
 * the server. Tasks the person has never dragged keep the order they arrived in, and sit
 * after the ones they arranged, so a new arrival cannot silently jump the queue.
 */
export function applyManualOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...items];
  const ranked: T[] = [];
  const rest: T[] = [];
  const position = new Map<string, number>();
  order.forEach((id, index) => position.set(id, index));

  for (const item of items) {
    if (position.has(item.id)) ranked.push(item);
    else rest.push(item);
  }
  ranked.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return [...ranked, ...rest];
}

/**
 * Records that one task was dropped onto another. Ids not yet in the saved order are folded
 * in from the list on screen first, so the first drag of a fresh list behaves like every
 * later one.
 */
export function reorderIds(
  visibleIds: readonly string[],
  savedOrder: readonly string[],
  movedId: string,
  targetId: string,
): string[] {
  const base = applyManualOrder(
    visibleIds.map((id) => ({ id })),
    savedOrder,
  ).map((entry) => entry.id);
  return moveBefore(base, movedId, targetId);
}

/** Stored preferences are a convenience: unreadable ones fall back rather than break the page. */
export function readStoredJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch (error) {
    console.warn(`[tasks] could not read ${key}: ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  }
}

export function writeStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[tasks] could not save ${key}: ${error instanceof Error ? error.message : "unknown"}`);
  }
}
