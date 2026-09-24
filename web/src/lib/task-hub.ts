import { localDayOf } from "@/lib/space-blocks";
import type { TaskParticipant } from "@/lib/task-collab";
import { isDeletedFor, isOpenTask, isTaskGone, taskPriority, type TaskItem } from "@/lib/tasks";

/**
 * Task Hub — the ten places Nhiệm vụ can be read from.
 *
 * Each is a lens over the same tasks, never a second copy of them. Order, words and the one-line
 * description of every section live here so the nav, the page and the tests all read one list.
 */
export type TaskHubSectionId =
  | "my_day"
  | "tasks"
  | "events"
  | "upcoming"
  | "calendar"
  | "overdue"
  | "invitations"
  | "drafts"
  | "completed"
  | "trash";

export type TaskHubSection = {
  id: TaskHubSectionId;
  /** What the address bar says: `/nhiem-vu?muc=<slug>`. */
  slug: string;
  label: string;
  description: string;
  empty: string;
  /** Shown but not built yet. */
  isComingSoon?: boolean;
};

export const TASK_HUB_PARAM = "muc";

export const TASK_HUB_SECTIONS: readonly TaskHubSection[] = [
  { id: "my_day", slug: "hom-nay", label: "My Day", description: "Việc và cuộc hẹn của riêng hôm nay — chạm một dòng để mở.", empty: "Hôm nay nhẹ nhàng, chưa có gì cần làm." },
  { id: "tasks", slug: "viec", label: "Tasks", description: "Mọi việc đang mở, đọc theo cách bạn quen.", empty: "Chưa có việc nào đang mở." },
  { id: "events", slug: "su-kien", label: "Events", description: "Những việc cần bạn có mặt, xếp theo giờ bắt đầu.", empty: "Chưa có sự kiện nào sắp tới." },
  { id: "upcoming", slug: "sap-toi", label: "Upcoming", description: "Bảy ngày tới trên một trang: khối là sự kiện, vạch là hạn chót.", empty: "Bảy ngày tới đang trống." },
  { id: "calendar", slug: "lich", label: "Lịch", description: "Ngày, tuần, tháng, năm — chỉ để xem. Chạm một việc để về đúng chỗ nó được bàn.", empty: "Khoảng này chưa có việc hay sự kiện nào." },
  { id: "overdue", slug: "qua-han", label: "Overdue", description: "Việc đã qua hạn — xem lại khi bạn sẵn sàng.", empty: "Không có việc nào trễ hạn." },
  { id: "invitations", slug: "loi-moi", label: "Invitations", description: "Có người mời bạn cùng tham gia — nhận hay từ chối đều được.", empty: "Không có lời mời nào đang chờ." },
  { id: "drafts", slug: "nhap", label: "Drafts", description: "Việc bạn viết dở, chưa giao cho ai.", empty: "Phần nháp sắp có.", isComingSoon: true },
  { id: "completed", slug: "hoan-thanh", label: "Completed", description: "Việc đã xong, mới nhất lên trước.", empty: "Chưa có việc nào hoàn thành." },
  { id: "trash", slug: "thung-rac", label: "Trash", description: "Việc bạn đã xoá — chạm để khôi phục.", empty: "Thùng rác trống." },
];

export function sectionBySlug(slug: string | null): TaskHubSection {
  return TASK_HUB_SECTIONS.find((section) => section.slug === slug) ?? TASK_HUB_SECTIONS[1];
}

function kept(tasks: readonly TaskItem[], userId: string | undefined): TaskItem[] {
  return tasks.filter((task) => !isTaskGone(task) && !isDeletedFor(task, userId));
}

function byStart(a: TaskItem, b: TaskItem): number {
  return (a.startAt ?? "").localeCompare(b.startAt ?? "");
}

/** The tasks a list-style section shows. `tasks` and `upcoming` are drawn by their own views. */
export function tasksForSection(
  id: TaskHubSectionId,
  tasks: readonly TaskItem[],
  userId: string | undefined,
  today: string,
): TaskItem[] {
  const live = kept(tasks, userId);
  switch (id) {
    case "my_day":
      return live.filter(
        (task) =>
          isOpenTask(task, userId) &&
          (task.deadline === today ||
            (task.requiresPresence && task.startAt !== null && localDayOf(task.startAt) === today)),
      );
    case "events":
      return live
        .filter((task) => isOpenTask(task, userId) && task.requiresPresence && task.startAt !== null && localDayOf(task.startAt) >= today)
        .sort(byStart);
    case "overdue":
      return live.filter((task) => isOpenTask(task, userId) && taskPriority(task, today) === "overdue");
    case "completed":
      return live
        .filter((task) => task.status === "done")
        .sort((a, b) => (b.completedConfirmedAt ?? b.doneAt ?? "").localeCompare(a.completedConfirmedAt ?? a.doneAt ?? ""));
    case "trash":
      return tasks.filter((task) => !isTaskGone(task) && isDeletedFor(task, userId));
    default:
      return [];
  }
}

// ------------------------------------------------------------------ calendar projection

/**
 * One entry on the calendar. The calendar owns no data: every entry is projected from a task.
 * An Event (`requiresPresence`) is a BLOCK spanning its start and end; any other task is a
 * MARKER on its deadline day.
 */
export type CalendarEntry =
  | { kind: "block"; task: TaskItem; day: string; startAt: string; endAt: string | null }
  | { kind: "marker"; task: TaskItem; day: string; time: string | null };

export type CalendarDay = { day: string; entries: CalendarEntry[] };

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/**
 * Upcoming reads open work only. Lịch also draws what already closed (`includeDone`), dimmed —
 * a calendar with last week's finished work erased would misreport what those days held.
 * Skipped work is never drawn: it was declined, not done.
 */
export function calendarProjection(
  tasks: readonly TaskItem[],
  userId: string | undefined,
  fromDay: string,
  days: number = 7,
  options: { includeDone?: boolean } = {},
): CalendarDay[] {
  const range: CalendarDay[] = Array.from({ length: days }, (_, index) => ({ day: addDays(fromDay, index), entries: [] }));
  const index = new Map<string, CalendarDay>(range.map((entry) => [entry.day, entry]));

  for (const task of kept(tasks, userId)) {
    const drawable = isOpenTask(task, userId) || (options.includeDone === true && task.status === "done");
    if (!drawable) continue;
    if (task.requiresPresence && task.startAt !== null) {
      const slot = index.get(localDayOf(task.startAt));
      if (slot !== undefined) slot.entries.push({ kind: "block", task, day: slot.day, startAt: task.startAt, endAt: task.endAt });
      continue;
    }
    if (task.deadline === null) continue;
    const slot = index.get(task.deadline);
    if (slot !== undefined) slot.entries.push({ kind: "marker", task, day: slot.day, time: task.deadlineTime });
  }

  for (const slot of range) {
    slot.entries.sort((a, b) => {
      const at = (entry: CalendarEntry): string =>
        entry.kind === "block" ? new Date(entry.startAt).toTimeString().slice(0, 5) : entry.time ?? "99:99";
      return at(a).localeCompare(at(b));
    });
  }
  return range;
}

/** Invitations waiting on the viewer, joined to the task they are for. */
export function invitationRows(
  participants: readonly TaskParticipant[],
  tasks: readonly TaskItem[],
  userId: string | undefined,
): { participant: TaskParticipant; task: TaskItem | null }[] {
  const byId = new Map<string, TaskItem>(tasks.map((task) => [task.id, task]));
  return participants
    .filter((row) => row.userId === userId && row.status === "pending")
    .map((participant) => ({ participant, task: byId.get(participant.taskId) ?? null }));
}
