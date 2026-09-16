import { supabase } from "@/integrations/supabase/client";

/**
 * A contact is either a person or a company, and says which from birth.
 *
 * The type is fixed at creation and never edited: every later rule (who can be invited, who can
 * have an employer, which fields are required) reads it, and a record that could change its mind
 * would make all of them guess. Someone who picked wrong deletes and creates again — one rare,
 * deliberate act instead of a permanent ambiguity.
 */
export type ContactType = "individual" | "business";

export type Contact = {
  id: string;
  ownerUserId: string;
  contactType: ContactType;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  linkedUserId: string | null;
  employerContactId: string | null;
  dateOfBirth: string | null;
  relationshipTag: string | null;
  taxCode: string | null;
  businessAddress: string | null;
  representativeName: string | null;
  representativePhone: string | null;
  representativeEmail: string | null;
  industry: string | null;
  createdAt: string;
  updatedAt: string;
};

/** How an invitation was sent. QR exists in the database but has no screen yet. */
export type InviteMethod = "sms" | "email" | "link" | "qr";

export type ContactInvite = {
  id: string;
  contactId: string;
  method: InviteMethod;
  inviteToken: string;
  status: "pending" | "accepted" | "expired";
  invitedAt: string;
  acceptedAt: string | null;
};

/** What the person filling in the individual form has typed so far. */
export type IndividualDraft = {
  name: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  relationshipTag: string;
  note: string;
  employerContactId: string | null;
};

/** What the person filling in the business form has typed so far. */
export type BusinessDraft = {
  name: string;
  taxCode: string;
  representativeName: string;
  phone: string;
  email: string;
  representativePhone: string;
  representativeEmail: string;
  businessAddress: string;
  industry: string;
  note: string;
};

export const EMPTY_INDIVIDUAL_DRAFT: IndividualDraft = {
  name: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  relationshipTag: "",
  note: "",
  employerContactId: null,
};

export const EMPTY_BUSINESS_DRAFT: BusinessDraft = {
  name: "",
  taxCode: "",
  representativeName: "",
  phone: "",
  email: "",
  representativePhone: "",
  representativeEmail: "",
  businessAddress: "",
  industry: "",
  note: "",
};

/**
 * Offered under the relationship field, not imposed as a list.
 *
 * Free text with suggestions rather than a fixed set: unlike the family marks — which a
 * notification rule has to act on — this label is only ever read by the person who wrote it,
 * so "bạn cấp ba" is as valid as "Đối tác" and nothing downstream needs to understand it.
 */
export const RELATIONSHIP_SUGGESTIONS: readonly string[] = ["Gia đình", "Bạn bè", "Đối tác"];

export const contactKeys = {
  all: ["contacts"] as const,
  list: ["contacts", "list"] as const,
  invites: (contactId: string) => ["contacts", "invites", contactId] as const,
};

/** Where an invited person lands when they open the link. */
export const CONTACT_INVITE_PATH = "/loi-moi-lien-he";

/**
 * How long an invitation stays good for. Mirrors `contact_invite_timed_out` in the database,
 * which is the rule that actually decides — this copy only keeps the sender's own screen from
 * claiming someone is still waiting on a link that can no longer be accepted.
 */
export const CONTACT_INVITE_TTL_DAYS = 14;

/**
 * Whether an invitation has run out of time.
 *
 * Timing out is derived from when it was sent, not an event anyone caused, so it is computed
 * on read rather than stored — otherwise the same row would mean different things depending on
 * whether someone happened to open the link.
 */
export function contactInviteTimedOut(invite: ContactInvite, now: Date = new Date()): boolean {
  if (invite.status !== "pending") return false;
  const sent = new Date(invite.invitedAt).getTime();
  if (Number.isNaN(sent)) return false;
  return now.getTime() - sent > CONTACT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** What the person holding an invitation link is allowed to know before deciding. */
export type ContactInvitePreview = {
  inviterName: string;
  status: ContactInvite["status"];
  isOwnInvite: boolean;
  alreadyLinked: boolean;
};

/**
 * Which of the six things the accept screen should say.
 *
 * Read once, before anything is pressed, so every dead end is explained as a sentence rather
 * than surfaced as a failed button press. Only `ready` shows the button at all.
 */
export type ContactInviteState =
  | { kind: "ready"; inviterName: string }
  | { kind: "missing" }
  | { kind: "accepted" }
  | { kind: "expired" }
  | { kind: "own" }
  | { kind: "linked" };

type ContactRow = {
  id: string;
  owner_user_id: string;
  contact_type: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  linked_user_id: string | null;
  employer_contact_id: string | null;
  date_of_birth: string | null;
  relationship_tag: string | null;
  tax_code: string | null;
  business_address: string | null;
  representative_name: string | null;
  representative_phone: string | null;
  representative_email: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
};

/** Anything that is not one of the two reads as a person rather than breaking the screen. */
export function isContactType(value: string): value is ContactType {
  return value === "individual" || value === "business";
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    contactType: isContactType(row.contact_type) ? row.contact_type : "individual",
    name: row.name,
    phone: row.phone,
    email: row.email,
    note: row.note,
    linkedUserId: row.linked_user_id,
    employerContactId: row.employer_contact_id,
    dateOfBirth: row.date_of_birth,
    relationshipTag: row.relationship_tag,
    taxCode: row.tax_code,
    businessAddress: row.business_address,
    representativeName: row.representative_name,
    representativePhone: row.representative_phone,
    representativeEmail: row.representative_email,
    industry: row.industry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps the RPC's Vietnamese exceptions and the PostgREST failures to what the form should say.
 *
 * The database already rejects in Vietnamese, so its sentence is kept when it is one of the
 * rules a person can act on — re-wording "cần mã số thuế" into something of our own would let
 * the two drift apart on the next schema change.
 */
export function toVietnameseContactError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("tên liên hệ không được để trống")) return "Liên hệ cần có tên.";
  if (normalized.includes("cần ít nhất số điện thoại hoặc email"))
    return "Cần ít nhất số điện thoại hoặc email.";
  if (normalized.includes("cần mã số thuế")) return "Doanh nghiệp cần mã số thuế.";
  if (normalized.includes("cần tên người đại diện")) return "Doanh nghiệp cần tên người đại diện.";
  if (normalized.includes("cần ít nhất một kênh liên hệ"))
    return "Cần ít nhất một số điện thoại hoặc email — của công ty hoặc của người đại diện.";
  if (normalized.includes("chỉ chủ liên hệ mới được sửa")) return "Đây không phải liên hệ của bạn.";
  if (normalized.includes("chỉ chủ liên hệ mới được gửi lời mời"))
    return "Đây không phải liên hệ của bạn.";
  if (normalized.includes("không tìm thấy liên hệ")) return "Liên hệ này không còn nữa.";
  if (normalized.includes("chỉ chọn được doanh nghiệp trong danh bạ"))
    return "Chỉ chọn được doanh nghiệp trong danh bạ của bạn.";
  if (normalized.includes("nơi làm việc phải là một liên hệ doanh nghiệp"))
    return "Nơi làm việc phải là một liên hệ doanh nghiệp.";
  if (normalized.includes("chỉ liên hệ cá nhân mới có thể mời"))
    return "Chỉ mời được liên hệ cá nhân — doanh nghiệp không đăng nhập vào AVORA.";
  if (normalized.includes("chưa có số điện thoại, không thể mời qua sms"))
    return "Liên hệ này chưa có số điện thoại. Hãy thêm số, hoặc mời bằng liên kết.";
  if (normalized.includes("chưa có email, không thể mời qua email"))
    return "Liên hệ này chưa có email. Hãy thêm email, hoặc mời bằng liên kết.";
  if (normalized.includes("lời mời không tồn tại")) return "Lời mời này không còn hiệu lực.";
  if (normalized.includes("lời mời này đã được chấp nhận")) return "Lời mời này đã được chấp nhận.";
  if (normalized.includes("lời mời đã hết hạn")) return "Lời mời này đã hết hạn.";
  if (normalized.includes("không thể tự chấp nhận lời mời của chính mình"))
    return "Đây là lời mời do chính bạn gửi. Hãy chuyển liên kết này cho người bạn muốn mời.";
  if (normalized.includes("liên hệ gốc không còn tồn tại"))
    return "Người gửi đã xoá liên hệ này, nên lời mời không còn hiệu lực.";
  if (normalized.includes("hai tài khoản đã liên kết với nhau từ trước"))
    return "Hai bạn đã có nhau trong danh bạ từ trước.";
  if (normalized.includes("người này đã liên kết với một tài khoản khác"))
    return "Lời mời này đã được một tài khoản khác dùng.";
  if (normalized.includes("chưa đăng nhập") || normalized.includes("avora_not_signed_in"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với liên hệ này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[contacts] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseContactError(code, message));
}

/** Empty once trimmed — what the database treats as "not given". */
function blank(value: string | null | undefined): boolean {
  return (value ?? "").trim().length === 0;
}

/** The value as the database will store it: trimmed, and absent rather than empty. */
function given(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Why this draft is not ready to send, or null when it is.
 *
 * A mirror of the RPC's rules, kept only so the button can explain itself before a round trip.
 * The server validates independently and is the one that decides — this never being called
 * would change how the form feels, not what can be stored.
 */
export function individualDraftProblem(draft: IndividualDraft): string | null {
  if (blank(draft.name)) return "Liên hệ cần có tên.";
  if (blank(draft.phone) && blank(draft.email)) return "Cần ít nhất số điện thoại hoặc email.";
  return null;
}

/** The same mirror for a company: name, tax code, representative, and one of four channels. */
export function businessDraftProblem(draft: BusinessDraft): string | null {
  if (blank(draft.name)) return "Doanh nghiệp cần có tên.";
  if (blank(draft.taxCode)) return "Doanh nghiệp cần mã số thuế.";
  if (blank(draft.representativeName)) return "Doanh nghiệp cần tên người đại diện.";
  if (
    blank(draft.phone) &&
    blank(draft.email) &&
    blank(draft.representativePhone) &&
    blank(draft.representativeEmail)
  ) {
    return "Cần ít nhất một số điện thoại hoặc email — của công ty hoặc của người đại diện.";
  }
  return null;
}

export function canSubmitIndividual(draft: IndividualDraft): boolean {
  return individualDraftProblem(draft) === null;
}

export function canSubmitBusiness(draft: BusinessDraft): boolean {
  return businessDraftProblem(draft) === null;
}

/** The two halves of the address book, each sorted by name the way Vietnamese reads. */
export function splitContacts(contacts: readonly Contact[]): {
  individuals: Contact[];
  businesses: Contact[];
} {
  const byName = (left: Contact, right: Contact): number => left.name.localeCompare(right.name, "vi");
  return {
    individuals: contacts.filter((entry) => entry.contactType === "individual").sort(byName),
    businesses: contacts.filter((entry) => entry.contactType === "business").sort(byName),
  };
}

/**
 * Whether one contact answers the search box.
 *
 * The fields searched differ by type because the ways people look differ: a person is found by
 * name, phone or email; a company is found by name or by the tax code someone is copying off an
 * invoice. Searching a company's representative here would return a row whose visible line does
 * not contain what was typed, which reads as a bug.
 */
export function matchesContactQuery(contact: Contact, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  const fields: (string | null)[] =
    contact.contactType === "individual"
      ? [contact.name, contact.phone, contact.email]
      : [contact.name, contact.taxCode];

  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export function filterContacts(contacts: readonly Contact[], query: string): Contact[] {
  return contacts.filter((entry) => matchesContactQuery(entry, query));
}

/** The people recorded as working for one company. */
export function staffOf(contacts: readonly Contact[], businessId: string): Contact[] {
  return contacts
    .filter((entry) => entry.contactType === "individual" && entry.employerContactId === businessId)
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

/** The companies offered by the "works for" field, narrowed by what has been typed. */
export function employerOptions(
  contacts: readonly Contact[],
  query: string,
  excludeId: string | null = null,
): Contact[] {
  const needle = query.trim().toLowerCase();
  return contacts
    .filter((entry) => entry.contactType === "business" && entry.id !== excludeId)
    .filter((entry) => {
      if (needle.length === 0) return true;
      return (
        entry.name.toLowerCase().includes(needle) || (entry.taxCode ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

export function contactById(contacts: readonly Contact[], id: string | undefined): Contact | null {
  if (id === undefined) return null;
  return contacts.find((entry) => entry.id === id) ?? null;
}

/**
 * A tax code shortened for a list row.
 *
 * The last four digits are kept because that is the end people read back to each other, and the
 * head is what repeats across companies in the same province. Short codes are shown whole — there
 * is nothing to save.
 */
export function shortTaxCode(taxCode: string | null): string {
  const value = (taxCode ?? "").trim();
  if (value.length === 0) return "Chưa có mã số thuế";
  if (value.length <= 10) return `MST ${value}`;
  return `MST …${value.slice(-4)}`;
}

/** The one line under a person's name: their phone, else their email, else nothing to show. */
export function individualSubtitle(contact: Contact): string {
  return contact.phone ?? contact.email ?? "Chưa có số điện thoại hoặc email";
}

/** Where an invitation link points. The token is the whole secret, so it is the whole path. */
export function buildContactInviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${CONTACT_INVITE_PATH}/${token}`;
}

/** What an invitation says when it travels by itself, in a message the sender can still edit. */
export function inviteMessage(inviterName: string, link: string): string {
  return `${inviterName} muốn kết nối với bạn trên AVORA: ${link}`;
}

/** The `sms:` / `mailto:` address an invitation opens, or null when the channel has no address. */
export function inviteHref(method: InviteMethod, contact: Contact, body: string): string | null {
  if (method === "sms") {
    const phone = given(contact.phone);
    if (phone === null) return null;
    return `sms:${phone}?&body=${encodeURIComponent(body)}`;
  }
  if (method === "email") {
    const email = given(contact.email);
    if (email === null) return null;
    return `mailto:${email}?subject=${encodeURIComponent("Lời mời kết nối trên AVORA")}&body=${encodeURIComponent(body)}`;
  }
  return null;
}

/** Only a person can be invited to link an account; a company is not someone who signs in. */
export function canInviteContact(contact: Contact): boolean {
  return contact.contactType === "individual" && contact.linkedUserId === null;
}

/**
 * Whether an invitation can actually travel this way.
 *
 * A message needs a number and an email needs an address, so offering those channels to a
 * contact that has neither written down is offering something that cannot work. A link needs
 * nothing: the sender forwards it however they like, which is why it is always available.
 *
 * `create_contact_invite` enforces the same rule; this is here so the screen can leave out a
 * button rather than let someone press one and collect an error.
 */
export function canInviteVia(contact: Contact, method: InviteMethod): boolean {
  if (method === "sms") return given(contact.phone) !== null;
  if (method === "email") return given(contact.email) !== null;
  return true;
}

/** A linked contact can be written to directly, through the same 1-1 thread as anywhere else. */
export function canMessageContact(contact: Contact): boolean {
  return contact.contactType === "individual" && contact.linkedUserId !== null;
}

/** What the invite row should say once one is waiting: which way it went, and when. */
export function pendingInviteLabel(invite: ContactInvite): string {
  const channel: Record<InviteMethod, string> = {
    sms: "tin nhắn",
    email: "email",
    link: "liên kết",
    qr: "mã QR",
  };
  return `Đã mời qua ${channel[invite.method]} — đang chờ`;
}

/** Every contact the viewer owns. RLS returns nobody else's, so there is no filter to forget. */
export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase.from("contact").select("*").order("name", { ascending: true });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toContact(row as ContactRow));
}

/** The invitations sent for one contact, newest first. Only the sender's own are visible. */
export async function fetchContactInvites(contactId: string): Promise<ContactInvite[]> {
  const { data, error } = await supabase
    .from("contact_invite")
    .select("*")
    .eq("contact_id", contactId)
    .order("invited_at", { ascending: false });

  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    method: row.method as InviteMethod,
    inviteToken: row.invite_token,
    status: row.status as ContactInvite["status"],
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
  }));
}

/**
 * The invitation still waiting to be accepted, if there is one.
 *
 * One that has run out of time does not count as waiting: the sender's panel hides the invite
 * buttons while something is pending, so treating a timed-out row as live would strand them —
 * still told "đang chờ" about a link nobody can accept, and unable to send a fresh one.
 */
export function pendingInvite(
  invites: readonly ContactInvite[],
  now: Date = new Date(),
): ContactInvite | null {
  return (
    invites.find((entry) => entry.status === "pending" && !contactInviteTimedOut(entry, now)) ?? null
  );
}

/**
 * Creates a person. The owner comes from the session server-side, so this cannot file a
 * contact into someone else's address book however the call is made.
 */
export async function createIndividual(draft: IndividualDraft): Promise<Contact> {
  const { data, error } = await supabase.rpc("create_contact", {
    p_contact_type: "individual",
    p_name: draft.name.trim(),
    p_phone: given(draft.phone) ?? undefined,
    p_email: given(draft.email) ?? undefined,
    p_note: given(draft.note) ?? undefined,
    p_date_of_birth: given(draft.dateOfBirth) ?? undefined,
    p_relationship_tag: given(draft.relationshipTag) ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  return toContact(data as unknown as ContactRow);
}

export async function createBusiness(draft: BusinessDraft): Promise<Contact> {
  const { data, error } = await supabase.rpc("create_contact", {
    p_contact_type: "business",
    p_name: draft.name.trim(),
    p_phone: given(draft.phone) ?? undefined,
    p_email: given(draft.email) ?? undefined,
    p_note: given(draft.note) ?? undefined,
    p_tax_code: given(draft.taxCode) ?? undefined,
    p_business_address: given(draft.businessAddress) ?? undefined,
    p_representative_name: given(draft.representativeName) ?? undefined,
    p_representative_phone: given(draft.representativePhone) ?? undefined,
    p_representative_email: given(draft.representativeEmail) ?? undefined,
    p_industry: given(draft.industry) ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  return toContact(data as unknown as ContactRow);
}

/**
 * Saves an edit. The type is not a parameter: the server re-reads it from the stored row and
 * measures the draft against that type's rules, so a person can never be edited into a company.
 */
export async function updateIndividual(contactId: string, draft: IndividualDraft): Promise<Contact> {
  const { data, error } = await supabase.rpc("update_contact", {
    p_contact_id: contactId,
    p_name: draft.name.trim(),
    p_phone: given(draft.phone) ?? undefined,
    p_email: given(draft.email) ?? undefined,
    p_note: given(draft.note) ?? undefined,
    p_date_of_birth: given(draft.dateOfBirth) ?? undefined,
    p_relationship_tag: given(draft.relationshipTag) ?? undefined,
    p_employer_contact_id: draft.employerContactId ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  return toContact(data as unknown as ContactRow);
}

export async function updateBusiness(contactId: string, draft: BusinessDraft): Promise<Contact> {
  const { data, error } = await supabase.rpc("update_contact", {
    p_contact_id: contactId,
    p_name: draft.name.trim(),
    p_phone: given(draft.phone) ?? undefined,
    p_email: given(draft.email) ?? undefined,
    p_note: given(draft.note) ?? undefined,
    p_tax_code: given(draft.taxCode) ?? undefined,
    p_business_address: given(draft.businessAddress) ?? undefined,
    p_representative_name: given(draft.representativeName) ?? undefined,
    p_representative_phone: given(draft.representativePhone) ?? undefined,
    p_representative_email: given(draft.representativeEmail) ?? undefined,
    p_industry: given(draft.industry) ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
  return toContact(data as unknown as ContactRow);
}

/** Issues an invitation and returns its token. Only the contact's owner may ask. */
export async function createContactInvite(contactId: string, method: InviteMethod): Promise<string> {
  const { data, error } = await supabase.rpc("create_contact_invite", {
    p_contact_id: contactId,
    p_method: method,
  });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không tạo được lời mời. Thử lại nhé.");
  return data as string;
}

/**
 * What the invitation looks like to the person holding the link, or null when there is no
 * such invitation.
 *
 * Goes through an RPC rather than a table read because the invitee can see neither: the
 * invite row is visible only to its sender, and a profile only to its owner. A missing token
 * is an ordinary outcome of a link sent by message, so it returns null instead of throwing.
 */
export async function fetchContactInvitePreview(token: string): Promise<ContactInvitePreview | null> {
  const { data, error } = await supabase.rpc("preview_contact_invite", { p_token: token });
  if (error) throw fail(error.code, error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    inviterName: row.inviter_name,
    status: row.status as ContactInvite["status"],
    isOwnInvite: row.is_own_invite,
    alreadyLinked: row.already_linked,
  };
}

/**
 * Turns the preview into the one thing the screen should say.
 *
 * Acceptance is reported before ownership on purpose: an inviter reopening their own link
 * after it worked is better told that it was accepted — the useful fact — than that they sent
 * it. The reverse order would hide the outcome behind a detail they already know.
 */
export function contactInviteState(preview: ContactInvitePreview | null): ContactInviteState {
  if (preview === null) return { kind: "missing" };
  if (preview.status === "accepted") return { kind: "accepted" };
  if (preview.status === "expired") return { kind: "expired" };
  if (preview.isOwnInvite) return { kind: "own" };
  if (preview.alreadyLinked) return { kind: "linked" };
  return { kind: "ready", inviterName: preview.inviterName };
}

/**
 * Accepts the invitation and returns the id of the contact it created in the accepter's own
 * book. The server re-checks every rule the preview showed, so a link left open while things
 * changed fails honestly instead of writing a half-link.
 */
export async function acceptContactInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không chấp nhận được lời mời. Thử lại nhé.");
  return data as string;
}

/** A stored contact read back into the form that edits it. */
export function toIndividualDraft(contact: Contact): IndividualDraft {
  return {
    name: contact.name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    dateOfBirth: contact.dateOfBirth ?? "",
    relationshipTag: contact.relationshipTag ?? "",
    note: contact.note ?? "",
    employerContactId: contact.employerContactId,
  };
}

export function toBusinessDraft(contact: Contact): BusinessDraft {
  return {
    name: contact.name,
    taxCode: contact.taxCode ?? "",
    representativeName: contact.representativeName ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    representativePhone: contact.representativePhone ?? "",
    representativeEmail: contact.representativeEmail ?? "",
    businessAddress: contact.businessAddress ?? "",
    industry: contact.industry ?? "",
    note: contact.note ?? "",
  };
}
