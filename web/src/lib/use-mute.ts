import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  clearMute,
  fetchMuteSettings,
  isScopeMuted,
  muteKeys,
  setMute,
  shouldBlockNotification,
  toMuteIndex,
  type MuteDecision,
  type MuteIndex,
  type MuteScope,
  type MuteSetting,
  type NotificationEvent,
} from "@/lib/mute";

/**
 * The viewer's own mute layers, and the decision they drive.
 *
 * Private to them: RLS returns only their rows, so whether someone has silenced a group is
 * never visible to the group — a quiet hour should not become a social statement.
 */
export function useMuteSettings(): {
  index: MuteIndex;
  settings: MuteSetting[];
  mutedUntil: (scope: MuteScope) => string | null;
  isMuted: (scope: MuteScope) => boolean;
  decide: (event: NotificationEvent) => MuteDecision;
  mute: (scope: MuteScope, until: Date) => Promise<void>;
  unmute: (scope: MuteScope) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data } = useQuery<MuteSetting[], Error>({
    queryKey: muteKeys.list,
    queryFn: fetchMuteSettings,
    enabled: Boolean(userId),
    // A mute ends on a clock, so the list is re-read often enough to notice silence lifting.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const settings = useMemo(() => data ?? [], [data]);
  const index = useMemo(() => toMuteIndex(settings), [settings]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: muteKeys.all });
  }, [queryClient]);

  const muteMutation = useMutation({
    mutationFn: ({ scope, until }: { scope: MuteScope; until: Date }) =>
      setMute(userId ?? "", scope, until),
    onSuccess: invalidate,
  });

  const unmuteMutation = useMutation({
    mutationFn: (scope: MuteScope) => clearMute(scope),
    onSuccess: invalidate,
  });

  return {
    index,
    settings,
    mutedUntil: useCallback((scope: MuteScope) => index.get(scope) ?? null, [index]),
    isMuted: useCallback((scope: MuteScope) => isScopeMuted(index, scope), [index]),
    decide: useCallback(
      (event: NotificationEvent) => shouldBlockNotification(index, event),
      [index],
    ),
    mute: useCallback(
      async (scope: MuteScope, until: Date): Promise<void> => {
        if (userId === undefined) return;
        await muteMutation.mutateAsync({ scope, until });
      },
      [muteMutation, userId],
    ),
    unmute: useCallback(
      async (scope: MuteScope): Promise<void> => {
        await unmuteMutation.mutateAsync(scope);
      },
      [unmuteMutation],
    ),
    isWorking: muteMutation.isPending || unmuteMutation.isPending,
  };
}
