import type { ScheduledMessage } from "@/lib/scheduled-messages";

/** Scheduled messages still waiting or failed — the chip row's count (AVORA-49 · 2.1). */
export function waitingScheduled(items: readonly ScheduledMessage[]): ScheduledMessage[] {
  return items.filter((item) => item.status === "pending" || item.status === "failed");
}
