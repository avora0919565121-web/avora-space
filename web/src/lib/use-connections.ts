import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { chatKeys } from "@/lib/chat";
import {
  connectionKeys,
  fetchConnectionRequests,
  fetchMyConnections,
  removeConnection,
  startPinConnection,
  type Connection,
  type ConnectionRequest,
} from "@/lib/connections";

/** Requests waiting on the viewer (AVORA-56 · A). Shared by the Kết nối row and the list. */
export function useConnectionRequests(): { requests: ConnectionRequest[]; isLoading: boolean } {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<ConnectionRequest[], Error>({
    queryKey: connectionKeys.requests,
    queryFn: fetchConnectionRequests,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  return { requests: useMemo(() => data ?? [], [data]), isLoading };
}

/** The viewer's bạn bè, shared by Liên hệ, the pickers and the thread header. */
export function useConnections(): {
  connections: Connection[];
  isLoading: boolean;
  byId: ReadonlyMap<string, Connection>;
  isConnected: (userId: string | null | undefined) => boolean;
  connectByPin: (pin: string, message: string) => Promise<string>;
  remove: (userId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<Connection[], Error>({
    queryKey: connectionKeys.list,
    queryFn: fetchMyConnections,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });

  const connections = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => new Map(connections.map((item) => [item.userId, item] as const)), [connections]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  }, [queryClient]);

  const connectMutation = useMutation({
    mutationFn: ({ pin, message }: { pin: string; message: string }) => startPinConnection(pin, message),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({ mutationFn: removeConnection, onSuccess: invalidate });

  return {
    connections,
    isLoading,
    byId,
    isConnected: useCallback((id: string | null | undefined) => (id ? byId.has(id) : false), [byId]),
    connectByPin: useCallback(
      async (pin: string, message: string) => connectMutation.mutateAsync({ pin, message }),
      [connectMutation],
    ),
    remove: useCallback(async (id: string) => removeMutation.mutateAsync(id), [removeMutation]),
    isWorking: connectMutation.isPending || removeMutation.isPending,
  };
}
