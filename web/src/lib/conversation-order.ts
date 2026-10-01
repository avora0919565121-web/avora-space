/**
 * Pinned first (in the order they were pinned), then everything else in its existing order.
 * Stable, so the rest of the list does not move.
 */
export function withPinnedFirst<T extends { conversationId: string }>(items: readonly T[], pins: ReadonlyMap<string, string>): T[] {
  if (pins.size === 0) return [...items];
  const pinned = items
    .filter((item) => pins.has(item.conversationId))
    .sort((a, b) => (pins.get(a.conversationId) ?? "").localeCompare(pins.get(b.conversationId) ?? ""));
  return [...pinned, ...items.filter((item) => !pins.has(item.conversationId))];
}
