/**
 * The floating bubble at the top right holds an ordered list of quick actions.
 *
 * Two entries now: Lịch, then Avora AI — the assistant that used to be pictured behind the logo.
 * The assistant is only a door so far: it names what is coming and holds no conversation yet.
 * With more than one action a tap opens a short chooser in this order; a screen to reorder the
 * list is not built.
 */
export type QuickActionId = "calendar" | "assistant";

export type QuickAction = {
  id: QuickActionId;
  /** Read aloud and shown as the tooltip. */
  label: string;
  /** Said under the label in the chooser. */
  note: string;
  /** Named but not built: the chooser marks it "Sắp ra mắt". */
  isUpcoming: boolean;
};

/** In display order. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "calendar", label: "Xem lịch", note: "Hôm nay và những ngày tới", isUpcoming: false },
  { id: "assistant", label: "Avora AI", note: "Trợ lý riêng của bạn", isUpcoming: true },
];

/**
 * What a tap on the bubble opens.
 *
 * With a single action the tap goes straight to it. With more than one it returns null and the
 * bubble shows the chooser instead of guessing.
 */
export function directQuickAction(actions: readonly QuickAction[]): QuickAction | null {
  return actions.length === 1 ? actions[0] : null;
}
