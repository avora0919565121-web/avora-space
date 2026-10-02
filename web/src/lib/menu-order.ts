/**
 * AVORA-71: one source of order for every menu of its kind — Nhật ký của tôi, 1-1, Nhóm, Dự án.
 *
 * Rules: what is used most comes first, restrictive actions come last in red behind a divider;
 * an entry that does not apply is hidden and the rest keep their relative places; nothing is ever
 * re-sorted per person, so the hand learns where things are.
 */

export type MessageMenuAction =
  | "reply"
  | "forward"
  | "copy"
  | "task"
  | "save-journal"
  | "save-image"
  | "later"
  | "pin"
  | "unpin"
  | "select"
  | "edit"
  | "details"
  | "recall"
  | "request-recall"
  | "delete"
  | "report";

export type MessageMenuGroup = "answer" | "keep" | "arrange" | "own" | "restrict";

/** 71 · B: ① Đáp lại ② Biến thành việc / giữ lại ③ Sắp xếp ④ Của tin này ⑤ Hạn chế. */
export const MESSAGE_MENU_ORDER: readonly { action: MessageMenuAction; group: MessageMenuGroup }[] = [
  { action: "reply", group: "answer" },
  { action: "forward", group: "answer" },
  { action: "copy", group: "answer" },
  { action: "task", group: "keep" },
  { action: "save-journal", group: "keep" },
  { action: "save-image", group: "keep" },
  { action: "later", group: "keep" },
  { action: "pin", group: "arrange" },
  { action: "unpin", group: "arrange" },
  { action: "select", group: "arrange" },
  { action: "edit", group: "own" },
  { action: "details", group: "own" },
  { action: "recall", group: "restrict" },
  { action: "request-recall", group: "restrict" },
  { action: "delete", group: "restrict" },
  { action: "report", group: "restrict" },
];

export const MESSAGE_MENU_GROUPS: readonly MessageMenuGroup[] = ["answer", "keep", "arrange", "own", "restrict"];

/** The actions that apply, in the one order. */
export function orderMessageActions(shown: ReadonlySet<MessageMenuAction>): MessageMenuAction[] {
  return MESSAGE_MENU_ORDER.filter((entry) => shown.has(entry.action)).map((entry) => entry.action);
}

export function messageActionGroup(action: MessageMenuAction): MessageMenuGroup {
  return MESSAGE_MENU_ORDER.find((entry) => entry.action === action)?.group ?? "own";
}

// ------------------------------------------------------------------ the ⋯ of a conversation (71 · C)

export type ConversationKind = "journal" | "direct" | "group" | "project";

export type ConversationMenuItem =
  | "quick"
  | "pending"
  | "tasks"
  | "boards"
  | "diary"
  | "pins"
  | "members"
  | "invite"
  | "projects"
  | "decisions"
  | "schedule-call"
  | "archive"
  | "trash"
  | "block"
  | "report"
  | "leave"
  | "propose-delete";

export type ConversationMenuSection = "head" | "pending" | "work" | "room" | "more" | "restrict";

/** 71 · C: one order for Nhật ký của tôi · 1-1 · Nhóm · Dự án; each kind only drops what it lacks. */
export const CONVERSATION_MENU_ORDER: readonly { item: ConversationMenuItem; section: ConversationMenuSection; kinds: readonly ConversationKind[] }[] = [
  { item: "quick", section: "head", kinds: ["journal", "direct", "group", "project"] },
  { item: "pending", section: "pending", kinds: ["direct", "group", "project"] },
  { item: "tasks", section: "work", kinds: ["journal", "direct", "group", "project"] },
  { item: "boards", section: "work", kinds: ["journal", "direct", "group", "project"] },
  { item: "diary", section: "work", kinds: ["journal", "direct", "group", "project"] },
  { item: "pins", section: "work", kinds: ["journal", "direct", "group", "project"] },
  { item: "members", section: "room", kinds: ["group", "project"] },
  { item: "invite", section: "room", kinds: ["group", "project"] },
  { item: "projects", section: "room", kinds: ["group"] },
  { item: "decisions", section: "room", kinds: ["group", "project"] },
  { item: "schedule-call", section: "more", kinds: ["direct", "group", "project"] },
  { item: "archive", section: "more", kinds: ["direct", "group", "project"] },
  { item: "trash", section: "more", kinds: ["journal", "direct", "group", "project"] },
  { item: "block", section: "restrict", kinds: ["direct"] },
  { item: "report", section: "restrict", kinds: ["direct", "group", "project"] },
  { item: "leave", section: "restrict", kinds: ["group", "project"] },
  { item: "propose-delete", section: "restrict", kinds: ["group"] },
];

/** The ⋯ items for one kind of conversation, in order. */
export function conversationMenuItems(kind: ConversationKind): ConversationMenuItem[] {
  return CONVERSATION_MENU_ORDER.filter((entry) => entry.kinds.includes(kind)).map((entry) => entry.item);
}
