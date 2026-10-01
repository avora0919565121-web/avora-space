import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Tidying a contact on save (AVORA-56 · B). Applied by every write path — the form, a spreadsheet,
 * a vCard and the phone book all go through `lib/contacts.ts` / `addContactChannel`. Old rows
 * are never rewritten in bulk; they are tidied the next time someone saves them.
 */

/** Extra spaces out (start, end, between words). Never changes letter case. */
export function cleanContactName(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** Every word with its first letter up and the rest down: "nguyễn văn a" → "Nguyễn Văn A". */
export function titleCaseName(name: string): string {
  return cleanContactName(name)
    .toLocaleLowerCase("vi")
    .split(" ")
    .map((word) => (word.length === 0 ? word : word.charAt(0).toLocaleUpperCase("vi") + word.slice(1)))
    .join(" ");
}

/**
 * The capitalised form to offer, or null. Only offered when the name is all lower case or all
 * upper case — a name someone already capitalised on purpose ("McDonald", "iPhone shop") is
 * left alone. Changing it is always the person's tap, never automatic.
 */
export function nameCaseSuggestion(raw: string): string | null {
  const name = cleanContactName(raw);
  if (!/\p{L}/u.test(name)) return null;
  const isAllLower = name === name.toLocaleLowerCase("vi");
  const isAllUpper = name === name.toLocaleUpperCase("vi");
  if (!isAllLower && !isAllUpper) return null;
  const suggestion = titleCaseName(name);
  return suggestion === name ? null : suggestion;
}

export function cleanContactEmail(raw: string): string {
  return (raw ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * International form for storage: `0901234567` → `+84901234567`. A number starting with 0 is
 * read as Vietnamese. Anything libphonenumber cannot read as a possible number (an extension
 * written after a comma, a short code) is kept as typed, only trimmed — a wrong guess would be
 * worse than an untidy value.
 */
export function toStoredPhone(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return "";
  if (/[,;]|ext|máy lẻ/i.test(trimmed)) return trimmed.replace(/\s+/g, " ");
  const compact = trimmed.replace(/[^\d+]/g, "");
  const candidate = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  const parsed = parsePhoneNumberFromString(candidate, "VN");
  if (parsed === undefined || !parsed.isPossible()) return trimmed.replace(/\s+/g, " ");
  return parsed.number;
}

/** Grouped for reading: `+84901234567` → `+84 90 123 4567`. Unreadable values are shown as stored. */
export function formatPhoneForDisplay(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  if (value === "") return "";
  // Old rows may still hold `0901234567`: shown grouped too, without rewriting what is stored.
  const e164 = value.startsWith("+") ? value.replace(/\s+/g, "") : toStoredPhone(value);
  if (!e164.startsWith("+")) return value;
  return groupVn(e164) ?? parsePhoneNumberFromString(e164)?.formatInternational() ?? value;
}

/**
 * Vietnamese numbers in the brief's shape: +84 + 2-digit prefix + 3 + rest (`+84 90 123 4567`).
 * libphonenumber's own VN grouping differs (`+84 90 123 45 67`), so the house style is written out.
 */
function groupVn(e164: string): string | null {
  const match = /^\+84(\d{9,10})$/.exec(e164);
  if (match === null) return null;
  const national = match[1];
  return `+84 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/** Optional field helper: tidy, then null when empty. */
export function storedPhoneOrNull(raw: string | null | undefined): string | null {
  const value = toStoredPhone(raw ?? "");
  return value === "" ? null : value;
}

export function storedEmailOrNull(raw: string | null | undefined): string | null {
  const value = cleanContactEmail(raw ?? "");
  return value === "" ? null : value;
}
