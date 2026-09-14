import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  fetchPins,
  isQuotaFull,
  orderedPins,
  pinFor,
  pinKeys,
  pinMessage,
  unpinMessage,
  usedPins,
  type MessagePin,
  type PinScope,
} from "@/lib/pins";

/**
 * The pins of one conversation, and the two actions that change them.
 *
 * What comes back is already scoped by RLS — every shared pin in the room, plus only this
 * reader's own private ones — so nothing here has to filter by audience a second time.
 */
export function useThreadPins(conversationId: string | undefined): {
  pins: MessagePin[];
  ordered: MessagePin[];
  pinOf: (messageId: string, scope: PinScope) => MessagePin | null;
  used: (scope: PinScope) => number;
  isFull: (scope: PinScope) => boolean;
  pin: (messageId: string, scope: PinScope) => Promise<void>;
  unpin: (pinId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data } = useQuery<MessagePin[], Error>({
    queryKey: pinKeys.thread(conversationId ?? ""),
    queryFn: () => fetchPins(conversationId as string),
    enabled: Boolean(conversationId) && Boolean(userId),
    staleTime: 30_000,
  });

  const pins = useMemo(() => data ?? [], [data]);
  const ordered = useMemo(() => orderedPins(pins), [pins]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: pinKeys.all });
  }, [queryClient]);

  const pinMutation = useMutation({
    mutationFn: ({ messageId, scope }: { messageId: string; scope: PinScope }) =>
      pinMessage(messageId, scope),
    onSuccess: invalidate,
  });

  const unpinMutation = useMutation({
    mutationFn: (pinId: string) => unpinMessage(pinId),
    onSuccess: invalidate,
  });

  const pin = useCallback(
    async (messageId: string, scope: PinScope): Promise<void> => {
      await pinMutation.mutateAsync({ messageId, scope });
    },
    [pinMutation],
  );

  const unpin = useCallback(
    async (pinId: string): Promise<void> => {
      await unpinMutation.mutateAsync(pinId);
    },
    [unpinMutation],
  );

  return {
    pins,
    ordered,
    pinOf: useCallback(
      (messageId: string, scope: PinScope) => pinFor(pins, messageId, scope, userId),
      [pins, userId],
    ),
    used: useCallback((scope: PinScope) => usedPins(pins, scope, userId), [pins, userId]),
    isFull: useCallback((scope: PinScope) => isQuotaFull(pins, scope, userId), [pins, userId]),
    pin,
    unpin,
    isWorking: pinMutation.isPending || unpinMutation.isPending,
  };
}
