import { sortGroupMembers, type GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import type { TaskItem } from "@/lib/tasks";

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
