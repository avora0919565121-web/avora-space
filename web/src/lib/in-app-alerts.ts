import type { MuteDecision, NotificationEvent } from "@/lib/mute";
import type { ConversationSummary } from "@/lib/chat-cache";

/**
 * In-app sounds, tab title and app badge while AVORA is open (Đợt gộp 2 · A11).
 *
 * Pure rules live here so they can be tested; the component that plays sounds is
 * `components/InAppAlerts.tsx`. Push notifications to a closed app are AVORA-46, not this.
 */

/** Fired by the realtime layer for every message from someone else. */
export const INCOMING_MESSAGE_EVENT = "avora:incoming-message";

export type IncomingMessageSignal = {
  conversationId: string;
  senderId: string;
  mentionsViewer: boolean;
  /** The thread is on screen in a visible tab. */
  isReading: boolean;
};

/** Many messages within this window make one sound. */
export const SOUND_THROTTLE_MS = 3_000;

export const MESSAGE_SOUND_URL = "/sounds/message-v1.mp3";
export const REMINDER_SOUND_URL = "/sounds/reminder-v1.mp3";

/** Which mute tab a conversation belongs to. The journal never makes a sound. */
export function surfaceOf(summary: Pick<ConversationSummary, "kind"> | undefined): NotificationEvent["surface"] | null {
  if (summary === undefined) return "direct";
  if (summary.kind === "personal") return null;
  return summary.kind === "group" ? "group" : "direct";
}

/**
 * The count shown in the tab title and on the app icon: conversations with something unread,
 * exactly like the Kết nối badge, minus those whose surface is muted right now.
 */
export function unreadConversationCount(
  conversations: readonly ConversationSummary[],
  decide: (event: NotificationEvent) => MuteDecision,
): number {
  let count = 0;
  for (const item of conversations) {
    if (item.unreadCount <= 0) continue;
    const surface = surfaceOf(item);
    if (surface === null) continue;
    if (decide({ surface, isFromFamily: false, mentionsRecipient: false }).blocked) continue;
    count += 1;
  }
  return count;
}

/** "(3) AVORA", or "AVORA" when nothing is waiting. */
export function tabTitle(count: number, base: string = "AVORA"): string {
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
}

/** Whether an incoming message should make the message sound. */
export function shouldChime(input: {
  signal: IncomingMessageSignal;
  soundOn: boolean;
  lastChimeAt: number;
  now: number;
  decision: MuteDecision;
}): boolean {
  if (!input.soundOn) return false;
  // Looking right at it: no sound.
  if (input.signal.isReading) return false;
  if (input.decision.blocked) return false;
  return input.now - input.lastChimeAt >= SOUND_THROTTLE_MS;
}

export type DueReminder = { key: string; title: string; href: string };

/**
 * Reminders that came due since the last check (at most `windowMs` ago, so opening the app
 * hours later does not ring for the whole morning at once). Already-rung keys are skipped.
 */
export function dueReminders(
  candidates: readonly { key: string; at: string | null; title: string; href: string }[],
  rung: ReadonlySet<string>,
  now: number,
  windowMs: number = 90_000,
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const candidate of candidates) {
    if (candidate.at === null || rung.has(candidate.key)) continue;
    const at = new Date(candidate.at).getTime();
    if (Number.isNaN(at)) continue;
    if (at <= now && now - at <= windowMs) due.push({ key: candidate.key, title: candidate.title, href: candidate.href });
  }
  return due;
}
