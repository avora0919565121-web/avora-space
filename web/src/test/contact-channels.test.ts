import { vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  allChannelsOf,
  buildChannelIndex,
  canAssignToBusiness,
  channelKindLabel,
  channelSourceLabel,
  channelsOf,
  contactsNeedingReview,
  isBlankChannel,
  matchAnyChannel,
  matchChannel,
  normalizeChannelValue,
  normalizeEmail,
  normalizePhone,
  planSharedChannelFix,
  reviewCount,
  reviewTotal,
  sharedChannelGroups,
  uniqueChannelValues,
  type ContactChannel,
} from "@/lib/contact-channels";
import { type Contact } from "@/lib/contacts";

const ME = "u-me";

function person(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: ME,
    contactType: "individual",
    phone: null,
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

function channel(overrides: Partial<ContactChannel> & { id: string; contactId: string }): ContactChannel {
  const kind = overrides.kind ?? "phone";
  const value = overrides.value ?? "0900000000";
  return {
    ownerUserId: ME,
    kind,
    value,
    valueNormalized: normalizeChannelValue(kind, value),
    label: null,
    source: "manual",
    needsReview: false,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    ...overrides,
  };
}

describe("reading a phone number the way the database reads it", () => {
  /**
   * These four cases mirror `private.normalize_channel`. If this file and that function ever
   * disagree, the preview calls something a duplicate that the database then stores twice.
   */
  it("treats the international and local forms as one number", () => {
    expect(normalizePhone("+84 912 345 678")).toBe(normalizePhone("0912345678"));
    expect(normalizePhone("+84912345678")).toBe("0912345678");
  });

  it("ignores the punctuation people type into phone numbers", () => {
    expect(normalizePhone("091-234-5678")).toBe("0912345678");
    expect(normalizePhone(" (091) 234 5678 ")).toBe("0912345678");
  });

  it("folds case and spacing out of an email", () => {
    expect(normalizeEmail("  Hoa@Example.COM ")).toBe("hoa@example.com");
  });

  it("reduces a value with no digits at all to nothing", () => {
    expect(normalizePhone("---")).toBe("");
    expect(isBlankChannel("phone", "  -- ")).toBe(true);
    expect(isBlankChannel("email", "   ")).toBe(true);
    expect(isBlankChannel("phone", "0900111222")).toBe(false);
  });

  it("picks the rule that matches the kind of channel", () => {
    expect(normalizeChannelValue("email", " A@B.com ")).toBe("a@b.com");
    expect(normalizeChannelValue("phone", "+84 900 111 222")).toBe("0900111222");
  });
});

describe("finding someone already in the book", () => {
  const contacts: Contact[] = [
    person({ id: "c1", name: "Hoà", phone: "0912345678" }),
    person({ id: "c2", name: "Lan", email: "lan@example.com" }),
  ];
  const channels: ContactChannel[] = [
    channel({ id: "ch1", contactId: "c1", kind: "phone", value: "0900 111 222" }),
    channel({ id: "ch2", contactId: "c2", kind: "email", value: "Lan.Work@Example.com" }),
  ];
  const index = buildChannelIndex(contacts, channels);

  it("matches a primary number written in another form", () => {
    const hit = matchChannel(index, "phone", "+84912345678");
    expect(hit?.contactId).toBe("c1");
    expect(hit?.contactName).toBe("Hoà");
  });

  /** The whole point of the channel table: the second number identifies its owner too. */
  it("matches a number that is only a secondary channel", () => {
    expect(matchChannel(index, "phone", "0900111222")?.contactId).toBe("c1");
    expect(matchChannel(index, "email", "lan.work@example.com")?.contactId).toBe("c2");
  });

  it("does not match a value nobody has", () => {
    expect(matchChannel(index, "phone", "0988888888")).toBeNull();
    expect(matchChannel(index, "email", "nobody@example.com")).toBeNull();
  });

  it("does not match on an empty value", () => {
    expect(matchChannel(index, "phone", "   ")).toBeNull();
    expect(matchChannel(index, "email", "")).toBeNull();
  });

  /**
   * An imported row often lists the new number first and the known one second, so checking only
   * the first value would file a second copy of someone already there.
   */
  it("checks every value it is given, not only the first", () => {
    const hit = matchAnyChannel(index, ["0988888888", "0900111222"], []);
    expect(hit?.contactId).toBe("c1");
  });

  it("checks emails once the phones have all missed", () => {
    const hit = matchAnyChannel(index, ["0988888888"], ["lan@example.com"]);
    expect(hit?.contactId).toBe("c2");
  });

  it("reports nothing when none of the values are known", () => {
    expect(matchAnyChannel(index, ["0988888888"], ["nobody@example.com"])).toBeNull();
  });

  it("ignores channels whose contact is not in the book", () => {
    const orphaned = buildChannelIndex(contacts, [
      channel({ id: "ch9", contactId: "gone", kind: "phone", value: "0977777777" }),
    ]);
    expect(matchChannel(orphaned, "phone", "0977777777")).toBeNull();
  });
});

describe("listing every way to reach one contact", () => {
  it("puts the primary channels first and marks them as primary", () => {
    const contact = person({ id: "c1", name: "Hoà", phone: "0912345678", email: "hoa@example.com" });
    const all = allChannelsOf(contact, [
      channel({ id: "ch1", contactId: "c1", kind: "phone", value: "0900111222" }),
    ]);

    expect(all.map((entry) => entry.value)).toEqual([
      "0912345678",
      "hoa@example.com",
      "0900111222",
    ]);
    expect(all[0].isPrimary).toBe(true);
    expect(all[2].isPrimary).toBe(false);
    expect(all[2].channelId).toBe("ch1");
  });

  it("leaves out a primary channel the contact does not have", () => {
    const contact = person({ id: "c1", name: "Hoà", email: "hoa@example.com" });
    const all = allChannelsOf(contact, []);
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("email");
  });

  it("returns nothing for a contact with no channels at all", () => {
    expect(allChannelsOf(person({ id: "c1", name: "Trống" }), [])).toEqual([]);
  });

  it("groups a contact's extra channels with phones before emails", () => {
    const channels = [
      channel({ id: "ch2", contactId: "c1", kind: "email", value: "a@example.com" }),
      channel({ id: "ch1", contactId: "c1", kind: "phone", value: "0900111222" }),
      channel({ id: "ch3", contactId: "other", kind: "phone", value: "0933333333" }),
    ];
    expect(channelsOf(channels, "c1").map((entry) => entry.id)).toEqual(["ch1", "ch2"]);
  });
});

describe("keeping the same value out of a list twice", () => {
  it("drops repeats that differ only in how they were typed", () => {
    expect(uniqueChannelValues("phone", ["0912345678", "+84 912 345 678", "0900111222"])).toEqual([
      "0912345678",
      "0900111222",
    ]);
  });

  it("drops values that are empty once normalised", () => {
    expect(uniqueChannelValues("phone", ["", "  ", "---", "0900111222"])).toEqual(["0900111222"]);
  });

  it("keeps the values as written, not as normalised", () => {
    expect(uniqueChannelValues("phone", [" 0912 345 678 "])).toEqual(["0912 345 678"]);
  });
});

describe("what still needs a person to look at it", () => {
  const contacts: Contact[] = [
    person({ id: "c1", name: "Bình", phone: "0912345678" }),
    person({ id: "c2", name: "An", phone: "0987000111" }),
  ];

  it("lists only contacts carrying an unconfirmed channel", () => {
    const channels = [
      channel({ id: "ch1", contactId: "c1", value: "0900111222", needsReview: true }),
      channel({ id: "ch2", contactId: "c2", value: "0900333444", needsReview: false }),
    ];
    const groups = contactsNeedingReview(contacts, channels);

    expect(groups).toHaveLength(1);
    expect(groups[0].contact.id).toBe("c1");
    expect(groups[0].channels.map((entry) => entry.id)).toEqual(["ch1"]);
  });

  it("carries only the flagged channels of a contact that has both kinds", () => {
    const channels = [
      channel({ id: "ch1", contactId: "c1", value: "0900111222", needsReview: true }),
      channel({ id: "ch2", contactId: "c1", value: "0900333444", needsReview: false }),
    ];
    expect(contactsNeedingReview(contacts, channels)[0].channels.map((e) => e.id)).toEqual(["ch1"]);
  });

  it("sorts the contacts the way Vietnamese reads names", () => {
    const channels = [
      channel({ id: "ch1", contactId: "c1", value: "0900111222", needsReview: true }),
      channel({ id: "ch2", contactId: "c2", value: "0900333444", needsReview: true }),
    ];
    expect(contactsNeedingReview(contacts, channels).map((g) => g.contact.name)).toEqual([
      "An",
      "Bình",
    ]);
  });

  it("is empty when nothing is flagged", () => {
    expect(contactsNeedingReview(contacts, [channel({ id: "ch1", contactId: "c1" })])).toEqual([]);
    expect(reviewCount([channel({ id: "ch1", contactId: "c1" })])).toBe(0);
  });

  it("counts flagged channels, not contacts", () => {
    const channels = [
      channel({ id: "ch1", contactId: "c1", value: "0900111222", needsReview: true }),
      channel({ id: "ch2", contactId: "c1", value: "0900333444", needsReview: true }),
    ];
    expect(reviewCount(channels)).toBe(2);
    expect(contactsNeedingReview(contacts, channels)).toHaveLength(1);
  });
});

describe("finding one channel held by several contacts", () => {
  it("says nothing when every number belongs to exactly one person", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0912345678" }),
      person({ id: "c2", name: "An", phone: "0987000111" }),
    ];
    expect(sharedChannelGroups(contacts, [])).toEqual([]);
  });

  /** Both holders keep it as their primary channel — neither has a `contact_channel` row. */
  it("finds a value shared between two primary channels", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({ id: "c2", name: "An", phone: "0900 111 222" }),
    ];

    const groups = sharedChannelGroups(contacts, []);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("phone");
    expect(groups[0].valueNormalized).toBe("0900111222");
    expect(groups[0].holders.map((entry) => entry.contact.id).sort()).toEqual(["c1", "c2"]);
    expect(groups[0].holders.every((entry) => entry.isPrimary)).toBe(true);
  });

  it("finds a value shared between two extra channels", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0912345678" }),
      person({ id: "c2", name: "An", phone: "0987000111" }),
    ];
    const channels = [
      channel({ id: "ch1", contactId: "c1", value: "0900111222" }),
      channel({ id: "ch2", contactId: "c2", value: "0900111222" }),
    ];

    const groups = sharedChannelGroups(contacts, channels);

    expect(groups).toHaveLength(1);
    expect(groups[0].holders.every((entry) => entry.isPrimary)).toBe(false);
  });

  /**
   * The case a cheaper check misses: one contact keeps the number in its phone field while
   * another keeps the same number as an extra channel.
   */
  it("finds a value shared across a primary channel and an extra one", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({ id: "c2", name: "An", phone: "0987000111" }),
    ];
    const channels = [channel({ id: "ch1", contactId: "c2", value: "+84 900 111 222" })];

    const groups = sharedChannelGroups(contacts, channels);

    expect(groups).toHaveLength(1);
    expect(groups[0].holders.map((entry) => entry.contact.id)).toEqual(["c1", "c2"]);
    // The one actually in use is listed first and names the group.
    expect(groups[0].holders[0].isPrimary).toBe(true);
    expect(groups[0].value).toBe("0900111222");
  });

  /** Each holder keeps its own spelling, so the card can show what each contact actually stored. */
  it("reads two spellings of one number as one number", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "+84912345678" }),
      person({ id: "c2", name: "An", phone: "0912 345 678" }),
    ];

    const groups = sharedChannelGroups(contacts, []);

    expect(groups).toHaveLength(1);
    expect(groups[0].valueNormalized).toBe("0912345678");
    expect(groups[0].holders.map((entry) => entry.value).sort()).toEqual([
      "+84912345678",
      "0912 345 678",
    ]);
  });

  /** Equal holders read alphabetically, the same order the address book itself uses. */
  it("lists holders of equal standing by name", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0912345678" }),
      person({ id: "c2", name: "An", phone: "0912345678" }),
    ];

    expect(sharedChannelGroups(contacts, [])[0].holders.map((entry) => entry.contact.name)).toEqual(
      ["An", "Bình"],
    );
  });

  it("treats emails case-insensitively, as the database does", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", email: "Ke.Toan@Sen.test" }),
      person({ id: "c2", name: "An", email: "ke.toan@sen.test" }),
    ];

    const groups = sharedChannelGroups(contacts, []);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("email");
  });

  /**
   * One contact holding the same value twice is the OTHER screen's question. Counting it here
   * would report a contact as sharing a number with itself.
   */
  it("does not report one contact holding the same value twice", () => {
    const contacts = [person({ id: "c1", name: "Bình", phone: "0900111222" })];
    const channels = [channel({ id: "ch1", contactId: "c1", value: "+84900111222" })];

    expect(sharedChannelGroups(contacts, channels)).toEqual([]);
  });

  it("ignores a channel whose contact is not in the book", () => {
    const contacts = [person({ id: "c1", name: "Bình", phone: "0900111222" })];
    const channels = [channel({ id: "ch1", contactId: "gone", value: "0900111222" })];

    expect(sharedChannelGroups(contacts, channels)).toEqual([]);
  });

  it("ignores values that are empty once normalised", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "   ", email: "binh@example.test" }),
      person({ id: "c2", name: "An", phone: "-- --", email: "an@example.test" }),
    ];

    expect(sharedChannelGroups(contacts, [])).toEqual([]);
  });

  it("counts every contact holding the value, not just the first two", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({ id: "c2", name: "An", phone: "0987000111" }),
      person({ id: "c3", name: "Cúc", phone: "0977000222" }),
    ];
    const channels = [
      channel({ id: "ch1", contactId: "c2", value: "0900111222" }),
      channel({ id: "ch2", contactId: "c3", value: "0900111222" }),
    ];

    expect(sharedChannelGroups(contacts, channels)[0].holders).toHaveLength(3);
  });

  it("puts the biggest tangle first, then phones before emails", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222", email: "chung@sen.test" }),
      person({ id: "c2", name: "An", phone: "0900111222", email: "chung@sen.test" }),
      person({ id: "c3", name: "Cúc", phone: "0900111222" }),
    ];

    const groups = sharedChannelGroups(contacts, []);

    expect(groups.map((entry) => entry.kind)).toEqual(["phone", "email"]);
    expect(groups[0].holders).toHaveLength(3);
  });

  it("names the companies among the holders", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({
        id: "c2",
        name: "Công ty Sen",
        contactType: "business",
        phone: "0900111222",
        taxCode: "0101234567",
      }),
    ];

    const groups = sharedChannelGroups(contacts, []);

    expect(groups[0].businesses.map((entry) => entry.id)).toEqual(["c2"]);
    expect(canAssignToBusiness(groups[0])).toBe(true);
  });

  /**
   * Without a company already holding the value, "this belongs to a business" would mean picking
   * one out of the whole address book — a bigger question than the one being asked.
   */
  it("does not offer the business answer when no company holds the value", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({ id: "c2", name: "An", phone: "0900111222" }),
    ];

    expect(canAssignToBusiness(sharedChannelGroups(contacts, [])[0])).toBe(false);
  });

  it("keys a group stably so a refetch does not reshuffle it", () => {
    const contacts = [
      person({ id: "c1", name: "Bình", phone: "0900111222" }),
      person({ id: "c2", name: "An", phone: "0900111222" }),
    ];

    expect(sharedChannelGroups(contacts, [])[0].key).toBe("phone:0900111222");
  });
});

describe("deciding what a shared channel fix touches", () => {
  const binh = person({ id: "c1", name: "Bình", phone: "0900111222" });
  const an = person({ id: "c2", name: "An", phone: "0987000111" });
  const sen = person({
    id: "c3",
    name: "Công ty Sen",
    contactType: "business",
    phone: "0900 111 222",
    taxCode: "0101234567",
    representativeName: "Chị Mai",
  });

  const group = sharedChannelGroups(
    [binh, an, sen],
    [channel({ id: "ch1", contactId: "c2", value: "+84900111222" })],
  )[0];

  it("sees all three holders", () => {
    expect(group.holders).toHaveLength(3);
  });

  it("keeping one contact detaches from exactly the others", () => {
    const plan = planSharedChannelFix(group, { kind: "keep-one", contactId: "c1" });

    expect(plan.problem).toBeNull();
    expect(plan.ensureOn).toBeNull();
    expect(plan.detachFrom.map((entry) => entry.contact.id).sort()).toEqual(["c2", "c3"]);
  });

  it("removing from all detaches from every holder and nobody else", () => {
    const plan = planSharedChannelFix(group, { kind: "remove-all" });

    expect(plan.detachFrom.map((entry) => entry.contact.id).sort()).toEqual(["c1", "c2", "c3"]);
    expect(plan.ensureOn).toBeNull();
  });

  it("assigning to the company leaves it holding the value and clears the people", () => {
    const plan = planSharedChannelFix(group, { kind: "assign-business", contactId: "c3" });

    expect(plan.problem).toBeNull();
    expect(plan.ensureOn?.contact.id).toBe("c3");
    expect(plan.detachFrom.map((entry) => entry.contact.id).sort()).toEqual(["c1", "c2"]);
  });

  /** The company keeps the number as it spells it, not as whichever holder named the group. */
  it("gives the company its own spelling of the value", () => {
    const plan = planSharedChannelFix(group, { kind: "assign-business", contactId: "c3" });

    expect(plan.ensureOn?.value).toBe("0900 111 222");
  });

  it("refuses to call a person's row the business owner", () => {
    const plan = planSharedChannelFix(group, { kind: "assign-business", contactId: "c1" });

    expect(plan.problem).toBe("Chỉ gán được cho một liên hệ doanh nghiệp.");
    expect(plan.detachFrom).toEqual([]);
  });

  /**
   * A screen left open while the data moved on must delete nothing. "Detach from everyone" is the
   * one fallback that would destroy the most while explaining the least.
   */
  it("detaches from nobody when the chosen contact no longer holds the value", () => {
    const plan = planSharedChannelFix(group, { kind: "keep-one", contactId: "khong-co" });

    expect(plan.problem).not.toBeNull();
    expect(plan.detachFrom).toEqual([]);
    expect(plan.ensureOn).toBeNull();
  });

  it("detaches each holder by the spelling that holder stored", () => {
    const plan = planSharedChannelFix(group, { kind: "keep-one", contactId: "c1" });
    const an_plan = plan.detachFrom.find((entry) => entry.contact.id === "c2");

    expect(an_plan?.value).toBe("+84900111222");
  });
});

describe("counting both kinds of review as one job", () => {
  it("adds the two lists into the one number the banner says", () => {
    expect(reviewTotal(2, 1)).toBe(3);
    expect(reviewTotal(0, 0)).toBe(0);
    expect(reviewTotal(0, 2)).toBe(2);
  });
});

describe("saying where a channel came from", () => {
  it("names each source in words a person would use", () => {
    expect(channelSourceLabel("manual")).toBe("Tự thêm");
    expect(channelSourceLabel("import_csv")).toBe("Nhập từ tệp");
    expect(channelSourceLabel("import_device")).toBe("Nhập từ danh bạ máy");
  });

  it("names each kind of channel", () => {
    expect(channelKindLabel("phone")).toBe("Số điện thoại");
    expect(channelKindLabel("email")).toBe("Email");
  });
});
