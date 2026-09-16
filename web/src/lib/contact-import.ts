import type { Contact, ContactType, InviteMethod } from "@/lib/contacts";
import type { ImportedContactCandidate } from "@/lib/contact-candidates";
import { normalizeEmail, normalizePhone } from "@/lib/contact-channels";

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
  "dien_thoai_2",
  "email",
  "email_2",
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
    "0987111222",
    "an.nguyen@example.com",
    "",
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
    "",
    "lienhe@anphat.example.com",
    "",
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
};

function emptyFields(): ImportFields {
  const fields = {} as ImportFields;
  for (const column of IMPORT_COLUMNS) fields[column] = "";
  return fields;
}

/**
 * Re-exported rather than defined here.
 *
 * These two rules now also live in the database, as `private.normalize_channel`, because the
 * channel table compares values with them. Keeping a second copy in this file would mean three
 * places to change and two chances to disagree about whether `+84` and `0` are the same phone.
 */
export { normalizeEmail, normalizePhone };

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

  // The second phone and email count as channels in their own right: a row carrying only
  // `dien_thoai_2` is reachable, and refusing it would be pedantry about column order.
  const hasAnyChannel: boolean =
    has("dien_thoai") || has("dien_thoai_2") || has("email") || has("email_2");

  if (kind === "individual") {
    if (!hasAnyChannel) {
      problems.push("Cá nhân cần ít nhất số điện thoại hoặc email.");
    }
  }

  if (kind === "business") {
    if (!has("ma_so_thue")) problems.push("Doanh nghiệp cần mã số thuế.");
    if (!has("nguoi_dai_dien")) problems.push("Doanh nghiệp cần người đại diện.");
    if (!hasAnyChannel && !has("dien_thoai_dai_dien") && !has("email_dai_dien")) {
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
export function buildImportRows(table: readonly string[][]): ImportReadResult {
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
    };
  });

  return { kind: "rows", rows };
}

/** Whether this row is allowed to be ticked at all. */
export function canImportRow(row: ImportRow): boolean {
  return row.problems.length === 0 && !row.isSample;
}

/**
 * What the count line above the table says.
 *
 * Matches against the existing book are deliberately not counted here any more: the file no
 * longer knows anything about duplicates. That comparison belongs to the shared pipeline, which
 * checks every channel of every candidate against both the contact rows and the channel table —
 * a file-only version of it would answer a narrower question and disagree.
 */
export function summarizeRows(rows: readonly ImportRow[]): {
  valid: number;
  invalid: number;
  sample: number;
} {
  return {
    valid: rows.filter((row) => canImportRow(row)).length,
    invalid: rows.filter((row) => row.problems.length > 0).length,
    sample: rows.filter((row) => row.isSample).length,
  };
}

/**
 * One validated line as the shared pipeline sees it.
 *
 * This is where the file stops being special. Everything past this point — matching against the
 * book, asking about type, writing the extra channels, offering the invitations — is the same
 * code the phone book goes through, so the two routes cannot drift apart in behaviour.
 */
export function rowToCandidate(row: ImportRow): ImportedContactCandidate {
  return {
    name: row.fields.ten,
    // Order matters: the first of each kind becomes the contact's primary channel.
    phones: [row.fields.dien_thoai, row.fields.dien_thoai_2],
    emails: [row.fields.email, row.fields.email_2],
    // The file states the type outright, so the preview never asks again.
    suggestedType: row.kind,
    source: "import_csv",
    extras: {
      note: row.fields.ghi_chu,
      dateOfBirth: toIsoDate(row.fields.ngay_sinh) ?? "",
      relationshipTag: row.fields.moi_quan_he,
      taxCode: row.fields.ma_so_thue,
      representativeName: row.fields.nguoi_dai_dien,
      representativePhone: row.fields.dien_thoai_dai_dien,
      representativeEmail: row.fields.email_dai_dien,
      businessAddress: row.fields.dia_chi,
      industry: row.fields.nganh_nghe,
    },
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
