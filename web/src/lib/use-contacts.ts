import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth";
import {
  acceptContactInvite,
  contactKeys,
  createBusiness,
  createContactInvite,
  createIndividual,
  fetchContactInvitePreview,
  fetchContactInvites,
  fetchContacts,
  updateBusiness,
  updateIndividual,
  type BusinessDraft,
  type Contact,
  type ContactInvite,
  type ContactInvitePreview,
  type IndividualDraft,
  type InviteMethod,
} from "@/lib/contacts";

/**
 * The viewer's whole address book, in one query.
 *
 * Both halves of the screen, the employer picker and a company's staff list all read from this
 * single list rather than querying per section: the book is small enough to hold at once, and
 * the alternative would make "who works here" a request that can be pending while the company
 * it belongs to is already on screen.
 */
export function useContacts(): UseQueryResult<Contact[], Error> {
  const { user } = useAuth();

  return useQuery<Contact[], Error>({
    queryKey: contactKeys.list,
    queryFn: fetchContacts,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** The invitations sent for one contact. Only asked for on a person who is not linked yet. */
export function useContactInvites(contactId: string | null, enabled: boolean = true): UseQueryResult<
  ContactInvite[],
  Error
> {
  return useQuery<ContactInvite[], Error>({
    queryKey: contactKeys.invites(contactId ?? "none"),
    queryFn: () => fetchContactInvites(contactId ?? ""),
    enabled: enabled && contactId !== null,
  });
}

/**
 * What one invitation link says to whoever opened it.
 *
 * Never retried: every answer this can give — including "no such invitation" — is a settled
 * fact about the token, not a hiccup worth asking about again.
 */
export function useContactInvitePreview(
  token: string,
): UseQueryResult<ContactInvitePreview | null, Error> {
  const { user } = useAuth();

  return useQuery<ContactInvitePreview | null, Error>({
    queryKey: ["contact-invite-preview", token],
    queryFn: () => fetchContactInvitePreview(token),
    enabled: token.length > 0 && Boolean(user?.id),
    retry: false,
    staleTime: 0,
  });
}

/** Accepting an invitation, which writes a contact into the accepter's own book. */
export function useAcceptContactInvite(): {
  accept: (token: string) => Promise<string>;
  isAccepting: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (token: string) => acceptContactInvite(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });

  return {
    accept: useCallback((token: string) => mutation.mutateAsync(token), [mutation]),
    isAccepting: mutation.isPending,
  };
}

/** Creating, editing and inviting — each refreshing the one list every screen reads. */
export function useContactActions(): {
  addIndividual: (draft: IndividualDraft) => Promise<Contact>;
  addBusiness: (draft: BusinessDraft) => Promise<Contact>;
  saveIndividual: (contactId: string, draft: IndividualDraft) => Promise<Contact>;
  saveBusiness: (contactId: string, draft: BusinessDraft) => Promise<Contact>;
  invite: (contactId: string, method: InviteMethod) => Promise<string>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  }, [queryClient]);

  const addIndividualMutation = useMutation({
    mutationFn: (draft: IndividualDraft) => createIndividual(draft),
    onSuccess: invalidate,
  });

  const addBusinessMutation = useMutation({
    mutationFn: (draft: BusinessDraft) => createBusiness(draft),
    onSuccess: invalidate,
  });

  const saveIndividualMutation = useMutation({
    mutationFn: ({ contactId, draft }: { contactId: string; draft: IndividualDraft }) =>
      updateIndividual(contactId, draft),
    onSuccess: invalidate,
  });

  const saveBusinessMutation = useMutation({
    mutationFn: ({ contactId, draft }: { contactId: string; draft: BusinessDraft }) =>
      updateBusiness(contactId, draft),
    onSuccess: invalidate,
  });

  const inviteMutation = useMutation({
    mutationFn: ({ contactId, method }: { contactId: string; method: InviteMethod }) =>
      createContactInvite(contactId, method),
    onSuccess: invalidate,
  });

  return {
    addIndividual: useCallback(
      (draft: IndividualDraft) => addIndividualMutation.mutateAsync(draft),
      [addIndividualMutation],
    ),
    addBusiness: useCallback(
      (draft: BusinessDraft) => addBusinessMutation.mutateAsync(draft),
      [addBusinessMutation],
    ),
    saveIndividual: useCallback(
      (contactId: string, draft: IndividualDraft) =>
        saveIndividualMutation.mutateAsync({ contactId, draft }),
      [saveIndividualMutation],
    ),
    saveBusiness: useCallback(
      (contactId: string, draft: BusinessDraft) => saveBusinessMutation.mutateAsync({ contactId, draft }),
      [saveBusinessMutation],
    ),
    invite: useCallback(
      (contactId: string, method: InviteMethod) => inviteMutation.mutateAsync({ contactId, method }),
      [inviteMutation],
    ),
    isWorking:
      addIndividualMutation.isPending ||
      addBusinessMutation.isPending ||
      saveIndividualMutation.isPending ||
      saveBusinessMutation.isPending ||
      inviteMutation.isPending,
  };
}
