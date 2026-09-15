import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * The moment a milestone closes, everyone in the room hears it — carried by a realtime
 * broadcast, not the database.
 *
 * Nothing about the burst is persisted: there is no table, no unread counter, no history.
 * It exists for the few seconds it takes to play, exactly like the confetti on the other
 * side of the screen. The broadcast payload carries only opaque ids — no titles, no names —
 * because the topic itself is not access-controlled; whoever receives it reconstructs the
 * meaning from their own caches, and a non-participant reconstructs nothing.
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

let channelPromise: Promise<RealtimeChannel> | null = null;

/**
 * Joins the burst topic once per page. The broadcast handler fans out to local subscribers,
 * so both the sender's own action and the network echo arrive through the same door.
 */
function burstChannel(): Promise<RealtimeChannel> {
  if (channelPromise === null) {
    channelPromise = new Promise((resolve) => {
      const channel = supabase.channel("avora-milestone", {
        config: { broadcast: { self: false } },
      });
      channel.on("broadcast", { event: "milestone_done" }, (message) => {
        const payload = (message as { payload?: MilestoneBurstEvent }).payload;
        if (payload && typeof payload.conversationId === "string" && typeof payload.taskId === "string") {
          deliverLocally(payload);
        }
      });
      channel.subscribe((state) => {
        if (state === "SUBSCRIBED") resolve(channel);
      });
    });
  }
  return channelPromise;
}

/**
 * Announces a closed milestone: plays locally for the person who just closed it, and
 * broadcasts to everyone else in the room. Fire-and-forget — a failed broadcast must never
 * look like a failed completion.
 */
export function fireMilestoneBurst(event: MilestoneBurstEvent): void {
  deliverLocally(event);
  void burstChannel()
    .then((channel) =>
      channel.send({ type: "broadcast", event: "milestone_done", payload: event }),
    )
    .catch((error: unknown) => {
      console.error("[milestone-burst] broadcast failed", error);
    });
}

/** Prepares the receive path. Called once the signed-in app mounts its burst layer. */
export function warmMilestoneChannel(): void {
  void burstChannel().catch((error: unknown) => {
    console.error("[milestone-burst] channel failed", error);
  });
}
