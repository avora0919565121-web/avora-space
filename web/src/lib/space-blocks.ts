import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";
import type { TaskReminder } from "@/lib/task-reminders";
import { isOpenTask, taskPriority, type TaskItem } from "@/lib/tasks";

/**
 * Avora Space, block by block.
 *
 * The order is data, not markup: the screen walks `SPACE_BLOCK_ORDER` and renders whatever each
 * id names, so moving a block is a one-line change here rather than a JSX reshuffle. Every
 * block's words — its title, the one line saying what it holds, the hint on what tapping does,
 * and what it says when empty — live beside it for the same reason.
 *
 * Two blocks disappear when they have nothing to say (planning, invitations): a standing
 * "0 lời mời" would be a permanent line of noise for everyone who is never invited to anything.
 * The rest stay and say their empty state out loud, because "nothing today" is itself news.
 */
export type SpaceBlockId =
  | "greeting"
  | "attention"
  | "reminders"
  | "planning"
  | "invitations"
  | "communication";

export const SPACE_BLOCK_ORDER: readonly SpaceBlockId[] = [
  "greeting",
  "attention",
  "reminders",
  "planning",
  "invitations",
  "communication",
];

export type SpaceBlockCopy = {
  title: string;
  /** One short line saying what the block holds, in a sharing voice. */
  description: string;
  /** What tapping does. */
  hint: string;
  /** Shown when empty. Null means the block hides itself instead. */
  empty: string | null;
};

export const SPACE_BLOCK_COPY: Readonly<Record<SpaceBlockId, SpaceBlockCopy>> = {
  greeting: {
    title: "Góc suy gẫm",
    description: "Một câu cho ngày hôm nay, và chỗ để bạn viết lại điều nó gợi ra.",
    hint: "Chạm “Viết lời bình” để lưu vào Nhật ký — chỉ bạn đọc được.",
    empty: null,
  },
  attention: {
    title: "Cần chú ý hôm nay",
    description: "Việc đến hạn hôm nay, việc đã trễ, và những cuộc hẹn cần bạn có mặt.",
    hint: "Chạm một dòng để mở việc đó.",
    empty: "Chưa có gì cần làm hôm nay.",
  },
  reminders: {
    title: "Nhắc nhở sắp tới",
    description: "Những lời nhắc bạn đã đặt trong 7 ngày tới.",
    hint: "Chạm để xem việc được nhắc.",
    empty: "Không có nhắc nhở nào sắp tới.",
  },
  planning: {
    title: "Góc hoạch định",
    description: "Các hạng mục trong Kế hoạch bạn hẹn xem lại đã tới lúc.",
    hint: "Chạm tên bảng để mở thẳng bảng đó.",
    empty: null,
  },
  invitations: {
    title: "Lời mời đang chờ",
    description: "Có người mời bạn cùng tham gia một việc.",
    hint: "Chạm để xem và trả lời.",
    empty: null,
  },
  communication: {
    title: "Giao tiếp",
    description: "Những cuộc trò chuyện đang có tin bạn chưa đọc.",
    hint: "Chạm để mở Tin nhắn.",
    empty: null,
  },
};

// ------------------------------------------------------------------ block 2

export type AttentionKind = "overdue" | "today" | "event";

export type AttentionItem = {
  task: TaskItem;
  kind: AttentionKind;
};

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export function localDayOf(iso: string): string {
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * What needs attention today: late work first, then work due today, then today's events.
 *
 * An event is a task that asks you to be somewhere (`requiresPresence`) and starts today; it is
 * listed once, as an event, even if its deadline is also today — one row per thing to do.
 */
export function attentionItems(
  tasks: readonly TaskItem[],
  userId: string | undefined,
  today: string,
): AttentionItem[] {
  const overdue: AttentionItem[] = [];
  const dueToday: AttentionItem[] = [];
  const events: AttentionItem[] = [];

  for (const task of tasks) {
    if (!isOpenTask(task, userId)) continue;
    if (task.requiresPresence && task.startAt !== null && localDayOf(task.startAt) === today) {
      events.push({ task, kind: "event" });
      continue;
    }
    if (taskPriority(task, today) === "overdue") overdue.push({ task, kind: "overdue" });
    else if (task.deadline === today) dueToday.push({ task, kind: "today" });
  }

  events.sort((a, b) => (a.task.startAt ?? "").localeCompare(b.task.startAt ?? ""));
  overdue.sort((a, b) => (a.task.deadline ?? "").localeCompare(b.task.deadline ?? ""));
  return [...overdue, ...dueToday, ...events];
}

// ------------------------------------------------------------------ block 3

export type UpcomingReminder = {
  reminder: TaskReminder;
  task: TaskItem;
};

/**
 * Reminders the viewer set that will fire within the next `days` days.
 *
 * Read from the viewer's OWN reminders, never from the task: on shared work each person sets
 * their own nudges, so this block shows what I asked to be told, not what the other side did.
 * A reminder whose task is gone or closed has nothing left to remind about and is dropped.
 */
export function upcomingReminders(
  reminders: readonly TaskReminder[],
  tasks: readonly TaskItem[],
  userId: string | undefined,
  now: Date = new Date(),
  days: number = 7,
): UpcomingReminder[] {
  const byId = new Map<string, TaskItem>(tasks.map((task) => [task.id, task]));
  const start = now.getTime();
  const end = start + days * 24 * 60 * 60_000;
  const upcoming: UpcomingReminder[] = [];

  for (const reminder of reminders) {
    if (reminder.isSent) continue;
    const at = new Date(reminder.at).getTime();
    if (Number.isNaN(at) || at < start || at > end) continue;
    const task = byId.get(reminder.taskId);
    if (task === undefined || !isOpenTask(task, userId)) continue;
    upcoming.push({ reminder, task });
  }

  return upcoming.sort((a, b) => a.reminder.at.localeCompare(b.reminder.at));
}

// ------------------------------------------------------------------ block 4

export type PlanningCount = {
  tableId: string;
  tableName: string;
  count: number;
};

/**
 * Think Hub records whose planning reminder has come due, counted per table.
 *
 * "Due" means at or before the end of the viewer's today: Avora Space is read once in the
 * morning, and a reminder set for 15:00 belongs on that morning's page, not only after 15:00.
 * Tables keep their own arranged order; a deleted table's records are not counted.
 */
export function planningCounts(
  records: readonly ThinkRecord[],
  tables: readonly ThinkTable[],
  now: Date = new Date(),
): PlanningCount[] {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const limit = endOfToday.getTime();

  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.deletedAt !== null || record.remindAt === null) continue;
    const at = new Date(record.remindAt).getTime();
    if (Number.isNaN(at) || at > limit) continue;
    counts.set(record.tableId, (counts.get(record.tableId) ?? 0) + 1);
  }

  return tables
    .filter((table) => table.deletedAt === null && (counts.get(table.id) ?? 0) > 0)
    .map((table) => ({ tableId: table.id, tableName: table.name, count: counts.get(table.id) ?? 0 }));
}

/** "Bảng A: 2 · Bảng B: 4" — the exact line the block shows. */
export function planningSummary(counts: readonly PlanningCount[]): string {
  return counts.map((entry) => `${entry.tableName}: ${entry.count}`).join(" · ");
}

// ------------------------------------------------------------------ visibility

/** Whether a block is shown at all. Only blocks with no empty copy may hide. */
export function isBlockVisible(id: SpaceBlockId, itemCount: number): boolean {
  if (SPACE_BLOCK_COPY[id].empty !== null) return true;
  if (id === "planning" || id === "invitations") return itemCount > 0;
  return true;
}
