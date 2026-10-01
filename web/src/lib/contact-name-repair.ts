import { cleanContactName } from "@/lib/contact-clean";

/**
 * AVORA-63 — names in Liên hệ: read files in the right encoding, and offer (never force) fixes for
 * the four kinds of broken name. Everything here runs on the device; no name leaves AVORA.
 */

// ------------------------------------------------------------------ Vietnamese letters

const TONE_MARKS = /[\u0300\u0301\u0303\u0309\u0323]/g;
const VIET_LETTERS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const VOWELS = "aăâeêioôơuưy";
const INITIALS = new Set([
  "", "b", "c", "ch", "d", "đ", "g", "gh", "gi", "h", "k", "kh", "l", "m", "n", "ng", "ngh", "nh", "p", "ph", "q", "r", "s", "t", "th", "tr", "v", "x",
]);
const FINALS = new Set(["", "c", "ch", "m", "n", "ng", "nh", "p", "t"]);

/** Lower case, NFC, tone marks removed — keeps ă â ê ô ơ ư đ, which decide the syllable's shape. */
function baseSyllable(word: string): string {
  return word.normalize("NFD").replace(TONE_MARKS, "").normalize("NFC").toLocaleLowerCase("vi");
}

/** No accents at all, for comparing "Hùng" with "Hung". */
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

export function hasVietnameseMarks(text: string): boolean {
  const composed = text.normalize("NFC");
  // A stray combining mark that did not compose (an old phone's NFD) still counts as marked.
  return VIET_LETTERS.test(composed) || /[\u0300-\u036f]/.test(composed);
}

/** Initial + one run of vowels + final, every part from the Vietnamese sets. */
function hasSyllableShape(base: string): boolean {
  const match = /^([^aăâeêioôơuưy]*)([aăâeêioôơuưy]+)([^aăâeêioôơuưy]*)$/u.exec(base);
  if (match === null) return false;
  const [, initial, , final] = match;
  // "gi" / "qu" borrow a vowel letter; both shapes are accepted by the regex already.
  return INITIALS.has(initial) && FINALS.has(final);
}

/** Why a word reads as mistyped, or null. Only meant for words in a Vietnamese-looking name. */
export function syllableProblem(word: string): string | null {
  // Letters and their marks: a stray combining tone must stay countable.
  const letters = word.normalize("NFD").replace(/[^\p{L}\p{M}]/gu, "").normalize("NFC");
  if (letters.length === 0) return null;
  if (/(\p{L})\1\1/iu.test(letters)) return "chữ lặp";
  const tones = (letters.normalize("NFD").match(TONE_MARKS) ?? []).length;
  if (tones > 1) return "hai dấu thanh";
  const base = baseSyllable(letters);
  if (![...base].some((character) => VOWELS.includes(character))) return letters.length >= 2 ? "không có nguyên âm" : null;
  if (!hasSyllableShape(base)) return "không giống âm tiết tiếng Việt";
  return null;
}

/**
 * The words of a name that look mistyped (B.3 / C). A word is only judged when it carries
 * Vietnamese marks itself — a plain word in a Vietnamese name is far more often a brand, an
 * acronym or a foreign name (`IPC`, `Pandanus`, `Michael`) than a typo. Silly repeats (`Bìnhhh`)
 * are caught in any word.
 */
export function suspectSyllables(name: string): string[] {
  const clean = cleanContactName(name).normalize("NFC");
  const words = clean.split(" ").filter((word) => !/[\d().@&/|]/.test(word));
  return words.filter((word) => {
    const letters = word.replace(/[^\p{L}]/gu, "");
    if (letters.length === 0) return false;
    // All capitals is an acronym or a label (`BĐS`, `GĐ`, `TTT`), not a misspelt syllable.
    if (letters === letters.toLocaleUpperCase("vi")) return false;
    if (/(\p{L})\1\1/iu.test(letters)) return true;
    if (!hasVietnameseMarks(word)) return false;
    return syllableProblem(word) !== null;
  });
}

// ------------------------------------------------------------------ broken characters

const CP1252_HIGH: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99,
  "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Signs that UTF-8 bytes were read as Latin-1 / Windows-1252: `Ã…`, `Ä‘`, `Æ°`, `áº…`, `�`. */
const MOJIBAKE = /\uFFFD|Ã[\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Ä[\u0080-\u00BFƒ‘’]|Æ[°¯\u00A0-\u00BF]|á[º»][\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Ã|Ä‘|Ä\u0090/;

export function looksBroken(text: string): boolean {
  return MOJIBAKE.test(text) || looksCp1258(text) || /\?/.test(text.replace(/^\?+|\?+$/g, "x"));
}

/**
 * Reads the letters back as the bytes they came from and decodes those as UTF-8 (B.1). Returns
 * the repaired name only when it is clean Vietnamese — never a guess.
 */
export function repairMojibake(text: string): string | null {
  if (!MOJIBAKE.test(text) || text.includes("\uFFFD")) return null;
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x100) bytes.push(code);
    else if (CP1252_HIGH[character] !== undefined) bytes.push(CP1252_HIGH[character]);
    else return null;
  }
  try {
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)).normalize("NFC");
    if (repaired === text || MOJIBAKE.test(repaired)) return null;
    return hasVietnameseMarks(repaired) || /^[\p{L}\s.'-]+$/u.test(repaired) ? cleanContactName(repaired) : null;
  } catch {
    return null;
  }
}

/**
 * Signs of a Windows-1258 file read as Windows-1252. Strong: letters Vietnamese never uses
 * (Ð ð Þ þ — not the real Đ), or a capital Ì Ò Þ right after a small letter mid-word (`ÐoaÌn`).
 * Soft (ý ì ò õ are real Vietnamese letters too): only counted when a word is also not a
 * possible Vietnamese syllable (`Trýòc` has two tone marks). `Lê Thuý Ngân` stays untouched.
 */
const CP1258_STRONG = /[\u00D0\u00F0\u00DE\u00FE]|\p{Ll}[\u00CC\u00D2\u00DE]/u;
const CP1258_SOFT = /[\u00FD\u00DD\u00EC\u00F2\u00F5]/;

function looksCp1258(text: string): boolean {
  if (CP1258_STRONG.test(text)) return true;
  if (!CP1258_SOFT.test(text)) return false;
  return cleanContactName(text)
    .split(" ")
    .some((word) => hasVietnameseMarks(word) && syllableProblem(word) !== null);
}

/**
 * A name saved in Windows-1258 but read as Windows-1252 (`Trýòc` → `Trước`, `ÐoaÌn` → `Đoàn`).
 * The bytes are all still there, so it comes back exactly; offered only when the result reads
 * as clean Vietnamese.
 */
export function repairCp1258(text: string): string | null {
  if (!looksCp1258(text)) return null;
  const bytes: number[] = [];
  for (const character of text.normalize("NFC")) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x100) bytes.push(code);
    else if (CP1252_HIGH[character] !== undefined) bytes.push(CP1252_HIGH[character]);
    else return null;
  }
  const repaired = decodeWith(Uint8Array.from(bytes), "windows-1258");
  if (repaired === null || repaired === text.normalize("NFC")) return null;
  const clean = cleanContactName(repaired);
  if (!hasVietnameseMarks(clean) || suspectSyllables(clean).length > 0) return null;
  return clean;
}

// ------------------------------------------------------------------ case and spaces

function capitalize(word: string): string {
  const lower = word.toLocaleLowerCase("vi");
  const at = lower.search(/\p{L}/u);
  return at < 0 ? lower : lower.slice(0, at) + lower.charAt(at).toLocaleUpperCase("vi") + lower.slice(at + 1);
}

/**
 * The tidy form of a name (B.2): spaces collapsed; an all-lower or all-upper name gets a capital
 * on each word. A deliberately mixed name (`iPhone`, `McDonald`, `ABC Corp`) only loses its extra
 * spaces. Text inside brackets is kept exactly as written.
 */
export function tidyNameSuggestion(raw: string): string | null {
  const spaced = cleanContactName(raw);
  const outside = spaced.replace(/\([^)]*\)/g, "");
  if (!/\p{L}/u.test(outside)) return spaced === raw ? null : spaced;
  const isAllLower = outside === outside.toLocaleLowerCase("vi");
  const isAllUpper = outside === outside.toLocaleUpperCase("vi");
  let next = spaced;
  if (isAllLower || isAllUpper) {
    next = spaced.replace(/(\([^)]*\))|([^\s()]+)/g, (_match, bracket: string | undefined, word: string | undefined) =>
      bracket !== undefined ? bracket : capitalize(word ?? ""),
    );
  }
  return next === raw ? null : next;
}

// ------------------------------------------------------------------ missing accents

/** A name of plain letters only, every word shaped like a Vietnamese syllable ("Hung", "Nguyen Van A"). */
export function isUnaccentedVietnamese(name: string): boolean {
  const clean = cleanContactName(name);
  if (clean === "" || hasVietnameseMarks(clean) || !/^[A-Za-z .]+$/.test(clean)) return false;
  const words = clean.split(" ").map((word) => word.replace(/\./g, "")).filter((word) => word !== "");
  return words.length > 0 && words.every((word) => (word.length === 1 ? true : hasSyllableShape(word.toLowerCase())));
}

// ------------------------------------------------------------------ the four groups

export type NameIssueKind = "broken" | "case" | "typo" | "accents";

export type NameIssue = {
  contactId: string;
  kind: NameIssueKind;
  current: string;
  /** Null = nothing trustworthy to offer: listed for a hand fix. */
  suggestion: string | null;
  /** Ticked when the screen opens (groups 1–2 only, and only with a suggestion). */
  preselected: boolean;
  /** Where an accent suggestion came from. */
  source?: "avora" | "phone";
  /** For "typo": the words that look wrong. */
  suspects?: readonly string[];
};

export type NameRepairInput = {
  id: string;
  name: string;
  phone: string | null;
  linkedUserId: string | null;
};

/**
 * Sorts every contact into at most one group, most urgent first: broken characters, then case /
 * spaces, then possible typos, then missing accents. `avoraName` is the display name of the
 * AVORA account a contact is linked to (bạn bè), when known.
 */
export function findNameIssues(contacts: readonly NameRepairInput[], avoraName: (userId: string) => string | null): NameIssue[] {
  const accentedByPhone = new Map<string, string[]>();
  for (const contact of contacts) {
    if (contact.phone === null || contact.phone === "") continue;
    const name = cleanContactName(contact.name);
    if (!hasVietnameseMarks(name) || looksBroken(name)) continue;
    accentedByPhone.set(contact.phone, [...(accentedByPhone.get(contact.phone) ?? []), name]);
  }

  const issues: NameIssue[] = [];
  for (const contact of contacts) {
    const name = contact.name;
    if (cleanContactName(name) === "") continue;

    if (looksBroken(name)) {
      const found = repairMojibake(name) ?? repairCp1258(name);
      // A letter already lost to "?" cannot be brought back: hand fix, never half a repair.
      const repaired = found !== null && found.includes("?") ? null : found;
      issues.push({ contactId: contact.id, kind: "broken", current: name, suggestion: repaired, preselected: repaired !== null });
      continue;
    }

    const tidy = tidyNameSuggestion(name);
    if (tidy !== null) {
      issues.push({ contactId: contact.id, kind: "case", current: name, suggestion: tidy, preselected: true });
      continue;
    }

    const suspects = suspectSyllables(name);
    if (suspects.length > 0) {
      issues.push({ contactId: contact.id, kind: "typo", current: name, suggestion: null, preselected: false, suspects });
      continue;
    }

    if (isUnaccentedVietnamese(name)) {
      const linked = contact.linkedUserId === null ? null : avoraName(contact.linkedUserId);
      if (linked !== null && hasVietnameseMarks(linked) && !looksBroken(linked)) {
        issues.push({ contactId: contact.id, kind: "accents", current: name, suggestion: cleanContactName(linked), preselected: false, source: "avora" });
        continue;
      }
      const plain = stripAccents(cleanContactName(name)).toLowerCase();
      const sameNumber = contact.phone === null ? [] : (accentedByPhone.get(contact.phone) ?? []);
      const match = sameNumber.find((other) => stripAccents(other).toLowerCase().includes(plain)) ?? sameNumber[0];
      issues.push({
        contactId: contact.id,
        kind: "accents",
        current: name,
        suggestion: match ?? null,
        preselected: false,
        ...(match !== undefined ? { source: "phone" as const } : {}),
      });
    }
  }
  return issues;
}

export function countIssues(issues: readonly NameIssue[]): Record<NameIssueKind, number> {
  const counts: Record<NameIssueKind, number> = { broken: 0, case: 0, typo: 0, accents: 0 };
  for (const issue of issues) counts[issue.kind] += 1;
  return counts;
}

// ------------------------------------------------------------------ reading files in the right encoding

const SUPPORTED = ["utf-8", "windows-1258", "windows-1252", "iso-8859-1"] as const;
export type ContactFileEncoding = (typeof SUPPORTED)[number];

function decodeWith(bytes: Uint8Array, encoding: string, fatal = false): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes).normalize("NFC");
  } catch {
    return null;
  }
}

/** How Vietnamese a decoded text reads: real letters up, broken shapes and odd symbols down. */
function vietnameseScore(text: string): number {
  const letters = (text.match(new RegExp(VIET_LETTERS.source, "gi")) ?? []).length;
  const broken = (text.match(new RegExp(MOJIBAKE.source, "g")) ?? []).length;
  const odd = (text.match(/[\u0080-\u009F¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷Þþ]/g) ?? []).length;
  const words = text.split(/[\s,;:"]+/).filter((word) => hasVietnameseMarks(word));
  const bad = words.filter((word) => syllableProblem(word) !== null).length;
  return letters - 3 * broken - 3 * odd - 2 * bad;
}

/**
 * A contact file's text, in the encoding it was really written in (63 · A): UTF-8 when it is
 * valid UTF-8; otherwise a declared `CHARSET=`; otherwise whichever of Windows-1258 / 1252 reads
 * as real Vietnamese.
 */
export function decodeContactFile(bytes: Uint8Array): { text: string; encoding: ContactFileEncoding } {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  const utf8 = decodeWith(body, "utf-8", true);
  if (utf8 !== null) return { text: utf8, encoding: "utf-8" };

  const ascii = decodeWith(body, "iso-8859-1") ?? "";
  const declared = /CHARSET=("?)([A-Za-z0-9_-]+)\1/i.exec(ascii)?.[2]?.toLowerCase();
  const normalized = declared === "cp1258" ? "windows-1258" : declared === "cp1252" ? "windows-1252" : declared;
  if (normalized !== undefined && (SUPPORTED as readonly string[]).includes(normalized) && normalized !== "utf-8") {
    const text = decodeWith(body, normalized);
    if (text !== null) return { text, encoding: normalized as ContactFileEncoding };
  }

  let best: { text: string; encoding: ContactFileEncoding; score: number } | null = null;
  for (const encoding of ["windows-1258", "windows-1252"] as const) {
    const text = decodeWith(body, encoding);
    if (text === null) continue;
    const score = vietnameseScore(text);
    if (best === null || score > best.score) best = { text, encoding, score };
  }
  return best === null ? { text: decodeWith(body, "utf-8") ?? "", encoding: "utf-8" } : { text: best.text, encoding: best.encoding };
}

export function encodingLabel(encoding: ContactFileEncoding): string {
  if (encoding === "utf-8") return "UTF-8";
  if (encoding === "windows-1258") return "Windows-1258 (tiếng Việt)";
  if (encoding === "windows-1252") return "Windows-1252";
  return "ISO-8859-1";
}

/** Quoted-printable bytes decoded in the charset the vCard line declared (default UTF-8). */
export function decodeQuotedPrintableIn(raw: string, charset: string | undefined): string {
  const withBytes = raw.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const bytes = Uint8Array.from(withBytes, (character) => character.charCodeAt(0) & 0xff);
  const wanted = (charset ?? "utf-8").toLowerCase().replace(/^cp/, "windows-");
  const encoding = (SUPPORTED as readonly string[]).includes(wanted) ? wanted : "utf-8";
  return decodeWith(bytes, encoding) ?? raw;
}
