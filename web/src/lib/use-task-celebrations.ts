import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { burstsFor, celebrationKeys, fetchPendingCelebrations, hasMilestone, markCelebrationsSeen } from "@/lib/task-celebrations";
import { celebrate } from "@/lib/confetti";
import { useDocumentVisible } from "@/lib/use-document-visible";

/**
 * Plays the celebrations that were waiting in a conversation, once.
 *
 * This is the other half of the live burst, not a replacement for it: whoever is looking
 * when work closes still sees it immediately over realtime. This covers the far more common
 * case — nobody was there — by keeping the moment until they next open the room.
 *
 * Three rules make it a celebration rather than a notification:
 *  - it fires only when the conversation is actually on screen (a hidden tab is not visiting),
 *  - it is marked seen straight after playing, so it never greets the same person twice,
 *  - a failed write leaves it pending, because replaying beats losing it.
 */
export function useThreadCelebrations(conversationId: string | undefined): void {
  const { user } = useAuth();
  const userId = user?.id;
  const isVisible = useDocumentVisible();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: celebrationKeys.thread(conversationId ?? ""),
    queryFn: () => fetchPendingCelebrations(conversationId as string, userId as string),
    enabled: Boolean(conversationId) && Boolean(userId) && isVisible,
    staleTime: 15_000,
  });

  const { mutate: markSeen } = useMutation({
    mutationFn: (taskIds: readonly string[]) => markCelebrationsSeen(taskIds, userId as string),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: celebrationKeys.all });
    },
  });

  /** Which task ids this page has already celebrated, so a refetch cannot replay them. */
  const playedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!conversationId || !userId || !isVisible) return;
    const pending = (data ?? []).filter((entry) => !playedRef.current.has(entry.taskId));
    if (pending.length === 0) return;

    for (const entry of pending) playedRef.current.add(entry.taskId);

    celebrate(hasMilestone(pending) ? "milestone" : "task", burstsFor(pending));
    markSeen(pending.map((entry) => entry.taskId));
  }, [conversationId, userId, isVisible, data, markSeen]);
}
