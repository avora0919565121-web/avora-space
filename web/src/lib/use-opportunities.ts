import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  contactsWithOpenOpportunity,
  createOpportunity,
  deleteOpportunity,
  fetchOpportunities,
  leadOpportunityOf,
  linkOpportunityConversation,
  opportunitiesOf,
  opportunityKeys,
  updateOpportunityDetails,
  updateOpportunityStage,
  type Opportunity,
  type OpportunityStage,
} from "@/lib/opportunities";

/**
 * Every opportunity the viewer owns, in one query.
 *
 * Read whole rather than per contact, like the address book and the channel list: the contact
 * list needs to know which of hundreds of rows deserve a badge, and a query per contact would
 * turn scrolling the book into a request per row.
 */
export function useOpportunities(): UseQueryResult<Opportunity[], Error> {
  const { user } = useAuth();

  return useQuery<Opportunity[], Error>({
    queryKey: opportunityKeys.list,
    queryFn: fetchOpportunities,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** The opportunities on one contact, plus the one that speaks for it. */
export function useContactOpportunities(contactId: string | undefined): {
  opportunities: Opportunity[];
  lead: Opportunity | null;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const query = useOpportunities();

  const opportunities = useMemo(
    () => (contactId === undefined ? [] : opportunitiesOf(query.data ?? [], contactId)),
    [query.data, contactId],
  );

  const lead = useMemo(
    () => (contactId === undefined ? null : leadOpportunityOf(query.data ?? [], contactId)),
    [query.data, contactId],
  );

  return {
    opportunities,
    lead,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Which contacts have something still in play, for the address book badge.
 *
 * A set built once per book rather than a lookup per row, and derived from the same query
 * everything else reads — so a deal closed a second ago stops badging its contact without a
 * second cache to go stale.
 */
export function useOpenOpportunityContacts(): ReadonlySet<string> {
  const query = useOpportunities();
  return useMemo(() => contactsWithOpenOpportunity(query.data ?? []), [query.data]);
}

/**
 * Opening, moving, retitling, tying to a conversation, and dropping an opportunity.
 *
 * Every one of them invalidates the opportunity list only. The contact rows themselves are
 * untouched by any of this — an opportunity is a separate record about a contact, not a field
 * on it — so there is nothing to refetch in the address book beyond the badge, which reads
 * from this same query.
 */
export function useOpportunityActions(): {
  create: (input: {
    contactId: string;
    title: string;
    estimatedValue?: number | null;
  }) => Promise<Opportunity>;
  setStage: (opportunityId: string, stage: OpportunityStage) => Promise<Opportunity>;
  linkConversation: (opportunityId: string, conversationId: string | null) => Promise<Opportunity>;
  updateDetails: (input: {
    opportunityId: string;
    title?: string;
    estimatedValue?: number | null;
  }) => Promise<void>;
  remove: (opportunityId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: opportunityKeys.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (input: { contactId: string; title: string; estimatedValue?: number | null }) =>
      createOpportunity(input),
    onSuccess: invalidate,
  });

  const stageMutation = useMutation({
    mutationFn: ({ opportunityId, stage }: { opportunityId: string; stage: OpportunityStage }) =>
      updateOpportunityStage(opportunityId, stage),
    onSuccess: invalidate,
  });

  const linkMutation = useMutation({
    mutationFn: ({
      opportunityId,
      conversationId,
    }: {
      opportunityId: string;
      conversationId: string | null;
    }) => linkOpportunityConversation(opportunityId, conversationId),
    onSuccess: invalidate,
  });

  const detailsMutation = useMutation({
    mutationFn: (input: { opportunityId: string; title?: string; estimatedValue?: number | null }) =>
      updateOpportunityDetails(input),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (opportunityId: string) => deleteOpportunity(opportunityId),
    onSuccess: invalidate,
  });

  return {
    create: useCallback(
      (input: { contactId: string; title: string; estimatedValue?: number | null }) =>
        createMutation.mutateAsync(input),
      [createMutation],
    ),
    setStage: useCallback(
      (opportunityId: string, stage: OpportunityStage) =>
        stageMutation.mutateAsync({ opportunityId, stage }),
      [stageMutation],
    ),
    linkConversation: useCallback(
      (opportunityId: string, conversationId: string | null) =>
        linkMutation.mutateAsync({ opportunityId, conversationId }),
      [linkMutation],
    ),
    updateDetails: useCallback(
      (input: { opportunityId: string; title?: string; estimatedValue?: number | null }) =>
        detailsMutation.mutateAsync(input),
      [detailsMutation],
    ),
    remove: useCallback(
      (opportunityId: string) => removeMutation.mutateAsync(opportunityId),
      [removeMutation],
    ),
    isWorking:
      createMutation.isPending ||
      stageMutation.isPending ||
      linkMutation.isPending ||
      detailsMutation.isPending ||
      removeMutation.isPending,
  };
}
