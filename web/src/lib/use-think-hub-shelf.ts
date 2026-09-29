import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth";
import { thinkHubKeys } from "@/lib/think-hub";
import {
  applyTemplate,
  copyRecord,
  copyTableToJournal,
  createTableFromTemplate,
  deleteUserTemplate,
  ensureBookshelf,
  fetchProposals,
  fetchSharedTrash,
  fetchStars,
  fetchTemplates,
  moveRecord,
  proposalKeys,
  proposeShared,
  purgeTable,
  restoreSharedTable,
  saveTableAsTemplate,
  setTableArchived,
  toggleStar,
  voteProposal,
  withdrawProposal,
  type BoardTemplate,
  type ProposalAction,
  type ProposalTarget,
  type SharedProposal,
  type SharedTrashItem,
} from "@/lib/think-hub-shelf";

export const shelfKeys = {
  templates: ["think-hub", "templates"] as const,
  stars: ["think-hub", "stars"] as const,
  sharedTrash: ["think-hub", "shared-trash"] as const,
};

export function useTemplates(): UseQueryResult<BoardTemplate[], Error> {
  const { user } = useAuth();
  return useQuery<BoardTemplate[], Error>({ queryKey: shelfKeys.templates, queryFn: fetchTemplates, enabled: Boolean(user?.id), staleTime: 5 * 60_000 });
}

export function useStars(): UseQueryResult<Set<string>, Error> {
  const { user } = useAuth();
  return useQuery<Set<string>, Error>({ queryKey: shelfKeys.stars, queryFn: fetchStars, enabled: Boolean(user?.id), staleTime: 60_000 });
}

export function useSharedTrash(enabled: boolean): UseQueryResult<SharedTrashItem[], Error> {
  const { user } = useAuth();
  return useQuery<SharedTrashItem[], Error>({ queryKey: shelfKeys.sharedTrash, queryFn: fetchSharedTrash, enabled: Boolean(user?.id) && enabled });
}

/** Every proposal in every conversation the viewer is in (RLS). Realtime refreshes this key. */
export function useProposals(): UseQueryResult<SharedProposal[], Error> {
  const { user } = useAuth();
  return useQuery<SharedProposal[], Error>({ queryKey: proposalKeys.all, queryFn: fetchProposals, enabled: Boolean(user?.id), staleTime: 30_000 });
}

/** Writes around a table. Each refreshes the whole HUB: archive, bin and move all change what lists show. */
export function useShelfActions() {
  const queryClient = useQueryClient();
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
    void queryClient.invalidateQueries({ queryKey: proposalKeys.all });
  }, [queryClient]);

  const fromTemplate = useMutation({ mutationFn: createTableFromTemplate, onSuccess: refresh });
  const apply = useMutation({
    mutationFn: ({ tableId, template }: { tableId: string; template: BoardTemplate }) => applyTemplate(tableId, template),
    onSuccess: refresh,
  });
  const saveTemplate = useMutation({
    mutationFn: ({ tableId, name }: { tableId: string; name: string }) => saveTableAsTemplate(tableId, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: shelfKeys.templates }),
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => deleteUserTemplate(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: shelfKeys.templates }),
  });
  const star = useMutation({
    mutationFn: (recordId: string) => toggleStar(recordId),
    onMutate: async (recordId: string) => {
      await queryClient.cancelQueries({ queryKey: shelfKeys.stars });
      const before = queryClient.getQueryData<Set<string>>(shelfKeys.stars);
      const next = new Set(before ?? []);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      queryClient.setQueryData(shelfKeys.stars, next);
      return { before };
    },
    onError: (_error, _id, context) => {
      if (context?.before !== undefined) queryClient.setQueryData(shelfKeys.stars, context.before);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: shelfKeys.stars }),
  });
  const archive = useMutation({
    mutationFn: ({ tableId, archived }: { tableId: string; archived: boolean }) => setTableArchived(tableId, archived),
    onSuccess: refresh,
  });
  const purge = useMutation({
    mutationFn: ({ tableId, name }: { tableId: string; name: string }) => purgeTable(tableId, name),
    onSuccess: refresh,
  });
  const restoreShared = useMutation({
    mutationFn: (tableId: string) => restoreSharedTable(tableId),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: shelfKeys.sharedTrash });
    },
  });
  const copyToJournal = useMutation({ mutationFn: (tableId: string) => copyTableToJournal(tableId), onSuccess: refresh });
  const propose = useMutation({
    mutationFn: (input: { action: ProposalAction; targetType: ProposalTarget; targetId: string; reason: string }) => proposeShared(input),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const vote = useMutation({
    mutationFn: ({ proposalId, vote: choice, reason }: { proposalId: string; vote: "agree" | "disagree"; reason: string | null }) =>
      voteProposal(proposalId, choice, reason),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const withdraw = useMutation({ mutationFn: (proposalId: string) => withdrawProposal(proposalId), onSuccess: refresh });
  const move = useMutation({
    mutationFn: ({ recordId, targetTableId }: { recordId: string; targetTableId: string }) => moveRecord(recordId, targetTableId),
    onSuccess: refresh,
  });
  const copy = useMutation({
    mutationFn: ({ recordId, targetTableId }: { recordId: string; targetTableId: string }) => copyRecord(recordId, targetTableId),
    onSuccess: refresh,
  });
  const bookshelf = useMutation({ mutationFn: ensureBookshelf, onSuccess: refresh });

  return { fromTemplate, apply, saveTemplate, removeTemplate, star, archive, purge, restoreShared, copyToJournal, propose, vote, withdraw, move, copy, bookshelf };
}
