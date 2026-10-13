import type { MuteDecision } from "@/lib/mute";

/**
 * AVORA-114 · 3 — "Vì sao tôi không nghe thấy?": the last 10 incoming messages and what the sound
 * layer decided for each. Kept on this device only (localStorage), never sent anywhere, and it
 * holds no content, no sender, no conversation — only a time and a reason.
 */

export type SoundOutcome =
  | "played"
  | "reading"
  | "muted"
  | "focus"
  | "quiet_reading"
  | "setting_off"
  | "throttled"
  | "locked"
  | "gone"
  | "error";

export type SoundLogEntry = { at: number; outcome: SoundOutcome; detail?: string };

export const SOUND_LOG_KEY = "avora.sound-log";
export const SOUND_LOG_SIZE = 10;
export const SOUND_LOG_EVENT = "avora:sound-log";

/** UI strings for this feature. The app has no i18n layer yet; the English twin is kept beside it. */
export const SOUND_STRINGS = {
  vi: {
    played: "Đã phát",
    reading: "Đang đọc cuộc này",
    muted: "Đã tắt thông báo cuộc/nhóm",
    focus: "Đang ở Chế độ tập trung",
    quiet_reading: "Đang Đọc yên tĩnh",
    setting_off: "Đã tắt âm báo tin nhắn trong Cài đặt",
    throttled: "Phát trong 3 giây trước (gộp)",
    locked: "Chưa mở khoá âm thanh",
    gone: "Tin đã thu hồi hoặc đã biến mất",
    error: "Lỗi",
    banner: "Chạm vào màn hình để bật âm báo.",
    test: "Nghe thử",
    testPlayed: "Đã phát",
    testLocked: "Máy đang chặn âm thanh, chạm lại",
    testMissing: "Không tìm thấy tệp âm thanh",
    testFailed: "Không phát được",
    why: "Vì sao tôi không nghe thấy?",
    whyEmpty: "Chưa có tin nào đến từ khi mở mục này.",
    whyNote: "Chỉ lưu trên máy này, không gửi đi đâu. Không có nội dung hay tên người gửi.",
    silentSwitch: "Nếu điện thoại đang để chế độ im lặng (nút gạt bên hông), bạn có thể không nghe thấy.",
  },
  en: {
    played: "Played",
    reading: "You were reading this chat",
    muted: "Notifications off for this chat/group",
    focus: "Focus mode was on",
    quiet_reading: "Quiet reading was on",
    setting_off: "Message sound is off in Settings",
    throttled: "A sound played in the 3 seconds before (grouped)",
    locked: "Sound not unlocked yet",
    gone: "Message was recalled or had disappeared",
    error: "Error",
    banner: "Tap the screen to turn on sounds.",
    test: "Play test",
    testPlayed: "Played",
    testLocked: "This device is blocking sound, tap again",
    testMissing: "Sound file not found",
    testFailed: "Could not play",
    why: "Why didn't I hear it?",
    whyEmpty: "No message has arrived yet.",
    whyNote: "Kept on this device only, never sent. No content or sender names.",
    silentSwitch: "If the phone is on silent (the side switch), you may not hear it.",
  },
} as const;

export const SOUND_TEXT = SOUND_STRINGS.vi;

export function outcomeLabel(entry: Pick<SoundLogEntry, "outcome" | "detail">): string {
  if (entry.outcome === "error") return `${SOUND_TEXT.error}: ${entry.detail ?? "unknown"}`;
  return SOUND_TEXT[entry.outcome];
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private mode with storage disabled: the list simply stays empty.
    return null;
  }
}

export function readSoundLog(): SoundLogEntry[] {
  const raw = storage()?.getItem(SOUND_LOG_KEY);
  if (raw === null || raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SoundLogEntry => typeof item === "object" && item !== null && typeof (item as SoundLogEntry).at === "number" && typeof (item as SoundLogEntry).outcome === "string",
    );
  } catch {
    return [];
  }
}

/** Newest first, at most 10. */
export function recordSoundOutcome(entry: SoundLogEntry): void {
  const next = [entry, ...readSoundLog()].slice(0, SOUND_LOG_SIZE);
  try {
    storage()?.setItem(SOUND_LOG_KEY, JSON.stringify(next));
  } catch {
    // Quota full: the diagnostics list is a convenience, losing one line is acceptable.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SOUND_LOG_EVENT));
}

/** Which outcome a mute decision maps to, when it blocked. */
export function mutedOutcome(decision: MuteDecision): "focus" | "muted" {
  return decision.decidedBy === "focus" ? "focus" : "muted";
}
