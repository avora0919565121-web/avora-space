import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { celebrationKeys, fetchPendingCelebrations, markCelebrationsSeen } from "@/lib/task-celebrations";
import { useDocumentVisible } from "@/lib/use-document-visible";

/**
 * Settles the celebrations that were waiting in a conversation — without playing them.
 *
 * The completion effect belongs to the moment someone actually confirms the work. Replaying it
 * when a room is opened later would be an effect on load for work finished before the screen
 * appeared, which is exactly what it must not do. The waiting entries are still marked seen, so
 * nothing piles up and nothing plays late. The live moment is unchanged: whoever confirms sees
 * it, and whoever is looking when a milestone closes sees it over realtime.
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

  /** Which task ids this page has already settled, so a refetch cannot resend the write. */
  const playedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!conversationId || !userId || !isVisible) return;
    const pending = (data ?? []).filter((entry) => !playedRef.current.has(entry.taskId));
    if (pending.length === 0) return;

    for (const entry of pending) playedRef.current.add(entry.taskId);

    markSeen(pending.map((entry) => entry.taskId));
  }, [conversationId, userId, isVisible, data, markSeen]);
}
