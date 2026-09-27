import { sortGroupMembers, type GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import { classifyProjectTask, type ProjectTaskKind } from "@/lib/task-scope";
import { isPending, type TaskSuggestion } from "@/lib/task-suggestions";
import { isSharedTask, type TaskItem } from "@/lib/tasks";

/**
 * One line of a project's (or group's) task list (AVORA-39 / Phần 1 · Nhóm D): real work,
 * planned under a Hạng mục or raised along the way, or a suggestion still waiting to be taken.
 */
export type TaskListEntry =
  | { kind: "planned"; id: string; task: TaskItem; recordId: string }
  | { kind: "adhoc"; id: string; task: TaskItem }
  | { kind: "pending"; id: string; suggestion: TaskSuggestion };

/**
 * The union the list reads, deduplicated by id:
 * 1. shared tasks agreed in this chat;
 * 2. (project chat only) tasks linked to this project — including those agreed in the parent group;
 * 3. suggestions still pending in this chat.
 *
 * Only what the viewer can already read comes in: nothing here widens access, and nothing counts
 * what was left out (ADR-014).
 */
export function buildTaskListEntries(input: {
  conversationId: string;
  projectId: string | null;
  tasks: readonly TaskItem[];
  projectLinks: readonly { taskId: string; projectId: string; recordId: string | null }[];
  recordTaskLinks: readonly { taskId: string; recordId: string }[];
  suggestions: readonly TaskSuggestion[];
}): TaskListEntry[] {
  const projectRecordByTask = new Map<string, string | null>();
  if (input.projectId !== null) {
    for (const link of input.projectLinks) {
      if (link.projectId === input.projectId) projectRecordByTask.set(link.taskId, link.recordId);
    }
  }
  const tableRecordByTask = new Map<string, string>();
  for (const link of input.recordTaskLinks) tableRecordByTask.set(link.taskId, link.recordId);

  const seen = new Set<string>();
  const entries: TaskListEntry[] = [];
  for (const task of input.tasks) {
    if (seen.has(task.id) || !isSharedTask(task)) continue;
    const inChat = task.conversationId === input.conversationId;
    const inProject = projectRecordByTask.has(task.id);
    if (!inChat && !inProject) continue;
    seen.add(task.id);
    const recordId = projectRecordByTask.get(task.id) ?? tableRecordByTask.get(task.id) ?? null;
    if (classifyProjectTask(recordId) === "planned" && recordId !== null) {
      entries.push({ kind: "planned", id: task.id, task, recordId });
    } else {
      entries.push({ kind: "adhoc", id: task.id, task });
    }
  }
  for (const suggestion of input.suggestions) {
    if (suggestion.conversationId !== input.conversationId || !isPending(suggestion) || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    entries.push({ kind: "pending", id: suggestion.id, suggestion });
  }
  return entries;
}

/** Who a line is with: the assignee of a task, or the person a suggestion asks. */
export function entryAssigneeId(entry: TaskListEntry): string | null {
  return entry.kind === "pending" ? entry.suggestion.assigneeId : entry.task.assigneeId;
}

/** The section key an entry falls under in the assignee chips — same keys as `groupTasksByAssignee`. */
export function entryAssigneeKey(entry: TaskListEntry, members: readonly GroupMember[]): string {
  const id = entryAssigneeId(entry);
  return id !== null && members.some((member) => member.userId === id) ? id : "unassigned";
}

export function countByKind(entries: readonly TaskListEntry[]): Record<ProjectTaskKind, number> {
  const counts: Record<ProjectTaskKind, number> = { planned: 0, adhoc: 0, pending: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** The assignee chips over any set of entries, ordered like the member list, empty people left out. */
export function assigneeChips(
  entries: readonly TaskListEntry[],
  members: readonly GroupMember[],
  viewerId: string | undefined,
): { key: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entryAssigneeKey(entry, members);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const chips = sortGroupMembers([...members])
    .filter((member) => counts.has(member.userId))
    .map((member) => ({
      key: member.userId,
      name: member.userId === viewerId ? `${memberLabel(member)} (bạn)` : memberLabel(member),
      count: counts.get(member.userId) ?? 0,
    }));
  const unassigned = counts.get("unassigned");
  if (unassigned !== undefined) chips.push({ key: "unassigned", name: "Chưa rõ người đảm trách", count: unassigned });
  return chips;
}

/** Settled work goes to the foot of its section, folded, so the open work reads first. */
export function isSettledEntry(entry: TaskListEntry): boolean {
  return entry.kind !== "pending" && (entry.task.status === "done" || entry.task.status === "skipped");
}

/** One member and everything currently on their plate in this group. */
export type MemberTasks = {
  key: string;
  name: string;
  tasks: TaskItem[];
};

/**
 * Groups the room's work by the person carrying it.
 *
 * The order follows the member list — owner, admin, then members — so the list reads the same
 * way the group does. A task whose assignee is nobody, or somebody who has since left, is
 * gathered under a heading of its own rather than being silently attributed to a member.
 * People with nothing on their plate are left out entirely: an empty heading says nothing.
 */
export function groupTasksByAssignee(
  tasks: readonly TaskItem[],
  members: readonly GroupMember[],
  viewerId: string | undefined,
): MemberTasks[] {
  const ordered = sortGroupMembers([...members]);
  const sections: MemberTasks[] = ordered.map((member) => ({
    key: member.userId,
    name: member.userId === viewerId ? `${memberLabel(member)} (bạn)` : memberLabel(member),
    tasks: tasks.filter((task) => task.assigneeId === member.userId),
  }));

  const unassigned = tasks.filter(
    (task) => task.assigneeId === null || !members.some((member) => member.userId === task.assigneeId),
  );
  if (unassigned.length > 0) {
    sections.push({ key: "unassigned", name: "Chưa rõ người đảm trách", tasks: unassigned });
  }

  return sections.filter((section) => section.tasks.length > 0);
}

/**
 * Applies the "only this person" pick to the grouped sections.
 *
 * A pick names a section key, so it follows the same grouping the list itself shows: picking
 * a member keeps exactly their section, picking the unassigned pile keeps that pile. Null is
 * the resting state — everything. A member whose last task moved on stops matching, and the
 * empty answer is the caller's cue to say so in words rather than draw a blank panel.
 */
export function filterMemberSections(
  sections: readonly MemberTasks[],
  selectedKey: string | null,
): MemberTasks[] {
  if (selectedKey === null) return [...sections];
  return sections.filter((section) => section.key === selectedKey);
}
