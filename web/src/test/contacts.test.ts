import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildContactInviteLink,
  businessDraftProblem,
  canInviteContact,
  canMessageContact,
  canSubmitBusiness,
  canSubmitIndividual,
  contactById,
  employerOptions,
  filterContacts,
  individualDraftProblem,
  individualSubtitle,
  inviteHref,
  inviteMessage,
  isContactType,
  matchesContactQuery,
  pendingInvite,
  pendingInviteLabel,
  shortTaxCode,
  splitContacts,
  staffOf,
  toBusinessDraft,
  toIndividualDraft,
  toVietnameseContactError,
  EMPTY_BUSINESS_DRAFT,
  EMPTY_INDIVIDUAL_DRAFT,
  RELATIONSHIP_SUGGESTIONS,
  type BusinessDraft,
  type Contact,
  type ContactInvite,
  type IndividualDraft,
} from "@/lib/contacts";

const ME = "u-me";

function person(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: ME,
    contactType: "individual",
    phone: "0900000000",
    email: null,
    note: null,
    linkedUserId: null,
    employerContactId: null,
    dateOfBirth: null,
    relationshipTag: null,
    taxCode: null,
    businessAddress: null,
    representativeName: null,
    representativePhone: null,
    representativeEmail: null,
    industry: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function company(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return person({
    ...overrides,
    contactType: "business",
    taxCode: overrides.taxCode ?? "0101234567",
    representativeName: overrides.representativeName ?? "Người Đại Diện",
  });
}

const individualDraft = (over: Partial<IndividualDraft> = {}): IndividualDraft => ({
  ...EMPTY_INDIVIDUAL_DRAFT,
  name: "Nguyễn Văn A",
  phone: "0900000001",
  ...over,
});

const businessDraft = (over: Partial<BusinessDraft> = {}): BusinessDraft => ({
  ...EMPTY_BUSINESS_DRAFT,
  name: "Công ty ABC",
  taxCode: "0101234567",
  representativeName: "Nguyễn Văn B",
  phone: "02800000000",
  ...over,
});

describe("what a contact is", () => {
  /**
   * The type is decided at creation and never edited: every later rule reads it, and a record
   * that could change its mind would make all of them guess.
   */
  it("recognises only the two kinds", () => {
    expect(isContactType("individual")).toBe(true);
    expect(isContactType("business")).toBe(true);
    expect(isContactType("person")).toBe(false);
    expect(isContactType("")).toBe(false);
  });

  it("keeps people and companies in two lists, each sorted the way Vietnamese reads", () => {
    const { individuals, businesses } = splitContacts([
      company({ id: "b1", name: "Zeta" }),
      person({ id: "p1", name: "Ân" }),
      person({ id: "p2", name: "Anh" }),
      company({ id: "b2", name: "Alpha" }),
    ]);

    expect(individuals.map((entry) => entry.id)).toEqual(["p2", "p1"]);
    expect(businesses.map((entry) => entry.id)).toEqual(["b2", "b1"]);
  });

  it("never lets one list leak into the other", () => {
    const { individuals, businesses } = splitContacts([
      person({ id: "p1", name: "A" }),
      company({ id: "b1", name: "B" }),
    ]);
    expect(individuals.every((entry) => entry.contactType === "individual")).toBe(true);
    expect(businesses.every((entry) => entry.contactType === "business")).toBe(true);
  });
});

describe("finding someone", () => {
  const people = [
    person({ id: "p1", name: "Trần Thị Hoa", phone: "0912345678", email: "hoa@vidu.com" }),
    person({ id: "p2", name: "Lê Văn Dũng", phone: "0987654321", email: null }),
  ];
  const companies = [
    company({ id: "b1", name: "Công ty Xây Dựng An Phát", taxCode: "0101234567" }),
    company({ id: "b2", name: "Bán Lẻ Minh Long", taxCode: "0309876543" }),
  ];

  it("finds a person by name, phone or email", () => {
    expect(filterContacts(people, "hoa").map((entry) => entry.id)).toEqual(["p1"]);
    expect(filterContacts(people, "0987").map((entry) => entry.id)).toEqual(["p2"]);
    expect(filterContacts(people, "hoa@vidu").map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("finds a company by name or by the tax code someone is copying off an invoice", () => {
    expect(filterContacts(companies, "an phát").map((entry) => entry.id)).toEqual(["b1"]);
    expect(filterContacts(companies, "0309876543").map((entry) => entry.id)).toEqual(["b2"]);
  });

  /**
   * A company's representative is deliberately not searched: the row on screen shows the company
   * name and its tax code, so a hit on a hidden field would look like a bug.
   */
  it("does not match a company on fields its row never shows", () => {
    const withRep = company({
      id: "b3",
      name: "Công ty Khác",
      representativeName: "Phạm Thị Lan",
      email: "lan@congty.com",
    });
    expect(matchesContactQuery(withRep, "Lan")).toBe(false);
    expect(matchesContactQuery(withRep, "lan@congty.com")).toBe(false);
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchesContactQuery(people[0], "  TRẦN  ".trim())).toBe(true);
    expect(matchesContactQuery(people[0], "trần")).toBe(true);
  });

  it("shows everyone when nothing has been typed", () => {
    expect(filterContacts(people, "")).toHaveLength(2);
    expect(filterContacts(people, "   ")).toHaveLength(2);
  });

  it("does not crash on a person with no email", () => {
    expect(matchesContactQuery(people[1], "vidu.com")).toBe(false);
  });
});

describe("what the form checks before asking the server", () => {
  /**
   * A mirror of the RPC's rules, kept only so the button can explain itself before a round trip.
   * The server validates independently and is the one that decides.
   */
  it("wants a name for a person", () => {
    expect(individualDraftProblem(individualDraft({ name: "" }))).toBe("Liên hệ cần có tên.");
    expect(individualDraftProblem(individualDraft({ name: "   " }))).toBe("Liên hệ cần có tên.");
  });

  it("wants one way to reach a person, either one", () => {
    expect(individualDraftProblem(individualDraft({ phone: "", email: "" }))).toBe(
      "Cần ít nhất số điện thoại hoặc email.",
    );
    expect(individualDraftProblem(individualDraft({ phone: "0900000001", email: "" }))).toBeNull();
    expect(individualDraftProblem(individualDraft({ phone: "", email: "a@b.com" }))).toBeNull();
  });

  it("does not count whitespace as a way to reach someone", () => {
    expect(individualDraftProblem(individualDraft({ phone: "  ", email: "  " }))).toBe(
      "Cần ít nhất số điện thoại hoặc email.",
    );
  });

  it("wants a name, a tax code and a representative for a company", () => {
    expect(businessDraftProblem(businessDraft({ name: "" }))).toBe("Doanh nghiệp cần có tên.");
    expect(businessDraftProblem(businessDraft({ taxCode: "" }))).toBe("Doanh nghiệp cần mã số thuế.");
    expect(businessDraftProblem(businessDraft({ representativeName: "" }))).toBe(
      "Doanh nghiệp cần tên người đại diện.",
    );
  });

  it("accepts any one of a company's four channels", () => {
    const bare = businessDraft({ phone: "", email: "", representativePhone: "", representativeEmail: "" });
    expect(businessDraftProblem(bare)).toContain("Cần ít nhất một số điện thoại hoặc email");

    expect(businessDraftProblem({ ...bare, phone: "0280000000" })).toBeNull();
    expect(businessDraftProblem({ ...bare, email: "a@congty.com" })).toBeNull();
    expect(businessDraftProblem({ ...bare, representativePhone: "0900000000" })).toBeNull();
    expect(businessDraftProblem({ ...bare, representativeEmail: "b@congty.com" })).toBeNull();
  });

  it("agrees with the button it enables", () => {
    expect(canSubmitIndividual(individualDraft())).toBe(true);
    expect(canSubmitIndividual(individualDraft({ name: "" }))).toBe(false);
    expect(canSubmitBusiness(businessDraft())).toBe(true);
    expect(canSubmitBusiness(businessDraft({ taxCode: "" }))).toBe(false);
  });

  it("asks nothing of the optional fields", () => {
    expect(
      individualDraftProblem(individualDraft({ dateOfBirth: "", relationshipTag: "", note: "" })),
    ).toBeNull();
    expect(businessDraftProblem(businessDraft({ businessAddress: "", industry: "", note: "" }))).toBeNull();
  });
});

describe("who works where", () => {
  const acme = company({ id: "b-acme", name: "Acme" });
  const other = company({ id: "b-other", name: "Beta" });
  const staff1 = person({ id: "p1", name: "Bình", employerContactId: "b-acme" });
  const staff2 = person({ id: "p2", name: "An", employerContactId: "b-acme" });
  const outsider = person({ id: "p3", name: "Cường" });
  const book = [acme, other, staff1, staff2, outsider];

  it("lists the people recorded as working for one company", () => {
    expect(staffOf(book, "b-acme").map((entry) => entry.id)).toEqual(["p2", "p1"]);
  });

  it("returns an empty list for a company nobody is attached to — not an error", () => {
    expect(staffOf(book, "b-other")).toEqual([]);
  });

  it("never counts a company as staff of another company", () => {
    const nested = company({ id: "b-sub", name: "Sub", employerContactId: "b-acme" });
    expect(staffOf([...book, nested], "b-acme").map((entry) => entry.id)).toEqual(["p2", "p1"]);
  });

  /**
   * The picker offers only the viewer's own companies — the server refuses anything else, and
   * offering a name that would be rejected is worse than not offering it.
   */
  it("offers companies only, never people", () => {
    expect(employerOptions(book, "").map((entry) => entry.id)).toEqual(["b-acme", "b-other"]);
  });

  it("narrows by name or tax code as someone types", () => {
    expect(employerOptions(book, "acm").map((entry) => entry.id)).toEqual(["b-acme"]);
    expect(employerOptions(book, "0101234567").map((entry) => entry.id)).toEqual(["b-acme", "b-other"]);
  });

  it("never offers the contact being edited as its own employer", () => {
    expect(employerOptions(book, "", "b-acme").map((entry) => entry.id)).toEqual(["b-other"]);
  });
});

describe("what a row says", () => {
  it("shortens a long tax code to the digits people read back", () => {
    expect(shortTaxCode("0101234567890")).toBe("MST …7890");
  });

  it("shows a short code whole — there is nothing to save", () => {
    expect(shortTaxCode("0101234567")).toBe("MST 0101234567");
  });

  it("says plainly when a company has no code rather than showing an empty label", () => {
    expect(shortTaxCode(null)).toBe("Chưa có mã số thuế");
    expect(shortTaxCode("   ")).toBe("Chưa có mã số thuế");
  });

  it("puts the phone under a person's name, falling back to email", () => {
    expect(individualSubtitle(person({ id: "p", name: "A", phone: "0900", email: "a@b.com" }))).toBe("0900");
    expect(individualSubtitle(person({ id: "p", name: "A", phone: null, email: "a@b.com" }))).toBe("a@b.com");
    expect(individualSubtitle(person({ id: "p", name: "A", phone: null, email: null }))).toBe(
      "Chưa có số điện thoại hoặc email",
    );
  });
});

describe("who can be invited, and who can be written to", () => {
  /**
   * A company is not someone who signs in. The rule is absolute on both sides: no invitation
   * button and no message button ever appear on a business record.
   */
  it("never offers to invite a company", () => {
    expect(canInviteContact(company({ id: "b", name: "Acme" }))).toBe(false);
    expect(canInviteContact(company({ id: "b", name: "Acme", linkedUserId: null }))).toBe(false);
  });

  it("never offers to message a company", () => {
    expect(canMessageContact(company({ id: "b", name: "Acme" }))).toBe(false);
  });

  it("offers an invitation to a person who is not on AVORA yet", () => {
    expect(canInviteContact(person({ id: "p", name: "A" }))).toBe(true);
  });

  it("stops offering the invitation once the person has joined", () => {
    const linked = person({ id: "p", name: "A", linkedUserId: "u-other" });
    expect(canInviteContact(linked)).toBe(false);
    expect(canMessageContact(linked)).toBe(true);
  });

  it("does not offer to message someone who has no account", () => {
    expect(canMessageContact(person({ id: "p", name: "A" }))).toBe(false);
  });
});

describe("an invitation on its way", () => {
  const invite = (over: Partial<ContactInvite> = {}): ContactInvite => ({
    id: "i1",
    contactId: "p1",
    method: "sms",
    inviteToken: "tok-123",
    status: "pending",
    invitedAt: "2026-09-10T00:00:00Z",
    acceptedAt: null,
    ...over,
  });

  it("finds the one still waiting", () => {
    expect(pendingInvite([invite({ status: "accepted" }), invite({ id: "i2" })])?.id).toBe("i2");
  });

  it("reports nothing waiting when every invitation is settled", () => {
    expect(pendingInvite([invite({ status: "accepted" }), invite({ status: "expired" })])).toBeNull();
    expect(pendingInvite([])).toBeNull();
  });

  it("names the channel it went by", () => {
    expect(pendingInviteLabel(invite({ method: "sms" }))).toBe("Đã mời qua tin nhắn — đang chờ");
    expect(pendingInviteLabel(invite({ method: "email" }))).toBe("Đã mời qua email — đang chờ");
    expect(pendingInviteLabel(invite({ method: "link" }))).toBe("Đã mời qua liên kết — đang chờ");
  });

  it("builds a link whose token is the whole secret", () => {
    expect(buildContactInviteLink("https://avora.app", "tok-123")).toBe(
      "https://avora.app/loi-moi-lien-he/tok-123",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildContactInviteLink("https://avora.app/", "tok")).toBe("https://avora.app/loi-moi-lien-he/tok");
  });

  /**
   * AVORA prepares and hands over; it never sends on someone's behalf. Each channel opens the
   * person's own app with the text written, so the last read and the send are theirs.
   */
  it("hands over a message the sender still has to send", () => {
    const body = inviteMessage("Minh", "https://avora.app/loi-moi-lien-he/tok");
    expect(body).toContain("Minh");
    expect(body).toContain("https://avora.app/loi-moi-lien-he/tok");

    const href = inviteHref("sms", person({ id: "p", name: "A", phone: "0900000000" }), body);
    expect(href).toContain("sms:0900000000");
    expect(href).toContain(encodeURIComponent("Minh"));
  });

  it("writes an email invitation to the address on the contact", () => {
    const href = inviteHref("email", person({ id: "p", name: "A", email: "a@b.com" }), "xin chào");
    expect(href).toContain("mailto:a@b.com");
    expect(href).toContain(encodeURIComponent("xin chào"));
  });

  it("has no address to open when the channel is missing one", () => {
    expect(inviteHref("sms", person({ id: "p", name: "A", phone: null, email: "a@b.com" }), "x")).toBeNull();
    expect(inviteHref("email", person({ id: "p", name: "A", email: null }), "x")).toBeNull();
    expect(inviteHref("link", person({ id: "p", name: "A" }), "x")).toBeNull();
  });
});

describe("reading a stored contact back into its form", () => {
  it("carries every person field into the draft, empty rather than null", () => {
    const draft = toIndividualDraft(
      person({
        id: "p",
        name: "A",
        phone: "0900",
        email: null,
        dateOfBirth: "1990-05-02",
        relationshipTag: "Bạn bè",
        employerContactId: "b1",
      }),
    );
    expect(draft).toEqual({
      name: "A",
      phone: "0900",
      email: "",
      dateOfBirth: "1990-05-02",
      relationshipTag: "Bạn bè",
      note: "",
      employerContactId: "b1",
    });
  });

  it("carries every company field into the draft", () => {
    const draft = toBusinessDraft(
      company({ id: "b", name: "Acme", taxCode: "010", representativeName: "B", industry: "Bán lẻ" }),
    );
    expect(draft.name).toBe("Acme");
    expect(draft.taxCode).toBe("010");
    expect(draft.representativeName).toBe("B");
    expect(draft.industry).toBe("Bán lẻ");
    expect(draft.businessAddress).toBe("");
  });

  it("produces a draft the form already considers valid", () => {
    expect(canSubmitIndividual(toIndividualDraft(person({ id: "p", name: "A", phone: "0900" })))).toBe(true);
    expect(canSubmitBusiness(toBusinessDraft(company({ id: "b", name: "Acme" })))).toBe(true);
  });

  it("finds one contact among many, and nothing for an unknown id", () => {
    const book = [person({ id: "p1", name: "A" }), company({ id: "b1", name: "B" })];
    expect(contactById(book, "b1")?.name).toBe("B");
    expect(contactById(book, "nope")).toBeNull();
    expect(contactById(book, undefined)).toBeNull();
  });
});

describe("what the screen says when the server refuses", () => {
  /**
   * The database already rejects in Vietnamese. Its sentence is kept when it names a rule a
   * person can act on, so the two cannot drift apart on the next schema change.
   */
  it("repeats the rule that was broken", () => {
    expect(toVietnameseContactError(undefined, "Tên liên hệ không được để trống")).toBe(
      "Liên hệ cần có tên.",
    );
    expect(toVietnameseContactError(undefined, "Liên hệ doanh nghiệp cần mã số thuế")).toBe(
      "Doanh nghiệp cần mã số thuế.",
    );
    expect(toVietnameseContactError(undefined, "Liên hệ cá nhân cần ít nhất số điện thoại hoặc email")).toBe(
      "Cần ít nhất số điện thoại hoặc email.",
    );
  });

  it("explains an attempt to touch someone else's contact without accusing anyone", () => {
    expect(toVietnameseContactError(undefined, "Chỉ chủ liên hệ mới được sửa liên hệ này")).toBe(
      "Đây không phải liên hệ của bạn.",
    );
  });

  it("says why a company cannot be invited", () => {
    expect(
      toVietnameseContactError(undefined, "Chỉ liên hệ cá nhân mới có thể mời liên kết tài khoản"),
    ).toContain("doanh nghiệp không đăng nhập");
  });

  it("sends an expired session back to sign in", () => {
    expect(toVietnameseContactError(undefined, "Chưa đăng nhập")).toContain("đăng nhập lại");
  });

  it("separates a network failure from a refusal", () => {
    expect(toVietnameseContactError(undefined, "Failed to fetch")).toContain("Kiểm tra mạng");
    expect(toVietnameseContactError("42501", "permission denied for function update_contact")).toContain(
      "Máy chủ chưa cho phép",
    );
  });

  it("falls back to something plain rather than leaking a Postgres message", () => {
    const message = toVietnameseContactError("XX000", 'relation "contact" does not exist');
    expect(message).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
    expect(message).not.toContain("relation");
  });
});

describe("the relationship field", () => {
  /**
   * Free text with suggestions, not a fixed set: unlike the family marks — which a notification
   * rule has to act on — this label is only ever read by the person who wrote it.
   */
  it("suggests the three common answers without limiting anyone to them", () => {
    expect(RELATIONSHIP_SUGGESTIONS).toEqual(["Gia đình", "Bạn bè", "Đối tác"]);
    expect(individualDraftProblem(individualDraft({ relationshipTag: "bạn cấp ba" }))).toBeNull();
  });
});
