/**
 * The floating bubble at the top right holds an ordered list of quick actions.
 *
 * Lịch first (what a quick tap opens on a phone), then the two capture shortcuts added in AVORA-35 —
 * a task from whatever was just copied, and a quick transaction — then Avora AI, still only a door
 * that names what is coming and holds no conversation yet.
 * With more than one action a tap opens a short chooser in this order; a screen to reorder the
 * list is not built.
 */
export type QuickActionId = "calendar" | "paste-task" | "quick-transaction" | "assistant";

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
  { id: "paste-task", label: "Tạo việc từ nội dung copy", note: "Dán chữ, ảnh hoặc tệp bạn vừa copy", isUpcoming: false },
  { id: "quick-transaction", label: "Tạo giao dịch nhanh", note: "Ghi thu/chi ngay, chọn sổ", isUpcoming: false },
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

/**
 * On a phone the bubble answers a tap and a hold differently, as the logo does: a quick tap
 * opens the first action straight away (Lịch), and only a hold opens the chooser.
 */
export function tapQuickAction(actions: readonly QuickAction[]): QuickAction | null {
  return actions[0] ?? null;
}

/** How long the bubble must be held on a phone before the chooser opens instead of Lịch. */
export const BUBBLE_HOLD_MS = 500;
