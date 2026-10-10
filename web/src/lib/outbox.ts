import { logError } from "@/lib/log";

/**
 * AVORA-106 · K2 (C1–C3) — the outbox on this device.
 *
 * Every message gets its id here, before anything leaves the device. The id is the message's
 * identity end to end: `send_message` returns the existing row when it sees the same id again,
 * so a retry after a timeout, a double tap or a reload can never make a second message.
 *
 * Items wait in IndexedDB (words + the files' blobs) until the server confirms them, and are sent
 * one at a time per conversation, in the order they were written; different conversations do not
 * wait for each other. Files upload up to three at a time.
 */

export type OutboxFile = {
  localId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  kind: "image" | "file" | "voice";
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  permission: "view" | "forward" | "export";
  captureSource: "camera" | "library" | null;
  /** Set once uploaded, so a retry does not upload again. */
  storagePath?: string;
};

export type OutboxItem = {
  /** The message id (uuid) — identical on every retry. */
  id: string;
  userId: string;
  conversationId: string;
  content: string;
  replyToMessageId: string | null;
  mentionedUserIds: string[];
  refs: { type: string; id: string }[];
  originGroupId: string | null;
  isUrgent: boolean;
  /** K5: a send effect asked for (the server may drop it past 3 / 10 min). */
  effect?: "fireworks" | "hearts" | "balloons" | "buzz" | null;
  /** K5: an Avora sticker message — the id only, never an image. */
  stickerId?: string | null;
  files: OutboxFile[];
  createdAt: string;
  /** Monotonic order within this device. */
  seq: number;
  state: "queued" | "sending" | "waiting_network" | "failed";
  attempts: number;
  lastError: string | null;
};

/** What the UI shows under a waiting bubble. */
export function outboxLabel(item: Pick<OutboxItem, "state">): string | null {
  if (item.state === "waiting_network") return "Đang chờ mạng";
  if (item.state === "failed") return "Chưa gửi được · Gửi lại";
  return null;
}

/** Errors that will not get better by trying again: the item stops and waits for the person. */
export function isPermanentSendError(message: string): boolean {
  const m = message.toLowerCase();
  return [
    "avora_not_a_participant",
    "avora_contact_unavailable",
    "avora_not_connected",
    "avora_verification",
    "avora_project_chat_closed",
    "avora_attachment_type_blocked",
    "avora_attachment_too_large",
    "avora_attachment_total_too_large",
    "avora_video_too_long",
    "avora_attachment_too_many",
    "avora_mentions_too_many",
    "avora_reply_out_of_scope",
    "messages_content",
    "avora_urgent",
    "avora_message_id_taken",
    "không có quyền",
    "không gửi loại tệp",
    "tệp quá lớn",
    "không còn",
    "chặn",
  ].some((needle) => m.includes(needle));
}

/** True when the failure looks like the network (retry quietly when it is back). */
export function isNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("failed to fetch") || m.includes("network") || m.includes("không kết nối được") || m.includes("load failed") || m.includes("timeout");
}

/** Next wait before an automatic retry: 1 s, 2 s, 4 s … capped at 30 s. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/** The order to send: per conversation by seq; conversations independent. Returns the head of each. */
export function sendableHeads(items: readonly OutboxItem[]): OutboxItem[] {
  const heads = new Map<string, OutboxItem>();
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    if (heads.has(item.conversationId)) continue;
    heads.set(item.conversationId, item);
  }
  // A failed head blocks its conversation (order matters) until the person retries or drops it.
  return [...heads.values()].filter((item) => item.state === "queued" || item.state === "waiting_network");
}

/** Runs `tasks` with at most `limit` in flight (C3: files upload three at a time). */
export async function runLimited<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ---------------------------------------------------------------- storage (IndexedDB)

const DB_NAME = "avora-outbox";
const STORE = "items";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      logError("outbox", { code: "idb_open_failed" });
      resolve(null);
    };
  });
}

/** In-memory copy when IndexedDB is unavailable (private mode): still no duplicates, only no reload survival. */
const memory = new Map<string, OutboxItem>();

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  const db = await openDb();
  if (db === null) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request === null ? null : (request.result ?? null));
    transaction.onerror = () => {
      logError("outbox", { code: "idb_tx_failed" });
      resolve(null);
    };
  });
}

export const outboxStore = {
  async put(item: OutboxItem): Promise<void> {
    memory.set(item.id, item);
    await tx("readwrite", (store) => store.put(item));
  },
  async remove(id: string): Promise<void> {
    memory.delete(id);
    await tx("readwrite", (store) => store.delete(id));
  },
  async all(userId: string): Promise<OutboxItem[]> {
    const stored = (await tx<OutboxItem[]>("readonly", (store) => store.getAll() as IDBRequest<OutboxItem[]>)) ?? [];
    const byId = new Map<string, OutboxItem>();
    for (const item of stored) byId.set(item.id, item);
    for (const item of memory.values()) byId.set(item.id, item);
    return [...byId.values()].filter((item) => item.userId === userId).sort((a, b) => a.seq - b.seq);
  },
  /** C11: leaving a conversation drops what was waiting for it. */
  async removeConversation(userId: string, conversationId: string): Promise<void> {
    for (const item of await outboxStore.all(userId)) {
      if (item.conversationId === conversationId) await outboxStore.remove(item.id);
    }
  },
  /** Signing out: nothing of the account stays waiting on the device. */
  async clear(): Promise<void> {
    memory.clear();
    await tx("readwrite", (store) => store.clear());
  },
};

let seqCounter = 0;
/** Strictly increasing on this device, even within one millisecond. */
export function nextSeq(now: number = Date.now()): number {
  seqCounter = Math.max(seqCounter + 1, now * 1000);
  return seqCounter;
}
