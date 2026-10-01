import { logError } from "@/lib/log";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  addReaction,
  fetchReactions,
  groupReactions,
  hasReacted,
  hasUnseenMessageIds,
  reactionKeys,
  removeReaction,
  type MessageReaction,
  type ReactionGroup,
} from "@/lib/reactions";

/**
 * Reactions for one thread, plus the one action that changes them.
 *
 * Reading and writing live in the same hook on purpose: a chip is a toggle, so deciding
 * whether a press adds or removes needs the current rows. Splitting them meant the writer
 * looked at a different cache key than the reader filled, and would always have decided
 * "add" — the kind of bug that only shows up as "my reaction won't come off".
 *
 * Keyed by conversation rather than by message, because the thread renders every bubble at
 * once and a query per line would be a request per line.
 */
export function useThreadReactions(
  conversationId: string | undefined,
  messageIds: readonly string[],
): {
  groupsFor: (messageId: string) => ReactionGroup[];
  toggle: (messageId: string, emoji: string) => void;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  /*
   * Keyed by the conversation only (AVORA-35). With the message ids in the key, every new
   * message made a brand-new query whose data started `undefined`, so every chip — including
   * the one just tapped — blinked out until the refetch landed. The ids now reach the fetch
   * through a ref, and a refetch is asked for explicitly when ids the cache has never covered
   * appear (a new message, or older ones loaded by scrolling up).
   */
  const queryKey = useMemo(() => reactionKeys.thread(conversationId ?? ""), [conversationId]);
  const idsRef = useRef<readonly string[]>(messageIds);
  idsRef.current = messageIds;
  const fetchedRef = useRef<Set<string>>(new Set<string>());

  const { data, refetch } = useQuery<MessageReaction[], Error>({
    queryKey,
    queryFn: () => {
      const ids = idsRef.current;
      fetchedRef.current = new Set<string>(ids);
      return fetchReactions(ids);
    },
    enabled: Boolean(conversationId) && Boolean(userId) && messageIds.length > 0,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });

  // A different thread starts from nothing covered.
  useEffect(() => {
    fetchedRef.current = new Set<string>();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !userId || messageIds.length === 0) return;
    if (fetchedRef.current.size === 0) return; // the first fetch is still on its way
    if (hasUnseenMessageIds(fetchedRef.current, messageIds)) void refetch();
  }, [conversationId, userId, messageIds, refetch]);

  const reactions = useMemo(() => data ?? [], [data]);

  const mutation = useMutation({
    mutationFn: ({
      messageId,
      emoji,
      remove,
    }: {
      messageId: string;
      emoji: string;
      remove: boolean;
    }) =>
      remove
        ? removeReaction(messageId, userId ?? "", emoji)
        : addReaction(messageId, userId ?? "", emoji),
    /**
     * Applied to the cache immediately, then reconciled.
     *
     * A reaction is a one-tap gesture, and waiting a round trip to see it land makes the tap
     * feel ignored — people press again, which with a toggle means undoing it.
     */
    onMutate: ({ messageId, emoji, remove }) => {
      if (userId === undefined) return;
      const previous = queryClient.getQueryData<MessageReaction[]>(queryKey);
      if (previous === undefined) return;
      const next = remove
        ? previous.filter(
            (entry) =>
              !(entry.messageId === messageId && entry.userId === userId && entry.emoji === emoji),
          )
        : [...previous, { messageId, userId, emoji }];
      queryClient.setQueryData<MessageReaction[]>(queryKey, next);
      return { previous };
    },
    onError: (error: Error, variables, context) => {
      logError("reactions", error);
      // AVORA-47 · H: take the chip back off, then offer the same press again.
      const previous = (context as { previous?: MessageReaction[] } | undefined)?.previous;
      if (previous !== undefined) queryClient.setQueryData<MessageReaction[]>(queryKey, previous);
      toast.error("Chưa lưu được cảm xúc", {
        action: { label: "Thử lại", onClick: () => retryRef.current?.(variables) },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reactionKeys.all });
    },
  });

  const retryRef = useRef<((variables: { messageId: string; emoji: string; remove: boolean }) => void) | null>(null);
  retryRef.current = (variables) => mutation.mutate(variables);

  /** Pressing your own reaction again takes it back; pressing a new one adds it. */
  const toggle = useCallback(
    (messageId: string, emoji: string): void => {
      if (userId === undefined) return;
      const remove = hasReacted(reactions, messageId, userId, emoji);
      mutation.mutate({ messageId, emoji, remove });
    },
    [mutation, reactions, userId],
  );

  const groupsFor = useCallback(
    (messageId: string): ReactionGroup[] => groupReactions(reactions, messageId, userId),
    [reactions, userId],
  );

  return { groupsFor, toggle, isWorking: mutation.isPending };
}
