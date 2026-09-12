import { isOpenTask, type TaskItem } from "@/lib/tasks";

/**
 * The three kinds of claim on someone's attention: their own list, what they owe one person,
 * and what they owe a group. This is the split the dashboard counts and the one Tab Nhiệm vụ
 * filters by, so both always mean exactly the same thing.
 */
export type TaskScope = "personal" | "direct" | "group";

export const TASK_SCOPES: readonly TaskScope[] = ["personal", "direct", "group"];

export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  personal: "Cá nhân",
  direct: "1-1",
  group: "Nhóm",
};

/** What each block is counting, said plainly under its number. */
export const TASK_SCOPE_NOTES: Record<TaskScope, string> = {
  personal: "Việc bạn tự đặt ra cho mình",
  direct: "Việc giữa bạn và một người",
  group: "Việc trong các nhóm của bạn",
};

/** How a scope appears in the address bar. Vietnamese, like every other route in AVORA. */
export const TASK_SCOPE_PARAM = "nhom";

const SCOPE_SLUGS: Record<TaskScope, string> = {
  personal: "ca-nhan",
  direct: "1-1",
  group: "nhom",
};

export function scopeSlug(scope: TaskScope): string {
  return SCOPE_SLUGS[scope];
}

/** Reads a scope out of the address bar; anything unrecognised means "no filter". */
export function parseTaskScope(raw: string | null | undefined): TaskScope | null {
  if (raw === null || raw === undefined) return null;
  const match = TASK_SCOPES.find((scope) => SCOPE_SLUGS[scope] === raw);
  return match ?? null;
}

export function scopeOfTask(task: TaskItem): TaskScope {
  if (task.type === "personal") return "personal";
  return task.type === "group-shared" ? "group" : "direct";
}

/** A null scope is "everything", not "nothing" — the unfiltered list is the normal one. */
export function filterByScope(tasks: readonly TaskItem[], scope: TaskScope | null): TaskItem[] {
  if (scope === null) return [...tasks];
  return tasks.filter((task) => scopeOfTask(task) === scope);
}

/**
 * How much is still outstanding in each of the three, from this person's point of view.
 * Anything they have binned is left out: a task in the bin is not work they are carrying.
 */
export function openCountsByScope(
  tasks: readonly TaskItem[],
  viewerId: string | undefined,
): Record<TaskScope, number> {
  const counts: Record<TaskScope, number> = { personal: 0, direct: 0, group: 0 };
  for (const task of tasks) {
    if (!isOpenTask(task, viewerId)) continue;
    counts[scopeOfTask(task)] += 1;
  }
  return counts;
}

/** Where a dashboard block leads: Tab Nhiệm vụ, already narrowed to that kind of work. */
export function scopeLink(scope: TaskScope): string {
  return `/nhiem-vu?${TASK_SCOPE_PARAM}=${SCOPE_SLUGS[scope]}`;
}
