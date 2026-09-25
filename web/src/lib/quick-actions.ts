/**
 * The floating bubble at the top right holds an ordered list of quick actions.
 *
 * Today the list has exactly one entry, Lịch. The order is the order a chooser would show once a
 * second action exists; that chooser (and a screen to reorder the list) are not built yet.
 */
export type QuickActionId = "calendar";

export type QuickAction = {
  id: QuickActionId;
  /** Read aloud and shown as the tooltip. */
  label: string;
};

/** In display order. */
export const QUICK_ACTIONS: readonly QuickAction[] = [{ id: "calendar", label: "Xem lịch" }];

/**
 * What a tap on the bubble opens.
 *
 * With a single action the tap goes straight to it, on touch and on desktop alike. With more than
 * one it returns null: the chooser that would handle that case does not exist yet.
 */
export function directQuickAction(actions: readonly QuickAction[]): QuickAction | null {
  return actions.length === 1 ? actions[0] : null;
}
