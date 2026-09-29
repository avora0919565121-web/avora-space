import type { GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";

/**
 * AVORA-39 Phần 3 · Nhóm E bản 2 (ADR-030) — the one task form.
 *
 * Everything here is pure so the rules the form follows (who receives, what the header says,
 * what is still missing) can be tested without rendering anything.
 */

/** Where the form was opened, as far as "Giao cho" is concerned. */
export type ComposerPlace =
  /** Nhật ký, tab Nhiệm vụ, Dán nội dung, Bảng cá nhân — only "Cho tôi". */
  | "personal"
  /** A 1-1 and its Bảng — Cho tôi · Cho {tên} · Cả hai. */
  | "direct"
  /** Nhóm, chat Dự án, trang Dự án, Bảng của nhóm/dự án — Cho tôi · Cả nhóm · Chọn người. */
  | "group";

/** The answer to "Giao cho". `none` is the resting state everywhere except personal places. */
export type RecipientChoice = "none" | "me" | "peer" | "both" | "all" | "pick";

export type Recipients = {
  includesSelf: boolean;
  /** Everyone else who receives a suggestion, in the order they will be sent. */
  others: string[];
};

export const NO_RECIPIENTS: Recipients = { includesSelf: false, others: [] };

/** The choice a place starts with: already "Cho tôi" where that is the only answer, else nothing. */
export function initialChoice(place: ComposerPlace): RecipientChoice {
  return place === "personal" ? "me" : "none";
}

/** Which buttons "Giao cho" shows for a place. */
export function choicesFor(place: ComposerPlace): RecipientChoice[] {
  if (place === "personal") return ["me"];
  if (place === "direct") return ["me", "peer", "both"];
  return ["me", "all", "pick"];
}

export function choiceLabel(choice: RecipientChoice, place: ComposerPlace, peerName: string): string {
  switch (choice) {
    case "me":
      return "Cho tôi";
    case "peer":
      return `Cho ${peerName}`;
    case "both":
      return "Cả hai";
    case "all":
      return "Cả nhóm";
    case "pick":
      return "Chọn người";
    default:
      return place === "personal" ? "Cho tôi" : "Chưa chọn";
  }
}

/**
 * Who actually receives, from the choice.
 *
 * `eligibleIds` is the room as the server lets this person reach it: live members, nobody blocked
 * either way (task_recipient_ids). "Cả nhóm" is exactly that list; "Chọn người" is the picked
 * subset of it — a pick the server would refuse never leaves the form.
 */
export function resolveRecipients(input: {
  place: ComposerPlace;
  choice: RecipientChoice;
  selfId: string | undefined;
  peerId: string | null;
  eligibleIds: readonly string[];
  pickedIds: readonly string[];
}): Recipients {
  const { place, choice, selfId, peerId, eligibleIds, pickedIds } = input;
  if (selfId === undefined) return NO_RECIPIENTS;
  if (choice === "me") return { includesSelf: true, others: [] };
  if (place === "direct") {
    if (peerId === null) return choice === "none" ? NO_RECIPIENTS : { includesSelf: choice === "both", others: [] };
    if (choice === "peer") return { includesSelf: false, others: [peerId] };
    if (choice === "both") return { includesSelf: true, others: [peerId] };
    return NO_RECIPIENTS;
  }
  if (place === "group") {
    const eligible = new Set<string>(eligibleIds);
    if (choice === "all") {
      return { includesSelf: true, others: eligibleIds.filter((id) => id !== selfId) };
    }
    if (choice === "pick") {
      const chosen = pickedIds.filter((id) => eligible.has(id) || id === selfId);
      return { includesSelf: chosen.includes(selfId), others: chosen.filter((id) => id !== selfId) };
    }
  }
  return NO_RECIPIENTS;
}

export function hasRecipients(recipients: Recipients): boolean {
  return recipients.includesSelf || recipients.others.length > 0;
}

/** The line under "Giao cho" — always shown once someone is chosen, so nobody guesses who gets it. */
export function recipientSummary(
  recipients: Recipients,
  choice: RecipientChoice,
  nameOf: (userId: string) => string,
): string | null {
  if (!hasRecipients(recipients)) return null;
  if (recipients.others.length === 0) return "Chỉ bạn";
  if (choice === "all") return `Cả nhóm: ${recipients.others.length + 1} người · gồm cả bạn`;
  const names = recipients.others.map(nameOf).join(", ");
  return `Gửi tới: ${names}${recipients.includesSelf ? " · và bạn" : ""}`;
}

export type ComposerCopy = {
  title: string;
  description: string;
  /** Null means there is no send button at all — only Huỷ. */
  submitLabel: string | null;
};

/** Header, subline and button always say what is about to happen (ADR-030 rule 4). */
export function composerCopy(input: {
  place: ComposerPlace;
  recipients: Recipients;
  peerName: string;
  nameOf: (userId: string) => string;
}): ComposerCopy {
  const { place, recipients, peerName, nameOf } = input;
  if (!hasRecipients(recipients)) {
    return { title: "Nhiệm vụ mới", description: "Chọn người nhận để bắt đầu.", submitLabel: null };
  }
  if (recipients.others.length === 0) {
    const description =
      place === "direct"
        ? `Việc riêng của bạn — ${peerName} không thấy.`
        : place === "group"
          ? "Việc của bạn trong nhóm — cả nhóm thấy."
          : "Việc riêng của bạn.";
    return { title: "Tạo nhiệm vụ", description, submitLabel: "Tạo nhiệm vụ" };
  }
  if (!recipients.includesSelf) {
    const description =
      recipients.others.length === 1
        ? `${nameOf(recipients.others[0])} có thể đồng ý hoặc từ chối.`
        : "Mỗi người nhận một gợi ý riêng.";
    return { title: "Gợi ý nhiệm vụ", description, submitLabel: "Gửi gợi ý" };
  }
  return {
    title: "Tạo và gợi ý nhiệm vụ",
    description: `Việc của bạn được tạo ngay; ${recipients.others.length} người còn lại nhận gợi ý.`,
    submitLabel: "Tạo và gửi gợi ý",
  };
}

/** The toast after saving, named for what happened. */
export function composerSuccess(recipients: Recipients, nameOf: (userId: string) => string): string {
  const others = recipients.others.length;
  if (others === 0) return "Đã tạo nhiệm vụ của bạn.";
  if (!recipients.includesSelf) return others === 1 ? `Đã gợi ý cho ${nameOf(recipients.others[0])}.` : `Đã gợi ý cho ${others} người.`;
  return `Đã tạo nhiệm vụ của bạn và gợi ý cho ${others} người.`;
}

/** A failure halfway keeps the honest "Đã gửi x/y" count. */
export function composerPartialFailure(done: number, total: number, message: string): string {
  return done === 0 ? message : `Đã gửi ${done}/${total}. ${message}`;
}

export type ComposerFields = {
  title: string;
  deadline: string;
  /** Local `YYYY-MM-DDTHH:MM`, or "" for no Event. */
  startAt: string;
  endAt: string;
  location: string;
  requiresPresence: boolean;
};

/** What still stands between the form and the button, in reading order. */
export function missingFields(fields: ComposerFields): string[] {
  const missing: string[] = [];
  if (fields.title.trim() === "") missing.push("tên việc");
  if (fields.deadline.trim() === "") missing.push("hạn hoàn thành");
  const needsStart = fields.requiresPresence || fields.endAt !== "" || fields.location.trim() !== "";
  if (needsStart && fields.startAt === "") missing.push("giờ bắt đầu của Sự kiện");
  return missing;
}

export function missingLine(missing: readonly string[]): string | null {
  return missing.length === 0 ? null : `Còn thiếu: ${missing.join(", ")}`;
}

/** Members for "Chọn người": the chooser pinned first as "Tôi", everyone else as they are. */
export function pickerMembers(members: readonly GroupMember[], selfId: string | undefined): GroupMember[] {
  const self = members.find((member) => member.userId === selfId);
  const rest = members.filter((member) => member.userId !== selfId);
  return self === undefined ? rest : [{ ...self, displayName: "Tôi", email: null }, ...rest];
}

export function memberName(members: readonly GroupMember[], userId: string, fallback: string): string {
  const member = members.find((entry) => entry.userId === userId);
  return member === undefined ? fallback : memberLabel(member);
}

// ------------------------------------------------------------------ Sự kiện / Hiện diện

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

function clockOf(date: Date): string {
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

/** `T4 30/09` */
export function shortDay(date: Date): string {
  return `${WEEKDAY_SHORT[date.getDay()]} ${`${date.getDate()}`.padStart(2, "0")}/${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

/** A place written as a link gets "Mở link"; anything else is a place and gets "Chép". */
export function isLinkLocation(location: string | null | undefined): boolean {
  return location !== null && location !== undefined && /^https?:\/\/\S+$/i.test(location.trim());
}

/** `Sự kiện · T4 30/09 · 14:00–15:30 · Văn phòng` — null when there is no start. */
export function eventSummary(startAt: string | null, endAt: string | null, location: string | null): string | null {
  if (startAt === null) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = endAt === null ? null : new Date(endAt);
  const range = end !== null && !Number.isNaN(end.getTime()) ? `${clockOf(start)}–${clockOf(end)}` : clockOf(start);
  const place = location !== null && location.trim() !== "" ? ` · ${location.trim()}` : "";
  return `Sự kiện · ${shortDay(start)} · ${range}${place}`;
}

/** Leave at start − travel; be reminded `offset` minutes before that (0 = "Đúng giờ đi"). */
export function departureTimes(
  startAt: string | null,
  travelMinutes: number | null,
  offsetMinutes: number,
): { leaveAt: Date; remindAt: Date } | null {
  if (startAt === null || travelMinutes === null) return null;
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return null;
  const leaveAt = new Date(start - travelMinutes * 60_000);
  return { leaveAt, remindAt: new Date(leaveAt.getTime() - Math.max(0, offsetMinutes) * 60_000) };
}

/** `Lên đường 13:40 · nhắc lúc 13:25` */
export function departureLine(startAt: string | null, travelMinutes: number | null, offsetMinutes: number): string | null {
  const times = departureTimes(startAt, travelMinutes, offsetMinutes);
  if (times === null) return null;
  return `Lên đường ${clockOf(times.leaveAt)} · nhắc lúc ${clockOf(times.remindAt)}`;
}

/** `Hiện diện · Có mặt · đi 20 phút · nhắc 13:25` */
export function presenceSummary(
  requiresPresence: boolean,
  startAt: string | null,
  travelMinutes: number | null,
  offsetMinutes: number,
): string | null {
  if (!requiresPresence) return null;
  const times = departureTimes(startAt, travelMinutes, offsetMinutes);
  if (times === null || travelMinutes === null) return "Hiện diện · Có mặt";
  return `Hiện diện · Có mặt · đi ${travelMinutes} phút · nhắc ${clockOf(times.remindAt)}`;
}

/** `Ghi chú · Mang hợp đồng bản in…` */
export function noteSummary(description: string, max: number = 48): string | null {
  const firstLine = description.trim().split("\n")[0]?.replace(/^[-•]\s*/, "") ?? "";
  if (firstLine === "") return null;
  return `Ghi chú · ${firstLine.length > max ? `${firstLine.slice(0, max).trimEnd()}…` : firstLine}`;
}

export const TRAVEL_CHIPS: readonly number[] = [10, 15, 20, 30, 45, 60];
export const REMINDER_CHIPS: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: "Đúng giờ đi" },
  { minutes: 5, label: "5 phút trước" },
  { minutes: 10, label: "10 phút trước" },
  { minutes: 15, label: "15 phút trước" },
  { minutes: 30, label: "30 phút trước" },
];

/** Picking a start with no end yet suggests one: + the estimate, or + 60 minutes. */
export function suggestedEnd(startLocal: string, estimateMinutes: number | null): string {
  const start = new Date(startLocal);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + (estimateMinutes ?? 60) * 60_000);
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function localStamp(date: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Latest end a same-day Event may have (no overnight Events yet). */
const LAST_END = "23:55";

/**
 * The end that goes with a new start (Đợt gộp 2 · A12):
 * - no end yet, or the old end is not after the new start → start + 60 minutes;
 * - a valid end already → keep the length (18:00–21:00 moved to 19:00 becomes 19:00–22:00).
 * Never past 23:55 of the start's own day.
 */
export function eventEndFor(nextStartLocal: string, prevStartLocal: string, prevEndLocal: string): string {
  const start = new Date(nextStartLocal);
  if (Number.isNaN(start.getTime())) return "";
  const prevStart = new Date(prevStartLocal);
  const prevEnd = new Date(prevEndLocal);
  const hadLength =
    !Number.isNaN(prevStart.getTime()) && !Number.isNaN(prevEnd.getTime()) && prevEnd.getTime() > prevStart.getTime();
  const lengthMs = hadLength ? prevEnd.getTime() - prevStart.getTime() : 60 * 60_000;
  const end = new Date(start.getTime() + lengthMs);
  const dayEnd = new Date(`${nextStartLocal.slice(0, 10)}T${LAST_END}`);
  const capped = end.getTime() > dayEnd.getTime() ? dayEnd : end;
  if (capped.getTime() <= start.getTime()) return "";
  return localStamp(capped);
}

/** "1 giờ", "3 giờ 30 phút", "45 phút" — shown beside the end time. Null when not a valid span. */
export function eventDurationLabel(startLocal: string, endLocal: string): string | null {
  const start = new Date(startLocal);
  const end = new Date(endLocal);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} phút`;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

/** Local `YYYY-MM-DDTHH:MM` ↔ ISO, as the Event fields store them. */
export function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
