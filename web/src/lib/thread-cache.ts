import type { ChatMessage } from "@/lib/chat";
import { logError } from "@/lib/log";

/**
 * AVORA-106 · K3 · N2 bước 0 — the last 50 messages of each conversation kept on this device
 * (IndexedDB), so an open paints at once and the network only fills in what changed.
 *
 * What is kept is exactly what this account could already read. It is forgotten when the person
 * leaves the conversation (C11), signs out, or the account on this device changes.
 */
const DB_NAME = "avora-thread-cache";
const STORE = "threads";
export const THREAD_CACHE_SIZE = 50;

type Entry = { key: string; userId: string; conversationId: string; messages: ChatMessage[]; savedAt: number };

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

const keyOf = (userId: string, conversationId: string): string => `${userId}:${conversationId}`;

/** Only real, settled messages are cached — never a waiting bubble (the outbox owns those). */
export function cacheable(messages: readonly ChatMessage[], now: number = Date.now()): ChatMessage[] {
  return messages
    .filter((message) => message.pending !== true)
    .map((message) => scrubExpired(message, now))
    .slice(-THREAD_CACHE_SIZE);
}

/**
 * AVORA-109 · B2: a copy on this device never keeps the words of a message whose time is up —
 * scrubbed when written and again when read back.
 */
export function scrubExpired(message: ChatMessage, now: number = Date.now()): ChatMessage {
  const gone = message.expiredAt != null || (message.expiresAt != null && new Date(message.expiresAt).getTime() <= now);
  if (!gone || (message.content === "" && message.forwardBundle == null && message.noteCard == null && message.stickerId == null)) return message;
  return { ...message, content: "", forwardBundle: null, noteCard: null, stickerId: null, contactCardUserId: null, refs: null, attachmentCount: 0, mentionedUserIds: [] };
}

export async function readThreadCache(userId: string, conversationId: string): Promise<ChatMessage[] | null> {
  const db = await openDb();
  if (db === null) return null;
  return new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(keyOf(userId, conversationId));
    request.onsuccess = () => {
      const messages = (request.result as Entry | undefined)?.messages ?? null;
      resolve(messages === null ? null : messages.map((message) => scrubExpired(message)));
    };
    request.onerror = () => resolve(null);
  });
}

export async function writeThreadCache(userId: string, conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  const entry: Entry = { key: keyOf(userId, conversationId), userId, conversationId, messages: cacheable(messages), savedAt: Date.now() };
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      logError("thread-cache", { code: "write_failed" });
      resolve();
    };
  });
}

export async function forgetThreadCache(userId: string, conversationId: string): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyOf(userId, conversationId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Signing out / switching account: nothing of the previous account stays. */
export async function clearThreadCache(): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
