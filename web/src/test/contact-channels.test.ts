import { vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  allChannelsOf,
  buildChannelIndex,
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
  reviewCount,
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
