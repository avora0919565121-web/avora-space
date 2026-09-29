import type { Contact } from "@/lib/contacts";
import { normalizeSearch } from "@/lib/normalize-search";

/**
 * Đợt gộp 2 · D5 — choosing a person in Tài chính. Pure rules, so the picker and its tests read
 * the same thing: accent-free search on name / phone / email, the five most recent first, a
 * short hint to tell two "Anh Minh" apart, and a duplicate check before adding a new one.
 */

const RECENT_KEY = "avora.finance.recent-contacts.v1";
export const RECENT_LIMIT = 5;

export function readRecentContacts(userId: string | undefined): string[] {
  if (userId === undefined) return [];
  try {
    const raw = window.localStorage.getItem(`${RECENT_KEY}:${userId}`);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentContact(userId: string | undefined, contactId: string): void {
  if (userId === undefined) return;
  try {
    const next = [contactId, ...readRecentContacts(userId).filter((id) => id !== contactId)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(`${RECENT_KEY}:${userId}`, JSON.stringify(next));
  } catch {
    // No storage: the list simply has no "gần đây".
  }
}

/** "•••• 4321" for a phone, the email otherwise, nothing when neither is known. */
export function contactHint(contact: Pick<Contact, "phone" | "email">): string {
  const digits = (contact.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return contact.email ?? "";
}

/** Matches on name, phone digits and email; recent people first, then by name. */
export function rankContacts(contacts: readonly Contact[], query: string, recentIds: readonly string[]): Contact[] {
  const needle = normalizeSearch(query);
  const digits = query.replace(/\D/g, "");
  const matches = contacts.filter((contact) => {
    if (needle === "") return true;
    if (normalizeSearch(contact.name).includes(needle)) return true;
    if (contact.email !== null && normalizeSearch(contact.email).includes(needle)) return true;
    return digits.length >= 3 && (contact.phone ?? "").replace(/\D/g, "").includes(digits);
  });
  const rank = (contact: Contact): number => {
    const index = recentIds.indexOf(contact.id);
    return index === -1 ? RECENT_LIMIT : index;
  };
  return [...matches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "vi"));
}

/** Someone already in Danh bạ under the same name (accent-free) — offered before adding a second. */
export function sameNameContacts(contacts: readonly Contact[], name: string): Contact[] {
  const needle = normalizeSearch(name);
  if (needle === "") return [];
  return contacts.filter((contact) => normalizeSearch(contact.name) === needle);
}

// ------------------------------------------------------------------ the amount field

/** Currencies written without decimals. */
const WHOLE_CURRENCIES = new Set<string>(["VND", "JPY", "KRW"]);

export function isWholeCurrency(currency: string | null | undefined): boolean {
  return WHOLE_CURRENCIES.has((currency ?? "").toUpperCase());
}

/** What the amount box shows as the person types: "1.500.000" for VND, digits and one dot otherwise. */
export function formatAmountTyping(raw: string, currency: string | null | undefined): string {
  if (isWholeCurrency(currency)) {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  return raw.replace(/[^\d.,]/g, "");
}

/** The plain number `validateAmount` reads. */
export function amountForValidation(display: string, currency: string | null | undefined): string {
  return isWholeCurrency(currency) ? display.replace(/\D/g, "") : display;
}

/** "Còn thiếu: Số tiền, Người vay" — what a greyed-out save button is waiting for. */
export function missingLine(missing: readonly string[]): string | null {
  return missing.length === 0 ? null : `Còn thiếu: ${missing.join(", ")}`;
}
