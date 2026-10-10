/**
 * AVORA-103 · A — Nguồn sách chính trực (ADR-080).
 *
 * Avora only takes books from lawful sources that state their rights: Project Gutenberg (official
 * mirror), Wikisource (public-domain pages), Open Library / Internet Archive (public editions only).
 * Pirate aggregators and their mirrors are never linked, searched or suggested. Their names are kept
 * here written backwards so that the plain names appear nowhere in Avora's code or data — a test
 * scans the whole source tree (and the catalogue probe scans the database) for them.
 */
const BANNED_REVERSED: readonly string[] = [
  "gro.evihcra-sanna",
  "il.evihcra-sanna",
  "es.evihcra-sanna",
  "gs.evihcra-sanna",
  "sr.cbil",
  "gro.negbil",
  "si.negbil",
  "ts.negbil",
  "il.negbil",
  "cr.negbil",
  "gro.yrarbil-z",
  "fe.yrarbil-z",
  "ks.yrarbil-z",
  "sr.yrarbil-z",
  "gro.kooblanoisnes",
  "ts.bilew",
  "gro.bilew",
  "ofni.bilew",
  "su.eekoob",
  "tsr.kooblle",
  "ten.eesbo",
  "ten.kooboiv",
];

/** The banned hosts, readable. Only for checks — never shown, never linked. */
export function bannedBookHosts(): string[] {
  return BANNED_REVERSED.map((name) => [...name].reverse().join(""));
}

/** True when a link points at a pirate aggregator or one of its mirrors (any subdomain). */
export function isBannedBookLink(link: string): boolean {
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return bannedBookHosts().some((banned) => host === banned || host.endsWith(`.${banned}`));
}

/** A book can be read in Avora only when every author and translator died more than 70 years ago. */
export const PD_YEARS = 70;

/** The last year of death that is public domain on 1 January of `year` (Viet Nam and the EU). */
export function lastPublicDeathYear(year: number = new Date().getFullYear()): number {
  return year - PD_YEARS - 1;
}

/** Words for a book Avora will not open (still in copyright somewhere it is used). */
export const NOT_PUBLIC_MESSAGE = "Cuốn này chưa chắc đã hết bản quyền ở Việt Nam và châu Âu, nên Avora không mở trong app.";
export const BORROW_MESSAGE = "Cuốn này còn bản quyền — chỉ mở được trên Open Library.";
export const OCR_MESSAGE = "Bản này chữ quét chưa sạch.";
export const BANNED_LINK_MESSAGE = "Avora không nhận link từ trang sách lậu. Hãy dùng nguồn hợp pháp.";
