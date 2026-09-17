import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  fetchMessageTaskMarks,
  messageTaskKeys,
  summarizeMessageTasks,
  type MessageTaskMark,
  type MessageTaskSummary,
} from "@/lib/message-tasks";

/**
 * Which messages in this thread produced work, read in one batch.
 *
 * Keyed by conversation and by the ids on screen, exactly like `useThreadReactions`: a thread
 * renders every bubble at once, so one query serves all of them and messages arriving later
 * pull their own marks in by changing the key.
 *
 * A journal has no suggestions in it, so passing `undefined` switches the whole thing off
 * rather than asking for rows that cannot exist.
 */
export function useMessageTasks(
  conversationId: string | undefined,
  messageIds: readonly string[],
): { markFor: (messageId: string) => MessageTaskSummary | null } {
  const { user } = useAuth();
  const userId = user?.id;

  const queryKey = useMemo(
    () => [...messageTaskKeys.thread(conversationId ?? ""), messageIds.join(",")],
    [conversationId, messageIds],
  );

  const { data } = useQuery<MessageTaskMark[], Error>({
    queryKey,
    queryFn: () => fetchMessageTaskMarks(messageIds),
    enabled: Boolean(conversationId) && Boolean(userId) && messageIds.length > 0,
    staleTime: 15_000,
  });

  const marks = useMemo(() => data ?? [], [data]);

  const markFor = useCallback(
    (messageId: string): MessageTaskSummary | null =>
      summarizeMessageTasks(marks, messageId, userId),
    [marks, userId],
  );

  return { markFor };
}
