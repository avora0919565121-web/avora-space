import { useCallback, useSyncExternalStore } from "react";

import { readDraft, writeDraft } from "@/lib/chat-drafts";

/**
 * K3 · N3: the words in the composer live here, outside the chat screen's state.
 *
 * A keystroke updates only the composer (and anything that asked to hear about this one thread),
 * so typing never re-draws the thread or the list. The saved copy on the device follows 400 ms
 * after the last keystroke, not on every key.
 */
export const DRAFT_SAVE_DELAY_MS = 400;

type Key = string;
const texts = new Map<Key, string>();
const listeners = new Map<Key, Set<() => void>>();
const timers = new Map<Key, ReturnType<typeof setTimeout>>();

function keyOf(userId: string | undefined, conversationId: string | undefined): Key | null {
  if (userId === undefined || conversationId === undefined) return null;
  return `${userId}:${conversationId}`;
}

/** The current words for one thread (the device's saved copy the first time). */
export function getComposerDraft(userId: string | undefined, conversationId: string | undefined): string {
  const key = keyOf(userId, conversationId);
  if (key === null) return "";
  const kept = texts.get(key);
  if (kept !== undefined) return kept;
  const saved = readDraft(userId, conversationId);
  texts.set(key, saved);
  return saved;
}

function flush(key: Key, userId: string, conversationId: string): void {
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(key);
  writeDraft(userId, conversationId, texts.get(key) ?? "");
}

/** New words for one thread. Empty text (a send, a clear) is saved at once. */
export function setComposerDraft(
  userId: string | undefined,
  conversationId: string | undefined,
  next: string | ((current: string) => string),
): void {
  const key = keyOf(userId, conversationId);
  if (key === null || userId === undefined || conversationId === undefined) return;
  const current = getComposerDraft(userId, conversationId);
  const text = typeof next === "function" ? next(current) : next;
  if (text === current) return;
  texts.set(key, text);
  listeners.get(key)?.forEach((listener) => listener());
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  if (text.trim() === "") {
    flush(key, userId, conversationId);
    return;
  }
  timers.set(
    key,
    setTimeout(() => flush(key, userId, conversationId), DRAFT_SAVE_DELAY_MS),
  );
}

/** Writes every pending draft now (leaving the page, hiding the tab). */
export function flushComposerDrafts(): void {
  for (const key of [...timers.keys()]) {
    const [userId, conversationId] = key.split(":");
    if (userId && conversationId) flush(key, userId, conversationId);
  }
}

/** Forget the in-memory words (sign-out); the device copies are cleared by chat-drafts. */
export function resetComposerDrafts(): void {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  texts.clear();
}

function subscribe(key: Key | null, listener: () => void): () => void {
  if (key === null) return () => undefined;
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** The words, re-rendering on every keystroke — for the composer itself only. */
export function useComposerDraft(userId: string | undefined, conversationId: string | undefined): string {
  const key = keyOf(userId, conversationId);
  const sub = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  return useSyncExternalStore(sub, () => getComposerDraft(userId, conversationId), () => "");
}

/** Only whether the box is empty — re-renders on the switch, not on every key. */
export function useComposerDraftIsEmpty(userId: string | undefined, conversationId: string | undefined): boolean {
  const key = keyOf(userId, conversationId);
  const sub = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  return useSyncExternalStore(sub, () => getComposerDraft(userId, conversationId).trim() === "", () => true);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushComposerDrafts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushComposerDrafts();
  });
}
