import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth";
import {
  contactKeys,
  fetchHandLinkedContactIds,
  linkContactToFriend,
  relinkContact,
  undoContactLinkChange,
  unlinkContact,
  type Contact,
} from "@/lib/contacts";

export type LinkChange =
  | { kind: "unlink"; contactId: string }
  | { kind: "relink"; fromId: string; toId: string }
  | { kind: "link"; contactId: string; userId: string };

/** The address book as it reads right after a change, so every name on screen moves at once. */
export function applyLinkChange(contacts: readonly Contact[], change: LinkChange): Contact[] {
  if (change.kind === "unlink") {
    return contacts.map((contact) => (contact.id === change.contactId ? { ...contact, linkedUserId: null } : contact));
  }
  if (change.kind === "link") {
    return contacts.map((contact) => (contact.id === change.contactId ? { ...contact, linkedUserId: change.userId } : contact));
  }
  const userId = contacts.find((contact) => contact.id === change.fromId)?.linkedUserId ?? null;
  return contacts.map((contact) => {
    if (contact.id === change.fromId) return { ...contact, linkedUserId: null };
    if (contact.id === change.toId) return { ...contact, linkedUserId: userId };
    return contact;
  });
}

/** The undo for a change the server already made, as the address book should read after it. */
function reverse(change: LinkChange, before: readonly Contact[]): LinkChange {
  if (change.kind === "relink") return { kind: "relink", fromId: change.toId, toId: change.fromId };
  if (change.kind === "link") return { kind: "unlink", contactId: change.contactId };
  const userId = before.find((contact) => contact.id === change.contactId)?.linkedUserId ?? "";
  return { kind: "link", contactId: change.contactId, userId };
}

/**
 * AVORA-117: gỡ / chuyển / gắn, each answered with the id `Hoàn tác` sends back. The cached address book
 * is updated before the refetch, so chat, groups, tasks, calls and person cards — all of which read their
 * names from `contactKeys.list` — show the new name without a reload.
 */
const NONE: string[] = [];

/** Contacts whose link the owner set by hand (chuyển / gắn) and has not undone. */
export function useHandLinkedContactIds(): string[] {
  const { user } = useAuth();
  const { data } = useQuery<string[], Error>({
    queryKey: [...contactKeys.all, "hand-linked"],
    queryFn: fetchHandLinkedContactIds,
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });
  return data ?? NONE;
}

export function useContactLink() {
  const queryClient = useQueryClient();

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  }, [queryClient]);

  const mutation = useMutation<{ changeId: string; undo: LinkChange }, Error, LinkChange>({
    mutationFn: async (change) => {
      const before = queryClient.getQueryData<Contact[]>(contactKeys.list) ?? [];
      const changeId =
        change.kind === "unlink"
          ? await unlinkContact(change.contactId)
          : change.kind === "relink"
            ? await relinkContact(change.fromId, change.toId)
            : await linkContactToFriend(change.contactId, change.userId);
      queryClient.setQueryData<Contact[]>(contactKeys.list, (current) => (current === undefined ? current : applyLinkChange(current, change)));
      return { changeId, undo: reverse(change, before) };
    },
    onSettled: refresh,
  });

  const undo = useMutation<void, Error, { changeId: string; undo: LinkChange }>({
    mutationFn: async ({ changeId, undo: back }) => {
      await undoContactLinkChange(changeId);
      queryClient.setQueryData<Contact[]>(contactKeys.list, (current) => (current === undefined ? current : applyLinkChange(current, back)));
    },
    onSettled: refresh,
  });

  return {
    change: mutation.mutateAsync,
    undo: undo.mutateAsync,
    isWorking: mutation.isPending || undo.isPending,
  };
}
