import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  addReaction,
  fetchReactions,
  groupReactions,
  hasReacted,
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

  // The ids are part of the key so messages arriving later pull their own reactions in.
  const queryKey = useMemo(
    () => [...reactionKeys.thread(conversationId ?? ""), messageIds.join(",")],
    [conversationId, messageIds],
  );

  const { data } = useQuery<MessageReaction[], Error>({
    queryKey,
    queryFn: () => fetchReactions(messageIds),
    enabled: Boolean(conversationId) && Boolean(userId) && messageIds.length > 0,
    staleTime: 15_000,
  });

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
    onError: (error: Error, _variables, context) => {
      console.error("[reactions] could not save", error);
      toast.error("Không lưu được cảm xúc, thử lại nhé.");
      const previous = (context as { previous?: MessageReaction[] } | undefined)?.previous;
      if (previous !== undefined) queryClient.setQueryData<MessageReaction[]>(queryKey, previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reactionKeys.all });
    },
  });

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
