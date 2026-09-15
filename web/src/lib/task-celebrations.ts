import { supabase } from "@/integrations/supabase/client";

/**
 * A celebration that waited.
 *
 * The realtime burst only reaches people who happen to be looking at the right moment. Most
 * of the time nobody is: shared work closes while the other person is asleep, in another
 * room of the app, or not signed in at all. These rows are for them — the party is kept
 * until they next open the conversation, then played once and never again.
 *
 * It is deliberately NOT a notification: no text, no unread count, no badge, nothing to
 * dismiss. A celebration that nags is not a celebration.
 */
export type PendingCelebration = {
  taskId: string;
  conversationId: string;
  /** How many times the confetti fires — 3 for a milestone, 1 for ordinary work. */
  burstCount: number;
  triggeredAt: string;
};

export const celebrationKeys = {
  all: ["task-celebrations"] as const,
  thread: (conversationId: string) => ["task-celebrations", conversationId] as const,
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[celebrations] ${code ?? "unknown"}: ${message}`);
  return new Error("Không tải được lời chúc mừng.");
}

type CelebrationRow = {
  task_id: string;
  conversation_id: string;
  burst_count: number;
  triggered_at: string;
};

/**
 * How long a celebration is still worth playing.
 *
 * Confetti for something finished a fortnight ago is confusing rather than joyful — the
 * reader has to work out what is being celebrated, which is the opposite of the intent. Past
 * this age the row simply stops being shown; nothing is deleted, because the row is also the
 * record that the moment happened.
 */
export const CELEBRATION_FRESH_DAYS = 7;

/** Whether a celebration is recent enough to still mean something. */
export function isCelebrationFresh(
  triggeredAt: string,
  now: Date = new Date(),
): boolean {
  const at = new Date(triggeredAt).getTime();
  if (Number.isNaN(at)) return false;
  const ageMs = now.getTime() - at;
  return ageMs >= 0 && ageMs <= CELEBRATION_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The celebrations in one conversation this person has not seen yet.
 *
 * Two queries rather than one join, because RLS already scopes both: the celebrations of
 * rooms this person is in, and only this person's own view rows. Subtracting one from the
 * other client-side keeps the "already seen" rule out of a view definition that would be
 * harder to reason about.
 */
export async function fetchPendingCelebrations(
  conversationId: string,
  userId: string,
): Promise<PendingCelebration[]> {
  const { data: celebrations, error } = await supabase
    .from("task_celebrations")
    .select("task_id, conversation_id, burst_count, triggered_at")
    .eq("conversation_id", conversationId)
    .order("triggered_at", { ascending: true });
  if (error) throw fail(error.code, error.message);

  const rows = (celebrations ?? []) as CelebrationRow[];
  if (rows.length === 0) return [];

  const { data: views, error: viewError } = await supabase
    .from("task_celebration_views")
    .select("task_id")
    .eq("user_id", userId)
    .in(
      "task_id",
      rows.map((row) => row.task_id),
    );
  if (viewError) throw fail(viewError.code, viewError.message);

  const seen = new Set((views ?? []).map((row) => (row as { task_id: string }).task_id));

  return rows
    .filter((row) => !seen.has(row.task_id) && isCelebrationFresh(row.triggered_at))
    .map((row) => ({
      taskId: row.task_id,
      conversationId: row.conversation_id,
      burstCount: row.burst_count,
      triggeredAt: row.triggered_at,
    }));
}

/**
 * Marks celebrations as seen. Safe to retry — a second attempt conflicts and does nothing.
 *
 * Written after the confetti has been handed to the animation, never before: a failed write
 * should mean "play it again next time", which is a far kinder failure than a celebration
 * silently swallowed.
 */
export async function markCelebrationsSeen(
  taskIds: readonly string[],
  userId: string,
): Promise<void> {
  if (taskIds.length === 0) return;
  const { error } = await supabase
    .from("task_celebration_views")
    .upsert(
      taskIds.map((taskId) => ({ task_id: taskId, user_id: userId })),
      { onConflict: "task_id,user_id" },
    );
  if (error) throw fail(error.code, error.message);
}

/**
 * How many bursts a set of waiting celebrations is worth.
 *
 * Capped, and deliberately not a sum: someone returning to a week of finished work should
 * get one generous celebration, not forty. Above the cap the room simply had a good week —
 * the strongest single celebration is the honest reading of that.
 */
export const MAX_BURSTS = 5;

export function burstsFor(pending: readonly PendingCelebration[]): number {
  if (pending.length === 0) return 0;
  const strongest = pending.reduce((most, entry) => Math.max(most, entry.burstCount), 0);
  const total = pending.reduce((sum, entry) => sum + entry.burstCount, 0);
  return Math.min(Math.max(strongest, total > MAX_BURSTS ? MAX_BURSTS : total), MAX_BURSTS);
}

/** Whether any waiting celebration is a milestone — which decides the confetti's weight. */
export function hasMilestone(pending: readonly PendingCelebration[]): boolean {
  return pending.some((entry) => entry.burstCount > 1);
}
