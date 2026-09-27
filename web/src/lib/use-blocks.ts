import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { blockKeys, blockUser, fetchMyBlocks, unblockUser, type BlockedPerson } from "@/lib/blocks";
import { chatKeys } from "@/lib/chat";

/**
 * The people the viewer has blocked. RLS only ever returns the viewer's own rows, so this can
 * say "you blocked them" but never "they blocked you" — that stays invisible by design.
 */
export function useBlocks(): {
  blocks: BlockedPerson[];
  isLoading: boolean;
  isBlocked: (userId: string | null | undefined) => boolean;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading } = useQuery<BlockedPerson[], Error>({
    queryKey: blockKeys.list,
    queryFn: fetchMyBlocks,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });

  const blocks = useMemo(() => data ?? [], [data]);
  const blockedIds = useMemo(() => new Set(blocks.map((person) => person.userId)), [blocks]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: blockKeys.all });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  }, [queryClient]);

  const blockMutation = useMutation({ mutationFn: blockUser, onSuccess: invalidate });
  const unblockMutation = useMutation({ mutationFn: unblockUser, onSuccess: invalidate });

  return {
    blocks,
    isLoading,
    isBlocked: useCallback((id: string | null | undefined) => (id ? blockedIds.has(id) : false), [blockedIds]),
    block: useCallback(async (id: string) => blockMutation.mutateAsync(id), [blockMutation]),
    unblock: useCallback(async (id: string) => unblockMutation.mutateAsync(id), [unblockMutation]),
    isWorking: blockMutation.isPending || unblockMutation.isPending,
  };
}
