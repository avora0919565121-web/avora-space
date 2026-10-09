import { logError } from "@/lib/log";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * The moment a milestone closes, everyone in the room hears it — carried by a realtime
 * broadcast, not the database.
 *
 * AVORA-106 · K1 (M4): the old system-wide `avora-milestone` topic is gone. A burst rides the
 * conversation's own private topic `conv-<id>`, which `realtime.messages` only lets members join
 * (`private.realtime_topic_ok` → `can_act_in(…, 'read')`). Someone outside the room never
 * receives it, so nothing has to be filtered on the device.
 */
export type MilestoneBurstEvent = {
  conversationId: string;
  taskId: string;
  /** Who closed it — the receiver skips their own echo. */
  actorId: string;
};

type BurstSubscriber = (event: MilestoneBurstEvent) => void;

const subscribers = new Set<BurstSubscriber>();

/** Watches for milestone bursts. Returns the unsubscribe function. */
export function onMilestoneBurst(subscribe: BurstSubscriber): () => void {
  subscribers.add(subscribe);
  return () => {
    subscribers.delete(subscribe);
  };
}

function deliverLocally(event: MilestoneBurstEvent): void {
  for (const subscriber of subscribers) subscriber(event);
}

/** The per-conversation topic. Shared with K3's broadcast of messages. */
export function conversationTopic(conversationId: string): string {
  return `conv-${conversationId}`;
}

const channels = new Map<string, Promise<RealtimeChannel>>();

function burstChannel(conversationId: string): Promise<RealtimeChannel> {
  const existing = channels.get(conversationId);
  if (existing !== undefined) return existing;
  const created = new Promise<RealtimeChannel>((resolve, reject) => {
    const channel = supabase.channel(`${conversationTopic(conversationId)}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "milestone_done" }, (message) => {
      const payload = (message as { payload?: MilestoneBurstEvent }).payload;
      if (payload && payload.conversationId === conversationId && typeof payload.taskId === "string") {
        deliverLocally(payload);
      }
    });
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") resolve(channel);
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        channels.delete(conversationId);
        reject(new Error(`milestone channel ${state}`));
      }
    });
  });
  channels.set(conversationId, created);
  return created;
}

/**
 * Announces a closed milestone: plays locally for the person who just closed it, and
 * broadcasts to the room. Fire-and-forget — a failed broadcast must never look like a failed completion.
 */
export function fireMilestoneBurst(event: MilestoneBurstEvent): void {
  deliverLocally(event);
  void burstChannel(event.conversationId)
    .then((channel) => channel.send({ type: "broadcast", event: "milestone_done", payload: event }))
    .catch((error: unknown) => {
      logError("milestone-burst", error);
    });
}

/**
 * Listens on the rooms the viewer is in (group / project rooms only — milestones live there).
 * Rooms that left the list are closed, so a removed member stops hearing at once.
 */
export function syncMilestoneChannels(conversationIds: readonly string[]): void {
  const wanted = new Set(conversationIds.slice(0, 50));
  for (const [id, promise] of channels) {
    if (wanted.has(id)) continue;
    channels.delete(id);
    void promise.then((channel) => supabase.removeChannel(channel)).catch(() => undefined);
  }
  for (const id of wanted) {
    void burstChannel(id).catch((error: unknown) => logError("milestone-burst", error));
  }
}
