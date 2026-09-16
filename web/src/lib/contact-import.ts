import {
  toBusinessDraft,
  toIndividualDraft,
  type BusinessDraft,
  type Contact,
  type ContactType,
  type IndividualDraft,
  type InviteMethod,
} from "@/lib/contacts";

/**
 * Bringing an address book in from a file.
 *
 * A spreadsheet is the one import route that works on every browser and every device, needs no
 * account anywhere else, and leaves the person in full view of what is about to be written: they
 * see the file, they see the table, they tick the rows. Everything here is pure so the rules can
 * be checked without a browser — reading the actual file lives in `contact-import-file.ts`.
 */

/** The template's columns, in the order they appear in the file. */
export const IMPORT_COLUMNS = [
  "loai",
  "ten",
  "dien_thoai",
  "email",
  "ghi_chu",
  "ngay_sinh",
  "moi_quan_he",
  "ma_so_thue",
  "dia_chi",
  "nguoi_dai_dien",
  "dien_thoai_dai_dien",
  "email_dai_dien",
  "nganh_nghe",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/**
 * The two values the `loai` column accepts, written the way a person types them rather than the
 * way the database stores them: nobody filling in a spreadsheet should have to write "individual".
 */
const TYPE_WORDS: Record<string, ContactType> = {
  ca_nhan: "individual",
  doanh_nghiep: "business",
};

/**
 * A hard ceiling, refused before anything is parsed.
 *
 * Every row here becomes one `create_contact` round trip, so a file of thousands would be a
 * progress bar that runs for minutes and fails halfway. Refusing a too-large file up front is
 * honest; pretending to accept it is not.
 */
export const MAX_IMPORT_ROWS = 500;

/** Excel reads a bare UTF-8 file as Latin-1; the BOM is what makes "Nguyễn" open correctly. */
const BOM = "\uFEFF";

/**
 * Written into the example rows' note column so the file itself carries the warning, not just
 * the screen that offered it. The importer also reads this marker back to recognise a row nobody
 * meant to import — see `isSampleRow`.
 */
export const SAMPLE_MARKER = "XOÁ DÒNG NÀY TRƯỚC KHI NHẬP";

const SAMPLE_ROWS: readonly string[][] = [
  [
    "ca_nhan",
    "Nguyễn Văn An",
    "0912345678",
    "an.nguyen@example.com",
    SAMPLE_MARKER,
    "1990-03-15",
    "Bạn bè",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "doanh_nghiep",
    "Công ty TNHH An Phát",
    "02838220011",
    "lienhe@anphat.example.com",
    SAMPLE_MARKER,
    "",
    "",
    "0301234567",
    "12 Lê Lợi, Quận 1, TP.HCM",
    "Trần Thị Bích",
    "0987654321",
    "bich.tran@anphat.example.com",
    "Bán lẻ",
  ],
];

function csvCell(value: string): string {
  if (/[",\n\r;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * The template file's text.
 *
 * The header is the first line even though the two example rows need a warning: a note above the
 * header would make the file unreadable by its own importer. The warning rides in each example
 * row's note column instead, where it is impossible to miss while editing and where the importer
 * can recognise it if someone forgets to delete it.
 */
export function buildTemplateCsv(): string {
  const lines = [
    IMPORT_COLUMNS.map(csvCell).join(","),
    ...SAMPLE_ROWS.map((row) => row.map(csvCell).join(",")),
  ];
  return BOM + lines.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ reading

/**
 * Splits delimited text into cells.
 *
 * Written out rather than taken from a library because the whole grammar needed is quoting and
 * line endings, and a dependency for that would still have to be configured for the one thing
 * that actually varies: Excel on a Vietnamese Windows writes CSV with semicolons, so the
 * delimiter is sniffed from the header line rather than assumed to be a comma.
 */
export function parseDelimitedText(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  if (body.trim().length === 0) return [];

  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"]
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
    .sort((left, right) => right.count - left.count)[0].candidate;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // Swallowed; the \n that follows ends the row.
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) endRow();

  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

/**
 * A column heading reduced to its bare name.
 *
 * Diacritics are stripped rather than aliased one by one, which means a person who typed
 * "Điện thoại" over our `dien_thoai` still lands on the same column — the accented heading is
 * what a Vietnamese speaker naturally writes, and refusing it would be pedantry.
 */
export function normalizeHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s.-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

function isImportColumn(value: string): value is ImportColumn {
  return (IMPORT_COLUMNS as readonly string[]).includes(value);
}

/** Where each known column sits in this particular file, which may be in any order. */
export function mapHeaderRow(header: readonly string[]): Partial<Record<ImportColumn, number>> {
  const positions: Partial<Record<ImportColumn, number>> = {};
  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    if (isImportColumn(name) && positions[name] === undefined) positions[name] = index;
  });
  return positions;
}

// ------------------------------------------------------------------ rows

export type ImportFields = Record<ImportColumn, string>;

/** Which existing contact a row appears to be, and what gave it away. */
export type DuplicateMatch = {
  contactId: string;
  contactName: string;
  on: "phone" | "email";
  /** Merging only makes sense into a contact of the same type. */
  canMerge: boolean;
};

/** What to do about a row that matches something already in the book. */
export type DuplicateChoice = "merge" | "skip" | "create";

export type ImportRow = {
  /** The line as the person sees it in their spreadsheet, header included. */
  lineNumber: number;
  fields: ImportFields;
  /** Null when `loai` is missing or unrecognised — the row cannot be filed anywhere. */
  kind: ContactType | null;
  name: string;
  /** Everything wrong with this row, in the order a person would fix it. Empty means valid. */
  problems: string[];
  /** One of the template's example rows, left in the file by accident. */
  isSample: boolean;
  duplicate: DuplicateMatch | null;
};

function emptyFields(): ImportFields {
  const fields = {} as ImportFields;
  for (const column of IMPORT_COLUMNS) fields[column] = "";
  return fields;
}

/** Digits only, with the international form folded onto the local one. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  // +84 912 345 678 and 0912345678 are the same phone; a person who stored one and imported
  // the other means one contact, not two.
  const local = digits.replace(/^(\+?84)/, "0");
  return local.replace(/\D/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A date the database will accept, or null when there is nothing usable.
 *
 * Both the ISO form and the day-first form Vietnamese spreadsheets use are read, because the
 * same file opened in Excel and in Google Sheets can produce either.
 */
export function toIsoDate(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dayFirst = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);

  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : dayFirst
      ? { year: Number(dayFirst[3]), month: Number(dayFirst[2]), day: Number(dayFirst[1]) }
      : null;

  if (parts === null) return null;
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;

  const stamp = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (stamp.getUTCMonth() !== parts.month - 1 || stamp.getUTCDate() !== parts.day) return null;

  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function isSampleRow(fields: ImportFields): boolean {
  return fields.ghi_chu.toUpperCase().includes("XOÁ DÒNG NÀY");
}

/**
 * Everything wrong with one row, said in full.
 *
 * All the problems are collected rather than returning at the first: someone who has to reopen
 * the spreadsheet should be able to fix the whole row in one pass instead of re-uploading to
 * discover the next complaint.
 */
function rowProblems(fields: ImportFields, kind: ContactType | null): string[] {
  const problems: string[] = [];
  const has = (column: ImportColumn): boolean => fields[column].trim().length > 0;

  if (!has("loai")) {
    problems.push("Thiếu cột loai — điền ca_nhan hoặc doanh_nghiep.");
  } else if (kind === null) {
    problems.push(`Loại "${fields.loai}" không hợp lệ — chỉ nhận ca_nhan hoặc doanh_nghiep.`);
  }

  if (!has("ten")) problems.push("Thiếu tên.");

  if (kind === "individual") {
    if (!has("dien_thoai") && !has("email")) {
      problems.push("Cá nhân cần ít nhất số điện thoại hoặc email.");
    }
  }

  if (kind === "business") {
    if (!has("ma_so_thue")) problems.push("Doanh nghiệp cần mã số thuế.");
    if (!has("nguoi_dai_dien")) problems.push("Doanh nghiệp cần người đại diện.");
    if (
      !has("dien_thoai") &&
      !has("email") &&
      !has("dien_thoai_dai_dien") &&
      !has("email_dai_dien")
    ) {
      problems.push("Doanh nghiệp cần ít nhất một số điện thoại hoặc email.");
    }
  }

  // A birthday nobody can read is refused rather than quietly dropped: the row would import
  // looking complete while the one date in it had vanished.
  if (has("ngay_sinh") && toIsoDate(fields.ngay_sinh) === null) {
    problems.push("Ngày sinh không đọc được — dùng dạng 1990-03-15 hoặc 15/03/1990.");
  }

  return problems;
}

/** The contact this row would collide with, by phone first and then email. */
export function findDuplicate(
  fields: ImportFields,
  kind: ContactType | null,
  contacts: readonly Contact[],
): DuplicateMatch | null {
  const phone = normalizePhone(fields.dien_thoai);
  const email = normalizeEmail(fields.email);

  const byPhone =
    phone.length === 0
      ? undefined
      : contacts.find((entry) => normalizePhone(entry.phone ?? "") === phone);
  if (byPhone !== undefined) {
    return {
      contactId: byPhone.id,
      contactName: byPhone.name,
      on: "phone",
      canMerge: kind === byPhone.contactType,
    };
  }

  const byEmail =
    email.length === 0
      ? undefined
      : contacts.find((entry) => normalizeEmail(entry.email ?? "") === email);
  if (byEmail !== undefined) {
    return {
      contactId: byEmail.id,
      contactName: byEmail.name,
      on: "email",
      canMerge: kind === byEmail.contactType,
    };
  }

  return null;
}

/**
 * A string discriminant rather than an `ok: boolean`: this project compiles with
 * `strictNullChecks` off, where a boolean discriminant does not narrow a union.
 */
export type ImportReadResult =
  | { kind: "rows"; rows: ImportRow[] }
  | { kind: "refused"; reason: string };

/**
 * A parsed table turned into rows the preview can show, or a reason the whole file is unusable.
 *
 * A file-wide refusal is kept separate from per-row problems because they are different acts:
 * a missing `loai` column means this is the wrong file, while a missing name means one line
 * needs fixing.
 */
export function buildImportRows(
  table: readonly string[][],
  contacts: readonly Contact[],
): ImportReadResult {
  if (table.length === 0) return { kind: "refused", reason: "File này không có dòng nào." };

  const positions = mapHeaderRow(table[0]);
  if (positions.loai === undefined || positions.ten === undefined) {
    return {
      kind: "refused",
      reason: "File thiếu cột loai hoặc ten. Hãy tải file mẫu và điền theo đúng các cột có sẵn.",
    };
  }

  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      kind: "refused",
      reason: `File có ${body.length} dòng, vượt giới hạn ${MAX_IMPORT_ROWS} dòng mỗi lần nhập. Hãy tách file thành nhiều phần.`,
    };
  }

  const rows: ImportRow[] = body.map((cells, index) => {
    const fields = emptyFields();
    for (const column of IMPORT_COLUMNS) {
      const at = positions[column];
      fields[column] = at === undefined ? "" : (cells[at] ?? "").trim();
    }

    const kind = TYPE_WORDS[normalizeHeader(fields.loai)] ?? null;

    return {
      // +2: the header is line 1, and this row's own index starts at 0.
      lineNumber: index + 2,
      fields,
      kind,
      name: fields.ten,
      problems: rowProblems(fields, kind),
      isSample: isSampleRow(fields),
      duplicate: findDuplicate(fields, kind, contacts),
    };
  });

  return { kind: "rows", rows };
}

/** Whether this row is allowed to be ticked at all. */
export function canImportRow(row: ImportRow): boolean {
  return row.problems.length === 0 && !row.isSample;
}

/** What the count line above the table says. */
export function summarizeRows(rows: readonly ImportRow[]): {
  valid: number;
  invalid: number;
  duplicate: number;
  sample: number;
} {
  return {
    valid: rows.filter((row) => canImportRow(row)).length,
    invalid: rows.filter((row) => row.problems.length > 0).length,
    duplicate: rows.filter((row) => canImportRow(row) && row.duplicate !== null).length,
    sample: rows.filter((row) => row.isSample).length,
  };
}

/** The default answer for a row that matched: never write a second copy without being asked. */
export function defaultChoice(row: ImportRow): DuplicateChoice {
  if (row.duplicate === null) return "create";
  return "skip";
}

// ------------------------------------------------------------------ drafts

export function rowToIndividualDraft(row: ImportRow): IndividualDraft {
  return {
    name: row.fields.ten,
    phone: row.fields.dien_thoai,
    email: row.fields.email,
    dateOfBirth: toIsoDate(row.fields.ngay_sinh) ?? "",
    relationshipTag: row.fields.moi_quan_he,
    note: row.fields.ghi_chu,
    employerContactId: null,
  };
}

export function rowToBusinessDraft(row: ImportRow): BusinessDraft {
  return {
    name: row.fields.ten,
    taxCode: row.fields.ma_so_thue,
    representativeName: row.fields.nguoi_dai_dien,
    phone: row.fields.dien_thoai,
    email: row.fields.email,
    representativePhone: row.fields.dien_thoai_dai_dien,
    representativeEmail: row.fields.email_dai_dien,
    businessAddress: row.fields.dia_chi,
    industry: row.fields.nganh_nghe,
    note: row.fields.ghi_chu,
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
 * is given, so a "patch" of just the empty ones would blank out the name and phone that were
 * already there. Every existing value is therefore carried through untouched, and the imported
 * row is only allowed to supply what was missing.
 */
export function mergeIntoIndividual(existing: Contact, row: ImportRow): IndividualDraft {
  const current = toIndividualDraft(existing);
  const incoming = rowToIndividualDraft(row);
  return {
    ...current,
    phone: fill(current.phone, incoming.phone),
    email: fill(current.email, incoming.email),
    note: fill(current.note, incoming.note),
    dateOfBirth: fill(current.dateOfBirth, incoming.dateOfBirth),
    relationshipTag: fill(current.relationshipTag, incoming.relationshipTag),
  };
}

export function mergeIntoBusiness(existing: Contact, row: ImportRow): BusinessDraft {
  const current = toBusinessDraft(existing);
  const incoming = rowToBusinessDraft(row);
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

// ------------------------------------------------------------------ inviting

/** One person the import just wrote down, and how an invitation could reach them. */
export type InviteCandidate = {
  contactId: string;
  name: string;
  /** Email when there is one, otherwise the phone: the quieter channel goes first. */
  method: Extract<InviteMethod, "sms" | "email">;
  /** Only the channels this contact actually has — the other one is never offered. */
  methods: Extract<InviteMethod, "sms" | "email">[];
};

/**
 * Who is worth inviting out of what was just imported.
 *
 * Companies are left out because a company does not sign in, and anyone already linked is left
 * out because they are on AVORA already. Email leads where both exist: it carries a full
 * sentence and a link without costing the sender an SMS.
 */
export function buildInviteCandidates(contacts: readonly Contact[]): InviteCandidate[] {
  const candidates: InviteCandidate[] = [];

  for (const contact of contacts) {
    if (contact.contactType !== "individual") continue;
    if (contact.linkedUserId !== null) continue;

    const methods: Extract<InviteMethod, "sms" | "email">[] = [];
    if ((contact.email ?? "").trim().length > 0) methods.push("email");
    if ((contact.phone ?? "").trim().length > 0) methods.push("sms");
    // With neither channel there is nothing to pick; such a contact is invited from its own
    // page by copying a link instead.
    if (methods.length === 0) continue;

    candidates.push({ contactId: contact.id, name: contact.name, method: methods[0], methods });
  }

  return candidates;
}
