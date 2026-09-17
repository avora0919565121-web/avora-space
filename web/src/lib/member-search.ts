import type { GroupMember } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";

/**
 * Vietnamese typed without diacritics still has to find the person.
 *
 * Nobody reaches for the tone keys while searching a name they already know, so "hoa" must
 * match "Hoà" and "dung" must match "Dũng". Unicode decomposition strips the marks; đ/Đ is
 * a separate letter rather than a marked d, so it is folded by hand.
 */
export function foldVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** How a member is named in the picker: their display name, else their email handle. */
export function memberLabel(member: GroupMember): string {
  return peerLabel(member.displayName, member.email);
}

/**
 * Whether a member answers to what has been typed. Both the name and the full email are
 * searched, because in a work group people are often looked up by address.
 */
export function memberMatchesQuery(member: GroupMember, query: string): boolean {
  const needle = foldVietnamese(query);
  if (needle === "") return true;
  const haystacks = [memberLabel(member), member.displayName ?? "", member.email ?? ""];
  return haystacks.some((value) => foldVietnamese(value).includes(needle));
}

/**
 * The suggestion list under the assignee box: members matching what is typed, minus the
 * people already chosen.
 *
 * The author is left out by default, because a suggestion is something you ask of someone
 * else. `allowSelf` is how a group says otherwise: volunteering for work the group just
 * discussed is not a request anybody has to answer, and refusing it forced people to make a
 * detached personal task that no longer remembered the conversation it came from.
 */
export function searchAssignees(
  members: readonly GroupMember[],
  query: string,
  options: {
    excludeUserIds: readonly string[];
    selfId?: string | undefined;
    allowSelf?: boolean;
  },
): GroupMember[] {
  return members
    .filter((member) => options.allowSelf === true || member.userId !== options.selfId)
    .filter((member) => !options.excludeUserIds.includes(member.userId))
    .filter((member) => memberMatchesQuery(member, query));
}

/** Vietnamese plural-free phrasing for how many people a task is about to be given to. */
export function assignSummary(count: number): string {
  if (count === 0) return "Chưa chọn ai";
  if (count === 1) return "Giao cho 1 người";
  return `Giao cho ${count} người — tạo ${count} nhiệm vụ riêng`;
}
