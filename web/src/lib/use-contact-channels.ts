import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  addContactChannel,
  buildChannelIndex,
  contactChannelKeys,
  contactsNeedingReview,
  deleteContactChannel,
  fetchContactChannels,
  markChannelReviewed,
  markContactReviewed,
  renameChannel,
  type ChannelKind,
  type ChannelMatch,
  type ChannelSource,
  type ContactChannel,
} from "@/lib/contact-channels";
import { contactKeys, type Contact } from "@/lib/contacts";
import { useContacts } from "@/lib/use-contacts";

/**
 * Every extra channel the viewer owns, in one query.
 *
 * Read whole rather than per contact, for the same reason the address book is: an import has to
 * check hundreds of values against all of them at once, and a per-contact query would turn
 * "is this number already mine?" into a request per row.
 */
export function useContactChannels(): UseQueryResult<ContactChannel[], Error> {
  const { user } = useAuth();

  return useQuery<ContactChannel[], Error>({
    queryKey: contactChannelKeys.list,
    queryFn: fetchContactChannels,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/**
 * The lookup an import checks its rows against, built once from the whole book.
 *
 * Returns an empty index while either query is still loading, which is why the import screen
 * waits for both before showing its preview: an index that is merely incomplete would report
 * "no duplicate" for someone who is already there.
 */
export function useChannelIndex(): {
  index: ReadonlyMap<string, ChannelMatch>;
  isPending: boolean;
  isError: boolean;
} {
  const contactsQuery = useContacts();
  const channelsQuery = useContactChannels();

  const index = useMemo(
    () => buildChannelIndex(contactsQuery.data ?? [], channelsQuery.data ?? []),
    [contactsQuery.data, channelsQuery.data],
  );

  return {
    index,
    isPending: contactsQuery.isPending || channelsQuery.isPending,
    isError: contactsQuery.isError || channelsQuery.isError,
  };
}

/** The contacts carrying a channel nobody has confirmed, ready for the review screen. */
export function useContactsNeedingReview(): {
  groups: { contact: Contact; channels: ContactChannel[] }[];
  count: number;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const contactsQuery = useContacts();
  const channelsQuery = useContactChannels();

  const groups = useMemo(
    () => contactsNeedingReview(contactsQuery.data ?? [], channelsQuery.data ?? []),
    [contactsQuery.data, channelsQuery.data],
  );

  return {
    groups,
    count: groups.length,
    isPending: contactsQuery.isPending || channelsQuery.isPending,
    isError: contactsQuery.isError || channelsQuery.isError,
    error: (contactsQuery.error ?? channelsQuery.error) as Error | null,
  };
}

/**
 * Adding, confirming, renaming and removing channels.
 *
 * Every one of them invalidates the contact list as well as the channel list: which channels a
 * contact has decides what its row says and which invitations it can be sent, so leaving the
 * book stale would show a contact that cannot be emailed next to the email just added to it.
 */
export function useContactChannelActions(): {
  add: (input: {
    contactId: string;
    kind: ChannelKind;
    value: string;
    source?: ChannelSource;
    label?: string | null;
    needsReview?: boolean;
  }) => Promise<ContactChannel | null>;
  confirm: (channelId: string) => Promise<void>;
  confirmContact: (contactId: string) => Promise<void>;
  rename: (channelId: string, label: string) => Promise<void>;
  remove: (channelId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: contactChannelKeys.all });
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  }, [queryClient]);

  const addMutation = useMutation({
    mutationFn: (input: {
      contactId: string;
      kind: ChannelKind;
      value: string;
      source?: ChannelSource;
      label?: string | null;
      needsReview?: boolean;
    }) => addContactChannel(input),
    onSuccess: invalidate,
  });

  const confirmMutation = useMutation({
    mutationFn: (channelId: string) => markChannelReviewed(channelId),
    onSuccess: invalidate,
  });

  const confirmContactMutation = useMutation({
    mutationFn: (contactId: string) => markContactReviewed(contactId),
    onSuccess: invalidate,
  });

  const renameMutation = useMutation({
    mutationFn: ({ channelId, label }: { channelId: string; label: string }) =>
      renameChannel(channelId, label),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (channelId: string) => deleteContactChannel(channelId),
    onSuccess: invalidate,
  });

  return {
    add: useCallback(
      (input: {
        contactId: string;
        kind: ChannelKind;
        value: string;
        source?: ChannelSource;
        label?: string | null;
        needsReview?: boolean;
      }) => addMutation.mutateAsync(input),
      [addMutation],
    ),
    confirm: useCallback((channelId: string) => confirmMutation.mutateAsync(channelId), [confirmMutation]),
    confirmContact: useCallback(
      (contactId: string) => confirmContactMutation.mutateAsync(contactId),
      [confirmContactMutation],
    ),
    rename: useCallback(
      (channelId: string, label: string) => renameMutation.mutateAsync({ channelId, label }),
      [renameMutation],
    ),
    remove: useCallback((channelId: string) => removeMutation.mutateAsync(channelId), [removeMutation]),
    isWorking:
      addMutation.isPending ||
      confirmMutation.isPending ||
      confirmContactMutation.isPending ||
      renameMutation.isPending ||
      removeMutation.isPending,
  };
}
