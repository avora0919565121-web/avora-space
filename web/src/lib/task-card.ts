import type { RecurrencePattern, TaskRecurrence } from "@/lib/task-schedule";

/**
 * AVORA-104 · PHẦN 2 (ADR-075) — Một thẻ nhiệm vụ. The pure half: which groups fold, what a folded
 * group says, the days the in-card calendar offers, and the words of each row. No React, no network.
 */

/** The five groups that fold; Tên việc, Ghi chú and the footer never do. */
export type CardGroupId = "steps" | "time" | "presence" | "people" | "files";

export const CARD_GROUPS: readonly { id: CardGroupId; title: string }[] = [
  { id: "steps", title: "Các bước" },
  { id: "time", title: "Thời gian" },
  { id: "presence", title: "Có mặt" },
  { id: "people", title: "Người" },
  { id: "files", title: "Tệp" },
];

/** The ten rows, in the one order every card uses (2.2 · 2). Read by the static test too. */
export const CARD_ROW_ORDER: readonly string[] = [
  "title",
  "steps",
  "my-day",
  "reminder",
  "when",
  "repeat",
  "presence",
  "assign",
  "files",
  "note",
];

const GROUPS_KEY = "avora-task-card-groups";

/** Folded groups, remembered on this device (2.2 · 3). Everything open by default. */
export function readFoldedGroups(): Set<CardGroupId> {
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const known = new Set<string>(CARD_GROUPS.map((group) => group.id));
    return new Set(parsed.filter((id): id is CardGroupId => typeof id === "string" && known.has(id)));
  } catch {
    return new Set();
  }
}

export function writeFoldedGroups(folded: ReadonlySet<CardGroupId>): void {
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify([...folded]));
  } catch {
    // Private mode: the fold just isn't remembered.
  }
}

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, days: number): string {
  const date = parseDay(day) ?? new Date();
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** `T5, 09/10` — how every row writes a day. */
export function cardDay(day: string | null | undefined): string | null {
  if (day === null || day === undefined || day === "") return null;
  const date = parseDay(day);
  if (date === null) return null;
  return `${WEEKDAY[date.getDay()]}, ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** `T5, 09/10 · 10:00–11:00` (end only when there is one). */
export function whenLine(day: string | null, time: string | null, endTime: string | null = null): string | null {
  const label = cardDay(day);
  if (label === null) return null;
  if (time === null || time === "") return label;
  return `${label} · ${time}${endTime !== null && endTime !== "" ? `–${endTime}` : ""}`;
}

/** The chips over the calendar: Hôm nay · Ngày mai · Tuần sau (next Monday). */
export function quickDays(today: string): { id: string; label: string; day: string }[] {
  const date = parseDay(today) ?? new Date();
  const toMonday = ((8 - date.getDay()) % 7) || 7;
  return [
    { id: "today", label: "Hôm nay", day: today },
    { id: "tomorrow", label: "Ngày mai", day: addDays(today, 1) },
    { id: "next-week", label: "Tuần sau", day: addDays(today, toMonday) },
  ];
}

/** A month as Monday-first weeks; days outside the month are null. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0, 12).getDate();
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null)];
  for (let day = 1; day <= count; day += 1) cells.push(isoDay(new Date(year, month, day, 12)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function monthTitle(year: number, month: number): string {
  return `Tháng ${month + 1}, ${year}`;
}

/** Five-minute marks, 24 h (2.2 · 6). */
export const CARD_HOURS: readonly string[] = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
export const CARD_MINUTES: readonly string[] = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

/** `HH:MM` → minutes, or null. */
export function minutesOf(time: string | null | undefined): number | null {
  if (time === null || time === undefined) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Local day + `HH:MM` → ISO instant. */
export function localInstant(day: string, time: string): string | null {
  const date = new Date(`${day}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO instant → local `{ day, time }`. */
export function localParts(iso: string | null | undefined): { day: string; time: string } | null {
  if (iso === null || iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: isoDay(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

/** The repeat choices in the card's own words (2.2 · 2, row 6). */
export const CARD_REPEATS: readonly { id: TaskRecurrence; label: string }[] = [
  { id: "none", label: "Không lặp" },
  { id: "daily", label: "Hằng ngày" },
  { id: "weekdays", label: "Ngày làm việc" },
  { id: "weekly", label: "Hằng tuần" },
  { id: "monthly", label: "Hằng tháng" },
  { id: "custom", label: "Tuỳ chỉnh" },
];

const UNIT: Record<RecurrencePattern["frequency"], string> = { daily: "ngày", weekly: "tuần", monthly: "tháng" };

export function repeatLine(recurrence: TaskRecurrence, pattern: RecurrencePattern | null): string | null {
  if (recurrence === "none") return null;
  if (recurrence === "custom") return pattern === null ? "Tuỳ chỉnh" : `Mỗi ${pattern.interval} ${UNIT[pattern.frequency]}`;
  return CARD_REPEATS.find((entry) => entry.id === recurrence)?.label ?? null;
}

/** `1/2` for Các bước, or null with no steps. */
export function stepsLine(done: number, total: number): string | null {
  return total === 0 ? null : `${done}/${total}`;
}

/** `Tạo 08/10 bởi bạn · từ Hạng mục` — the footer line. */
export function footerLine(createdAt: string, creatorName: string, source: string | null): string {
  const date = new Date(createdAt);
  const day = Number.isNaN(date.getTime())
    ? ""
    : `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `Tạo ${day} bởi ${creatorName}${source !== null ? ` · ${source}` : ""}`;
}

/** What the corner says while a field is written (2.2 · 5). */
export type SaveState = "idle" | "saving" | "saved" | "error";

export function saveLabel(state: SaveState): string | null {
  if (state === "saving") return "Đang lưu…";
  if (state === "saved") return "Đã lưu ✓";
  if (state === "error") return "Chưa lưu được";
  return null;
}

/** Minutes a reminder sits before the deadline, or null when it is not before it (the trigger only carries offsets). */
export function reminderOffset(reminderIso: string, deadlineIso: string | null): number | null {
  if (deadlineIso === null) return null;
  const diff = Math.round((new Date(deadlineIso).getTime() - new Date(reminderIso).getTime()) / 60_000);
  return diff >= 0 ? diff : null;
}
