import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  addContactChannel,
  buildChannelIndex,
  contactChannelKeys,
  contactsNeedingReview,
  deleteContactChannel,
  detachContactChannel,
  fetchContactChannels,
  markChannelReviewed,
  markContactReviewed,
  planSharedChannelFix,
  renameChannel,
  sharedChannelGroups,
  type ChannelKind,
  type ChannelMatch,
  type ChannelSource,
  type ContactChannel,
  type SharedChannelChoice,
  type SharedChannelGroup,
  type SharedChannelOutcome,
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
 * The values that more than one contact is holding.
 *
 * Read from the same two queries as everything else on the review screen rather than a query of
 * its own: the detection is a grouping of the address book, so a contact created a second ago is
 * already part of it, and there is no cache to fall out of date.
 */
export function useSharedChannels(): {
  groups: SharedChannelGroup[];
  count: number;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const contactsQuery = useContacts();
  const channelsQuery = useContactChannels();

  const groups = useMemo(
    () => sharedChannelGroups(contactsQuery.data ?? [], channelsQuery.data ?? []),
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
 * Carrying out one decision about one shared value.
 *
 * The company keeps the value first, then the others give it up: done the other way round, a
 * failure halfway through would leave the number on nobody. Each contact is detached separately
 * and a refusal on one is reported by name instead of stopping the rest — six contacts sharing a
 * number is already a mess, and abandoning the cleanup at the second one leaves a worse one.
 */
export function useSharedChannelFix(): {
  apply: (group: SharedChannelGroup, choice: SharedChannelChoice) => Promise<SharedChannelOutcome>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    SharedChannelOutcome,
    Error,
    { group: SharedChannelGroup; choice: SharedChannelChoice }
  >({
    mutationFn: async ({ group, choice }) => {
      const plan = planSharedChannelFix(group, choice);
      if (plan.problem !== null) throw new Error(plan.problem);

      const failures: { contactName: string; reason: string }[] = [];
      let detached = 0;

      if (plan.ensureOn !== null) {
        await addContactChannel({
          contactId: plan.ensureOn.contact.id,
          kind: group.kind,
          value: plan.ensureOn.value,
          source: "manual",
          needsReview: false,
        });
      }

      for (const holder of plan.detachFrom) {
        try {
          await detachContactChannel({
            contactId: holder.contact.id,
            kind: group.kind,
            value: holder.value,
          });
          detached += 1;
        } catch (problem) {
          failures.push({
            contactName: holder.contact.name,
            reason: (problem as Error).message,
          });
        }
      }

      return { detached, failures };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactChannelKeys.all });
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });

  return {
    apply: useCallback(
      (group: SharedChannelGroup, choice: SharedChannelChoice) =>
        mutation.mutateAsync({ group, choice }),
      [mutation],
    ),
    isWorking: mutation.isPending,
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
