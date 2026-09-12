import { describe, expect, it, vi } from "vitest";

// The member type lives in the module that owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { GroupMember } from "@/lib/groups";
import {
  assignSummary,
  foldVietnamese,
  memberLabel,
  memberMatchesQuery,
  searchAssignees,
} from "@/lib/member-search";

function member(overrides: Partial<GroupMember> & { userId: string }): GroupMember {
  return {
    displayName: null,
    email: null,
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const HOA = member({ userId: "u-hoa", displayName: "Nguyễn Thị Hoà", email: "hoa@avora.vn" });
const DUNG = member({ userId: "u-dung", displayName: "Trần Dũng", email: "dung@avora.vn" });
const DAT = member({ userId: "u-dat", displayName: "Đặng Văn Đạt", email: "dat@avora.vn" });
const ME = member({ userId: "u-me", displayName: "Chính tôi", email: "me@avora.vn" });

const EVERYONE: GroupMember[] = [HOA, DUNG, DAT, ME];

describe("foldVietnamese", () => {
  it("takes the tone marks off so an untyped accent still matches", () => {
    expect(foldVietnamese("Hoà")).toBe("hoa");
    expect(foldVietnamese("Dũng")).toBe("dung");
    expect(foldVietnamese("Đặng Văn Đạt")).toBe("dang van dat");
  });

  it("folds đ, which is its own letter rather than a marked d", () => {
    expect(foldVietnamese("Đà Nẵng")).toBe("da nang");
    expect(foldVietnamese("đỏ")).toBe("do");
  });

  it("ignores case and the whitespace around what was typed", () => {
    expect(foldVietnamese("  HOÀ  ")).toBe("hoa");
  });
});

describe("memberMatchesQuery", () => {
  it("finds a name typed without any diacritics at all", () => {
    expect(memberMatchesQuery(HOA, "hoa")).toBe(true);
    expect(memberMatchesQuery(DUNG, "dung")).toBe(true);
    expect(memberMatchesQuery(DAT, "dat")).toBe(true);
  });

  it("also finds it when the accents are typed correctly", () => {
    expect(memberMatchesQuery(HOA, "Hoà")).toBe(true);
    expect(memberMatchesQuery(DAT, "Đạt")).toBe(true);
  });

  it("matches on part of a name, not just its start", () => {
    expect(memberMatchesQuery(HOA, "thi")).toBe(true);
  });

  it("searches the email too, because groups look people up by address", () => {
    expect(memberMatchesQuery(DUNG, "dung@avora")).toBe(true);
  });

  it("says no when nobody answers to it", () => {
    expect(memberMatchesQuery(HOA, "khanh")).toBe(false);
  });

  it("treats an empty box as no filter at all", () => {
    expect(memberMatchesQuery(HOA, "")).toBe(true);
    expect(memberMatchesQuery(HOA, "   ")).toBe(true);
  });
});

describe("searchAssignees", () => {
  it("never offers the person doing the choosing", () => {
    const found = searchAssignees(EVERYONE, "", { excludeUserIds: [], selfId: "u-me" });
    expect(found.map((entry) => entry.userId)).toEqual(["u-hoa", "u-dung", "u-dat"]);
  });

  it("drops people already chosen, so nobody can be picked twice", () => {
    const found = searchAssignees(EVERYONE, "", { excludeUserIds: ["u-hoa"], selfId: "u-me" });
    expect(found.map((entry) => entry.userId)).toEqual(["u-dung", "u-dat"]);
  });

  it("narrows to what has been typed, ignoring diacritics", () => {
    const found = searchAssignees(EVERYONE, "dang", { excludeUserIds: [], selfId: "u-me" });
    expect(found.map((entry) => entry.userId)).toEqual(["u-dat"]);
  });

  it("returns nothing rather than everything when the query matches no one", () => {
    expect(searchAssignees(EVERYONE, "zzz", { excludeUserIds: [], selfId: "u-me" })).toEqual([]);
  });
});

describe("memberLabel", () => {
  it("prefers the display name and falls back to the email handle", () => {
    expect(memberLabel(HOA)).toBe("Nguyễn Thị Hoà");
    expect(memberLabel(member({ userId: "u-x", email: "khanh@avora.vn" }))).toBe("khanh");
  });
});

describe("assignSummary", () => {
  it("says plainly that several people means several separate tasks", () => {
    expect(assignSummary(0)).toBe("Chưa chọn ai");
    expect(assignSummary(1)).toBe("Giao cho 1 người");
    expect(assignSummary(3)).toBe("Giao cho 3 người — tạo 3 nhiệm vụ riêng");
  });
});
