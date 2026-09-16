import {
  matchAnyChannel,
  normalizeChannelValue,
  uniqueChannelValues,
  type ChannelKind,
  type ChannelMatch,
  type ChannelSource,
} from "@/lib/contact-channels";
import {
  toBusinessDraft,
  toIndividualDraft,
  type BusinessDraft,
  type Contact,
  type ContactType,
  type IndividualDraft,
} from "@/lib/contacts";

/**
 * The one shape every bulk import route arrives in.
 *
 * A spreadsheet and a phone book disagree about almost everything — how they are read, what they
 * are allowed to ask for, whether they know a contact's type — but they agree completely on the
 * decisions that follow: is this person already in the book, which of these numbers is the real
 * one, should they be invited. Converting each source to this shape means those decisions are
 * written once, and a third source later only has to produce this type.
 *
 * Nothing below this line branches on `source`. The only place it is read is when a channel is
 * filed, where it records where the value honestly came from.
 */
export type CandidateSource = Extract<
  ChannelSource,
  "import_csv" | "import_device" | "import_vcf"
>;

/**
 * The fields only a filled-in spreadsheet can know.
 *
 * Carried as one optional bag rather than widened into the candidate itself: the pipeline never
 * reads these, it only passes them through to the row being written. Dropping them would have
 * been a regression — the file import already stores birthdays, relationships and company
 * details — while promoting them to real candidate fields would suggest the phone book could
 * ever supply them.
 */
export type CandidateExtras = {
  note?: string;
  dateOfBirth?: string;
  relationshipTag?: string;
  taxCode?: string;
  representativeName?: string;
  representativePhone?: string;
  representativeEmail?: string;
  businessAddress?: string;
  industry?: string;
};

export type ImportedContactCandidate = {
  name: string;
  /** Every number found, in the order the source listed them. */
  phones: string[];
  /** Every address found, in the order the source listed them. */
  emails: string[];
  /** What the source claims this is. Null means nobody has said yet — the screen must ask. */
  suggestedType: ContactType | null;
  source: CandidateSource;
  /**
   * A name to pre-fill on a channel, keyed `kind:normalisedValue`.
   *
   * Only a vCard has anything to say here, and only as a suggestion: its `TYPE=WORK` becomes
   * "Cơ quan" on the channel the person then sees and can rename. Keyed by value rather than
   * by position so de-duplicating the list cannot shift a label onto the wrong number.
   */
  channelLabels?: Record<string, string>;
  extras?: CandidateExtras;
};

/** What to do about a candidate that matches something already in the book. */
export type CandidateChoice = "merge" | "skip" | "create";

/**
 * What the person filling in the gaps has decided about one candidate.
 *
 * Only ever needed when the source could not say what the candidate is: a phone book entry has
 * no notion of "company", so the two fields a company cannot exist without have to be typed in
 * at the row itself.
 */
export type TypeDecision = {
  isBusiness: boolean;
  taxCode: string;
  representativeName: string;
};

export const EMPTY_TYPE_DECISION: TypeDecision = {
  isBusiness: false,
  taxCode: "",
  representativeName: "",
};

/** One candidate as the preview table shows it. */
export type CandidateRow = {
  /** Stable within one import session; the checkbox and the decisions are keyed by it. */
  key: string;
  candidate: ImportedContactCandidate;
  /** Where in the source this came from, for a message a person can act on. */
  origin: string;
  duplicate: ChannelMatch | null;
  /** True when the source already stated the type and the screen must not ask again. */
  isTypeKnown: boolean;
};

// ------------------------------------------------------------------ cleaning

/**
 * The same candidate with nothing repeated and nothing blank.
 *
 * Repeats are dropped here rather than at the point of writing because the preview has to show
 * the truth: a file listing the same number in `dien_thoai` and `dien_thoai_2` describes one
 * number, and a row claiming two would ask the person to review a conflict that does not exist.
 */
export function cleanCandidate(candidate: ImportedContactCandidate): ImportedContactCandidate {
  return {
    ...candidate,
    name: candidate.name.trim(),
    phones: uniqueChannelValues("phone", candidate.phones),
    emails: uniqueChannelValues("email", candidate.emails),
  };
}

/** A name and at least one way to reach them; anything less is not a contact. */
export function hasMinimumFields(candidate: ImportedContactCandidate): boolean {
  if (candidate.name.trim().length === 0) return false;
  return candidate.phones.length > 0 || candidate.emails.length > 0;
}

// ------------------------------------------------------------------ rows

/**
 * Candidates turned into the rows a preview can show.
 *
 * Anything without a name or a channel is dropped rather than listed as broken: unlike a
 * spreadsheet line — where a missing field is a mistake the person can go and fix — an entry
 * like this is simply not a contact, and showing it as an error would ask them to fix something
 * they never wrote.
 */
export function buildCandidateRows(
  candidates: readonly ImportedContactCandidate[],
  index: ReadonlyMap<string, ChannelMatch>,
  origins?: readonly string[],
): CandidateRow[] {
  const rows: CandidateRow[] = [];

  candidates.forEach((raw, position) => {
    const candidate = cleanCandidate(raw);
    if (!hasMinimumFields(candidate)) return;

    rows.push({
      key: `${candidate.source}:${position}`,
      candidate,
      origin: origins?.[position] ?? candidate.name,
      duplicate: matchAnyChannel(index, candidate.phones, candidate.emails),
      isTypeKnown: candidate.suggestedType !== null,
    });
  });

  return rows;
}

/** Which type this row will be written as, given whatever the person has decided. */
export function resolvedType(row: CandidateRow, decision: TypeDecision): ContactType {
  if (row.candidate.suggestedType !== null) return row.candidate.suggestedType;
  return decision.isBusiness ? "business" : "individual";
}

/**
 * Why this row cannot be ticked yet, or null when it can.
 *
 * A company needs a tax code and a representative, and those are the two facts a phone book
 * never has. Turning the toggle on therefore opens two required fields, and the row stays
 * unpickable until they are filled — the alternative is a create call that fails one row at a
 * time after the person has already walked away.
 */
export function candidateProblem(row: CandidateRow, decision: TypeDecision): string | null {
  if (resolvedType(row, decision) !== "business") return null;

  const taxCode = (decision.taxCode ?? "").trim();
  const representative = (decision.representativeName ?? "").trim();

  // A spreadsheet supplies both in its own columns; only the toggled rows have to be typed in.
  if (row.candidate.suggestedType === "business") {
    const fromFile = row.candidate.extras ?? {};
    const hasTax = (fromFile.taxCode ?? "").trim().length > 0;
    const hasRep = (fromFile.representativeName ?? "").trim().length > 0;
    if (!hasTax) return "Doanh nghiệp cần mã số thuế.";
    if (!hasRep) return "Doanh nghiệp cần tên người đại diện.";
    return null;
  }

  if (taxCode.length === 0) return "Điền mã số thuế để lưu thành doanh nghiệp.";
  if (representative.length === 0) return "Điền tên người đại diện để lưu thành doanh nghiệp.";
  return null;
}

export function canImportCandidate(row: CandidateRow, decision: TypeDecision): boolean {
  return candidateProblem(row, decision) === null;
}

/**
 * Whether this candidate may be merged into the contact it matched.
 *
 * Only into the same kind of contact: pouring a person's birthday and relationship into a
 * company row — or a tax code into a person — produces a record that describes nothing real.
 * Where the kinds differ the screen offers skipping or creating instead, which are both honest.
 */
export function canMergeCandidate(row: CandidateRow, decision: TypeDecision): boolean {
  if (row.duplicate === null) return false;
  return row.duplicate.contactType === resolvedType(row, decision);
}

/** The default answer for a match: never write a second copy of somebody without being asked. */
export function defaultCandidateChoice(row: CandidateRow): CandidateChoice {
  return row.duplicate === null ? "create" : "skip";
}

/** What the count line above the table says. */
export function summarizeCandidates(
  rows: readonly CandidateRow[],
  decisions: Readonly<Record<string, TypeDecision>>,
): { total: number; ready: number; blocked: number; duplicate: number } {
  const decisionOf = (row: CandidateRow): TypeDecision =>
    decisions[row.key] ?? EMPTY_TYPE_DECISION;

  return {
    total: rows.length,
    ready: rows.filter((row) => canImportCandidate(row, decisionOf(row))).length,
    blocked: rows.filter((row) => !canImportCandidate(row, decisionOf(row))).length,
    duplicate: rows.filter((row) => row.duplicate !== null).length,
  };
}

// ------------------------------------------------------------------ channels

export type PendingChannel = {
  kind: ChannelKind;
  value: string;
  /** What the source suggested calling it, or null when it said nothing. */
  label: string | null;
};

/** What the source suggested calling this value, if anything. */
export function suggestedLabelOf(
  candidate: ImportedContactCandidate,
  kind: ChannelKind,
  value: string,
): string | null {
  const labels = candidate.channelLabels;
  if (labels === undefined) return null;
  return labels[`${kind}:${normalizeChannelValue(kind, value)}`] ?? null;
}

/**
 * The channels that will not fit on the contact row itself.
 *
 * The first phone and the first email become the contact's primary channels, because those are
 * the fields every existing screen and the invitation rules already read. Everything after that
 * is a `contact_channel` row — which is why a candidate with one number of each kind writes
 * nothing at all to the channel table.
 */
export function extraChannelsOf(candidate: ImportedContactCandidate): PendingChannel[] {
  const extras: PendingChannel[] = [];
  for (const value of candidate.phones.slice(1)) {
    extras.push({ kind: "phone", value, label: suggestedLabelOf(candidate, "phone", value) });
  }
  for (const value of candidate.emails.slice(1)) {
    extras.push({ kind: "email", value, label: suggestedLabelOf(candidate, "email", value) });
  }
  return extras;
}

/**
 * Whether a person has to look at this contact's channels afterwards.
 *
 * Two numbers of the same kind is exactly the situation an import cannot resolve: both are
 * plausible, and only the person who knows them can say which one is answered. The flag is set
 * on every channel of such a contact rather than on the runners-up alone, so the review screen
 * shows the whole set being chosen between instead of a single value stripped of its context.
 */
export function candidateNeedsReview(candidate: ImportedContactCandidate): boolean {
  return candidate.phones.length >= 2 || candidate.emails.length >= 2;
}

// ------------------------------------------------------------------ drafts

function pick(values: readonly string[]): string {
  return values.length > 0 ? values[0] : "";
}

export function candidateToIndividualDraft(
  candidate: ImportedContactCandidate,
): IndividualDraft {
  const extras = candidate.extras ?? {};
  return {
    name: candidate.name.trim(),
    phone: pick(candidate.phones),
    email: pick(candidate.emails),
    dateOfBirth: extras.dateOfBirth ?? "",
    relationshipTag: extras.relationshipTag ?? "",
    note: extras.note ?? "",
    employerContactId: null,
  };
}

export function candidateToBusinessDraft(
  candidate: ImportedContactCandidate,
  decision: TypeDecision = EMPTY_TYPE_DECISION,
): BusinessDraft {
  const extras = candidate.extras ?? {};
  // The file's own columns win when it had them; the toggle's fields are what a source that
  // cannot know the type had to ask for.
  const taxCode = (extras.taxCode ?? "").trim() || decision.taxCode.trim();
  const representativeName =
    (extras.representativeName ?? "").trim() || decision.representativeName.trim();

  return {
    name: candidate.name.trim(),
    taxCode,
    representativeName,
    phone: pick(candidate.phones),
    email: pick(candidate.emails),
    representativePhone: extras.representativePhone ?? "",
    representativeEmail: extras.representativeEmail ?? "",
    businessAddress: extras.businessAddress ?? "",
    industry: extras.industry ?? "",
    note: extras.note ?? "",
  };
}

/** Whichever of the two the existing value is, or the imported one when there is nothing yet. */
function fill(existing: string, incoming: string): string {
  return existing.trim().length > 0 ? existing : incoming.trim();
}

/**
 * Merging fills the gaps and nothing else.
 *
 * The whole draft is sent, not only the blank fields: `update_contact` replaces every column it
 * is given, so a "patch" of just the empty ones would blank out the name and phone already
 * there. The imported candidate is only allowed to supply what was missing — and any number it
 * brought that did not fit becomes an extra channel instead, which is how merging can add a
 * second phone without ever overwriting the first.
 */
export function mergeCandidateIntoIndividual(
  existing: Contact,
  candidate: ImportedContactCandidate,
): IndividualDraft {
  const current = toIndividualDraft(existing);
  const incoming = candidateToIndividualDraft(candidate);
  return {
    ...current,
    phone: fill(current.phone, incoming.phone),
    email: fill(current.email, incoming.email),
    note: fill(current.note, incoming.note),
    dateOfBirth: fill(current.dateOfBirth, incoming.dateOfBirth),
    relationshipTag: fill(current.relationshipTag, incoming.relationshipTag),
  };
}

export function mergeCandidateIntoBusiness(
  existing: Contact,
  candidate: ImportedContactCandidate,
  decision: TypeDecision = EMPTY_TYPE_DECISION,
): BusinessDraft {
  const current = toBusinessDraft(existing);
  const incoming = candidateToBusinessDraft(candidate, decision);
  return {
    ...current,
    phone: fill(current.phone, incoming.phone),
    email: fill(current.email, incoming.email),
    note: fill(current.note, incoming.note),
    taxCode: fill(current.taxCode, incoming.taxCode),
    representativeName: fill(current.representativeName, incoming.representativeName),
    representativePhone: fill(current.representativePhone, incoming.representativePhone),
    representativeEmail: fill(current.representativeEmail, incoming.representativeEmail),
    businessAddress: fill(current.businessAddress, incoming.businessAddress),
    industry: fill(current.industry, incoming.industry),
  };
}

/**
 * Every channel a merge should try to file, including the ones that became primary.
 *
 * All of them are offered rather than only the leftovers, because a merge does not know which of
 * the candidate's numbers the existing contact already holds. `add_contact_channel` answers that
 * itself — it returns nothing for a value that is already the primary channel or already stored
 * — so the honest move is to hand it everything and let the one place that can compare decide.
 */
export function mergeChannelsOf(candidate: ImportedContactCandidate): PendingChannel[] {
  const all: PendingChannel[] = [];
  for (const value of candidate.phones) {
    all.push({ kind: "phone", value, label: suggestedLabelOf(candidate, "phone", value) });
  }
  for (const value of candidate.emails) {
    all.push({ kind: "email", value, label: suggestedLabelOf(candidate, "email", value) });
  }
  return all;
}
