import { IMPORT_COLUMNS, normalizeHeader, type ImportColumn } from "@/lib/contact-import";
import type { ContactType } from "@/lib/contacts";

/**
 * Matching somebody else's column headings to ours.
 *
 * Almost no real file arrives with our template's headings. It comes out of a CRM, an old
 * phone, an accountant's spreadsheet — "Họ tên", "SĐT", "Full Name" — and until now every one
 * of those was refused at the door for lacking a column called `ten`. This module is the only
 * thing that changes about that: it turns the file's own headings into the template's, and
 * hands the result to the same reader, validator, duplicate check and preview as before.
 *
 * Everything here is pure except the two remembering functions at the bottom, so the matching
 * rules can be checked without a browser.
 */

/**
 * What each of our fields might be called in somebody else's file.
 *
 * One object rather than rules scattered through the matcher, because this is the part that
 * grows: every unrecognised heading a real user hits is one line added here, and a list is
 * something anybody can extend without understanding the matching.
 *
 * Headings are compared after normalisation, so accents, case, spaces, hyphens and underscores
 * do not need their own entries — "SĐT", "sdt" and "S.Đ.T" all reduce to the same word.
 */
export const COLUMN_SYNONYMS: Record<ImportColumn, readonly string[]> = {
  ten: ["ten", "họ tên", "họ và tên", "tên", "name", "full name", "fullname"],
  dien_thoai: [
    "dien_thoai",
    "số điện thoại",
    "sđt",
    "sdt",
    "điện thoại",
    "phone",
    "phone number",
    "mobile",
    "tel",
  ],
  email: ["email", "e-mail", "mail", "địa chỉ email"],
  loai: ["loai", "loại", "loại liên hệ", "type", "phân loại"],
  ghi_chu: ["ghi_chu", "ghi chú", "note", "notes", "chú thích"],
  ngay_sinh: ["ngay_sinh", "ngày sinh", "date of birth", "dob", "birthday"],
  moi_quan_he: ["moi_quan_he", "mối quan hệ", "quan hệ", "relationship"],
  ma_so_thue: ["ma_so_thue", "mã số thuế", "mst", "tax code", "tax id"],
  dia_chi: ["dia_chi", "địa chỉ", "address"],
  nguoi_dai_dien: ["nguoi_dai_dien", "người đại diện", "đại diện", "representative"],
  dien_thoai_dai_dien: [
    "dien_thoai_dai_dien",
    "điện thoại đại diện",
    "sđt đại diện",
    "representative phone",
  ],
  email_dai_dien: ["email_dai_dien", "email đại diện", "representative email"],
  nganh_nghe: ["nganh_nghe", "ngành nghề", "lĩnh vực", "industry"],
  dien_thoai_2: ["dien_thoai_2", "số điện thoại 2", "sđt 2", "phone 2", "second phone"],
  email_2: ["email_2", "email 2", "second email"],
};

/** What each field is called on the confirmation screen. */
export const COLUMN_LABELS: Record<ImportColumn, string> = {
  ten: "Tên",
  dien_thoai: "Số điện thoại",
  dien_thoai_2: "Số điện thoại 2",
  email: "Email",
  email_2: "Email 2",
  loai: "Loại liên hệ",
  ghi_chu: "Ghi chú",
  ngay_sinh: "Ngày sinh",
  moi_quan_he: "Mối quan hệ",
  ma_so_thue: "Mã số thuế",
  dia_chi: "Địa chỉ",
  nguoi_dai_dien: "Người đại diện",
  dien_thoai_dai_dien: "Điện thoại đại diện",
  email_dai_dien: "Email đại diện",
  nganh_nghe: "Ngành nghề",
};

/**
 * The order the fields are asked about, which is not the template's order.
 *
 * The template puts `loai` first because that is how the file reads; a person matching columns
 * wants the name and the ways of reaching somebody first, and the company paperwork last —
 * most files being matched here have none of it.
 */
export const MAPPING_ORDER: readonly ImportColumn[] = [
  "ten",
  "dien_thoai",
  "dien_thoai_2",
  "email",
  "email_2",
  "loai",
  "ghi_chu",
  "ngay_sinh",
  "moi_quan_he",
];

/** Asked about under their own heading, because a file of people has none of them. */
export const MAPPING_ORDER_BUSINESS: readonly ImportColumn[] = [
  "ma_so_thue",
  "nguoi_dai_dien",
  "dien_thoai_dai_dien",
  "email_dai_dien",
  "dia_chi",
  "nganh_nghe",
];

/**
 * Which of the file's columns holds each of our fields, by the heading's own text.
 *
 * Held by name rather than by position so that the same choice can be remembered and applied
 * to next month's export of the same report, where a column may have moved.
 */
export type ColumnMapping = Partial<Record<ImportColumn, string>>;

/** The one field without which nothing can be written at all. */
export const REQUIRED_MAPPING: readonly ImportColumn[] = ["ten"];

/**
 * A heading reduced to the word underneath its punctuation.
 *
 * `normalizeHeader` turns spaces, dots and hyphens into underscores, which is right for our own
 * column names but leaves "S.Đ.T" and "SĐT" as two different words — and a person typing a
 * heading by hand writes either. The separators come out entirely for comparison only: what is
 * shown in the dropdown, and stored, is always the heading exactly as the file spells it.
 *
 * This stays an exact comparison, not a fuzzy one. "Tên công ty" still does not match "tên".
 */
function matchKey(cell: string): string {
  return normalizeHeader(cell).replace(/_/g, "");
}

/** Every heading in the file, in order, with blanks and repeats dropped. */
export function fileColumns(header: readonly string[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const cell of header) {
    const key = matchKey(cell);
    // A repeated heading is listed once: the reader below finds the first column of that name,
    // so offering the second would be offering something it cannot honour.
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    columns.push(cell.trim());
  }
  return columns;
}

function headingIndex(header: readonly string[]): Map<string, number> {
  const indexes = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = matchKey(cell);
    if (key.length > 0 && !indexes.has(key)) indexes.set(key, index);
  });
  return indexes;
}

/**
 * Our best reading of the file's headings, and nothing beyond it.
 *
 * A heading either is one of the words we know or it is left blank for a person to answer.
 * There is deliberately no similarity scoring: a wrong guess here puts phone numbers in the
 * note field of two thousand contacts, and it would be pre-filled on a screen most people will
 * click straight through. An empty dropdown asks a question; a plausible wrong one does not.
 */
export function autoMapColumns(header: readonly string[]): ColumnMapping {
  const lookup = new Map<string, string>();
  for (const cell of fileColumns(header)) lookup.set(matchKey(cell), cell);

  const mapping: ColumnMapping = {};
  const taken = new Set<string>();

  for (const column of IMPORT_COLUMNS) {
    for (const synonym of COLUMN_SYNONYMS[column]) {
      const heading = lookup.get(matchKey(synonym));
      // One column cannot fill two fields by itself, or a file with a single "Liên hệ" column
      // would quietly become both the phone and the email.
      if (heading === undefined || taken.has(heading)) continue;
      mapping[column] = heading;
      taken.add(heading);
      break;
    }
  }

  return mapping;
}

/** Fields the file offers nothing for, out of those that must be answered. */
export function missingRequired(mapping: ColumnMapping): ImportColumn[] {
  return REQUIRED_MAPPING.filter((column) => (mapping[column] ?? "").length === 0);
}

/** Columns the file has that nothing is being read from, named so their absence is a choice. */
export function unusedColumns(header: readonly string[], mapping: ColumnMapping): string[] {
  const used = new Set<string>();
  for (const column of IMPORT_COLUMNS) {
    const heading = mapping[column];
    if (heading !== undefined) used.add(matchKey(heading));
  }
  return fileColumns(header).filter((cell) => !used.has(matchKey(cell)));
}

/** A remembered mapping, believed only as far as this file's headings allow. */
export function sanitizeMapping(mapping: ColumnMapping, header: readonly string[]): ColumnMapping {
  const lookup = new Map<string, string>();
  for (const cell of fileColumns(header)) lookup.set(matchKey(cell), cell);

  const clean: ColumnMapping = {};
  for (const column of IMPORT_COLUMNS) {
    const heading = mapping[column];
    if (heading === undefined) continue;
    const actual = lookup.get(matchKey(heading));
    // Kept under the heading this file actually spells, so the dropdown can show it selected.
    if (actual !== undefined) clean[column] = actual;
  }
  return clean;
}

const TYPE_WORD: Record<ContactType, string> = {
  individual: "ca_nhan",
  business: "doanh_nghiep",
};

/**
 * The file rewritten under our own headings.
 *
 * This is the whole point of the module and the extent of it: past this line the table is
 * indistinguishable from one saved out of our template, so the validator, the duplicate check,
 * the type question and the preview are the same code on the same shape as before.
 *
 * `fallbackType` fills the type column only when the file has no such column at all. A file
 * that does have one keeps its own values, blanks included — a row whose type was left empty
 * is a row somebody needs to look at, not one for us to decide.
 */
export function applyColumnMapping(
  table: readonly string[][],
  mapping: ColumnMapping,
  fallbackType: ContactType,
): string[][] {
  const header = table[0] ?? [];
  const indexes = headingIndex(header);

  const positions = IMPORT_COLUMNS.map((column) => {
    const heading = mapping[column];
    if (heading === undefined) return -1;
    return indexes.get(matchKey(heading)) ?? -1;
  });

  const rows: string[][] = [[...IMPORT_COLUMNS]];
  for (const cells of table.slice(1)) {
    rows.push(
      IMPORT_COLUMNS.map((column, slot) => {
        const at = positions[slot];
        if (at >= 0) return cells[at] ?? "";
        return column === "loai" ? TYPE_WORD[fallbackType] : "";
      }),
    );
  }
  return rows;
}

// ------------------------------------------------------------------ remembering

/**
 * A fingerprint of the file's set of headings.
 *
 * Sorted before hashing, so a report exported with its columns in a different order next time
 * still counts as the same file — the mapping is held by heading name, which makes the order
 * genuinely irrelevant rather than merely tolerated.
 *
 * FNV-1a: this identifies a spreadsheet layout, it guards nothing, and a collision costs a
 * pre-filled dropdown somebody is about to read anyway.
 */
export function headerSignature(header: readonly string[]): string {
  const words = fileColumns(header)
    .map((cell) => matchKey(cell))
    .sort()
    .join("|");

  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    hash ^= words.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Per account and per layout.
 *
 * The account is in the key because two people sharing a laptop do not share a CRM export, and
 * the layout is in it because the mapping means nothing without the headings it was made for.
 */
export function mappingStorageKey(userId: string, signature: string): string {
  return `avora.import-map.${userId}.${signature}`;
}

type StoredMapping = { v: number; columns: Record<string, string> };

/** What was chosen last time for this exact set of headings, if anything. */
export function readRememberedMapping(
  userId: string,
  header: readonly string[],
): ColumnMapping | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(mappingStorageKey(userId, headerSignature(header)));
  } catch {
    // Private mode or blocked storage: nothing was remembered, which is a working state.
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as StoredMapping;
    if (parsed?.columns === undefined) return null;
    const clean = sanitizeMapping(parsed.columns as ColumnMapping, header);
    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    // A value written by something else, or half-written: treated as no memory at all.
    return null;
  }
}

/** Remembered for next time. Never applied without being shown first — see the map step. */
export function rememberMapping(
  userId: string,
  header: readonly string[],
  mapping: ColumnMapping,
): void {
  const payload: StoredMapping = { v: 1, columns: { ...mapping } as Record<string, string> };
  try {
    window.localStorage.setItem(
      mappingStorageKey(userId, headerSignature(header)),
      JSON.stringify(payload),
    );
  } catch {
    // Not worth telling anyone about: the import itself is unaffected.
  }
}
