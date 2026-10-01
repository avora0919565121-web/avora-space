import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  announceBoardChanges,
  boardChangeKeys,
  fetchBoardChanges,
  marksSince,
  markBoardSeen,
  myPendingChanges,
  setAnnounceSettings,
  type BoardChange,
  type ChangeMarks,
} from "@/lib/board-changes";
import { useAuth } from "@/lib/auth";
import { thinkHubKeys } from "@/lib/think-hub";

/**
 * A shared board's change state for the viewer (AVORA-62): its log, my unannounced changes, and
 * what changed since I last opened it. Opening the board is remembered once per visit.
 */
export function useBoardChanges(tableId: string | null, isShared: boolean): {
  changes: readonly BoardChange[];
  pending: readonly BoardChange[];
  since: ChangeMarks;
  previousSeenAt: string | null;
  announce: ReturnType<typeof useAnnounceMutation>;
  isLoading: boolean;
} {
  const { user } = useAuth();
  const enabled = tableId !== null && isShared;
  const query = useQuery({
    queryKey: boardChangeKeys.table(tableId ?? ""),
    queryFn: () => fetchBoardChanges(tableId ?? ""),
    enabled,
    staleTime: 15_000,
  });
  const [previousSeenAt, setPreviousSeenAt] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || tableId === null || markedRef.current === tableId) return;
    markedRef.current = tableId;
    setPreviousSeenAt(null);
    markBoardSeen(tableId).then(
      (previous) => setPreviousSeenAt(previous ?? new Date(0).toISOString()),
      () => undefined,
    );
  }, [enabled, tableId]);

  const changes = useMemo(() => query.data ?? [], [query.data]);
  const pending = useMemo(() => myPendingChanges(changes, user?.id), [changes, user?.id]);
  // Nothing is "new since last time" on a first visit (previous unknown yet): no dots at all.
  const since = useMemo(
    () => marksSince(changes, previousSeenAt ?? new Date().toISOString(), user?.id),
    [changes, previousSeenAt, user?.id],
  );
  const announce = useAnnounceMutation(tableId);
  return { changes, pending, since, previousSeenAt, announce, isLoading: query.isPending && enabled };
}

function useAnnounceMutation(tableId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { note: string; notify: readonly string[]; mentions: readonly string[] }) =>
      announceBoardChanges({ tableId: tableId ?? "", ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardChangeKeys.all });
    },
  });
}

export function useAnnounceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAnnounceSettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all }),
  });
}
