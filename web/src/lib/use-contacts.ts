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
import {
  confirmInviteSent,
  declineInvite,
  discardInviteDraft,
  fetchPublicInvitePreview,
  prepareInvite,
  type PrepareOptions,
  type PreparedInvite,
  type PublicInvitePreview,
} from "@/lib/contact-invites";

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

/**
 * KT-07a: the public page of an invitation — works signed out. Keyed by the viewer too, because a
 * signed-in viewer is told more (their own link, a blocked pair).
 */
export function usePublicInvitePreview(token: string): UseQueryResult<PublicInvitePreview | null, Error> {
  const { user, isLoading } = useAuth() as { user?: { id: string } | null; isLoading?: boolean };
  return useQuery<PublicInvitePreview | null, Error>({
    queryKey: ["contact-invite-public", token, user?.id ?? "anon"],
    queryFn: () => fetchPublicInvitePreview(token),
    enabled: token.length > 0 && isLoading !== true,
    retry: false,
    staleTime: 0,
  });
}

/** KT-07a: "Không, cảm ơn" from the public page. */
export function useDeclineInvite(): { decline: (token: string) => Promise<void>; isDeclining: boolean } {
  const mutation = useMutation({ mutationFn: (token: string) => declineInvite(token) });
  return {
    decline: useCallback((token: string) => mutation.mutateAsync(token), [mutation]),
    isDeclining: mutation.isPending,
  };
}

/**
 * KT-07a: the three steps of "Avora soạn, bạn gửi" — prepare a draft, then the sender says
 * `Đã gửi` (confirm) or `Chưa gửi` (discard). Each refreshes the invitations every screen reads.
 */
export function useInviteActions(): {
  prepare: (contactId: string, method: InviteMethod, options?: PrepareOptions) => Promise<PreparedInvite>;
  confirmSent: (inviteId: string) => Promise<void>;
  discardDraft: (inviteId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  }, [queryClient]);
  const prepareMutation = useMutation({
    mutationFn: (args: { contactId: string; method: InviteMethod; options?: PrepareOptions }) =>
      prepareInvite(args.contactId, args.method, args.options),
  });
  const confirmMutation = useMutation({ mutationFn: (inviteId: string) => confirmInviteSent(inviteId), onSuccess: invalidate });
  const discardMutation = useMutation({ mutationFn: (inviteId: string) => discardInviteDraft(inviteId), onSuccess: invalidate });
  return {
    prepare: useCallback(
      (contactId: string, method: InviteMethod, options?: PrepareOptions) =>
        prepareMutation.mutateAsync({ contactId, method, options }),
      [prepareMutation],
    ),
    confirmSent: useCallback((inviteId: string) => confirmMutation.mutateAsync(inviteId), [confirmMutation]),
    discardDraft: useCallback((inviteId: string) => discardMutation.mutateAsync(inviteId), [discardMutation]),
    isWorking: prepareMutation.isPending || confirmMutation.isPending || discardMutation.isPending,
  };
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
