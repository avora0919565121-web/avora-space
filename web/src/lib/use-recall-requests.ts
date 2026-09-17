import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  fetchRecallRequests,
  hasAsked,
  recallRequestKeys,
  requestRecall,
  requestsFor,
  resolveRecallRequests,
  type RecallRequest,
} from "@/lib/recall-requests";

/**
 * The open "please take that back" asks in one conversation, and the two actions on them.
 *
 * RLS decides what comes back: the sender sees asks about their own messages, and an asker
 * sees their own. Nobody sees a third party's ask, so a room cannot be read for who is
 * annoyed with whom.
 */
export function useRecallRequests(conversationId: string | undefined): {
  requests: RecallRequest[];
  askedBy: (messageId: string) => RecallRequest[];
  hasAskedFor: (messageId: string) => boolean;
  ask: (messageId: string) => Promise<void>;
  resolve: (messageId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data } = useQuery<RecallRequest[], Error>({
    queryKey: recallRequestKeys.thread(conversationId ?? ""),
    queryFn: () => fetchRecallRequests(conversationId as string),
    enabled: Boolean(conversationId) && Boolean(userId),
    staleTime: 30_000,
  });

  const requests = useMemo(() => data ?? [], [data]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: recallRequestKeys.all });
  }, [queryClient]);

  const askMutation = useMutation({
    mutationFn: (messageId: string) => requestRecall(messageId, userId as string),
    onSuccess: invalidate,
  });

  const resolveMutation = useMutation({
    mutationFn: (messageId: string) => resolveRecallRequests(messageId),
    onSuccess: invalidate,
  });

  const ask = useCallback(
    async (messageId: string): Promise<void> => {
      if (userId === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      await askMutation.mutateAsync(messageId);
    },
    [askMutation, userId],
  );

  const resolve = useCallback(
    async (messageId: string): Promise<void> => {
      await resolveMutation.mutateAsync(messageId);
    },
    [resolveMutation],
  );

  return {
    requests,
    askedBy: useCallback((messageId: string) => requestsFor(requests, messageId), [requests]),
    hasAskedFor: useCallback(
      (messageId: string) => hasAsked(requests, messageId, userId),
      [requests, userId],
    ),
    ask,
    resolve,
    isWorking: askMutation.isPending || resolveMutation.isPending,
  };
}
