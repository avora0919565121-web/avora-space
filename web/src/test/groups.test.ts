import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; the client is never called, but importing the module pulls it in and it
// refuses to construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  adminSeatTakenMessage,
  buildInviteLink,
  canAppointAdmin,
  canLeaveGroup,
  canManageGroupInvite,
  canRenameGroup,
  canResolveRemovalRequests,
  canSeeRemovalRequests,
  canSubmitGroupRename,
  filterGroupMembers,
  findGroupAdmin,
  GROUP_NAME_MAX_LENGTH,
  INVITE_BLOCKED_MESSAGE,
  INVITE_UNAVAILABLE_MESSAGE,
  LEAVE_BLOCKED_MESSAGE,
  memberActionsFor,
  memberMatchesQuery,
  normalizeGroupName,
  RENAME_BLOCKED_MESSAGE,
  resolveInviteSectionState,
  roleLabel,
  shouldShowMemberSearch,
  sortGroupMembers,
  toVietnameseGroupError,
  type GroupMember,
  type GroupRole,
} from "@/lib/groups";

describe("memberActionsFor", () => {
  it("gives the owner a direct remove button next to an admin and a member", () => {
    expect(memberActionsFor("owner", "member", false)).toContain("remove");
    expect(memberActionsFor("owner", "admin", false)).toContain("remove");
  });

  it("never gives an admin a remove button — only the right to ask", () => {
    const actions = memberActionsFor("admin", "member", false);
    expect(actions).toContain("requestRemove");
    expect(actions).not.toContain("remove");
  });

  it("does not let an admin act against the owner or another admin", () => {
    expect(memberActionsFor("admin", "owner", false)).toEqual(["directMessage"]);
    expect(memberActionsFor("admin", "admin", false)).toEqual(["directMessage"]);
  });

  it("gives a plain member no power over anyone, but still lets them message privately", () => {
    expect(memberActionsFor("member", "member", false)).toEqual(["directMessage"]);
    expect(memberActionsFor("member", "owner", false)).toEqual(["directMessage"]);
  });

  it("offers ownership transfer only from the owner's seat", () => {
    expect(memberActionsFor("owner", "member", false)).toContain("transferOwnership");
    expect(memberActionsFor("admin", "member", false)).not.toContain("transferOwnership");
    expect(memberActionsFor("member", "member", false)).not.toContain("transferOwnership");
  });

  it("offers the admin badge to a member and its removal to an admin", () => {
    expect(memberActionsFor("owner", "member", false)).toContain("makeAdmin");
    expect(memberActionsFor("owner", "member", false)).not.toContain("revokeAdmin");
    expect(memberActionsFor("owner", "admin", false)).toContain("revokeAdmin");
    expect(memberActionsFor("owner", "admin", false)).not.toContain("makeAdmin");
  });

  it("shows no row actions against yourself, whatever your role", () => {
    const roles: GroupRole[] = ["owner", "admin", "member"];
    for (const role of roles) {
      expect(memberActionsFor(role, role, true)).toEqual([]);
    }
  });

  it("never offers a direct message to yourself", () => {
    expect(memberActionsFor("member", "member", true)).not.toContain("directMessage");
  });
});

describe("removal request visibility", () => {
  it("lets only the owner answer", () => {
    expect(canResolveRemovalRequests("owner")).toBe(true);
    expect(canResolveRemovalRequests("admin")).toBe(false);
    expect(canResolveRemovalRequests("member")).toBe(false);
  });

  it("shows the record to owner and admin, and hides it from a member", () => {
    expect(canSeeRemovalRequests("owner")).toBe(true);
    expect(canSeeRemovalRequests("admin")).toBe(true);
    expect(canSeeRemovalRequests("member")).toBe(false);
  });
});

describe("canLeaveGroup", () => {
  it("stops the owner in the interface rather than at the database", () => {
    expect(canLeaveGroup("owner")).toBe(false);
    expect(canLeaveGroup("admin")).toBe(true);
    expect(canLeaveGroup("member")).toBe(true);
  });
});

describe("roleLabel", () => {
  it("names each seat in Vietnamese", () => {
    expect(roleLabel("owner")).toBe("Chủ nhóm");
    expect(roleLabel("admin")).toBe("Quản trị viên");
    expect(roleLabel("member")).toBe("Thành viên");
  });
});

describe("the invite link", () => {
  it("is managed by the owner alone, but shared by anyone", () => {
    expect(canManageGroupInvite("owner")).toBe(true);
    expect(canManageGroupInvite("admin")).toBe(false);
    expect(canManageGroupInvite("member")).toBe(false);
  });

  it("carries the token on the invite route, tolerating a trailing slash on the origin", () => {
    expect(buildInviteLink("https://avora.app", "abc-123")).toBe("https://avora.app/loi-moi/abc-123");
    expect(buildInviteLink("https://avora.app/", "abc-123")).toBe("https://avora.app/loi-moi/abc-123");
  });

  it("says who may manage the link when a non-owner asks the database anyway", () => {
    expect(toVietnameseGroupError(undefined, "Only owner can manage the invite link")).toBe(
      INVITE_BLOCKED_MESSAGE + ".",
    );
  });

  it("reads a dead link as a sentence, not an error", () => {
    expect(toVietnameseGroupError(undefined, "Invite link not found")).toBe(
      "Liên kết mời không còn hiệu lực.",
    );
  });
});

describe("the invite panel state", () => {
  const state = (over: Partial<Parameters<typeof resolveInviteSectionState>[0]> = {}) =>
    resolveInviteSectionState({
      membersFailed: false,
      roleKnown: true,
      inviteFailed: false,
      inviteLoaded: true,
      ...over,
    });

  it("waits while the member list is still arriving, because the role comes from it", () => {
    expect(state({ roleKnown: false, inviteLoaded: false })).toBe("loading");
  });

  it("stops waiting forever when the member list failed", () => {
    // The regression: the invite query stays disabled, so it reports pending for good.
    expect(state({ membersFailed: true, roleKnown: false, inviteLoaded: false })).toBe(
      "unavailable",
    );
  });

  it("calls a failed member list unavailable even if the invite once loaded", () => {
    expect(state({ membersFailed: true, inviteLoaded: true })).toBe("unavailable");
  });

  it("reports the invite's own failure as an error", () => {
    expect(state({ inviteFailed: true, inviteLoaded: false })).toBe("error");
  });

  it("shows the link once the role is known and the invite has loaded", () => {
    expect(state()).toBe("ready");
  });

  it("keeps waiting when the role is known but the invite is still in flight", () => {
    expect(state({ inviteLoaded: false })).toBe("loading");
  });

  it("explains the dependency in the message rather than blaming the link", () => {
    expect(INVITE_UNAVAILABLE_MESSAGE).toContain("danh sách thành viên");
  });
});

describe("sortGroupMembers", () => {
  const member = (id: string, role: GroupRole, joinedAt: string): GroupMember => ({
    userId: id,
    displayName: id,
    email: null,
    role,
    joinedAt,
  });

  it("puts the owner above the admin above the members", () => {
    const sorted = sortGroupMembers([
      member("m1", "member", "2026-01-01"),
      member("a1", "admin", "2026-01-02"),
      member("o1", "owner", "2026-01-03"),
    ]);
    expect(sorted.map((m) => m.userId)).toEqual(["o1", "a1", "m1"]);
  });

  it("keeps longest-standing first within a tier and never mutates the input", () => {
    const input = [
      member("m-new", "member", "2026-06-01"),
      member("m-old", "member", "2026-01-01"),
    ];
    const sorted = sortGroupMembers(input);
    expect(sorted.map((m) => m.userId)).toEqual(["m-old", "m-new"]);
    expect(input.map((m) => m.userId)).toEqual(["m-new", "m-old"]);
  });
});

describe("the single admin seat", () => {
  const member = (id: string, role: GroupRole, displayName: string | null = id): GroupMember => ({
    userId: id,
    displayName,
    email: null,
    role,
    joinedAt: "2026-01-01",
  });

  const withoutAdmin: GroupMember[] = [member("o1", "owner"), member("m1", "member")];
  const withAdmin: GroupMember[] = [...withoutAdmin, member("a1", "admin", "Lan")];

  it("finds the sitting admin, and reports none when the seat is empty", () => {
    expect(findGroupAdmin(withAdmin)?.userId).toBe("a1");
    expect(findGroupAdmin(withoutAdmin)).toBeNull();
    expect(findGroupAdmin([])).toBeNull();
  });

  it("offers an appointment only while the seat is free", () => {
    expect(canAppointAdmin(withoutAdmin)).toBe(true);
    expect(canAppointAdmin(withAdmin)).toBe(false);
  });

  it("explains a blocked appointment by naming who holds the seat", () => {
    const admin = findGroupAdmin(withAdmin);
    expect(admin).not.toBeNull();
    const message = adminSeatTakenMessage(admin?.displayName ?? "");
    expect(message).toContain("Lan");
    expect(message).toContain("thu hồi quyền");
  });

  it("keeps the promote and demote buttons on the owner's seat alone", () => {
    for (const viewer of ["admin", "member"] as GroupRole[]) {
      for (const target of ["owner", "admin", "member"] as GroupRole[]) {
        const actions = memberActionsFor(viewer, target, false);
        expect(actions).not.toContain("makeAdmin");
        expect(actions).not.toContain("revokeAdmin");
      }
    }
  });

  it("never offers the owner a badge to give or take from themselves", () => {
    expect(memberActionsFor("owner", "owner", true)).toEqual([]);
  });
});

describe("toVietnameseGroupError", () => {
  it("tells an admin why removal failed and what they can do instead", () => {
    expect(toVietnameseGroupError("P0001", "Only owner can remove participants directly")).toBe(
      "Chỉ chủ nhóm mới được xoá thành viên. Bạn có thể gửi đề nghị xoá.",
    );
  });

  it("reads a duplicate-request collision as a plain sentence, not an index name", () => {
    const message =
      'duplicate key value violates unique constraint "one_pending_request_per_target"';
    expect(toVietnameseGroupError("23505", message)).toBe("Đã có một đề nghị đang chờ duyệt cho người này.");
  });

  it("turns the owner-leaving guard into the same words the button uses", () => {
    const message = "Owner must transfer ownership before leaving — use transfer_group_ownership";
    expect(toVietnameseGroupError("P0001", message)).toBe(LEAVE_BLOCKED_MESSAGE + ".");
  });

  it("covers the resolve guards", () => {
    expect(toVietnameseGroupError("P0001", "Only owner can resolve a removal request")).toBe(
      "Chỉ chủ nhóm mới được duyệt đề nghị này.",
    );
    expect(toVietnameseGroupError("P0001", "Request already resolved")).toBe("Đề nghị này đã được xử lý.");
  });

  it("never leaks a raw Postgres permission error to the reader", () => {
    const vietnamese = toVietnameseGroupError("42501", "permission denied for table group_removal_requests");
    expect(vietnamese).toBe("Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.");
    expect(vietnamese).not.toContain("permission denied");
  });

  it("tells a direct-conversation viewer why there is no member list", () => {
    expect(toVietnameseGroupError("P0001", "Not a group conversation")).toBe(
      "Đây là cuộc trò chuyện trực tiếp, không phải nhóm.",
    );
  });

  it("says the rename guard in the same words the menu uses", () => {
    expect(toVietnameseGroupError("P0001", "avora_not_group_owner")).toBe(RENAME_BLOCKED_MESSAGE + ".");
    expect(toVietnameseGroupError("P0001", "avora_group_not_found")).toBe("Không tìm thấy nhóm này.");
  });

  it("states the name limits without quoting the database", () => {
    expect(toVietnameseGroupError("P0001", "avora_group_name_required")).toBe("Nhóm cần có tên.");
    expect(toVietnameseGroupError("P0001", "avora_group_name_max_len")).toBe(
      `Tên nhóm quá dài (tối đa ${GROUP_NAME_MAX_LENGTH} ký tự).`,
    );
  });

  it("falls back to a calm sentence for anything unrecognised", () => {
    expect(toVietnameseGroupError(undefined, "some unmapped failure")).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
  });
});

describe("group rename", () => {
  it("lets only the owner rename the room", () => {
    expect(canRenameGroup("owner")).toBe(true);
    expect(canRenameGroup("admin")).toBe(false);
    expect(canRenameGroup("member")).toBe(false);
  });

  it("stores the name the reader meant, not the whitespace they typed", () => {
    expect(normalizeGroupName("  Nhóm   dự án  ")).toBe("Nhóm dự án");
    expect(normalizeGroupName("\n Team \t A ")).toBe("Team A");
  });

  it("refuses a blank name instead of leaving the group nameless", () => {
    expect(canSubmitGroupRename("", "Nhóm cũ")).toBe(false);
    expect(canSubmitGroupRename("    ", "Nhóm cũ")).toBe(false);
  });

  it("refuses a save that would change nothing, spacing included", () => {
    expect(canSubmitGroupRename("Nhóm dự án", "Nhóm dự án")).toBe(false);
    expect(canSubmitGroupRename("  Nhóm  dự án ", "Nhóm dự án")).toBe(false);
  });

  it("accepts a real change, and a first name for a group that had none", () => {
    expect(canSubmitGroupRename("Nhóm mới", "Nhóm cũ")).toBe(true);
    expect(canSubmitGroupRename("Nhóm dự án", null)).toBe(true);
  });

  it("stops at the length the database would reject", () => {
    expect(canSubmitGroupRename("a".repeat(GROUP_NAME_MAX_LENGTH), "cũ")).toBe(true);
    expect(canSubmitGroupRename("a".repeat(GROUP_NAME_MAX_LENGTH + 1), "cũ")).toBe(false);
  });
});

describe("member search", () => {
  const member = (id: string, displayName: string | null, email: string | null): GroupMember => ({
    userId: id,
    displayName,
    email,
    role: "member",
    joinedAt: "2026-01-01",
  });

  it("withholds the search field until the roster is big enough to need it", () => {
    expect(shouldShowMemberSearch(6)).toBe(false);
    expect(shouldShowMemberSearch(7)).toBe(true);
  });

  it("matches names case-insensitively and across name or email", () => {
    const lan = member("u1", "Trần Lan", "lan@avora.app");
    expect(memberMatchesQuery(lan, "lan")).toBe(true);
    expect(memberMatchesQuery(lan, "TRẦN")).toBe(true);
    expect(memberMatchesQuery(lan, "@avora.app")).toBe(true);
    expect(memberMatchesQuery(lan, "binh")).toBe(false);
  });

  it("treats an empty or whitespace query as matching everyone, and tolerates missing names", () => {
    const anonymous = member("u2", null, null);
    expect(memberMatchesQuery(anonymous, "")).toBe(true);
    expect(memberMatchesQuery(anonymous, "   ")).toBe(true);
    expect(memberMatchesQuery(anonymous, "lan")).toBe(false);
  });

  it("filters while keeping the caller's ordering untouched", () => {
    const roster = [member("u1", "Trần Lan", null), member("u2", "Nguyễn Bình", null), member("u3", "Lan Anh", null)];
    const filtered = filterGroupMembers(roster, "lan");
    expect(filtered.map((m) => m.userId)).toEqual(["u1", "u3"]);
    expect(roster).toHaveLength(3);
  });
});
