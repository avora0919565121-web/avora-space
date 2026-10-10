import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/lib/auth";
import {
  chatKeys,
  fetchConversations,
  fetchInboxUnreadCounts,
  growInboxPage,
  inboxHasMore,
  subscribeInboxPaging,
  totalUnread,
  type ConversationSummary,
  type InboxUnreadCounts,
} from "@/lib/chat";
import { useChatRealtime } from "@/lib/realtime";

/**
 * Realtime is the delivery path; this interval only engages while the socket is down
 * (blocked websockets, flaky network) so the app degrades instead of going silent.
 */
export const OFFLINE_INBOX_POLL_MS = 10_000;

/**
 * Lives under the inbox key on purpose: every `invalidateQueries(chatKeys.conversations)` the app
 * already does refreshes the badge counts too, with no second place to remember.
 */
export const inboxUnreadKey = [...chatKeys.conversations, "unread-counts"] as const;

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

/** K3 · N9: whether more 1-1 threads wait past the loaded pages, and a way to bring the next 50. */
export function useInboxPaging(): { hasMore: boolean; isLoadingMore: boolean; loadMore: () => void } {
  const queryClient = useQueryClient();
  const hasMore: boolean = useSyncExternalStore(subscribeInboxPaging, inboxHasMore, () => false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const loadMore = useCallback((): void => {
    if (!inboxHasMore() || isLoadingMore) return;
    growInboxPage();
    setIsLoadingMore(true);
    void queryClient
      .refetchQueries({ queryKey: chatKeys.conversations, exact: true })
      .finally(() => setIsLoadingMore(false));
  }, [queryClient, isLoadingMore]);
  return { hasMore, isLoadingMore, loadMore };
}

/** Server-side unread totals per conversation kind (one light RPC). Only asked while the list is paged. */
export function useInboxUnreadCounts(): InboxUnreadCounts | null {
  const { user } = useAuth();
  const hasMore: boolean = useSyncExternalStore(subscribeInboxPaging, inboxHasMore, () => false);
  const query = useQuery<InboxUnreadCounts, Error>({
    queryKey: inboxUnreadKey,
    queryFn: fetchInboxUnreadCounts,
    enabled: Boolean(user?.id) && hasMore,
  });
  return hasMore ? (query.data ?? null) : null;
}

/** Total unread messages across every conversation. */
export function useTotalUnread(): number {
  const { data } = useConversations();
  const server = useInboxUnreadCounts();
  return useMemo(() => {
    const local = totalUnread(data ?? []);
    // While the list is paged, the server knows threads the device has not loaded yet.
    return server ? Math.max(local, server.total) : local;
  }, [data, server]);
}
