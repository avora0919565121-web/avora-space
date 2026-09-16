import { supabase } from "@/integrations/supabase/client";
import { toVietnameseContactError, type Contact, type ContactType } from "@/lib/contacts";

/**
 * The second, third and fourth way to reach someone.
 *
 * A person has one name but often several numbers, and the contact row only has room for one of
 * each. Rather than widen that row — which every screen, every RPC and every invitation rule
 * already reads — the extra ways to reach someone live here, and `contact.phone` / `contact.email`
 * stay the primary channel. A contact with a single number therefore has no rows here at all:
 * the simple case pays nothing for the complicated one.
 */
export type ChannelKind = "phone" | "email";

/** Where a channel came from. Kept because it answers "why do I have this number?" later. */
export type ChannelSource = "manual" | "import_csv" | "import_device";

export type ContactChannel = {
  id: string;
  contactId: string;
  ownerUserId: string;
  kind: ChannelKind;
  /** As the person wrote it, spacing and all — this is what gets displayed. */
  value: string;
  /** As the database compares it. Two channels matching here are the same channel. */
  valueNormalized: string;
  label: string | null;
  source: ChannelSource;
  /** Nobody has confirmed which of several numbers is the real one. */
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
};

type ContactChannelRow = {
  id: string;
  contact_id: string;
  owner_user_id: string;
  kind: string;
  value: string;
  value_normalized: string;
  label: string | null;
  source: string;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
};

export const contactChannelKeys = {
  all: ["contact-channels"] as const,
  list: ["contact-channels", "list"] as const,
};

function isChannelKind(value: string): value is ChannelKind {
  return value === "phone" || value === "email";
}

function isChannelSource(value: string): value is ChannelSource {
  return value === "manual" || value === "import_csv" || value === "import_device";
}

function toChannel(row: ContactChannelRow): ContactChannel {
  return {
    id: row.id,
    contactId: row.contact_id,
    ownerUserId: row.owner_user_id,
    kind: isChannelKind(row.kind) ? row.kind : "phone",
    value: row.value,
    valueNormalized: row.value_normalized,
    label: row.label,
    source: isChannelSource(row.source) ? row.source : "manual",
    needsReview: row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[contact-channels] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseContactError(code, message));
}

/**
 * A phone number reduced to what actually identifies it.
 *
 * `+84 912 345 678` and `0912345678` are one phone, so someone who stored one form and imported
 * the other must end up with one contact rather than two. `private.normalize_channel` in the
 * database performs these exact steps in the same order — if the two ever drift, the preview
 * would call something a duplicate that the database then happily stores twice.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  const local = digits.replace(/^(\+?84)/, "0");
  return local.replace(/\D/g, "");
}

export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/** The one entry point: normalising depends on which kind of channel this is. */
export function normalizeChannelValue(kind: ChannelKind, raw: string): string {
  return kind === "email" ? normalizeEmail(raw) : normalizePhone(raw);
}

/** Empty once normalised — nothing anybody could be reached at. */
export function isBlankChannel(kind: ChannelKind, raw: string): boolean {
  return normalizeChannelValue(kind, raw).length === 0;
}

/** What a channel is called in a sentence, for labels and counts. */
export function channelKindLabel(kind: ChannelKind): string {
  return kind === "phone" ? "Số điện thoại" : "Email";
}

/** Where a channel came from, said the way a person would explain it. */
export function channelSourceLabel(source: ChannelSource): string {
  if (source === "import_csv") return "Nhập từ tệp";
  if (source === "import_device") return "Nhập từ danh bạ máy";
  return "Tự thêm";
}

// ------------------------------------------------------------------ reading

/** Every extra channel the viewer owns. RLS returns nobody else's. */
export async function fetchContactChannels(): Promise<ContactChannel[]> {
  const { data, error } = await supabase
    .from("contact_channel")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toChannel(row as ContactChannelRow));
}

/** The extra channels of one contact, phones before emails. */
export function channelsOf(
  channels: readonly ContactChannel[],
  contactId: string,
): ContactChannel[] {
  return channels
    .filter((entry) => entry.contactId === contactId)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "phone" ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    });
}

/**
 * Every way to reach one contact, primary first.
 *
 * The primary channel is not a `contact_channel` row, so any screen listing "all the numbers"
 * has to join the two shapes. Doing it in one place keeps that seam from being re-invented —
 * and wrongly — on each screen that needs it.
 */
export type ReachableChannel = {
  kind: ChannelKind;
  value: string;
  label: string | null;
  /** Null for the primary channel, which lives on the contact row and has no id of its own. */
  channelId: string | null;
  isPrimary: boolean;
  needsReview: boolean;
};

export function allChannelsOf(
  contact: Contact,
  channels: readonly ContactChannel[],
): ReachableChannel[] {
  const result: ReachableChannel[] = [];

  const primaryPhone = (contact.phone ?? "").trim();
  if (primaryPhone.length > 0) {
    result.push({
      kind: "phone",
      value: primaryPhone,
      label: null,
      channelId: null,
      isPrimary: true,
      needsReview: false,
    });
  }

  const primaryEmail = (contact.email ?? "").trim();
  if (primaryEmail.length > 0) {
    result.push({
      kind: "email",
      value: primaryEmail,
      label: null,
      channelId: null,
      isPrimary: true,
      needsReview: false,
    });
  }

  for (const extra of channelsOf(channels, contact.id)) {
    result.push({
      kind: extra.kind,
      value: extra.value,
      label: extra.label,
      channelId: extra.id,
      isPrimary: false,
      needsReview: extra.needsReview,
    });
  }

  return result;
}

// ------------------------------------------------------------------ matching

/** One contact found by one of its channels, and which value gave it away. */
export type ChannelMatch = {
  contactId: string;
  contactName: string;
  kind: ChannelKind;
  /** The stored value that matched, as written — so the screen can show what collided. */
  value: string;
  /** Carried so a caller can refuse to pour a person's details into a company row. */
  contactType: ContactType;
};

/**
 * Every channel the viewer already has, keyed by normalised value.
 *
 * Built once and reused across a whole import: checking hundreds of rows against hundreds of
 * contacts by scanning the list each time is the difference between a preview that appears and
 * one that hangs. Primary channels and extra ones go into the same index because a duplicate is
 * a duplicate whichever of the two it hit.
 */
export function buildChannelIndex(
  contacts: readonly Contact[],
  channels: readonly ContactChannel[],
): Map<string, ChannelMatch> {
  const index = new Map<string, ChannelMatch>();
  const byId = new Map<string, Contact>();

  for (const contact of contacts) {
    byId.set(contact.id, contact);

    const phone = normalizePhone(contact.phone ?? "");
    if (phone.length > 0 && !index.has(`phone:${phone}`)) {
      index.set(`phone:${phone}`, {
        contactId: contact.id,
        contactName: contact.name,
        kind: "phone",
        value: (contact.phone ?? "").trim(),
        contactType: contact.contactType,
      });
    }

    const email = normalizeEmail(contact.email ?? "");
    if (email.length > 0 && !index.has(`email:${email}`)) {
      index.set(`email:${email}`, {
        contactId: contact.id,
        contactName: contact.name,
        kind: "email",
        value: (contact.email ?? "").trim(),
        contactType: contact.contactType,
      });
    }
  }

  for (const channel of channels) {
    const key = `${channel.kind}:${channel.valueNormalized}`;
    if (channel.valueNormalized.length === 0 || index.has(key)) continue;
    const owner = byId.get(channel.contactId);
    if (owner === undefined) continue;
    index.set(key, {
      contactId: channel.contactId,
      contactName: owner.name,
      kind: channel.kind,
      value: channel.value,
      contactType: owner.contactType,
    });
  }

  return index;
}

/** The contact already holding this value, if any. */
export function matchChannel(
  index: ReadonlyMap<string, ChannelMatch>,
  kind: ChannelKind,
  raw: string,
): ChannelMatch | null {
  const normalized = normalizeChannelValue(kind, raw);
  if (normalized.length === 0) return null;
  return index.get(`${kind}:${normalized}`) ?? null;
}

/**
 * The first contact any of these values points at.
 *
 * Every value is checked rather than only the first, because the number that identifies someone
 * already in the book is often not the one listed first in the file being imported.
 */
export function matchAnyChannel(
  index: ReadonlyMap<string, ChannelMatch>,
  phones: readonly string[],
  emails: readonly string[],
): ChannelMatch | null {
  for (const phone of phones) {
    const hit = matchChannel(index, "phone", phone);
    if (hit !== null) return hit;
  }
  for (const email of emails) {
    const hit = matchChannel(index, "email", email);
    if (hit !== null) return hit;
  }
  return null;
}

/** Values that are real, normalised-unique, and in the order they were given. */
export function uniqueChannelValues(kind: ChannelKind, values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeChannelValue(kind, value);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}

// ------------------------------------------------------------------ review

/** Contacts carrying at least one channel nobody has confirmed yet. */
export function contactsNeedingReview(
  contacts: readonly Contact[],
  channels: readonly ContactChannel[],
): { contact: Contact; channels: ContactChannel[] }[] {
  const flagged = channels.filter((entry) => entry.needsReview);
  const groups: { contact: Contact; channels: ContactChannel[] }[] = [];

  for (const contact of contacts) {
    const mine = flagged.filter((entry) => entry.contactId === contact.id);
    if (mine.length === 0) continue;
    groups.push({ contact, channels: channelsOf(mine, contact.id) });
  }

  return groups.sort((left, right) => left.contact.name.localeCompare(right.contact.name, "vi"));
}

export function reviewCount(channels: readonly ContactChannel[]): number {
  return channels.filter((entry) => entry.needsReview).length;
}

// ------------------------------------------------------------------ writing

/**
 * Records one more way to reach a contact.
 *
 * Returns null when the value is already the contact's primary channel: there is nothing to add
 * and nothing wrong either, which is an ordinary outcome when a file repeats a number the book
 * already has. The owner check happens server-side — this call cannot file a channel into
 * somebody else's contact however it is made.
 */
export async function addContactChannel(input: {
  contactId: string;
  kind: ChannelKind;
  value: string;
  source?: ChannelSource;
  label?: string | null;
  needsReview?: boolean;
}): Promise<ContactChannel | null> {
  const { data, error } = await supabase.rpc("add_contact_channel", {
    p_contact_id: input.contactId,
    p_kind: input.kind,
    p_value: input.value.trim(),
    p_source: input.source ?? "manual",
    p_label: input.label ?? undefined,
    p_needs_review: input.needsReview ?? false,
  });

  if (error) throw fail(error.code, error.message);
  if (!data) return null;
  return toChannel(data as unknown as ContactChannelRow);
}

/**
 * Marks a channel as looked at.
 *
 * Only `needs_review` and `label` are writable on the table, so a confirmation cannot become a
 * way to rewrite the number itself — correcting a value is deleting it and adding it again,
 * which keeps `source` honest about where each one came from.
 */
export async function markChannelReviewed(channelId: string): Promise<void> {
  const { error } = await supabase
    .from("contact_channel")
    .update({ needs_review: false })
    .eq("id", channelId);

  if (error) throw fail(error.code, error.message);
}

/** Confirms every flagged channel of one contact in a single act. */
export async function markContactReviewed(contactId: string): Promise<void> {
  const { error } = await supabase
    .from("contact_channel")
    .update({ needs_review: false })
    .eq("contact_id", contactId)
    .eq("needs_review", true);

  if (error) throw fail(error.code, error.message);
}

export async function renameChannel(channelId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  const { error } = await supabase
    .from("contact_channel")
    .update({ label: trimmed.length === 0 ? null : trimmed })
    .eq("id", channelId);

  if (error) throw fail(error.code, error.message);
}

export async function deleteContactChannel(channelId: string): Promise<void> {
  const { error } = await supabase.from("contact_channel").delete().eq("id", channelId);
  if (error) throw fail(error.code, error.message);
}
