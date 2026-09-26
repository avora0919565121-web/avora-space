import { normalizePhone, type ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

/**
 * Calling from a conversation. AVORA prepares and hands over; the call itself always happens
 * in the app the person picks (the phone dialer, Zalo, WhatsApp) — nothing is dialled for them.
 */
export type CallApp = "phone" | "zalo" | "whatsapp";

export const CALL_APPS: readonly { id: CallApp; label: string; note: string }[] = [
  { id: "phone", label: "Điện thoại", note: "Gọi bằng số di động" },
  { id: "zalo", label: "Zalo", note: "Mở Zalo, số đã được chép sẵn" },
  { id: "whatsapp", label: "WhatsApp", note: "Mở WhatsApp, số đã được chép sẵn" },
];

/**
 * The phone number for the other person in a 1-1, read from the viewer's own Liên hệ: the
 * contact linked to that AVORA account, its main phone first, then any extra phone channel.
 * Null when the viewer has not saved one — AVORA never looks it up anywhere else.
 */
export function peerPhone(
  peerId: string | null,
  contacts: readonly Contact[],
  channels: readonly ContactChannel[],
): { phone: string; contactId: string } | null {
  if (peerId === null) return null;
  const contact = contacts.find((item) => item.linkedUserId === peerId);
  if (contact === undefined) return null;
  const main = contact.phone?.trim() ?? "";
  if (main.length > 0) return { phone: main, contactId: contact.id };
  const extra = channels.find((entry) => entry.contactId === contact.id && entry.kind === "phone");
  return extra === undefined ? null : { phone: extra.value.trim(), contactId: contact.id };
}

/**
 * Every number a contact can be called on, main phone first, then the representative's (a company),
 * then extra phone channels — de-duplicated by their normalised digits. Empty when there is none,
 * in which case no call channel is shown at all.
 */
export function contactPhones(
  contact: Pick<Contact, "id" | "phone" | "representativePhone">,
  channels: readonly ContactChannel[],
): { phone: string; label: string }[] {
  const found: { phone: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, label: string): void => {
    const value = raw?.trim() ?? "";
    const digits = normalizePhone(value);
    if (digits.length < 8 || seen.has(digits)) return;
    seen.add(digits);
    found.push({ phone: value, label });
  };
  add(contact.phone, "Số chính");
  add(contact.representativePhone, "Người đại diện");
  for (const entry of channels) {
    if (entry.contactId === contact.id && entry.kind === "phone") add(entry.value, entry.label ?? "Số khác");
  }
  return found;
}

/** Local Vietnamese form (0912345678) → international digits without "+" (84912345678). */
export function internationalDigits(raw: string): string {
  const local = normalizePhone(raw);
  return local.startsWith("0") ? `84${local.slice(1)}` : local;
}

/** Where each choice goes. Zalo and WhatsApp open a chat with that number; Phone opens the dialer. */
export function callHref(app: CallApp, raw: string): string {
  const local = normalizePhone(raw);
  if (app === "phone") return `tel:${local}`;
  if (app === "zalo") return `https://zalo.me/${local}`;
  return `https://wa.me/${internationalDigits(raw)}`;
}

// ------------------------------------------------------------------ scheduled group calls

/** How far ahead a call can be set, so a typo in the year is caught rather than posted. */
export const SCHEDULE_MAX_DAYS = 365;

/**
 * A fresh meeting room link. Jitsi Meet needs no account and no install on a computer, so the
 * link works for every member the moment it is posted; the person scheduling can replace it
 * with their own Meet/Zoom/Zalo link before sending.
 */
export function newCallRoomLink(random: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let code = "";
  for (let index = 0; index < 12; index += 1) code += alphabet[Math.floor(random() * alphabet.length)];
  return `https://meet.jit.si/avora-${code}`;
}

/** Only an http(s) link is posted; anything else is refused before it reaches the chat. */
export function isCallLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Why a scheduled call cannot be posted yet, or null when it can. */
export function scheduleProblem(input: { at: Date | null; link: string }, now: Date = new Date()): string | null {
  if (input.at === null || Number.isNaN(input.at.getTime())) return "Hãy chọn ngày và giờ cho cuộc gọi.";
  if (input.at.getTime() < now.getTime()) return "Thời gian này đã qua — chọn một lúc sắp tới nhé.";
  if (input.at.getTime() - now.getTime() > SCHEDULE_MAX_DAYS * 86_400_000) return "Chỉ lên lịch được trong vòng một năm tới.";
  if (!isCallLink(input.link)) return "Link cuộc gọi cần bắt đầu bằng https://";
  return null;
}

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** "Thứ sáu, 26/09/2026 lúc 14:30" — in the scheduler's own time zone, which it names. */
export function callTimeLabel(at: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${WEEKDAYS[at.getDay()]}, ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} lúc ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The invitation posted into the conversation — the words only, nothing it does on its own. */
export function callInviteMessage(input: { topic: string; at: Date; link: string }): string {
  const topic = input.topic.trim();
  return [
    `📞 Lịch gọi nhóm${topic.length > 0 ? `: ${topic}` : ""}`,
    `🕒 ${callTimeLabel(input.at)}`,
    `🔗 ${input.link.trim()}`,
  ].join("\n");
}

/** Splits a message into plain text and http(s) links, so a posted call link can be tapped. */
export function splitLinks(text: string): { text: string; href: string | null }[] {
  const parts: { text: string; href: string | null }[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    // A sentence's full stop or closing bracket is not part of the link.
    const raw = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (start > last) parts.push({ text: text.slice(last, start), href: null });
    parts.push({ text: raw, href: raw });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null });
  return parts.length === 0 ? [{ text, href: null }] : parts;
}
