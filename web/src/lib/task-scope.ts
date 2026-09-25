import { contextTarget } from "@/lib/task-context";
import { isOpenTask, TASK_VIEW_LABELS, type TaskItem, type TaskViewMode } from "@/lib/tasks";

/**
 * The four layers of Connect Hub, in the order they are always shown: my own list, what I owe one
 * person, what I owe a group, and project work. Tab Nhiệm vụ and Avora Space read the same split.
 *
 * Decided from where a task lives, never from a stored label: no conversation is "mine", a direct
 * chat is 1-1, a group is Nhóm — unless a project is attached, either to the chat itself (the
 * project's sub-group) or to the task through the project's task links. That second case covers
 * work agreed in the parent group before the project had its own chat.
 */
export type TaskScope = "personal" | "direct" | "group" | "project";

export const TASK_SCOPES: readonly TaskScope[] = ["personal", "direct", "group", "project"];

export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  personal: "Của tôi",
  direct: "1-1",
  group: "Nhóm",
  project: "Dự án",
};

/** A project as the task list needs it: which one, and its own sub-group chat. */
export type ProjectRef = {
  projectId: string;
  conversationId: string;
  title: string;
};

/** Which tasks and chats belong to a project, read once for the whole list. */
export type ProjectIndex = {
  byTask: ReadonlyMap<string, ProjectRef>;
  byConversation: ReadonlyMap<string, ProjectRef>;
};

export const EMPTY_PROJECT_INDEX: ProjectIndex = { byTask: new Map(), byConversation: new Map() };

/** Builds the index from the visible projects and project–task links. A link to an unseen project is ignored. */
export function buildProjectIndex(
  projects: readonly { id: string; conversationId: string; title: string }[],
  links: readonly { taskId: string; projectId: string }[],
): ProjectIndex {
  const byId = new Map<string, ProjectRef>();
  const byConversation = new Map<string, ProjectRef>();
  for (const project of projects) {
    const ref: ProjectRef = { projectId: project.id, conversationId: project.conversationId, title: project.title };
    byId.set(project.id, ref);
    byConversation.set(project.conversationId, ref);
  }
  const byTask = new Map<string, ProjectRef>();
  for (const link of links) {
    const ref = byId.get(link.projectId);
    if (ref !== undefined) byTask.set(link.taskId, ref);
  }
  return { byTask, byConversation };
}

/** The project a task belongs to, if any. A task with no conversation is always the viewer's own. */
export function projectOfTask(task: TaskItem, index: ProjectIndex): ProjectRef | null {
  if (task.conversationId === null) return null;
  return index.byTask.get(task.id) ?? index.byConversation.get(task.conversationId) ?? null;
}

/**
 * Where "Xem trong ngữ cảnh" goes. Project work opens the project's own sub-group chat, even when
 * it was agreed in the parent group; everything else returns to the chat (and message) it came from.
 */
export function taskContextTarget(
  task: TaskItem,
  index: ProjectIndex,
): { conversationId: string; messageId: string | null } | null {
  const project = projectOfTask(task, index);
  if (project !== null) return { conversationId: project.conversationId, messageId: null };
  return contextTarget(task.contextSnapshot, task.conversationId);
}

/** What each block is counting, said plainly under its number. */
export const TASK_SCOPE_NOTES: Record<TaskScope, string> = {
  personal: "Việc bạn tự đặt ra cho mình",
  direct: "Việc giữa bạn và một người",
  group: "Việc trong các nhóm của bạn",
  project: "Việc thuộc các dự án của bạn",
};

/** How a scope appears in the address bar. Vietnamese, like every other route in AVORA. */
export const TASK_SCOPE_PARAM = "nhom";

/**
 * Which reading of the list to open on, when the link has an opinion about it.
 *
 * Arriving from a dashboard block is arriving with a question already in mind — "what do I owe
 * this person" — so the link says which tab answers it. Opening Nhiệm vụ from the sidebar
 * carries no such question and keeps whatever reading the person chose for themselves.
 */
export const TASK_VIEW_PARAM = "view";

const SCOPE_SLUGS: Record<TaskScope, string> = {
  personal: "ca-nhan",
  direct: "1-1",
  group: "nhom",
  project: "du-an",
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

/**
 * Reads a requested reading out of the address bar.
 *
 * Anything unrecognised means "no opinion", not an error: a stale bookmark or a hand-edited
 * address must fall back to the person's own default rather than leave the screen on a tab
 * that cannot render.
 */
export function parseTaskView(raw: string | null | undefined): TaskViewMode | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const modes = Object.keys(TASK_VIEW_LABELS) as TaskViewMode[];
  return modes.find((mode) => mode === raw) ?? null;
}

export function scopeOfTask(task: TaskItem, index: ProjectIndex = EMPTY_PROJECT_INDEX): TaskScope {
  if (task.type === "personal" || task.conversationId === null) return "personal";
  if (projectOfTask(task, index) !== null) return "project";
  return task.type === "group-shared" ? "group" : "direct";
}

/** A null scope is "everything", not "nothing" — the unfiltered list is the normal one. */
export function filterByScope(
  tasks: readonly TaskItem[],
  scope: TaskScope | null,
  index: ProjectIndex = EMPTY_PROJECT_INDEX,
): TaskItem[] {
  if (scope === null) return [...tasks];
  return tasks.filter((task) => scopeOfTask(task, index) === scope);
}

/** Splits anything carrying a task into the four layers, in Connect Hub order, dropping empty layers. */
export function groupByScope<T>(
  items: readonly T[],
  taskOf: (item: T) => TaskItem,
  index: ProjectIndex = EMPTY_PROJECT_INDEX,
): { scope: TaskScope; items: T[] }[] {
  const buckets: Record<TaskScope, T[]> = { personal: [], direct: [], group: [], project: [] };
  for (const item of items) buckets[scopeOfTask(taskOf(item), index)].push(item);
  return TASK_SCOPES.filter((scope) => buckets[scope].length > 0).map((scope) => ({ scope, items: buckets[scope] }));
}

/**
 * How much is still outstanding in each of the four, from this person's point of view.
 * Anything they have binned is left out: a task in the bin is not work they are carrying.
 */
export function openCountsByScope(
  tasks: readonly TaskItem[],
  viewerId: string | undefined,
  index: ProjectIndex = EMPTY_PROJECT_INDEX,
): Record<TaskScope, number> {
  const counts: Record<TaskScope, number> = { personal: 0, direct: 0, group: 0, project: 0 };
  for (const task of tasks) {
    if (!isOpenTask(task, viewerId)) continue;
    counts[scopeOfTask(task, index)] += 1;
  }
  return counts;
}

/**
 * Where a dashboard block leads: Tab Nhiệm vụ, narrowed to that kind of work AND opened on
 * the by-contact reading.
 *
 * The filter alone was not enough. A block labelled "1-1" dropped the person into the deadline
 * timeline, where the grouping that made the block meaningful — who the work is with — is not
 * visible at all, so the screen appeared to have ignored what they clicked.
 */
export function scopeLink(scope: TaskScope): string {
  return `/nhiem-vu?${TASK_SCOPE_PARAM}=${SCOPE_SLUGS[scope]}&${TASK_VIEW_PARAM}=relationship`;
}
