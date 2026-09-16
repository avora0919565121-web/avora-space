import { vi } from "vitest";

// Pure-logic tests; importing the module pulls the Supabase client in, and it refuses to
// construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildCandidateRows,
  candidateNeedsReview,
  candidateProblem,
  candidateToBusinessDraft,
  candidateToIndividualDraft,
  canImportCandidate,
  canMergeCandidate,
  cleanCandidate,
  defaultCandidateChoice,
  EMPTY_TYPE_DECISION,
  extraChannelsOf,
  hasMinimumFields,
  mergeCandidateIntoBusiness,
  mergeCandidateIntoIndividual,
  mergeChannelsOf,
  resolvedType,
  summarizeCandidates,
  type CandidateRow,
  type ImportedContactCandidate,
  type TypeDecision,
} from "@/lib/contact-candidates";
import { buildChannelIndex, type ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

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

function company(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return person({
    ...overrides,
    contactType: "business",
    taxCode: overrides.taxCode ?? "0301234567",
  });
}

function channel(
  overrides: Partial<ContactChannel> & { id: string; contactId: string; value: string },
): ContactChannel {
  const kind = overrides.kind ?? "phone";
  return {
    ownerUserId: ME,
    kind,
    valueNormalized: kind === "email" ? overrides.value.toLowerCase() : overrides.value,
    label: null,
    source: "import_csv",
    needsReview: false,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<ImportedContactCandidate> & { name: string },
): ImportedContactCandidate {
  return {
    phones: [],
    emails: [],
    suggestedType: null,
    source: "import_device",
    ...overrides,
  };
}

/** One row as the preview would build it, with no existing contacts to collide with. */
function rowOf(entry: ImportedContactCandidate, contacts: readonly Contact[] = []): CandidateRow {
  return buildCandidateRows([entry], buildChannelIndex(contacts, []))[0];
}

function business(overrides: Partial<TypeDecision> = {}): TypeDecision {
  return { isBusiness: true, taxCode: "0301234567", representativeName: "Chị Bích", ...overrides };
}

describe("tidying up what a source handed over", () => {
  it("drops a repeat that differs only in how it was typed", () => {
    const cleaned = cleanCandidate(
      candidate({ name: "Hoà", phones: ["0912345678", "+84 912 345 678", "0987000111"] }),
    );
    expect(cleaned.phones).toEqual(["0912345678", "0987000111"]);
  });

  it("drops values that are empty once read", () => {
    const cleaned = cleanCandidate(
      candidate({ name: "Hoà", phones: ["", "  ", "---", "0912345678"], emails: ["   "] }),
    );
    expect(cleaned.phones).toEqual(["0912345678"]);
    expect(cleaned.emails).toEqual([]);
  });

  it("trims the name without rewriting it", () => {
    expect(cleanCandidate(candidate({ name: "  Chị Hoà  " })).name).toBe("Chị Hoà");
  });

  it("needs a name and at least one channel to be a contact at all", () => {
    expect(hasMinimumFields(candidate({ name: "Hoà", phones: ["0912345678"] }))).toBe(true);
    expect(hasMinimumFields(candidate({ name: "Hoà", emails: ["a@e.com"] }))).toBe(true);
    expect(hasMinimumFields(candidate({ name: "Hoà" }))).toBe(false);
    expect(hasMinimumFields(candidate({ name: "  ", phones: ["0912345678"] }))).toBe(false);
  });

  /**
   * A phone book entry with no number is not a mistake someone can go and fix, unlike a
   * spreadsheet line — so it is left out rather than listed as broken.
   */
  it("leaves an unusable entry out of the table entirely", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Hoà", phones: ["0912345678"] }), candidate({ name: "Không số" })],
      buildChannelIndex([], []),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate.name).toBe("Hoà");
  });

  it("keeps each row's origin so a message can point at it", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Hoà", phones: ["0912345678"] })],
      buildChannelIndex([], []),
      ["Dòng 7"],
    );
    expect(rows[0].origin).toBe("Dòng 7");
  });

  it("gives every row a key of its own", () => {
    const rows = buildCandidateRows(
      [
        candidate({ name: "A", phones: ["0912345678"] }),
        candidate({ name: "B", phones: ["0987000111"] }),
      ],
      buildChannelIndex([], []),
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
});

describe("recognising someone already in the book", () => {
  const contacts = [
    person({ id: "c1", name: "Chị Hoa", phone: "0912345678" }),
    person({ id: "c2", name: "Anh Nam", email: "nam@example.com" }),
  ];
  const channels = [channel({ id: "ch1", contactId: "c1", value: "0900111222" })];
  const index = buildChannelIndex(contacts, channels);

  it("matches a number written in the other form", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Hoa", phones: ["+84 912 345 678"] })],
      index,
    );
    expect(rows[0].duplicate).toMatchObject({ contactId: "c1", kind: "phone" });
  });

  /**
   * The whole reason the channel table exists: someone's second number identifies them just as
   * well as their first, and an import that only checked the primary one would file a duplicate.
   */
  it("matches against a channel that is not the contact's primary one", () => {
    const rows = buildCandidateRows([candidate({ name: "Hoa", phones: ["0900111222"] })], index);
    expect(rows[0].duplicate).toMatchObject({ contactId: "c1" });
  });

  /** The known number is often not the one a file lists first. */
  it("checks every value, not just the first of each kind", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Ai đó", phones: ["0988888888", "0912345678"] })],
      index,
    );
    expect(rows[0].duplicate).toMatchObject({ contactId: "c1" });
  });

  it("matches on an email once the numbers have all missed", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Nam", phones: ["0988888888"], emails: ["NAM@example.com"] })],
      index,
    );
    expect(rows[0].duplicate).toMatchObject({ contactId: "c2", kind: "email" });
  });

  it("finds nobody when none of the values are known", () => {
    const rows = buildCandidateRows(
      [candidate({ name: "Mới", phones: ["0988888888"], emails: ["moi@example.com"] })],
      index,
    );
    expect(rows[0].duplicate).toBeNull();
  });

  it("defaults a match to being skipped and a new person to being created", () => {
    const matched = buildCandidateRows([candidate({ name: "Hoa", phones: ["0912345678"] })], index);
    const fresh = buildCandidateRows([candidate({ name: "Mới", phones: ["0988888888"] })], index);
    expect(defaultCandidateChoice(matched[0])).toBe("skip");
    expect(defaultCandidateChoice(fresh[0])).toBe("create");
  });

  /** Pouring a person's details into a company row would produce nonsense. */
  it("refuses to offer a merge across the two kinds of contact", () => {
    const withCompany = buildChannelIndex(
      [company({ id: "b1", name: "Công ty A", phone: "02838220011" })],
      [],
    );
    const row = buildCandidateRows(
      [candidate({ name: "Ai đó", phones: ["02838220011"] })],
      withCompany,
    )[0];
    expect(canMergeCandidate(row, EMPTY_TYPE_DECISION)).toBe(false);
  });

  it("offers a merge when both sides are the same kind", () => {
    const row = buildCandidateRows([candidate({ name: "Hoa", phones: ["0912345678"] })], index)[0];
    expect(canMergeCandidate(row, EMPTY_TYPE_DECISION)).toBe(true);
  });

  it("has nothing to merge into when nobody matched", () => {
    const row = buildCandidateRows([candidate({ name: "Mới", phones: ["0988888888"] })], index)[0];
    expect(canMergeCandidate(row, EMPTY_TYPE_DECISION)).toBe(false);
  });
});

describe("deciding what a candidate is", () => {
  /** A file states its own `loai`, so the screen must not ask again. */
  it("uses the type the source already stated", () => {
    const row = rowOf(
      candidate({ name: "Người", phones: ["0912345678"], suggestedType: "individual" }),
    );
    expect(row.isTypeKnown).toBe(true);
    expect(resolvedType(row, business())).toBe("individual");
  });

  it("asks when the source could not know", () => {
    const row = rowOf(candidate({ name: "Người", phones: ["0912345678"] }));
    expect(row.isTypeKnown).toBe(false);
    expect(resolvedType(row, EMPTY_TYPE_DECISION)).toBe("individual");
    expect(resolvedType(row, business())).toBe("business");
  });

  it("is a person by default, never a company", () => {
    const row = rowOf(candidate({ name: "Người", phones: ["0912345678"] }));
    expect(resolvedType(row, EMPTY_TYPE_DECISION)).toBe("individual");
    expect(canImportCandidate(row, EMPTY_TYPE_DECISION)).toBe(true);
  });

  /**
   * The two facts a company cannot exist without are asked for at the row, because the
   * alternative is a create call that fails one row at a time after the person walked away.
   */
  it("blocks a company until its tax code and representative are filled in", () => {
    const row = rowOf(candidate({ name: "Công ty", phones: ["02838220011"] }));

    const empty = business({ taxCode: "", representativeName: "" });
    expect(candidateProblem(row, empty)).toContain("mã số thuế");
    expect(canImportCandidate(row, empty)).toBe(false);

    const noRep = business({ representativeName: "" });
    expect(candidateProblem(row, noRep)).toContain("người đại diện");
    expect(canImportCandidate(row, noRep)).toBe(false);

    expect(canImportCandidate(row, business())).toBe(true);
  });

  it("does not ask a toggled-off row for company fields", () => {
    const row = rowOf(candidate({ name: "Người", phones: ["0912345678"] }));
    expect(candidateProblem(row, EMPTY_TYPE_DECISION)).toBeNull();
  });

  /** A file's own company row carries the fields in its columns; it is never re-asked. */
  it("reads a file's company fields from the file", () => {
    const row = rowOf(
      candidate({
        name: "Công ty A",
        phones: ["02838220011"],
        suggestedType: "business",
        source: "import_csv",
        extras: { taxCode: "0301234567", representativeName: "Chị Bích" },
      }),
    );
    expect(canImportCandidate(row, EMPTY_TYPE_DECISION)).toBe(true);
  });

  it("still objects when a file calls a row a company but leaves the fields blank", () => {
    const row = rowOf(
      candidate({
        name: "Công ty A",
        phones: ["02838220011"],
        suggestedType: "business",
        source: "import_csv",
      }),
    );
    expect(candidateProblem(row, EMPTY_TYPE_DECISION)).toContain("mã số thuế");
  });

  it("counts what is ready, blocked and already known for the line above the table", () => {
    const rows = buildCandidateRows(
      [
        candidate({ name: "A", phones: ["0912345678"] }),
        candidate({ name: "B", phones: ["0987000111"] }),
        candidate({ name: "C", phones: ["0900111222"] }),
      ],
      buildChannelIndex([person({ id: "c1", name: "Đã có", phone: "0900111222" })], []),
    );
    const decisions = { [rows[1].key]: business({ taxCode: "", representativeName: "" }) };

    expect(summarizeCandidates(rows, decisions)).toEqual({
      total: 3,
      ready: 2,
      blocked: 1,
      duplicate: 1,
    });
  });
});

describe("splitting the channels between the contact row and the channel table", () => {
  /** The first of each kind is what every existing screen and the invitation rules read. */
  it("keeps the first phone and email as the contact's own fields", () => {
    const entry = cleanCandidate(
      candidate({
        name: "Hoà",
        phones: ["0912345678", "0987000111"],
        emails: ["a@e.com", "b@e.com"],
      }),
    );
    const draft = candidateToIndividualDraft(entry);
    expect(draft.phone).toBe("0912345678");
    expect(draft.email).toBe("a@e.com");
  });

  it("files everything after the first as an extra channel", () => {
    const entry = cleanCandidate(
      candidate({
        name: "Hoà",
        phones: ["0912345678", "0987000111"],
        emails: ["a@e.com", "b@e.com"],
      }),
    );
    expect(extraChannelsOf(entry)).toEqual([
      { kind: "phone", value: "0987000111" },
      { kind: "email", value: "b@e.com" },
    ]);
  });

  /** One number of each kind is the ordinary case, and it must cost nothing. */
  it("writes nothing to the channel table for a contact with one of each", () => {
    const entry = cleanCandidate(
      candidate({ name: "Hoà", phones: ["0912345678"], emails: ["a@e.com"] }),
    );
    expect(extraChannelsOf(entry)).toEqual([]);
    expect(candidateNeedsReview(entry)).toBe(false);
  });

  it("asks for a review exactly when there are two of one kind", () => {
    expect(
      candidateNeedsReview(candidate({ name: "A", phones: ["0912345678", "0987000111"] })),
    ).toBe(true);
    expect(candidateNeedsReview(candidate({ name: "A", emails: ["a@e.com", "b@e.com"] }))).toBe(
      true,
    );
    expect(
      candidateNeedsReview(candidate({ name: "A", phones: ["0912345678"], emails: ["a@e.com"] })),
    ).toBe(false);
  });

  /** Two spellings of one number are one number, so there is nothing to choose between. */
  it("does not ask for a review when the second number was the same number", () => {
    const entry = cleanCandidate(
      candidate({ name: "A", phones: ["0912345678", "+84912345678"] }),
    );
    expect(candidateNeedsReview(entry)).toBe(false);
    expect(extraChannelsOf(entry)).toEqual([]);
  });
});

describe("turning a candidate into something the server accepts", () => {
  it("passes a file's extra fields through to a person", () => {
    const draft = candidateToIndividualDraft(
      candidate({
        name: " Chị Hoa ",
        phones: ["0912345678"],
        source: "import_csv",
        extras: { note: "Gặp ở hội chợ", dateOfBirth: "1990-03-15", relationshipTag: "Đối tác" },
      }),
    );
    expect(draft).toEqual({
      name: "Chị Hoa",
      phone: "0912345678",
      email: "",
      dateOfBirth: "1990-03-15",
      relationshipTag: "Đối tác",
      note: "Gặp ở hội chợ",
      employerContactId: null,
    });
  });

  it("leaves a phone book entry's absent fields blank rather than inventing them", () => {
    const draft = candidateToIndividualDraft(
      candidate({ name: "Hoà", phones: ["0912345678"] }),
    );
    expect(draft.note).toBe("");
    expect(draft.dateOfBirth).toBe("");
    expect(draft.relationshipTag).toBe("");
  });

  it("takes a company's required fields from the toggle when the source had none", () => {
    const draft = candidateToBusinessDraft(
      candidate({ name: "Công ty A", phones: ["02838220011"] }),
      business(),
    );
    expect(draft.taxCode).toBe("0301234567");
    expect(draft.representativeName).toBe("Chị Bích");
  });

  /** A filled-in file is the person's own word; a toggle is only for sources that cannot say. */
  it("prefers the file's own company columns over the toggle", () => {
    const draft = candidateToBusinessDraft(
      candidate({
        name: "Công ty A",
        phones: ["02838220011"],
        suggestedType: "business",
        source: "import_csv",
        extras: { taxCode: "9999999999", representativeName: "Anh Từ File" },
      }),
      business(),
    );
    expect(draft.taxCode).toBe("9999999999");
    expect(draft.representativeName).toBe("Anh Từ File");
  });
});

describe("merging into someone already there", () => {
  const existing = person({
    id: "c1",
    name: "Chị Hoa",
    phone: "0912345678",
    note: "Ghi chú cũ",
  });

  it("fills in a field that was empty", () => {
    const draft = mergeCandidateIntoIndividual(
      existing,
      candidate({ name: "Chị Hoa", emails: ["hoa@example.com"] }),
    );
    expect(draft.email).toBe("hoa@example.com");
  });

  /**
   * `update_contact` replaces every column it is given, so the merge has to carry the existing
   * values through untouched — a patch of only the blank fields would blank out the rest.
   */
  it("never overwrites a field that already had something in it", () => {
    const draft = mergeCandidateIntoIndividual(
      existing,
      candidate({
        name: "Chị Hoa",
        phones: ["0999999999"],
        source: "import_csv",
        extras: { note: "Ghi chú mới" },
      }),
    );
    expect(draft.phone).toBe("0912345678");
    expect(draft.note).toBe("Ghi chú cũ");
  });

  it("keeps the name and every other field the contact already had", () => {
    const draft = mergeCandidateIntoIndividual(
      person({ id: "c2", name: "Tên Cũ", phone: "0912345678", relationshipTag: "Bạn bè" }),
      candidate({
        name: "Tên Mới",
        emails: ["x@example.com"],
        source: "import_csv",
        extras: { relationshipTag: "Đối tác" },
      }),
    );
    expect(draft.name).toBe("Tên Cũ");
    expect(draft.relationshipTag).toBe("Bạn bè");
  });

  it("fills a company's missing representative without touching its tax code", () => {
    const draft = mergeCandidateIntoBusiness(
      company({ id: "b1", name: "Công ty A", taxCode: "0301234567" }),
      candidate({
        name: "Công ty A",
        emails: ["a@example.com"],
        suggestedType: "business",
        source: "import_csv",
        extras: { taxCode: "9999999999", representativeName: "Chị Bích" },
      }),
    );
    expect(draft.taxCode).toBe("0301234567");
    expect(draft.representativeName).toBe("Chị Bích");
  });

  /**
   * Every value is offered rather than only the leftovers: a merge cannot tell which of the
   * candidate's numbers the contact already holds, and `add_contact_channel` is the one place
   * that can compare — it keeps nothing that is already the primary channel or already stored.
   */
  it("offers every value it brought so a number can be added without overwriting one", () => {
    const entry = cleanCandidate(
      candidate({ name: "Chị Hoa", phones: ["0912345678", "0987000111"], emails: ["a@e.com"] }),
    );
    expect(mergeChannelsOf(entry)).toEqual([
      { kind: "phone", value: "0912345678" },
      { kind: "phone", value: "0987000111" },
      { kind: "email", value: "a@e.com" },
    ]);
  });
});
