import vCard from "vcf";

import type { ImportedContactCandidate } from "@/lib/contact-candidates";
import { normalizeChannelValue, type ChannelKind } from "@/lib/contact-channels";

/**
 * Reading an address book out of a `.vcf` file.
 *
 * This is the only bulk route that works on an iPhone. Safari has no Contacts Picker — Apple
 * withholds it at the WebKit level, so no amount of code here would produce one — and exporting
 * a `.vcf` from the Contacts app is what an iPhone owner can actually do. The same file is what
 * Android, Outlook and Gmail export too, so one reader serves all of them.
 *
 * The vCard grammar is left to the `vcf` library: line folding, parameter parsing and the
 * property model are exactly the parts a hand-written regex gets wrong on real files. What this
 * module owns is the envelope around it — splitting a file of many cards, line endings, the
 * quoted-printable that Android still emits — because the library is strict in places where
 * real exports are not, and a strict reader would throw away a whole address book over one odd
 * card.
 */

/** Where a value sat in the card, so the review screen can pre-fill something sensible. */
export type SuggestedChannelLabel = "business" | "personal" | "other";

export type VcardReadResult = {
  candidates: ImportedContactCandidate[];
  /**
   * Cards that yielded nothing at all — no name, no number, no address.
   *
   * Measured by what came out rather than by whether the parser threw, because the repairs in
   * `prepareBlock` are deliberately forgiving: a block of junk usually parses into an empty
   * card instead of raising, and counting only the raises would report a clean file while
   * quietly dropping people.
   *
   * A card with a number but no name is NOT counted here. It is legible, it is simply not a
   * contact, and the shared pipeline drops it for the same reason it drops a nameless
   * phone-book entry — reporting it as damage would blame the file for our rule.
   */
  skipped: number;
  /** Cards found in the file, usable or not. */
  total: number;
};

/**
 * The card boundaries, found before the parser is involved.
 *
 * One `.vcf` is a whole phone book — several hundred cards end to end — and the library parses
 * a file as one unit, refusing all of it when any card is malformed. Cutting the file up here
 * means one unreadable card costs one contact instead of the import.
 *
 * The final `END:VCARD` is optional because exports truncated by a transfer are common enough
 * that dropping the last person would be a quiet, hard-to-notice loss. A card missing its END
 * therefore stops at the next BEGIN rather than running on: without that, one unterminated
 * card in the middle of a file would swallow the person written after it.
 */
export function splitVcardBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /BEGIN:VCARD\r?\n([\s\S]*?)(?:END:VCARD|(?=BEGIN:VCARD)|$)/gi;

  for (const match of text.matchAll(pattern)) {
    const body = match[1].trim();
    if (body.length > 0) blocks.push(body);
  }

  return blocks;
}

/**
 * Quoted-printable soft line breaks, joined back together.
 *
 * Android's vCard 2.1 export encodes any non-ASCII name this way and wraps long lines with a
 * trailing `=` and no leading space — which is not the folding the library knows, so "Đặng Đức
 * Bình" arrives as a truncated name plus a junk property named after its own second half.
 *
 * Only lines that declare the encoding are joined. A blanket rule would also eat the `=`
 * padding that ends a BASE64 `PHOTO`, merging an image into whatever property follows it.
 */
export function joinQuotedPrintableLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const joined: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];

    if (/^[^:]*ENCODING=QUOTED-PRINTABLE/i.test(line)) {
      while (line.endsWith("=") && index + 1 < lines.length) {
        line = line.slice(0, -1) + lines[index + 1];
        index += 1;
      }
    }

    joined.push(line);
  }

  return joined.join("\r\n");
}

/**
 * Quoted-printable back to text.
 *
 * Decoded as UTF-8 bytes rather than character by character: every escape is one byte, and a
 * Vietnamese letter is two or three of them, so decoding singly yields mojibake on exactly the
 * names this matters for.
 */
export function decodeQuotedPrintable(raw: string): string {
  const withBytes = raw.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  const bytes = Uint8Array.from(withBytes, (character) => character.charCodeAt(0) & 0xff);
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return raw;
  }
}

/** vCard escaping: `\,` `\;` `\n` `\\` mean what they say. */
export function unescapeVcardText(raw: string): string {
  return raw.replace(/\\([\\,;nN])/g, (_match, character: string) =>
    character === "n" || character === "N" ? "\n" : character,
  );
}

/** Splits a structured value (`ORG`, `N`) on its unescaped semicolons. */
function structuredParts(raw: string): string[] {
  return raw
    .split(/(?<!\\);/)
    .map((part) => unescapeVcardText(part).trim());
}

type PropertyLike = {
  valueOf: () => string;
  encoding?: string | string[];
  type?: string | string[];
};

/** Every property under one name, as a list — the library returns one or many or nothing. */
function propertiesOf(card: vCard, key: string): PropertyLike[] {
  const found = card.get(key) as unknown;
  if (found === undefined || found === null) return [];
  const list = Array.isArray(found) ? found : [found];
  return list.filter((entry): entry is PropertyLike => entry !== null && entry !== undefined);
}

/** One property's value, decoded and unescaped. */
function textOf(property: PropertyLike): string {
  const raw = String(property.valueOf() ?? "");
  const encoding = Array.isArray(property.encoding)
    ? property.encoding.join(",")
    : (property.encoding ?? "");
  const decoded = /QUOTED-PRINTABLE/i.test(encoding) ? decodeQuotedPrintable(raw) : raw;
  return unescapeVcardText(decoded).trim();
}

function firstText(card: vCard, key: string): string {
  for (const property of propertiesOf(card, key)) {
    const value = textOf(property);
    if (value.length > 0) return value;
  }
  return "";
}

/**
 * What a `TYPE=` parameter suggests this value is for.
 *
 * A suggestion only. Phone books disagree about these words — an iPhone writes `CELL` for a
 * number its owner uses entirely for work — so this pre-fills a label and never decides
 * anything the person cannot overrule.
 */
export function suggestedLabelFor(property: PropertyLike): SuggestedChannelLabel {
  const raw = Array.isArray(property.type) ? property.type.join(",") : (property.type ?? "");
  const words = raw.toLowerCase();

  if (/\bwork\b/.test(words)) return "business";
  if (/\b(home|cell|iphone|main|personal)\b/.test(words)) return "personal";
  return "other";
}

/**
 * The words a suggested label is written in, or nothing.
 *
 * "other" deliberately produces no label at all: a channel labelled "Khác" reads as though
 * somebody decided something, when in truth the card only said `FAX` or said nothing. An
 * unlabelled channel is the honest version of not knowing.
 */
export function labelWords(label: SuggestedChannelLabel): string | null {
  if (label === "business") return "Cơ quan";
  if (label === "personal") return "Cá nhân";
  return null;
}

/**
 * Whether this card describes a company.
 *
 * Apple states it outright with `X-ABShowAs:COMPANY`. Otherwise the test is an organisation
 * with no person named alongside it — a card carrying both is someone's employer being written
 * down, not a company contact, and guessing "business" there would file a person as a firm.
 *
 * Returns null rather than "individual" when unsure, which is what leaves the question with the
 * person: the preview's toggle then appears, off, exactly as it does for the phone book.
 */
export function suggestedTypeOf(card: vCard, organisation: string, fullName: string): "business" | null {
  const showAs = firstText(card, "xAbShowAs");
  if (/company/i.test(showAs)) return "business";

  if (organisation.length === 0) return null;

  const structuredName = firstText(card, "n");
  const nameParts = structuredName.length > 0 ? structuredParts(structuredName) : [];
  // N is Family;Given;Additional;Prefix;Suffix — the first two are what name a person.
  const hasPersonName = nameParts.slice(0, 2).some((part) => part.length > 0);
  if (hasPersonName) return null;

  // A card with no structured name, whose display name is the organisation itself.
  return fullName.length === 0 || fullName === organisation ? "business" : null;
}

/** The display name, falling back to the structured name a sparse card may carry instead. */
function nameOf(card: vCard): string {
  const full = firstText(card, "fn");
  if (full.length > 0) return full;

  const structured = firstText(card, "n");
  if (structured.length === 0) return "";

  // Family name first: this is a Vietnamese address book, and "Nguyễn An" is the order the
  // person who wrote the card reads.
  const [family = "", given = ""] = structuredParts(structured);
  return [family, given].filter((part) => part.length > 0).join(" ");
}

/**
 * One card, made ready for the library.
 *
 * The library requires CRLF and a supported `VERSION`, and throws for the whole file otherwise.
 * Both are properties of how the file was written rather than of the contact in it, so they are
 * repaired instead of being grounds to lose somebody: a card whose name and number are perfectly
 * legible should not be dropped over its line endings.
 */
function prepareBlock(body: string): string {
  const withoutVersion = body
    .split(/\r?\n/)
    .filter((line) => !/^VERSION:/i.test(line))
    .join("\r\n");

  const declared = body.match(/^VERSION:(\d\.\d)/im)?.[1] ?? "";
  const version = vCard.versions.includes(declared as (typeof vCard.versions)[number])
    ? declared
    : "3.0";

  return joinQuotedPrintableLines(
    `BEGIN:VCARD\r\nVERSION:${version}\r\n${withoutVersion}\r\nEND:VCARD\r\n`,
  );
}

/** Both value lists of one card, with whatever each value's `TYPE=` suggested. */
function channelsOf(
  card: vCard,
  key: string,
  kind: ChannelKind,
): { values: string[]; labels: Record<string, string> } {
  const values: string[] = [];
  const labels: Record<string, string> = {};

  for (const property of propertiesOf(card, key)) {
    const value = textOf(property);
    if (value.length === 0) continue;
    values.push(value);

    const words = labelWords(suggestedLabelFor(property));
    // Keyed by the normalised value so the label survives the de-duplication that follows:
    // the same number written two ways must not end up with two different suggestions.
    if (words !== null) {
      const slot = `${kind}:${normalizeChannelValue(kind, value)}`;
      if (labels[slot] === undefined) labels[slot] = words;
    }
  }

  return { values, labels };
}

/**
 * Every contact in a `.vcf` file.
 *
 * A card that cannot be read is counted and passed over rather than thrown: a phone book of
 * six hundred people should not be refused because one entry came out of an old device wrong.
 */
export function parseVcards(text: string): VcardReadResult {
  const blocks = splitVcardBlocks(text);
  const candidates: ImportedContactCandidate[] = [];
  let skipped = 0;

  for (const block of blocks) {
    let card: vCard;
    try {
      card = vCard.parse(prepareBlock(block))[0];
    } catch (error) {
      console.error("[contact-vcard] bỏ qua một thẻ không đọc được", error);
      skipped += 1;
      continue;
    }

    if (card === undefined) {
      skipped += 1;
      continue;
    }

    const phones = channelsOf(card, "tel", "phone");
    const emails = channelsOf(card, "email", "email");
    const organisation = structuredParts(firstText(card, "org"))[0] ?? "";
    const name = nameOf(card);

    if (
      name.length === 0 &&
      organisation.length === 0 &&
      phones.values.length === 0 &&
      emails.values.length === 0
    ) {
      skipped += 1;
      continue;
    }

    candidates.push({
      name: name.length > 0 ? name : organisation,
      phones: phones.values,
      emails: emails.values,
      suggestedType: suggestedTypeOf(card, organisation, name),
      source: "import_vcf",
      channelLabels: { ...phones.labels, ...emails.labels },
      extras: {
        note: firstText(card, "note"),
        businessAddress: "",
      },
    });
  }

  return { candidates, skipped, total: blocks.length };
}
