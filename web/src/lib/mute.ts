import { supabase } from "@/integrations/supabase/client";

/**
 * Turning notifications off, in layers.
 *
 * Five scopes, and deliberately no sixth. There is no mute for Tasks anywhere in AVORA: a task
 * is a promise someone is waiting on, and silencing it would let a person opt out of being
 * asked while the other side still believes the request landed. Tasks are quietened by
 * finishing them.
 */
export type MuteScope = "avora" | "messages" | "direct" | "group" | "project";

export type MuteSetting = {
  scope: MuteScope;
  /** When silence ends. Always a moment, never "forever" — see DURATION rules below. */
  mutedUntil: string;
};

export const muteKeys = {
  all: ["mute-settings"] as const,
  list: ["mute-settings", "list"] as const,
};

export const MUTE_SCOPE_LABELS: Record<MuteScope, string> = {
  avora: "Toàn bộ AVORA",
  messages: "Tin nhắn",
  direct: "Chat 1-1",
  group: "Chat nhóm",
  project: "Project",
};

/** What each layer covers, said plainly under its switch. */
export const MUTE_SCOPE_NOTES: Record<MuteScope, string> = {
  avora: "Tắt mọi thông báo — không có ngoại lệ nào, kể cả Gia đình",
  messages: "Tắt thông báo tin nhắn — Gia đình vẫn qua được",
  direct: "Chỉ các cuộc trò chuyện 1-1",
  group: "Chỉ các nhóm — người nhắc tên bạn vẫn qua được",
  project: "Chỉ các Project",
};

/**
 * The two upper layers may be muted for an arbitrary stretch, and the per-tab layers may not.
 *
 * The asymmetry is the point. "Quiet the whole app until Monday" is a decision about your own
 * day and harms nobody. "Quiet this group for a month" is a decision about the people in it,
 * who are left believing their messages arrive — so those layers get four fixed answers, the
 * longest of which ends tonight. Nobody can set a tab aside and forget it for a fortnight.
 */
export function allowsCustomDuration(scope: MuteScope): boolean {
  return scope === "avora" || scope === "messages";
}

export type MuteDurationOption = {
  id: string;
  label: string;
  /** Null means "work it out from the current clock" — the end-of-day option. */
  hours: number | null;
};

/** The three quick answers every layer offers. */
export const QUICK_MUTE_DURATIONS: readonly MuteDurationOption[] = [
  { id: "1h", label: "1 giờ", hours: 1 },
  { id: "4h", label: "4 giờ", hours: 4 },
  { id: "8h", label: "8 giờ", hours: 8 },
] as const;

/** The fourth answer, offered only on the per-tab layers, and the longest they allow. */
export const END_OF_DAY_OPTION: MuteDurationOption = {
  id: "today",
  label: "Cả ngày",
  hours: null,
};

/**
 * The choices for one layer.
 *
 * A per-tab layer gets exactly four and no free-text box. The upper two get the same three
 * quick answers plus the ability to name a longer stretch — and NOT the end-of-day option,
 * which would be a strictly worse version of typing a number.
 */
export function muteDurationOptions(scope: MuteScope): MuteDurationOption[] {
  if (allowsCustomDuration(scope)) return [...QUICK_MUTE_DURATIONS];
  return [...QUICK_MUTE_DURATIONS, END_OF_DAY_OPTION];
}

/** Longest stretch the custom box accepts — a week, after which it is a decision to re-make. */
export const MAX_CUSTOM_MUTE_HOURS = 168;

/** The end of the reader's own day, in their own timezone. Local midnight, not UTC. */
export function endOfLocalDay(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** When a chosen option runs out. */
export function mutedUntilFor(option: MuteDurationOption, now: Date = new Date()): Date {
  if (option.hours === null) return endOfLocalDay(now);
  return new Date(now.getTime() + option.hours * 60 * 60 * 1000);
}

/** A typed number of hours, bounded. Anything unusable reads as "no duration given". */
export function parseCustomHours(raw: string): number | null {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, MAX_CUSTOM_MUTE_HOURS);
}

// ------------------------------------------------------------------ reading state

/** Only a mute whose end is still ahead of now counts. */
export function isMuteActive(setting: MuteSetting, now: Date = new Date()): boolean {
  return new Date(setting.mutedUntil).getTime() > now.getTime();
}

export type MuteIndex = ReadonlyMap<MuteScope, string>;

/** The settings as a lookup, keeping only those still in force. */
export function toMuteIndex(settings: readonly MuteSetting[], now: Date = new Date()): MuteIndex {
  const index = new Map<MuteScope, string>();
  for (const setting of settings) {
    if (isMuteActive(setting, now)) index.set(setting.scope, setting.mutedUntil);
  }
  return index;
}

export function isScopeMuted(index: MuteIndex, scope: MuteScope, now: Date = new Date()): boolean {
  const until = index.get(scope);
  if (until === undefined) return false;
  return new Date(until).getTime() > now.getTime();
}

/** `còn 2 giờ` — how much silence is left, for the switch that is currently on. */
export function remainingMuteLabel(until: string, now: Date = new Date()): string {
  const ms = new Date(until).getTime() - now.getTime();
  if (ms <= 0) return "đã hết";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `còn ${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `còn ~${hours} giờ`;
  return `còn ~${Math.round(hours / 24)} ngày`;
}

// ------------------------------------------------------------------ the decision

/** The kind of thread an event came from, which decides which tab layer applies. */
export type EventSurface = "direct" | "group" | "project";

/** Everything the decision needs to know about one incoming event. */
export type NotificationEvent = {
  surface: EventSurface;
  /** True when the sender is family to the recipient. */
  isFromFamily: boolean;
  /** True when the recipient was named in the message. Only meaningful in a group. */
  mentionsRecipient: boolean;
};

/** Why an event was let through, or stopped. Returned so the reason can be shown and tested. */
export type MuteDecision = {
  blocked: boolean;
  /** The layer that decided, or null when nothing was muted. */
  decidedBy: MuteScope | null;
  /** Which exception saved it, when one did. */
  exception: "family" | "mention" | null;
};

/**
 * Whether one event should be silenced, read layer by layer from the outside in.
 *
 *   1. AVORA — absolute. No exception, not family, not being named. Someone who silences the
 *      whole app has said "not now" about everything, and an app that decided some of its own
 *      notifications were too important to obey that would make the switch untrustworthy.
 *   2. Tin nhắn — family passes. The people you carry lasting responsibility for are exactly
 *      who a blanket message mute should not cut off.
 *   3. The tab (1-1 / group / project) — family passes; inside a group, being named passes too.
 *      A mention is someone asking you specifically, which is different from the room being
 *      busy, and quietening a busy room should not also hide a direct question.
 *
 * Family is checked before mentions on purpose: it is the broader exception, and in a group
 * where both apply the reason a message got through is the relationship, not the "@".
 */
export function shouldBlockNotification(
  index: MuteIndex,
  event: NotificationEvent,
  now: Date = new Date(),
): MuteDecision {
  // 1. The whole app. Absolute, and checked first so nothing below can soften it.
  if (isScopeMuted(index, "avora", now)) {
    return { blocked: true, decidedBy: "avora", exception: null };
  }

  // 2. All messages. Family is the one relationship that survives it.
  if (isScopeMuted(index, "messages", now)) {
    if (event.isFromFamily) return { blocked: false, decidedBy: "messages", exception: "family" };
    return { blocked: true, decidedBy: "messages", exception: null };
  }

  // 3. The tab this event belongs to.
  const tabScope: MuteScope = event.surface;
  if (isScopeMuted(index, tabScope, now)) {
    if (event.isFromFamily) return { blocked: false, decidedBy: tabScope, exception: "family" };
    // Being named is an exception only where a room can be busy around you.
    if (tabScope === "group" && event.mentionsRecipient) {
      return { blocked: false, decidedBy: tabScope, exception: "mention" };
    }
    return { blocked: true, decidedBy: tabScope, exception: null };
  }

  // 4. Nothing is muted.
  return { blocked: false, decidedBy: null, exception: null };
}

/** Plain-language reason, for a "why did this come through?" line. */
export function describeMuteDecision(decision: MuteDecision): string {
  if (!decision.blocked) {
    if (decision.exception === "family") return "Vẫn thông báo vì người gửi là Gia đình.";
    if (decision.exception === "mention") return "Vẫn thông báo vì bạn được nhắc tên.";
    return "Không có tầng nào đang tắt thông báo.";
  }
  if (decision.decidedBy === "avora") return "Đã tắt toàn bộ AVORA — không có ngoại lệ nào.";
  if (decision.decidedBy === "messages") return "Đã tắt thông báo tin nhắn.";
  return `Đã tắt thông báo ${MUTE_SCOPE_LABELS[decision.decidedBy ?? "group"]}.`;
}

// ------------------------------------------------------------------ data access

function fail(code: string | undefined, message: string): Error {
  console.error(`[mute] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("mute_settings_scope_valid"))
    return new Error("Không tắt được thông báo cho phần này.");
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không lưu được thiết lập thông báo. Vui lòng thử lại.");
}

type MuteRow = { scope: string; muted_until: string };

const MUTE_SCOPES: readonly MuteScope[] = ["avora", "messages", "direct", "group", "project"];

function isMuteScope(value: string): value is MuteScope {
  return (MUTE_SCOPES as readonly string[]).includes(value);
}

/** The viewer's own mutes. RLS returns nobody else's, so silence stays private. */
export async function fetchMuteSettings(): Promise<MuteSetting[]> {
  const { data, error } = await supabase.from("mute_settings").select("scope, muted_until");
  if (error) throw fail(error.code, error.message);
  return (data ?? [])
    .map((row) => row as MuteRow)
    .filter((row) => isMuteScope(row.scope))
    .map((row) => ({ scope: row.scope as MuteScope, mutedUntil: row.muted_until }));
}

/** Silences one layer until a moment. Re-muting the same layer replaces the old end. */
export async function setMute(
  userId: string,
  scope: MuteScope,
  mutedUntil: Date,
): Promise<void> {
  const { error } = await supabase
    .from("mute_settings")
    .upsert(
      { user_id: userId, scope, muted_until: mutedUntil.toISOString() },
      { onConflict: "user_id,scope" },
    );
  if (error) throw fail(error.code, error.message);
}

/** Turns a layer back on early. Always available: a time limit needs a way back. */
export async function clearMute(scope: MuteScope): Promise<void> {
  const { error } = await supabase.from("mute_settings").delete().eq("scope", scope);
  if (error) throw fail(error.code, error.message);
}
