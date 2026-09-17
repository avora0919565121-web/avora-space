/**
 * Pure chat helpers: shapes, cache reducers and Vietnamese time formatting.
 * Deliberately free of the Supabase client so this logic stays unit-testable.
 */

/** What a thread is: a 1-1, a group, or the viewer's own journal. */
export type ConversationKind = "direct" | "group" | "personal";

/** One row of the inbox: a conversation plus its resolved peer and last message. */
export type ConversationSummary = {
  conversationId: string;
  kind: ConversationKind;
  peerId: string | null;
  peerName: string;
  peerEmail: string | null;
  /** Set for a group; a 1-1 and a journal are named by their people instead. */
  groupName: string | null;
  memberCount: number;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  lastMessageSenderId: string | null;
  /** Messages from the peer newer than the viewer's read watermark. */
  unreadCount: number;
  /** How far the peer has read this thread — powers the "Đã xem" receipt. */
  peerLastReadAt: string | null;
  sortAt: string;
};

/** The directions Tin nhắn is split into. "email" is named in the strip but not built yet. */
export type MessageTab = "journal" | "direct" | "group" | "projects" | "email";

export const MESSAGE_TABS: readonly { readonly id: MessageTab; readonly label: string }[] = [
  { id: "journal", label: "Nhật ký" },
  { id: "direct", label: "1-1" },
  { id: "group", label: "Nhóm" },
  { id: "projects", label: "Dự án" },
  { id: "email", label: "Email" },
];

/** The tabs that exist only as a promise in the strip, with no function behind them yet. */
export const PLACEHOLDER_TABS: readonly MessageTab[] = ["email"];

export function isPlaceholderTab(tab: MessageTab): tab is "email" {
  return PLACEHOLDER_TABS.includes(tab);
}

/**
 * Whether a tab lists projects rather than conversations.
 *
 * Dự án reads from its own query, not from the inbox: a project is not a thread, so it has no
 * last message, no unread count and no place in `filterConversationsByTab`. The tab still
 * belongs in the same strip because that is where people look for the work they share with
 * someone — but everything below the strip comes from elsewhere.
 */
export function isProjectTab(tab: MessageTab): tab is "projects" {
  return tab === "projects";
}

export const JOURNAL_TITLE = "Nhật ký của bạn";
export const JOURNAL_SUBTITLE = "Chỉ mình bạn đọc được";

/** Which tab a thread belongs under. */
export function tabOfKind(kind: ConversationKind): MessageTab {
  if (kind === "personal") return "journal";
  if (kind === "group") return "group";
  return "direct";
}

/**
 * What to call a thread in the list and in its header. A group carries its own name, a journal
 * is addressed to the viewer, and a 1-1 is named after the other person.
 */
export function conversationTitle(summary: ConversationSummary): string {
  if (summary.kind === "personal") return JOURNAL_TITLE;
  if (summary.kind === "group") return summary.groupName ?? "Nhóm";
  return summary.peerName;
}

/** The second line under the title: who else is in the room. */
export function conversationSubtitle(summary: ConversationSummary): string {
  if (summary.kind === "personal") return JOURNAL_SUBTITLE;
  if (summary.kind === "group") return `${summary.memberCount} thành viên`;
  return summary.peerEmail ?? "Người dùng AVORA";
}

/** The rows belonging to one tab, keeping the server's recency order. */
export function filterConversationsByTab(
  inbox: ConversationSummary[],
  tab: MessageTab,
): ConversationSummary[] {
  return inbox.filter((item) => tabOfKind(item.kind) === tab);
}

/** Unread total for one tab, so each tab can carry its own badge. */
export function unreadForTab(inbox: ConversationSummary[], tab: MessageTab): number {
  return filterConversationsByTab(inbox, tab).reduce((sum, item) => sum + item.unreadCount, 0);
}

/**
 * Inbox search: matches the thread's own name, the peer's email, or the last message.
 * An empty query matches everything.
 */
export function matchesConversationQuery(summary: ConversationSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    conversationTitle(summary).toLowerCase().includes(needle) ||
    (summary.peerEmail ?? "").toLowerCase().includes(needle) ||
    (summary.lastMessageContent ?? "").toLowerCase().includes(needle)
  );
}

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  /**
   * When the wording was corrected, or null if it never was.
   *
   * Shown on the bubble on purpose. A silent edit would let someone change what they are on
   * record as having said, which is a worse problem than the typo it fixes.
   */
  editedAt?: string | null;
  /**
   * When the message was withdrawn. The row survives so replies quoting it still have
   * something to point at, but `content` is genuinely empty by then — the server destroys
   * the text rather than hiding it.
   */
  deletedAt?: string | null;
  /** The message this one answers, or null for an ordinary message. */
  replyToMessageId?: string | null;
  /**
   * Who this message specifically asks, by id.
   *
   * Ids rather than the text "@Minh": display names change, so re-reading the words later
   * could resolve to a different person or to nobody. The mute rules need an exact answer to
   * "was I named in this?", and an empty array means "nobody was" — never "we did not record".
   */
  mentionedUserIds?: string[];
  /** True while an optimistic bubble is still being written to the server. */
  pending?: boolean;
};

/** Stands in for the words of a withdrawn message, wherever they would have been shown. */
export const RECALLED_MESSAGE_NOTE = "Tin nhắn đã được thu hồi.";

/** True once a message has been taken back. */
export function isRecalled(message: Pick<ChatMessage, "deletedAt">): boolean {
  return message.deletedAt !== null && message.deletedAt !== undefined;
}

/** True once its wording was corrected — and not merely withdrawn. */
export function isEdited(message: Pick<ChatMessage, "editedAt" | "deletedAt">): boolean {
  if (isRecalled(message)) return false;
  return message.editedAt !== null && message.editedAt !== undefined;
}

/**
 * What a bubble should read. A withdrawn message shows the note in place of its words, which
 * is why every surface asks this rather than reading `content` directly.
 */
export function messageBodyText(message: Pick<ChatMessage, "content" | "deletedAt">): string {
  return isRecalled(message) ? RECALLED_MESSAGE_NOTE : message.content;
}

/** How long a message stays yours to correct or take back. Mirrors the database's own window. */
export const MESSAGE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the window is still open.
 *
 * The database enforces this independently — an expired edit is refused even when called
 * directly — so this only decides whether to offer the action rather than hiding a rule the
 * server does not keep.
 */
export function isWithinEditWindow(
  message: Pick<ChatMessage, "createdAt">,
  now: Date = new Date(),
): boolean {
  const age = now.getTime() - new Date(message.createdAt).getTime();
  return age >= 0 && age <= MESSAGE_EDIT_WINDOW_MS;
}

/** Correcting your own words: yours, still live, still inside the window. */
export function canEditMessage(
  message: ChatMessage,
  viewerId: string | undefined,
  now: Date = new Date(),
): boolean {
  if (viewerId === undefined || message.senderId !== viewerId) return false;
  if (message.pending === true || isRecalled(message)) return false;
  return isWithinEditWindow(message, now);
}

/**
 * Taking your own message back. Same window as editing, and an already-withdrawn message has
 * nothing left to withdraw.
 */
export function canRecallMessage(
  message: ChatMessage,
  viewerId: string | undefined,
  now: Date = new Date(),
): boolean {
  if (viewerId === undefined || message.senderId !== viewerId) return false;
  if (message.pending === true || isRecalled(message)) return false;
  return isWithinEditWindow(message, now);
}

/**
 * Anyone in the room may answer any message, including a withdrawn one — replying to the gap
 * where something was said is a legitimate thing to do, and the quote block says as much.
 * A message still in flight has no id to point at yet.
 */
export function canReplyToMessage(message: ChatMessage): boolean {
  return message.pending !== true;
}

/** How a search result is labelled in the list, and what the query matched. */
export const MESSAGE_SEARCH_KEY = "message-search";

/**
 * Where the match sits inside a message, so the result can show the words around it.
 *
 * A result that shows only the first 80 characters of a long message often fails to include
 * the thing that was searched for, which makes the list unreadable. This finds the match and
 * keeps a window around it instead.
 */
export function matchExcerpt(
  content: string,
  query: string,
  radius: number = 40,
): { text: string; matchStart: number; matchLength: number } {
  const flat = content.replace(/\s+/g, " ").trim();
  const needle = query.trim();
  if (needle === "") return { text: flat, matchStart: -1, matchLength: 0 };

  const at = flat.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (at === -1) return { text: flat, matchStart: -1, matchLength: 0 };

  const from = Math.max(0, at - radius);
  const to = Math.min(flat.length, at + needle.length + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < flat.length ? "…" : "";

  return {
    text: `${prefix}${flat.slice(from, to)}${suffix}`,
    matchStart: at - from + prefix.length,
    matchLength: needle.length,
  };
}

/** Whether a query is worth sending. One character matches most of a thread. */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;

export function isSearchable(query: string): boolean {
  return query.trim().length >= MESSAGE_SEARCH_MIN_LENGTH;
}

/** The short version of a quoted message, for the block above a reply. */
export function quotePreview(
  message: Pick<ChatMessage, "content" | "deletedAt">,
  maxLength: number = 80,
): string {
  const text = messageBodyText(message);
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length <= maxLength ? flattened : `${flattened.slice(0, maxLength - 1)}…`;
}

/**
 * Normalises a Postgres timestamp to ISO.
 * Realtime replays the raw WAL text (`2026-09-05 10:00:00.123456+00`), while PostgREST
 * returns ISO — the two must be comparable before they land in the same cache.
 */
export function toIsoTimestamp(value: string): string {
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  for (const candidate of [normalized, value]) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  console.error(`[chat] unparsable timestamp: ${value}`);
  return new Date().toISOString();
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
}

/**
 * Adds a realtime message to a cached thread, keeping server order.
 * Ignores replayed duplicates and retires the matching optimistic bubble
 * (one bubble only, so sending the same word twice keeps both).
 */
export function mergeIncomingMessage(thread: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (thread.some((message) => message.id === incoming.id)) return thread;

  const pendingIndex = thread.findIndex(
    (message) =>
      message.pending === true && message.senderId === incoming.senderId && message.content === incoming.content,
  );
  const next = pendingIndex === -1 ? [...thread] : thread.filter((_, index) => index !== pendingIndex);
  next.push(incoming);
  return next.sort(compareMessages);
}

/**
 * Replaces a cached message with the server's newer version of itself.
 *
 * An edit and a recall both arrive as UPDATEs rather than new messages, so they patch in
 * place instead of appending. Returns the same array when the id is not cached, which is the
 * ordinary case for a thread nobody has open.
 */
export function applyMessageUpdate(thread: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = thread.findIndex((message) => message.id === incoming.id);
  if (index === -1) return thread;
  const current = thread[index];
  if (
    current.content === incoming.content &&
    (current.editedAt ?? null) === (incoming.editedAt ?? null) &&
    (current.deletedAt ?? null) === (incoming.deletedAt ?? null)
  )
    return thread;
  const next = [...thread];
  // `pending` is a client-only flag and the server knows nothing about it, so it is dropped
  // rather than carried: a row coming back from the database has plainly been written.
  next[index] = { ...current, ...incoming, pending: undefined };
  return next;
}

/**
 * Keeps the inbox preview honest after an edit or a recall.
 *
 * Only touched when the changed message is the one being previewed — editing something from
 * last Tuesday must not overwrite the line showing what was said a minute ago.
 */
export function applyMessageEditToInbox(
  inbox: ConversationSummary[],
  incoming: ChatMessage,
): ConversationSummary[] {
  const index = inbox.findIndex((item) => item.conversationId === incoming.conversationId);
  if (index === -1) return inbox;
  const current = inbox[index];
  if (current.lastMessageAt === null) return inbox;
  const isPreviewed =
    new Date(current.lastMessageAt).getTime() === new Date(incoming.createdAt).getTime() &&
    current.lastMessageSenderId === incoming.senderId;
  if (!isPreviewed) return inbox;

  const next = [...inbox];
  next[index] = { ...current, lastMessageContent: messageBodyText(incoming) };
  return next;
}

function sortByRecency(inbox: ConversationSummary[]): ConversationSummary[] {
  return [...inbox].sort((left, right) => new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime());
}

/** Who is looking at what, so an arriving message knows whether it counts as unread. */
export type ReadingContext = {
  viewerId: string;
  /** The thread on screen in a focused tab, or null when nothing is actively being read. */
  readingConversationId: string | null;
};

/**
 * Moves a conversation to the top of the cached inbox with its new last message,
 * bumping the unread count unless the viewer sent it or is reading that thread right now.
 * Returns null when the conversation is not in the cache yet (a peer just started it),
 * which means the caller has to refetch to learn who they are.
 */
export function applyMessageToInbox(
  inbox: ConversationSummary[],
  incoming: ChatMessage,
  context: ReadingContext,
): ConversationSummary[] | null {
  const index = inbox.findIndex((item) => item.conversationId === incoming.conversationId);
  if (index === -1) return null;

  const current = inbox[index];
  const countsAsUnread =
    incoming.senderId !== context.viewerId && incoming.conversationId !== context.readingConversationId;
  // A late or replayed arrival still counts as unread, but it must not overwrite a newer
  // preview or drag the row back down the list.
  const isLatest = new Date(incoming.createdAt).getTime() >= new Date(current.sortAt).getTime();

  const next = [...inbox];
  next[index] = {
    ...current,
    lastMessageContent: isLatest ? incoming.content : current.lastMessageContent,
    lastMessageAt: isLatest ? incoming.createdAt : current.lastMessageAt,
    lastMessageSenderId: isLatest ? incoming.senderId : current.lastMessageSenderId,
    unreadCount: countsAsUnread ? current.unreadCount + 1 : current.unreadCount,
    sortAt: isLatest ? incoming.createdAt : current.sortAt,
  };
  return sortByRecency(next);
}

/** Clears the badge for one conversation. Order is untouched — reading is not activity. */
export function clearUnread(inbox: ConversationSummary[], conversationId: string): ConversationSummary[] {
  const index = inbox.findIndex((item) => item.conversationId === conversationId);
  if (index === -1 || inbox[index].unreadCount === 0) return inbox;

  const next = [...inbox];
  next[index] = { ...next[index], unreadCount: 0 };
  return next;
}

/** Records how far the peer has read, ignoring a watermark that would move backwards. */
export function applyPeerRead(
  inbox: ConversationSummary[],
  conversationId: string,
  readAt: string,
): ConversationSummary[] {
  const index = inbox.findIndex((item) => item.conversationId === conversationId);
  if (index === -1) return inbox;

  const current = inbox[index].peerLastReadAt;
  if (current !== null && new Date(current).getTime() >= new Date(readAt).getTime()) return inbox;

  const next = [...inbox];
  next[index] = { ...next[index], peerLastReadAt: readAt };
  return next;
}

export function totalUnread(inbox: ConversationSummary[]): number {
  return inbox.reduce((sum, item) => sum + item.unreadCount, 0);
}

/** Badge text. Past 99 the exact number stops being useful and starts breaking the layout. */
export function formatUnreadBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** How many threads are actually waiting — five unread messages in one thread is one thread. */
export function conversationsWithUnread(inbox: ConversationSummary[]): number {
  return inbox.reduce((count, item) => (item.unreadCount > 0 ? count + 1 : count), 0);
}

/** The line Avora Space opens with: threads waiting, not a raw message count. */
export function unreadSummaryText(conversationCount: number): string {
  if (conversationCount === 0) return "Không có tin nhắn mới.";
  return `${conversationCount} cuộc trò chuyện có tin mới`;
}

/** True once the peer's read watermark has reached this message. */
export function isSeenByPeer(message: ChatMessage, peerLastReadAt: string | null): boolean {
  if (peerLastReadAt === null || message.pending === true) return false;
  return new Date(peerLastReadAt).getTime() >= new Date(message.createdAt).getTime();
}

/** Id of the viewer's newest own message — the only one that carries a delivery receipt. */
export function lastOutgoingId(messages: ChatMessage[], viewerId: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].senderId === viewerId) return messages[index].id;
  }
  return null;
}

/**
 * How much slack counts as "still at the bottom". A line of text is ~24px, so this tolerates
 * a couple of lines of drift — a thread nudged by a re-render or a half-scrolled wheel tick
 * is still a thread the reader is watching live.
 */
export const THREAD_BOTTOM_TOLERANCE_PX = 96;

/** The three measurements a scroll container reports about itself. */
export type ThreadScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** True while the reader is parked at (or within a couple of lines of) the newest message. */
export function isNearThreadBottom(
  metrics: ThreadScrollMetrics,
  tolerance: number = THREAD_BOTTOM_TOLERANCE_PX,
): boolean {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distance <= tolerance;
}

/**
 * What the thread should do about a message that just appeared.
 * `jump` lands on the newest message with no animation, `glide` scrolls there smoothly,
 * `stay` leaves the reader exactly where they were reading.
 */
export type ThreadScrollDecision = "jump" | "glide" | "stay";

/**
 * Opening a thread starts at the newest message, and anything you send yourself is always
 * followed. Someone else's message only pulls the view down if you were already at the
 * bottom — reading older messages is never interrupted.
 */
export function threadScrollDecision(input: {
  conversationChanged: boolean;
  firstPaint: boolean;
  sentByViewer: boolean;
  nearBottom: boolean;
}): ThreadScrollDecision {
  if (input.conversationChanged || input.firstPaint) return "jump";
  if (input.sentByViewer || input.nearBottom) return "glide";
  return "stay";
}

/**
 * Enter writes a new line, so the button is the only way a message leaves the composer.
 * It stays unavailable while the draft is empty or nothing but whitespace, and while a
 * send is already in flight, so a blank message can never be sent.
 */
export function canSendDraft(draft: string, isSending: boolean): boolean {
  if (isSending) return false;
  return draft.trim().length > 0;
}

/** Label on the jump-to-newest pill while messages arrived out of sight. */
export function formatMissedMessages(count: number): string {
  if (count <= 0) return "Tin nhắn mới nhất";
  return `${formatUnreadBadge(count)} tin nhắn mới`;
}

const WEEKDAYS: readonly string[] = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDistance(iso: string): number {
  const then = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  return Math.round((today - then) / 86_400_000);
}

/** HH:mm in 24h — matches the tabular numerals used across the app. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Compact stamp for inbox rows: time today, "Hôm qua", weekday, then date. */
export function formatInboxTime(iso: string | null): string {
  if (!iso) return "";
  const distance = dayDistance(iso);
  if (distance <= 0) return formatClock(iso);
  if (distance === 1) return "Hôm qua";
  if (distance < 7) return WEEKDAYS[new Date(iso).getDay()];
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/** Separator label above each day of a thread. */
export function formatDayLabel(iso: string): string {
  const distance = dayDistance(iso);
  if (distance <= 0) return "Hôm nay";
  if (distance === 1) return "Hôm qua";
  if (distance < 7) return WEEKDAYS[new Date(iso).getDay()];
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export type MessageDayGroup = {
  key: string;
  label: string;
  messages: ChatMessage[];
};

/** Groups an ascending thread into day buckets for the date separators. */
export function groupMessagesByDay(messages: ChatMessage[]): MessageDayGroup[] {
  const groups: MessageDayGroup[] = [];
  for (const message of messages) {
    const key = new Date(message.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.messages.push(message);
      continue;
    }
    groups.push({ key, label: formatDayLabel(message.createdAt), messages: [message] });
  }
  return groups;
}

export const chatKeys = {
  conversations: ["conversations"] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  peer: (conversationId: string) => ["conversation-peer", conversationId] as const,
};
