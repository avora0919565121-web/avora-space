import { supabase } from "@/integrations/supabase/client";

/** Where someone stands in a group. One owner and at most one admin per group. */
export type GroupRole = "owner" | "admin" | "member";

/** An action a viewer may take against one other member, from that viewer's seat. */
export type GroupMemberAction =
  | "remove"
  | "requestRemove"
  | "transferOwnership"
  | "makeAdmin"
  | "revokeAdmin"
  | "directMessage";

export type PendingRemovalRequest = {
  id: string;
  conversationId: string;
  targetUserId: string;
  requestedBy: string;
  createdAt: string | null;
};

/** One row of the group's member list, identity resolved server-side. */
export type GroupMember = {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: GroupRole;
  joinedAt: string;
};

/** The group's identity, from the sidecar table. Null when the conversation is not a group. */
export type GroupMeta = {
  name: string | null;
  ownerId: string;
};

/** The group's active invite link. Null when none was ever created or the last one was revoked. */
export type GroupInvite = {
  token: string;
  createdAt: string | null;
};

/** React Query cache keys for the group info surfaces. */
export const groupKeys = {
  meta: (conversationId: string) => ["group-meta", conversationId] as const,
  members: (conversationId: string) => ["group-members", conversationId] as const,
  removalRequests: (conversationId: string) => ["group-removal-requests", conversationId] as const,
  invite: (conversationId: string) => ["group-invite", conversationId] as const,
};

export const LEAVE_BLOCKED_MESSAGE = "Bạn cần chuyển quyền chủ nhóm trước khi rời";

/** Shown to a member who opens the settings menu, so the rule is visible rather than hidden. */
export const RENAME_BLOCKED_MESSAGE = "Chỉ chủ nhóm mới đổi được tên nhóm";

/** Only the owner rotates or revokes the invite link — the seat that decides who belongs. */
export const INVITE_BLOCKED_MESSAGE = "Chỉ chủ nhóm mới quản lý được liên kết mời";

/**
 * The invite link can only be fetched once we know the viewer's role, and the role comes from
 * the member list. When that list fails the invite panel has nothing to wait for, so it says so
 * instead of spinning forever.
 */
export const INVITE_UNAVAILABLE_MESSAGE =
  "Không tải được liên kết mời vì danh sách thành viên chưa tải được.";

/** The database rejects anything longer; the field stops typing at the same number. */
export const GROUP_NAME_MAX_LENGTH = 120;

/** A group needs a name and at least one other person before it is worth creating. */
export function canCreateGroup(name: string, memberCount: number): boolean {
  return name.trim().length > 0 && memberCount > 0;
}

/** Renaming the room is the owner's alone — the same seat that decides who is in it. */
export function canRenameGroup(viewerRole: GroupRole): boolean {
  return viewerRole === "owner";
}

/** The name as it will be stored: surrounding and repeated whitespace collapsed away. */
export function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Whether the Save button should do anything: a name is needed, it must fit, and it must
 * actually differ from the current one — re-saving the same text is a write with nothing to say.
 */
export function canSubmitGroupRename(nextName: string, currentName: string | null): boolean {
  const normalized = normalizeGroupName(nextName);
  if (normalized.length === 0 || normalized.length > GROUP_NAME_MAX_LENGTH) return false;
  return normalized !== normalizeGroupName(currentName ?? "");
}

/**
 * The buttons a viewer is allowed to see next to one member.
 *
 * This is the single source of truth for the accountability model on the client: an admin never
 * gets a delete button, only the right to ask. The database enforces the same rules, so a UI that
 * drifts from this list produces a rejected call rather than an unauthorised change.
 */
export function memberActionsFor(
  viewerRole: GroupRole,
  targetRole: GroupRole,
  isSelf: boolean,
): GroupMemberAction[] {
  // Nothing is done to yourself from the member list — leaving is its own, separate decision.
  if (isSelf) return [];

  if (viewerRole === "owner") {
    const actions: GroupMemberAction[] = ["remove", "transferOwnership", "directMessage"];
    if (targetRole === "admin") actions.push("revokeAdmin");
    if (targetRole === "member") actions.push("makeAdmin");
    return actions;
  }

  // An admin may raise the question about a plain member, and nothing more.
  if (viewerRole === "admin") {
    return targetRole === "member" ? ["requestRemove", "directMessage"] : ["directMessage"];
  }

  return ["directMessage"];
}

/** Only the owner answers removal requests. */
export function canResolveRemovalRequests(viewerRole: GroupRole): boolean {
  return viewerRole === "owner";
}

/** Rotating or revoking the invite link is the owner's alone; every member may share the link. */
export function canManageGroupInvite(viewerRole: GroupRole): boolean {
  return viewerRole === "owner";
}

/**
 * What the invite panel should render. A React Query that is disabled still reports `isPending`,
 * so a panel that only asks "is it pending?" shows a loading line forever whenever its dependency
 * fails. This maps the real situation instead: a broken member list is a failure, not a wait.
 */
export type InviteSectionState = "loading" | "unavailable" | "error" | "ready";

/**
 * Resolve the invite panel state from the two queries it depends on.
 *
 * The invite query is gated on the viewer's role, which only the member list can supply, so a
 * failed member list must surface as `unavailable` rather than an endless `loading`.
 */
export function resolveInviteSectionState(input: {
  membersFailed: boolean;
  roleKnown: boolean;
  inviteFailed: boolean;
  inviteLoaded: boolean;
}): InviteSectionState {
  if (input.membersFailed) return "unavailable";
  if (input.inviteFailed) return "error";
  if (!input.roleKnown) return "loading";
  return input.inviteLoaded ? "ready" : "loading";
}

/** The full URL a member shares: the invite route carries the secret token. */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/loi-moi/${token}`;
}

/** Owner and admin can see the record of who asked for what; a plain member cannot. */
export function canSeeRemovalRequests(viewerRole: GroupRole): boolean {
  return viewerRole === "owner" || viewerRole === "admin";
}

/**
 * An owner sees the leave button but is stopped in the UI with a plain sentence, rather than
 * being allowed to press it and meet a database error.
 */
export function canLeaveGroup(viewerRole: GroupRole): boolean {
  return viewerRole !== "owner";
}

/** Maps the group RPC exceptions to short Vietnamese messages. */
export function toVietnameseGroupError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (code === "23505" || normalized.includes("one_pending_request_per_target"))
    return "Đã có một đề nghị đang chờ duyệt cho người này.";
  if (normalized.includes("only owner can remove participants directly"))
    return "Chỉ chủ nhóm mới được xoá thành viên. Bạn có thể gửi đề nghị xoá.";
  if (normalized.includes("only admin can request a removal"))
    return "Chỉ quản trị viên mới được gửi đề nghị xoá.";
  if (normalized.includes("can only request removal of a regular member"))
    return "Chỉ có thể đề nghị xoá thành viên thường.";
  if (normalized.includes("only owner can resolve a removal request"))
    return "Chỉ chủ nhóm mới được duyệt đề nghị này.";
  if (normalized.includes("request already resolved")) return "Đề nghị này đã được xử lý.";
  if (normalized.includes("request not found")) return "Không tìm thấy đề nghị này.";
  if (normalized.includes("owner must transfer ownership before leaving")) return LEAVE_BLOCKED_MESSAGE + ".";
  if (normalized.includes("owner cannot remove themselves this way"))
    return "Chủ nhóm cần chuyển quyền trước khi rời nhóm.";
  if (normalized.includes("only current owner can transfer ownership"))
    return "Chỉ chủ nhóm hiện tại mới được chuyển quyền.";
  if (normalized.includes("target must be an existing admin or member"))
    return "Người này không còn trong nhóm.";
  if (normalized.includes("target is not a participant")) return "Người này không còn trong nhóm.";
  if (normalized.includes("you are not a participant")) return "Bạn không còn trong nhóm này.";
  if (normalized.includes("this group already has an admin")) return "Nhóm đã có một quản trị viên.";
  if (normalized.includes("only owner can change admin")) return "Chỉ chủ nhóm mới được đổi quản trị viên.";
  if (normalized.includes("invite link not found")) return "Liên kết mời không còn hiệu lực.";
  if (normalized.includes("only owner can manage the invite link")) return INVITE_BLOCKED_MESSAGE + ".";
  if (normalized.includes("cannot dm yourself")) return "Không thể nhắn riêng với chính mình.";
  if (normalized.includes("related group not found")) return "Không tìm thấy nhóm này.";
  if (normalized.includes("not a group conversation"))
    return "Đây là cuộc trò chuyện trực tiếp, không phải nhóm.";
  if (normalized.includes("avora_group_name_required")) return "Nhóm cần có tên.";
  if (normalized.includes("avora_group_name_max_len"))
    return `Tên nhóm quá dài (tối đa ${GROUP_NAME_MAX_LENGTH} ký tự).`;
  if (normalized.includes("avora_not_group_owner")) return RENAME_BLOCKED_MESSAGE + ".";
  if (normalized.includes("avora_group_not_found")) return "Không tìm thấy nhóm này.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[groups] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseGroupError(code, message));
}

/**
 * Creates a group with the caller as owner and the given users as members.
 * Unknown ids and the caller's own id are ignored server-side, so one stale pick cannot fail
 * the whole creation.
 */
export async function createGroupConversation(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_name: name.trim(),
    p_member_ids: memberIds,
  });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không tạo được nhóm. Thử lại nhé.");
  return data as string;
}

/**
 * Owner only. Renames the group and returns the stored name.
 * Ownership cannot travel with a rename — the only way that moves is
 * {@link transferGroupOwnership}.
 */
export async function renameGroupConversation(conversationId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("rename_group_conversation", {
    p_conversation_id: conversationId,
    p_name: normalizeGroupName(name),
  });
  if (error) throw fail(error.code, error.message);
  return (data as string | null) ?? normalizeGroupName(name);
}

/** Owner only. Removes a member outright. */
export async function removeGroupParticipant(conversationId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_group_participant", {
    target_conversation_id: conversationId,
    target_user_id: targetUserId,
  });
  if (error) throw fail(error.code, error.message);
}

/** Admin only. Puts the question to the owner and returns the request id. */
export async function requestRemoveParticipant(conversationId: string, targetUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("request_remove_participant", {
    target_conversation_id: conversationId,
    target_user_id: targetUserId,
  });
  if (error) throw fail(error.code, error.message);
  return data as string;
}

/** Owner only. Approving removes the member; rejecting leaves them in place. Either way it is signed. */
export async function resolveRemovalRequest(requestId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("resolve_removal_request", {
    target_request_id: requestId,
    approve,
  });
  if (error) throw fail(error.code, error.message);
}

/** Owner only. The old owner becomes a plain member in the same breath. */
export async function transferGroupOwnership(conversationId: string, newOwnerUserId: string): Promise<void> {
  const { error } = await supabase.rpc("transfer_group_ownership", {
    target_conversation_id: conversationId,
    new_owner_user_id: newOwnerUserId,
  });
  if (error) throw fail(error.code, error.message);
}

/** Owner only. Appoints or stands down the group's single admin. */
export async function setGroupAdmin(
  conversationId: string,
  targetUserId: string,
  makeAdmin: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_group_admin", {
    target_conversation_id: conversationId,
    target_user_id: targetUserId,
    make_admin: makeAdmin,
  });
  if (error) throw fail(error.code, error.message);
}

/**
 * Leaves the group. Callers should check {@link canLeaveGroup} first so an owner reads a sentence
 * instead of an error.
 */
export async function leaveGroupConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_group_conversation", {
    target_conversation_id: conversationId,
  });
  if (error) throw fail(error.code, error.message);
}

/**
 * Opens the private thread between the caller and one other member of a group, creating it once.
 * The group's owner has no special access to it.
 */
export async function openGroupDirectMessage(targetUserId: string, groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation_for_group", {
    target_user_id: targetUserId,
    group_id: groupId,
  });
  if (error) throw fail(error.code, error.message);
  return data as string;
}

/** The group sidecar row for a conversation, or null when the conversation is not a group. */
export async function fetchGroupMeta(conversationId: string): Promise<GroupMeta | null> {
  const { data, error } = await supabase
    .from("conversation_groups")
    .select("name, owner_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) throw fail(error.code, error.message);
  if (!data) return null;
  return { name: data.name, ownerId: data.owner_id };
}

/**
 * The member list, names and emails resolved server-side — profiles are only readable
 * through this definer function, never directly.
 */
export async function fetchGroupMembers(conversationId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase.rpc("list_group_members", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: (row.role as GroupRole) ?? "member",
    joinedAt: row.joined_at,
  }));
}

/**
 * Below this many members, scanning beats typing — the search field would be decoration.
 * Above it, the roster is big enough that finding "the one to ask about" needs a filter.
 */
export const MEMBER_SEARCH_MIN_MEMBERS = 7;

/**
 * The admin, if the group currently has one. A group holds a single admin seat: the database
 * rejects a second appointment, so the client must know whether that seat is free before offering it.
 */
export function findGroupAdmin(members: GroupMember[]): GroupMember | null {
  return members.find((member) => member.role === "admin") ?? null;
}

/** The admin seat is free, so an appointment will be accepted. */
export function canAppointAdmin(members: GroupMember[]): boolean {
  return findGroupAdmin(members) === null;
}

/** Says why an appointment is unavailable, naming the person who already holds the seat. */
export function adminSeatTakenMessage(adminName: string): string {
  return `Nhóm chỉ có một quản trị viên — hãy thu hồi quyền của ${adminName} trước.`;
}

/** The roster is large enough to deserve the search field. */
export function shouldShowMemberSearch(memberCount: number): boolean {
  return memberCount >= MEMBER_SEARCH_MIN_MEMBERS;
}

/**
 * Case-insensitive match on display name or email; an empty (or whitespace) query matches
 * everyone. This is what the panel filters the roster and the pending-removal list with, so
 * an admin can pull up one person to act on without scrolling a large group.
 */
export function memberMatchesQuery(member: GroupMember, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    (member.displayName ?? "").toLowerCase().includes(needle) ||
    (member.email ?? "").toLowerCase().includes(needle)
  );
}

/** The members matching the query, keeping the caller's ordering untouched. */
export function filterGroupMembers(members: GroupMember[], query: string): GroupMember[] {
  return members.filter((member) => memberMatchesQuery(member, query));
}

/** Role badge text. Short forms keep member rows at one line. */
export function roleLabel(role: GroupRole): string {
  if (role === "owner") return "Chủ nhóm";
  if (role === "admin") return "Quản trị viên";
  return "Thành viên";
}

/**
 * Owner first, then admin, then members; within a tier, longest-standing first.
 * The list reads top-down like a hierarchy of responsibility, not an address book.
 */
export function sortGroupMembers(members: GroupMember[]): GroupMember[] {
  const rank: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
  return [...members].sort((left, right) => {
    const byRole = rank[left.role] - rank[right.role];
    if (byRole !== 0) return byRole;
    return new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime();
  });
}

/** Requests still awaiting the owner's answer. Visible to owner and admin only, by policy. */
export async function fetchPendingRemovalRequests(conversationId: string): Promise<PendingRemovalRequest[]> {
  const { data, error } = await supabase
    .from("group_removal_requests")
    .select("id, conversation_id, target_user_id, requested_by, created_at")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    targetUserId: row.target_user_id,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  }));
}

/** The group's live invite link, or null when none exists or the last one was revoked. */
export async function fetchGroupInvite(conversationId: string): Promise<GroupInvite | null> {
  const { data, error } = await supabase
    .from("group_invite_links")
    .select("token, created_at")
    .eq("conversation_id", conversationId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw fail(error.code, error.message);
  if (!data) return null;
  return { token: data.token, createdAt: data.created_at };
}

/** Owner only. Creates the link the first time, rotates it afterwards, and un-revokes it. */
export async function rotateGroupInvite(conversationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_group_invite", {
    p_conversation_id: conversationId,
  });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không tạo được liên kết mời. Thử lại nhé.");
  return data as string;
}

/** Owner only. Kills the active link; the next rotate issues a brand-new token. */
export async function revokeGroupInvite(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_group_invite", {
    p_conversation_id: conversationId,
  });
  if (error) throw fail(error.code, error.message);
}

/** What a guest sees on the invite page before deciding: which group, and nothing more. */
export async function previewGroupInvite(token: string): Promise<{ conversationId: string; groupName: string }> {
  const { data, error } = await supabase.rpc("preview_group_invite", { p_token: token });
  if (error) throw fail(error.code, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(toVietnameseGroupError(undefined, "Invite link not found"));
  return { conversationId: row.conversation_id, groupName: row.group_name };
}

/**
 * Joins the group through its invite link as a plain member. Already being a member is not
 * an error — the call simply returns the conversation, so the link can always be opened.
 */
export async function joinGroupWithInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_group_with_invite", { p_token: token });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không tham gia được nhóm. Thử lại nhé.");
  return data as string;
}
