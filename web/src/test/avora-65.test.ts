import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { recordSourceLabel } from "@/components/think-hub/QuickTaskDialog";
import { KEYBOARD_POINTER_QUERY } from "@/components/tasks/TaskViewTabs";
import { HINT_SECONDS } from "@/components/PlusMenuButton";
import { chooseFloatingPlacement } from "@/components/ui/floating-panel";
import { findNameIssues, phoneKey, proposeNamesFromFile } from "@/lib/contact-name-repair";
import { REPLAYABLE_GUIDANCE } from "@/lib/guidance";

describe("AVORA-65 · B — keys hint by device, not width", () => {
  it("asks for a fine hovering pointer and rules out any coarse one", () => {
    expect(KEYBOARD_POINTER_QUERY).toContain("pointer: fine");
    expect(KEYBOARD_POINTER_QUERY).toContain("not (any-pointer: coarse)");
    expect(KEYBOARD_POINTER_QUERY).not.toContain("min-width");
  });
});

describe("AVORA-65 · D — names from the original file, matched by phone", () => {
  const contacts = [
    { id: "c1", name: "Nguyen Van Hung", phone: "0909 111 222" },
    { id: "c2", name: "Tr?n Th? Lan", phone: "+84 912 333 444" },
    { id: "c3", name: "Pham Minh", phone: "0988555666" },
    { id: "c4", name: "Lê Văn Tâm", phone: "0977000111" },
    { id: "c5", name: "Hoang Anh", phone: "0966000222" },
  ];
  const issues = findNameIssues(
    contacts.map((contact) => ({ ...contact, linkedUserId: null })),
    () => null,
  );
  const entries = [
    { name: "Nguyễn Văn Hùng", phones: ["0909111222"] },
    { name: "Trần Thị Lan", phones: ["0912333444"] },
    // Same number, a different person's name: never a rename.
    { name: "Đỗ Quang Vinh", phones: ["0988555666"] },
    { name: "Lê Văn Tâm Mới", phones: ["0977000111"] },
    // Two accented names for one number: ambiguous, nothing offered.
    { name: "Hoàng Anh", phones: ["0966000222"] },
    { name: "Hoàng Ánh", phones: ["0966000222"] },
    { name: "Người Mới", phones: ["0911999888"] },
  ];

  it("normalises numbers the same way on both sides", () => {
    expect(phoneKey("+84 912 333 444")).toBe("0912333444");
    expect(phoneKey("12")).toBe("");
  });

  it("offers only broken / unaccented names with exactly one trustworthy match", () => {
    const proposals = proposeNamesFromFile(contacts, issues, entries);
    const byId = new Map(proposals.map((issue) => [issue.contactId, issue] as const));
    expect(byId.get("c1")?.suggestion).toBe("Nguyễn Văn Hùng");
    expect(byId.get("c2")?.suggestion).toBe("Trần Thị Lan");
    expect(byId.has("c3")).toBe(false);
    expect(byId.has("c4")).toBe(false);
    expect(byId.has("c5")).toBe(false);
    expect(proposals.every((issue) => issue.source === "file" && issue.preselected)).toBe(true);
    // Never adds anyone: every proposal is an existing contact.
    expect(proposals.every((issue) => contacts.some((contact) => contact.id === issue.contactId))).toBe(true);
  });
});

describe("AVORA-65 · F — panels have room for their body", () => {
  it("centres when neither side fits", () => {
    expect(chooseFloatingPlacement({ anchorTop: 300, anchorBottom: 344, viewportHeight: 600, panelHeight: 470 })).toBe("center");
  });
});

describe("AVORA-65 · G — one-time hints", () => {
  it("fades after 6 seconds and both + hints can be read again", () => {
    expect(HINT_SECONDS).toBe(6);
    expect(REPLAYABLE_GUIDANCE).toEqual(["plan_plus_hold", "task_plus_hold"]);
  });
});

describe("AVORA-65 · H — where a task from a sub-table came from", () => {
  it("names the whole path, root board last", () => {
    expect(recordSourceLabel("Khu A", [{ name: "Anam Cam Ranh", viaTitle: "Anam Cam Ranh" }, { name: "PBA | Khách hàng", viaTitle: null }])).toBe(
      "Từ Hạng mục Khu A · Bảng con của Anam Cam Ranh · Bảng PBA | Khách hàng",
    );
    expect(recordSourceLabel("X", [{ name: "Z", viaTitle: null }])).toBe("Từ Hạng mục X · Bảng Z");
  });
});
