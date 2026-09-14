import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Who is in this thread right now, and who is typing.
 *
 * Neither is stored. Typing is a broadcast that expires on its own, and presence is held by
 * the socket — so closing the tab makes both facts disappear rather than leaving a stale
 * "online" row behind that nobody can correct.
 *
 * This is also why there is no "last seen at": a timestamp would outlive the moment it
 * described and quietly become a log of when someone was at their desk. Online or not is
 * the whole answer.
 */

/** A typing signal is only believed this long; the sender re-sends while still typing. */
export const TYPING_TTL_MS = 4_000;

/** How often a continuously typing person re-announces, comfortably inside the TTL. */
const TYPING_HEARTBEAT_MS = 2_000;

type TypingPayload = { userId: string; at: number };

export type ThreadPresence = {
  /** Ids of other people currently typing — never includes the viewer. */
  typingUserIds: string[];
  /** Ids of other people with this thread open. */
  onlineUserIds: string[];
  /** Call on every keystroke; safe to call often, it rate-limits itself. */
  notifyTyping: () => void;
  /** Call once a message is sent, so the indicator stops immediately. */
  clearTyping: () => void;
};

/**
 * The sentence shown under the header: who is typing, in Vietnamese.
 *
 * A 1-1 needs no name — there is only one other person, and "Người kia đang nhập" reads like
 * a stranger. A group names one person, counts two, and gives up past that: five names is not
 * information, it is noise.
 */
export function typingText(userIds: readonly string[], nameOf: (id: string) => string): string | null {
  if (userIds.length === 0) return null;
  if (userIds.length === 1) return `${nameOf(userIds[0] as string)} đang nhập…`;
  if (userIds.length === 2)
    return `${nameOf(userIds[0] as string)} và ${nameOf(userIds[1] as string)} đang nhập…`;
  return `${userIds.length} người đang nhập…`;
}

export function useThreadPresence(
  conversationId: string | undefined,
  /** False stops this person's own signal going out. Seeing others is unaffected. */
  sendsTypingSignal: boolean,
): ThreadPresence {
  const { user } = useAuth();
  const userId = user?.id;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef<number>(0);
  const [typingAt, setTypingAt] = useState<Record<string, number>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (conversationId === undefined || userId === undefined) {
      setTypingAt({});
      setOnlineUserIds([]);
      return;
    }

    const channel = supabase.channel(`thread-${conversationId}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const signal = payload as TypingPayload;
        // Your own keystrokes are not news to you.
        if (signal.userId === userId) return;
        setTypingAt((current) => ({ ...current, [signal.userId]: Date.now() }));
      })
      .on("broadcast", { event: "typing-stop" }, ({ payload }) => {
        const signal = payload as TypingPayload;
        if (signal.userId === userId) return;
        setTypingAt((current) => {
          if (current[signal.userId] === undefined) return current;
          const next = { ...current };
          delete next[signal.userId];
          return next;
        });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUserIds(Object.keys(state).filter((id) => id !== userId));
      })
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;
        void channel.track({ at: Date.now() });
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
      setTypingAt({});
      setOnlineUserIds([]);
    };
  }, [conversationId, userId]);

  /**
   * Expire stale signals on a timer.
   *
   * Without this, someone who starts typing and then closes their laptop would appear to be
   * typing forever — the indicator has to be able to go out on its own, not only when a stop
   * message happens to arrive.
   */
  useEffect(() => {
    if (Object.keys(typingAt).length === 0) return;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - TYPING_TTL_MS;
      setTypingAt((current) => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const [id, at] of Object.entries(current)) {
          if (at >= cutoff) next[id] = at;
          else changed = true;
        }
        return changed ? next : current;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [typingAt]);

  const notifyTyping = useCallback((): void => {
    if (!sendsTypingSignal || userId === undefined) return;
    const channel = channelRef.current;
    if (channel === null) return;
    // One announcement per heartbeat, however fast someone types.
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_HEARTBEAT_MS) return;
    lastSentRef.current = now;
    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId, at: now } satisfies TypingPayload,
    });
  }, [sendsTypingSignal, userId]);

  const clearTyping = useCallback((): void => {
    if (userId === undefined) return;
    const channel = channelRef.current;
    if (channel === null) return;
    lastSentRef.current = 0;
    void channel.send({
      type: "broadcast",
      event: "typing-stop",
      payload: { userId, at: Date.now() } satisfies TypingPayload,
    });
  }, [userId]);

  const typingUserIds = useMemo(() => {
    const cutoff = Date.now() - TYPING_TTL_MS;
    return Object.entries(typingAt)
      .filter(([, at]) => at >= cutoff)
      .map(([id]) => id);
  }, [typingAt]);

  return { typingUserIds, onlineUserIds, notifyTyping, clearTyping };
}
