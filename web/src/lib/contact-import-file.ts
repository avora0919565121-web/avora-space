import { readSheet } from "read-excel-file/browser";

import { buildTemplateCsv, parseDelimitedText } from "@/lib/contact-import";
import { triggerDownload } from "@/lib/download";

/**
 * Turning a chosen file into a plain table of strings.
 *
 * Kept apart from `contact-import.ts` so every rule about what a valid row is stays testable
 * without a browser, and so the spreadsheet reader is only pulled into the bundle by the screen
 * that actually imports.
 */

export const TEMPLATE_FILENAME = "avora-mau-nhap-lien-he.csv";

export function downloadImportTemplate(): string {
  triggerDownload(
    new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" }),
    TEMPLATE_FILENAME,
  );
  return TEMPLATE_FILENAME;
}

/** What the file input accepts. Kept next to the reader that has to honour it. */
export const IMPORT_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A cell from a spreadsheet as text.
 *
 * The reader hands back real types — numbers, dates, booleans — because a spreadsheet stores
 * them that way. Everything is flattened to the string the person typed, since a phone number
 * read as a number would lose its leading zero and a date must survive as a date.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const pad = (part: number): string => String(part).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === "number") {
    // Excel keeps "0912345678" as 912345678 when the column is numeric; the zero is put back
    // when what is left looks like a Vietnamese mobile number missing exactly its leading zero.
    const digits = String(value);
    return /^\d{9}$/.test(digits) ? `0${digits}` : digits;
  }
  return String(value);
}

function isExcelName(name: string): boolean {
  return /\.xlsx$/i.test(name);
}

/** Unreadable files are reported in the user's words, never as a stack trace. */
export class ImportFileError extends Error {}

/**
 * Reads a `.csv` or `.xlsx` file into rows of text.
 *
 * The extension decides which reader is used rather than the MIME type, which is unreliable
 * across operating systems — a `.csv` exported by Excel frequently arrives as
 * `application/vnd.ms-excel`.
 */
export async function readImportFile(file: File): Promise<string[][]> {
  if (isExcelName(file.name)) {
    try {
      const sheet = await readSheet(file);
      return sheet.map((row) => row.map(cellToText));
    } catch (error) {
      console.error("[contact-import] không đọc được xlsx", error);
      throw new ImportFileError(
        "Không đọc được file Excel này. Hãy lưu lại dưới dạng .xlsx hoặc .csv rồi thử lại.",
      );
    }
  }

  const text = await file.text();
  const table = parseDelimitedText(text);
  if (table.length === 0) {
    throw new ImportFileError("File này không có dòng nào.");
  }
  return table;
}
