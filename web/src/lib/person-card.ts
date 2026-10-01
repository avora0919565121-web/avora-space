import type { Connection } from "@/lib/connections";
import type { Contact } from "@/lib/contacts";
import { UNKNOWN_PERSON } from "@/lib/task-owner";

/** Who a person card is about — whatever the place that opened it already knows. */
export type PersonRef = {
  userId: string;
  /** The name shown where the avatar was tapped (display name, never an email). */
  name?: string | null;
  /** A PIN the opener already holds (a 1-1 peer's, a request's). */
  pin?: string | null;
  /** Inside a group: lets `Kết bạn` start from this group (ADR-029). */
  groupId?: string | null;
};

export type PersonCardView = {
  userId: string;
  name: string;
  pin: string | null;
  /** Only from the viewer's own Liên hệ (a contact linked to this account). Never an email. */
  phone: string | null;
  isSelf: boolean;
  isFriend: boolean;
  /** The viewer's own contact for this person, if they keep one. */
  contactId: string | null;
};

/**
 * What one person card shows (AVORA-60 · C). Pure, so the privacy rules are tested directly:
 * the phone number comes only from the viewer's own address book, the PIN only from what the
 * viewer can already see (a friendship or the opener), and an email is never read at all.
 */
export function personCardView(
  ref: PersonRef,
  viewerId: string | undefined,
  connections: ReadonlyMap<string, Connection>,
  contacts: readonly Contact[],
  ownPin: string | null = null,
): PersonCardView {
  const isSelf = viewerId !== undefined && ref.userId === viewerId;
  const friend = connections.get(ref.userId) ?? null;
  const contact = isSelf ? null : (contacts.find((item) => item.linkedUserId === ref.userId) ?? null);
  const pickName = (...names: (string | null | undefined)[]): string => {
    for (const candidate of names) {
      const clean = candidate?.trim() ?? "";
      if (clean !== "" && !clean.includes("@")) return clean;
    }
    return isSelf ? "Bạn" : UNKNOWN_PERSON;
  };
  const phone = contact?.phone?.trim() ?? "";
  return {
    userId: ref.userId,
    name: pickName(ref.name, friend?.displayName, contact?.name),
    pin: isSelf ? ownPin : (friend?.pin ?? ref.pin ?? null),
    phone: phone === "" ? null : phone,
    isSelf,
    isFriend: friend !== null,
    contactId: contact?.id ?? null,
  };
}
