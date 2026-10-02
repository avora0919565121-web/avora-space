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

/** AVORA-71 · E: what a card may show depends only on how the viewer knows this person. */
export type PersonRelation = "self" | "friend-contact" | "friend" | "stranger-contact" | "stranger";

export type PersonCardView = {
  userId: string;
  /** "My name" for them: my Liên hệ name, else my alias, else the name they go by. */
  name: string;
  /** The name they go by, shown small under "my name" when the two differ. */
  realName: string;
  relation: PersonRelation;
  /** My alias for them (only when no Liên hệ of mine names them). */
  alias: string | null;
  /** From my own Liên hệ only — never the other account's email. */
  email: string | null;
  note: string | null;
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
  aliases: ReadonlyMap<string, string> = new Map(),
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
  const email = contact?.email?.trim() ?? "";
  const realName = pickName(ref.name, friend?.displayName);
  const alias = isSelf || contact !== null ? null : (aliases.get(ref.userId)?.trim() || null);
  const relation: PersonRelation = isSelf
    ? "self"
    : friend !== null
      ? contact !== null
        ? "friend-contact"
        : "friend"
      : contact !== null
        ? "stranger-contact"
        : "stranger";
  return {
    userId: ref.userId,
    name: isSelf ? realName : pickName(contact?.name, alias, ref.name, friend?.displayName),
    realName,
    relation,
    alias,
    // A PIN only between friends (or my own). Someone not yet a friend shows only their name.
    pin: isSelf ? ownPin : friend !== null ? (friend.pin ?? ref.pin ?? null) : null,
    phone: phone === "" ? null : phone,
    email: email === "" ? null : email,
    note: contact?.note?.trim() || null,
    isSelf,
    isFriend: friend !== null,
    contactId: contact?.id ?? null,
  };
}
