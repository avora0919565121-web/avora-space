import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { chatKeys, fetchConversations, totalUnread, type ConversationSummary } from "@/lib/chat";
import { useChatRealtime } from "@/lib/realtime";

/**
 * Realtime is the delivery path; this interval only engages while the socket is down
 * (blocked websockets, flaky network) so the app degrades instead of going silent.
 */
export const OFFLINE_INBOX_POLL_MS = 10_000;

/**
 * The inbox query, shared by every screen through one React Query key so the
 * sidebar badge, Tin nhắn and Liên hệ always agree without extra requests.
 */
export function useConversations(): UseQueryResult<ConversationSummary[], Error> {
  const { user } = useAuth();
  const { isLive } = useChatRealtime();

  return useQuery<ConversationSummary[], Error>({
    queryKey: chatKeys.conversations,
    queryFn: fetchConversations,
    enabled: Boolean(user?.id),
    refetchInterval: isLive ? false : OFFLINE_INBOX_POLL_MS,
  });
}

/** Total unread messages across every conversation. */
export function useTotalUnread(): number {
  const { data } = useConversations();
  return useMemo(() => totalUnread(data ?? []), [data]);
}
