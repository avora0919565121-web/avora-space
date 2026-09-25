import { isOpenTask, taskPriority, type TaskItem } from "@/lib/tasks";

/**
 * The day, said the way someone would read it aloud. Beside the greeting it answers the
 * quietest question a person opens an app with — which day is this — without a calendar.
 */
const WEEKDAYS: readonly string[] = [
  "Chủ nhật",
  "Thứ hai",
  "Thứ ba",
  "Thứ tư",
  "Thứ năm",
  "Thứ sáu",
  "Thứ bảy",
];

export function spaceDateLabel(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  return `${weekday}, ${date.getDate()} thg ${date.getMonth() + 1}`;
}

/**
 * The three numbers Avora Space opens with.
 *
 * They are a PARTITION of everything still open, not three interesting statistics: late,
 * due today, and everything still ahead. So the three always add up to the total the sentence
 * above them states, and no task is counted twice or left out. A triple where "overdue" and
 * "waiting on you" overlapped would make the page argue with itself — two numbers describing
 * the same task, and a sum that means nothing.
 *
 * Undated work counts as ahead: it is genuinely not late, and calling it late would punish
 * someone for writing something down without committing to a day.
 */
export type TaskPulse = {
  overdue: number;
  today: number;
  ahead: number;
  total: number;
};

export function taskPulse(
  tasks: readonly TaskItem[],
  userId: string | undefined,
  today: string,
): TaskPulse {
  const pulse: TaskPulse = { overdue: 0, today: 0, ahead: 0, total: 0 };
  for (const task of tasks) {
    if (!isOpenTask(task, userId)) continue;
    pulse.total += 1;
    if (taskPriority(task, today) === "overdue") pulse.overdue += 1;
    else if (task.deadline === today) pulse.today += 1;
    else pulse.ahead += 1;
  }
  return pulse;
}

/** What each number is counting, in the order the strip reads. */
export const PULSE_LABELS: readonly { key: "overdue" | "today" | "ahead"; label: string }[] = [
  { key: "overdue", label: "Quá hạn" },
  { key: "today", label: "Hôm nay" },
  { key: "ahead", label: "Sắp tới" },
] as const;

/**
 * Where each number leads: the Nhiệm vụ section of the same name. Slugs, not ids, because the
 * address bar is what a link carries (`/nhiem-vu?muc=<slug>`, the same list the nav reads).
 */
export const PULSE_SECTION_SLUGS: Readonly<Record<"overdue" | "today" | "ahead", string>> = {
  overdue: "qua-han",
  today: "hom-nay",
  ahead: "sap-toi",
};

/** The link behind one number of the strip. */
export function pulseHref(key: "overdue" | "today" | "ahead"): string {
  return `/nhiem-vu?muc=${PULSE_SECTION_SLUGS[key]}`;
}

/**
 * The one sentence under the three numbers.
 *
 * It names the single most pressing fact rather than repeating the strip in words: what is
 * late if anything is, else what is due today, else how much is merely scheduled — and an
 * empty day is said as rest, not as zero.
 */
export function pulseSentence(pulse: TaskPulse): string {
  if (pulse.total === 0) return "Không còn việc nào đang chờ. Nghỉ tay một chút nhé.";
  if (pulse.overdue > 0)
    return `${pulse.total} việc đang chờ, trong đó ${pulse.overdue} việc đã quá hạn.`;
  if (pulse.today > 0) return `${pulse.total} việc đang chờ, ${pulse.today} việc đến hạn hôm nay.`;
  return `${pulse.total} việc đang chờ, chưa có việc nào tới hạn hôm nay.`;
}
