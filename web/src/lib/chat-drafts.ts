import { useSyncExternalStore } from "react";

/**
 * Half-typed messages, one per conversation (Đợt gộp 2 · A8).
 *
 * A composer belongs to exactly one conversation: switching threads never carries words across.
 * Drafts live on this device only (localStorage, keyed by account + conversation), hold text and
 * nothing else, and are wiped on sign-out. Every storage call is guarded: a private window or a
 * full quota simply means drafts are not remembered, never a crash.
 */

const PREFIX = "avora.draft.v1";
const MAX_DRAFT = 4000;

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function keyFor(userId: string, conversationId: string): string {
  return `${PREFIX}:${userId}:${conversationId}`;
}

/** The saved draft for this conversation, or "" when there is none. */
export function readDraft(userId: string | undefined, conversationId: string | undefined): string {
  if (userId === undefined || conversationId === undefined) return "";
  try {
    return window.localStorage.getItem(keyFor(userId, conversationId)) ?? "";
  } catch {
    return "";
  }
}

/** Saves (or, when blank, forgets) the draft for one conversation. */
export function writeDraft(userId: string | undefined, conversationId: string | undefined, text: string): void {
  if (userId === undefined || conversationId === undefined) return;
  const key = keyFor(userId, conversationId);
  try {
    const previous = window.localStorage.getItem(key) ?? "";
    const next = text.trim() === "" ? "" : text.slice(0, MAX_DRAFT);
    if (previous === next) return;
    if (next === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, next);
    notify();
  } catch {
    // Not remembered on this device; the words stay in the box until the thread changes.
  }
}

/** Removes every draft on this device — called on sign-out. */
export function clearAllDrafts(): void {
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(`${PREFIX}:`)) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
    notify();
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** "✎ Nháp: {đầu câu}" — the first line, shortened, for list rows. */
export function draftPreview(text: string, max: number = 60): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const short = firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
  return `✎ Nháp: ${short}`;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key.startsWith(`${PREFIX}:`)) notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Re-renders the caller whenever any draft changes; read rows with `readDraft` in the same render. */
export function useDraftsVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

/**
 * The draft of one conversation, live — list rows re-read when any draft changes. Having a
 * draft never moves a conversation up the list: order stays by newest message.
 */
export function useDraftOf(userId: string | undefined, conversationId: string): string {
  useDraftsVersion();
  return readDraft(userId, conversationId);
}
