import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { groupKeys, type GroupMember } from "@/lib/groups";
import { taskOwnership, UNKNOWN_PERSON, type TaskOwnership } from "@/lib/task-owner";
import type { TaskItem } from "@/lib/tasks";
import { useConnections } from "@/lib/use-connections";
import { useConversations } from "@/lib/use-conversations";

/**
 * Display names for the people around the viewer's tasks: bạn bè, 1-1 peers and any group roster
 * already loaded. Display names only — an email is never a name (AVORA-59 · B).
 */
export function usePeopleNames(): {
  nameOf: (id: string | null) => string;
  peerOf: (conversationId: string | null) => string | null;
} {
  const { user, profile } = useAuth();
  const { byId } = useConnections();
  const { data: conversations } = useConversations();
  const queryClient = useQueryClient();

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of conversations ?? []) {
      if (item.peerId !== null && item.peerName.trim() !== "" && !item.peerName.includes("@")) map.set(item.peerId, item.peerName);
    }
    for (const [id, person] of byId) {
      const name = person.displayName?.trim() ?? "";
      if (name !== "") map.set(id, name);
    }
    return map;
  }, [conversations, byId]);

  const peers = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of conversations ?? []) if (item.kind === "direct" && item.peerId !== null) map.set(item.conversationId, item.peerId);
    return map;
  }, [conversations]);

  const nameOf = useCallback(
    (id: string | null): string => {
      if (id === null) return UNKNOWN_PERSON;
      if (id === user?.id) return profile?.display_name?.trim() || "Tôi";
      const known = names.get(id);
      if (known !== undefined) return known;
      // Any group roster already in the cache (list_group_members never carries emails).
      for (const [, members] of queryClient.getQueriesData<GroupMember[]>({ queryKey: groupKeys.members("").slice(0, 1) })) {
        const hit = members?.find((member) => member.userId === id);
        if (hit !== undefined && hit.displayName.trim() !== "") return hit.displayName;
      }
      return UNKNOWN_PERSON;
    },
    [names, queryClient, user?.id, profile?.display_name],
  );

  const peerOf = useCallback((conversationId: string | null): string | null => (conversationId === null ? null : (peers.get(conversationId) ?? null)), [peers]);

  return { nameOf, peerOf };
}

/** `taskOwnership` with names resolved for the signed-in viewer. */
export function useTaskOwnership(task: TaskItem): TaskOwnership {
  const { user } = useAuth();
  const { nameOf, peerOf } = usePeopleNames();
  return useMemo(() => taskOwnership(task, user?.id, nameOf, peerOf), [task, user?.id, nameOf, peerOf]);
}
