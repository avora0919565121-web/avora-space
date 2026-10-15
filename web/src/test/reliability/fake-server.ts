/**
 * 112-A · 2 — one shared, in-memory Avora server for the two-person harness.
 *
 * It keeps the rules the real database keeps for the flows under test (checked against
 * `supabase/migrations` and the SQL tests): `send_message` is idempotent on the device-made id and
 * refuses an id taken by someone else, the server sets `created_at`, only participants read or
 * write a conversation, every member's private topic `user-<id>` gets a `message` / `message_update`
 * broadcast (K3 · N1), read marks / tasks reach only their own viewers as `postgres_changes`.
 * Everything else answers empty so screens that ask for more still load.
 *
 * Deliberately NOT a database: the SQL tests (`supabase/tests/*.sql`) prove the real server rules;
 * this proves the app keeps them across two people, reloads and a bad network.
 */

export type Row = Record<string, unknown>;

export type ServerError = { message: string; code?: string };

export type ServerReply = { data: unknown; error: ServerError | null };

export type ChangeEvent = {
  /** `broadcast` (private topic) or `postgres_changes` (table stream, RLS-filtered here). */
  type: "broadcast" | "postgres_changes";
  topic?: string;
  event: string;
  table?: string;
  payload: Record<string, unknown>;
};

/** One subscription a client holds: the server pushes matching events to `deliver`. */
export type ServerSubscription = {
  userId: string;
  topic: string;
  deliver: (event: ChangeEvent) => void;
};

type SendArgs = {
  p_id: string;
  p_conversation: string;
  p_content: string;
  p_reply_to?: string | null;
  p_attachments?: { storage_path: string; kind: string; file_name: string; mime_type: string; byte_size: number }[];
  p_mentioned?: string[];
  p_urgent?: boolean;
  p_sticker?: string | null;
};

const MESSAGE_LIMIT = 4000;

/** A timestamp as whole microseconds (Postgres precision), whatever form the client sent it in. */
export function micros(value: string): number {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (match === null) return new Date(value).getTime() * 1000;
  const whole = new Date(`${match[1]}${match[3] ?? "Z"}`).getTime() * 1000;
  return whole + Number((match[2] ?? "").padEnd(6, "0").slice(0, 6));
}

export class FakeAvoraServer {
  readonly tables = new Map<string, Row[]>();
  readonly storage = new Map<string, Blob>();
  readonly subscriptions = new Set<ServerSubscription>();
  /** Every call that reached the server (after the network let it through). */
  readonly calls: { userId: string; name: string; args: unknown }[] = [];
  /** Names nobody taught this server — reported so a test sees what a screen asked for. */
  readonly unknown = new Set<string>();
  private lastMicros = 0;
  /** A test may make the server refuse a call (e.g. `avora_contact_unavailable` once blocked). */
  refuse: ((userId: string, name: string, args: Record<string, unknown>) => ServerError | null) | null = null;

  constructor() {
    for (const name of ["profiles", "conversations", "conversation_participants", "messages", "conversation_read_marks", "tasks", "message_attachments"]) {
      this.tables.set(name, []);
    }
  }

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (rows === undefined) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  /** Strictly increasing server time (microseconds), like `clock_timestamp()` on one primary. */
  now(): string {
    const micros = Math.max(this.lastMicros + 1, Date.now() * 1000);
    this.lastMicros = micros;
    const ms = Math.floor(micros / 1000);
    const extra = String(micros % 1000).padStart(3, "0");
    return new Date(ms).toISOString().replace("Z", `${extra}Z`);
  }

  addUser(id: string, displayName: string): void {
    this.table("profiles").push({ id, display_name: displayName, avatar_url: null, created_at: this.now() });
  }

  addConversation(id: string, type: "direct" | "group", members: readonly string[]): void {
    this.table("conversations").push({ id, type, created_at: this.now() });
    for (const userId of members) this.table("conversation_participants").push({ conversation_id: id, user_id: userId, left_at: null });
  }

  removeMember(conversationId: string, userId: string): void {
    const rows = this.table("conversation_participants");
    const index = rows.findIndex((row) => row.conversation_id === conversationId && row.user_id === userId);
    if (index !== -1) rows.splice(index, 1);
    this.broadcastTo(userId, "removed", { conversation_id: conversationId, name: null });
  }

  isMember(conversationId: string, userId: string): boolean {
    return this.table("conversation_participants").some((row) => row.conversation_id === conversationId && row.user_id === userId);
  }

  members(conversationId: string): string[] {
    return this.table("conversation_participants")
      .filter((row) => row.conversation_id === conversationId)
      .map((row) => row.user_id as string);
  }

  /** Messages of one conversation in server order (created_at, id) — the order everyone must see. */
  thread(conversationId: string): Row[] {
    return this.table("messages")
      .filter((row) => row.conversation_id === conversationId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  }

  subscribe(subscription: ServerSubscription): () => void {
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  broadcastTo(userId: string, event: string, payload: Record<string, unknown>): void {
    const topic = `user-${userId}`;
    for (const sub of this.subscriptions) {
      if (sub.userId === userId && sub.topic === topic) sub.deliver({ type: "broadcast", topic, event, payload });
    }
  }

  /**
   * 112-D: permission checks the realtime path costs, per change. `legacy` (postgres_changes): the RLS of the
   * row is evaluated once for every subscriber of the table. `broadcast` (the 112-D triggers): the server
   * computes the recipients once; each private topic was authorised once, when it was joined.
   */
  readonly authChecks = { legacy: 0, broadcast: 0, changes: 0 };

  /** A table change: streamed to table subscribers allowed to read the row (legacy), and sent to each reader's own topic (112-D). */
  emitChange(table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: Row, canRead: (userId: string) => boolean): void {
    this.authChecks.changes += 1;
    this.authChecks.broadcast += 1;
    const sentTo = new Set<string>();
    for (const sub of this.subscriptions) {
      if (sub.topic.startsWith("user-")) {
        // The trigger's recipient list, delivered to every device of each recipient that is listening.
        if (sub.topic !== `user-${sub.userId}` || !canRead(sub.userId)) continue;
        const event = table === "tasks" ? "task" : table === "conversation_read_marks" ? "read_mark" : null;
        if (event === null) continue;
        sentTo.add(sub.userId);
        sub.deliver({ type: "broadcast", topic: sub.topic, event, payload: { eventType, new: eventType === "DELETE" ? {} : row, old: { id: row.id } } });
        continue;
      }
      this.authChecks.legacy += 1;
      if (!canRead(sub.userId)) continue;
      sub.deliver({ type: "postgres_changes", event: eventType, table, payload: { eventType, table, schema: "public", new: eventType === "DELETE" ? {} : row, old: eventType === "DELETE" ? row : {} } });
    }
    void sentTo;
  }

  // ------------------------------------------------------------------ RPC

  rpc(userId: string, name: string, args: Record<string, unknown>): ServerReply {
    this.calls.push({ userId, name, args });
    const refused = this.refuse?.(userId, name, args) ?? null;
    if (refused !== null) return { data: null, error: refused };
    switch (name) {
      case "send_message":
        return this.sendMessage(userId, args as unknown as SendArgs);
      case "edit_message":
        return this.editMessage(userId, String(args.p_message_id), String(args.p_content));
      case "recall_message":
        return this.recallMessage(userId, String(args.p_message_id));
      case "forward_messages":
        return this.forward(userId, args.p_message_ids as string[], String(args.p_target_conversation_id));
      case "mark_conversation_read":
        return this.markRead(userId, String(args.p_conversation ?? args.p_conversation_id), (args.p_up_to as string | null | undefined) ?? null);
      case "mark_messages_delivered":
      case "mark_conversation_delivered":
        return { data: 0, error: null };
      case "messages_page":
        return this.messagesPage(userId, String(args.p_conversation), (args.p_before_at as string | null) ?? null, (args.p_before_id as string | null) ?? null, Number(args.p_limit ?? 50));
      case "vault_status":
        return { data: { has_vault: false, unlocked: false }, error: null };
      default:
        this.unknown.add(`rpc:${name}`);
        return { data: null, error: null };
    }
  }

  private sendMessage(userId: string, args: SendArgs): ServerReply {
    if (!this.isMember(args.p_conversation, userId)) return { data: null, error: { message: "avora_not_a_participant", code: "42501" } };
    const existing = this.table("messages").find((row) => row.id === args.p_id);
    if (existing !== undefined) {
      // K2 · C1: the same id again from its sender is the same message, never a second one.
      if (existing.sender_id === userId && existing.conversation_id === args.p_conversation) return { data: { ...existing }, error: null };
      return { data: null, error: { message: "avora_message_id_taken", code: "23505" } };
    }
    const content = (args.p_content ?? "").trim();
    const attachments = args.p_attachments ?? [];
    if (content.length === 0 && attachments.length === 0 && !args.p_sticker) return { data: null, error: { message: "messages_content_not_blank", code: "23514" } };
    if (content.length > MESSAGE_LIMIT) return { data: null, error: { message: "messages_content_max_len", code: "23514" } };
    for (const file of attachments) {
      if (!this.storage.has(file.storage_path)) return { data: null, error: { message: "avora_attachment_missing", code: "P0001" } };
    }
    const row: Row = {
      id: args.p_id,
      conversation_id: args.p_conversation,
      sender_id: userId,
      content,
      created_at: this.now(),
      edited_at: null,
      deleted_at: null,
      trashed_at: null,
      reply_to_message_id: args.p_reply_to ?? null,
      mentioned_user_ids: args.p_mentioned ?? [],
      origin_group_id: null,
      attachment_count: attachments.length,
      origin_content_id: null,
      origin_sender_id: null,
      system_kind: null,
      forward_bundle: null,
      is_urgent: args.p_urgent === true,
      refs: null,
      contact_card_user_id: null,
      sticker_id: args.p_sticker ?? null,
      effect: null,
      note_card: null,
      expires_at: null,
      expired_at: null,
    };
    this.table("messages").push(row);
    for (const file of attachments) {
      this.table("message_attachments").push({ id: `${args.p_id}:${file.storage_path}`, message_id: args.p_id, conversation_id: args.p_conversation, attached_by: userId, ...file });
    }
    for (const member of this.members(args.p_conversation)) this.broadcastTo(member, "message", { message: { ...row } });
    return { data: { ...row }, error: null };
  }

  private editMessage(userId: string, id: string, content: string): ServerReply {
    const row = this.table("messages").find((entry) => entry.id === id);
    if (row === undefined) return { data: null, error: { message: "avora_message_not_found" } };
    if (row.sender_id !== userId) return { data: null, error: { message: "avora_message_not_yours" } };
    if (row.deleted_at !== null) return { data: null, error: { message: "avora_message_recalled" } };
    row.content = content.trim();
    row.edited_at = this.now();
    for (const member of this.members(String(row.conversation_id))) this.broadcastTo(member, "message_update", { message: { ...row } });
    return { data: { ...row }, error: null };
  }

  private recallMessage(userId: string, id: string): ServerReply {
    const row = this.table("messages").find((entry) => entry.id === id);
    if (row === undefined) return { data: null, error: { message: "avora_message_not_found" } };
    if (row.sender_id !== userId) return { data: null, error: { message: "avora_message_not_yours" } };
    row.content = "";
    row.deleted_at = this.now();
    for (const member of this.members(String(row.conversation_id))) this.broadcastTo(member, "message_update", { message: { ...row } });
    return { data: { ...row }, error: null };
  }

  private forward(userId: string, ids: readonly string[], target: string): ServerReply {
    if (!this.isMember(target, userId)) return { data: null, error: { message: "avora_not_a_participant", code: "42501" } };
    let forwarded = 0;
    for (const id of ids) {
      const source = this.table("messages").find((entry) => entry.id === id);
      if (source === undefined || !this.isMember(String(source.conversation_id), userId) || source.deleted_at !== null) continue;
      const copyId = crypto.randomUUID();
      const reply = this.sendMessage(userId, { p_id: copyId, p_conversation: target, p_content: String(source.content) });
      if (reply.error !== null) continue;
      const copy = this.table("messages").find((entry) => entry.id === copyId);
      if (copy !== undefined) {
        copy.origin_content_id = source.id;
        copy.origin_sender_id = source.sender_id;
      }
      forwarded += 1;
    }
    return { data: { forwarded, files_carried: 0, files_blocked: 0 }, error: null };
  }

  private messagesPage(userId: string, conversationId: string, beforeAt: string | null, beforeId: string | null, limit: number): ServerReply {
    if (!this.isMember(conversationId, userId)) return { data: [], error: null };
    const cursor = beforeAt === null ? Number.POSITIVE_INFINITY : micros(beforeAt);
    const rows = this.thread(conversationId)
      .filter((row) => {
        const at = micros(String(row.created_at));
        return at < cursor || (at === cursor && beforeId !== null && String(row.id) < beforeId);
      })
      .reverse()
      .slice(0, limit)
      .map((row) => ({ ...row }));
    return { data: rows, error: null };
  }

  private markRead(userId: string, conversationId: string, upTo: string | null): ServerReply {
    if (!this.isMember(conversationId, userId)) return { data: null, error: { message: "avora_not_a_participant", code: "42501" } };
    const thread = this.thread(conversationId);
    const until = upTo === null ? thread[thread.length - 1] : thread.find((row) => row.id === upTo);
    const lastReadAt = (until?.created_at as string | undefined) ?? this.now();
    const marks = this.table("conversation_read_marks");
    let mark = marks.find((row) => row.conversation_id === conversationId && row.user_id === userId);
    if (mark === undefined) {
      mark = { conversation_id: conversationId, user_id: userId, last_read_at: lastReadAt };
      marks.push(mark);
      this.emitChange("conversation_read_marks", "INSERT", { ...mark }, (viewer) => viewer === userId);
    } else {
      mark.last_read_at = lastReadAt;
      this.emitChange("conversation_read_marks", "UPDATE", { ...mark }, (viewer) => viewer === userId);
    }
    return { data: lastReadAt, error: null };
  }

  // ------------------------------------------------------------------ tasks (luồng 4)

  /** A shared task between two people: creator and assignee read it (the real tasks RLS, reduced). */
  upsertTask(task: Row & { id: string; creator_id: string; assignee_id: string | null }): void {
    const rows = this.table("tasks");
    const index = rows.findIndex((row) => row.id === task.id);
    const eventType = index === -1 ? "INSERT" : "UPDATE";
    if (index === -1) rows.push({ ...task });
    else rows[index] = { ...rows[index], ...task };
    const stored = rows.find((row) => row.id === task.id) as Row;
    this.emitChange("tasks", eventType, { ...stored }, (viewer) => viewer === stored.creator_id || viewer === stored.assignee_id);
  }

  // ------------------------------------------------------------------ table reads (RLS-reduced)

  canRead(userId: string, table: string, row: Row): boolean {
    if (table === "messages" || table === "message_attachments") return this.isMember(String(row.conversation_id), userId);
    if (table === "conversation_read_marks") return row.user_id === userId;
    if (table === "tasks") return row.creator_id === userId || row.assignee_id === userId;
    if (table === "conversation_participants") return this.isMember(String(row.conversation_id), userId);
    return true;
  }

  // ------------------------------------------------------------------ storage

  upload(userId: string, bucket: string, path: string, blob: Blob): ServerReply {
    this.calls.push({ userId, name: `storage.upload:${bucket}`, args: { path } });
    const key = `${bucket}/${path}`;
    if (this.storage.has(key)) return { data: null, error: { message: "The resource already exists" } };
    // The attachment bucket is keyed by conversation: only members may write there.
    const conversationId = path.split("/")[0];
    if (bucket === "chat-attachments" && !this.isMember(conversationId, userId)) return { data: null, error: { message: "new row violates row-level security policy" } };
    this.storage.set(key, blob);
    this.storage.set(path, blob);
    return { data: { path }, error: null };
  }

  removeObjects(bucket: string, paths: readonly string[]): ServerReply {
    for (const path of paths) {
      this.storage.delete(`${bucket}/${path}`);
      this.storage.delete(path);
    }
    return { data: paths.map((name) => ({ name })), error: null };
  }

  /** Files in a bucket that no message points at — what 112-A calls an orphan. */
  orphans(bucket: string): string[] {
    const referenced = new Set(this.table("message_attachments").map((row) => String(row.storage_path)));
    return [...this.storage.keys()]
      .filter((key) => key.startsWith(`${bucket}/`))
      .map((key) => key.slice(bucket.length + 1))
      .filter((path) => !path.endsWith("/thumb-320.webp") && !referenced.has(path));
  }
}
