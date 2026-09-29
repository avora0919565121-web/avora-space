import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  choicesFor,
  composerCopy,
  composerPartialFailure,
  composerSuccess,
  departureLine,
  eventSummary,
  initialChoice,
  isLinkLocation,
  missingFields,
  missingLine,
  noteSummary,
  pickerMembers,
  presenceSummary,
  recipientSummary,
  resolveRecipients,
  suggestedEnd,
} from "@/lib/task-composer";
import { suggestionChanged } from "@/lib/task-suggestions";
import { sendToRecipients, travelOf } from "@/lib/use-task-composer";
import { isTaskDraftComplete, validateTaskDraft } from "@/lib/tasks";
import { matchesSearch } from "@/lib/normalize-search";

const ME = "u-me";
const PEER = "u-an";
const names: Record<string, string> = { "u-an": "An", "u-binh": "Bình", "u-chau": "Châu", "u-dung": "Dũng" };
const nameOf = (id: string): string => names[id] ?? "?";
const GROUP = [ME, "u-an", "u-binh", "u-chau", "u-dung"];

describe("3.21 · nothing chosen means no send button", () => {
  it("starts empty everywhere except personal places", () => {
    expect(initialChoice("direct")).toBe("none");
    expect(initialChoice("group")).toBe("none");
    expect(initialChoice("personal")).toBe("me");
    expect(choicesFor("personal")).toEqual(["me"]);
    expect(choicesFor("direct")).toEqual(["me", "peer", "both"]);
    expect(choicesFor("group")).toEqual(["me", "all", "pick"]);
  });

  it("titles the form Nhiệm vụ mới with no button", () => {
    const recipients = resolveRecipients({ place: "direct", choice: "none", selfId: ME, peerId: PEER, eligibleIds: [], pickedIds: [] });
    const copy = composerCopy({ place: "direct", recipients, peerName: "An", nameOf });
    expect(copy).toEqual({ title: "Nhiệm vụ mới", description: "Chọn người nhận để bắt đầu.", submitLabel: null });
  });
});

describe("3.22 / 3.23 · 1-1", () => {
  it("Cho tôi is a private task the other person does not see", () => {
    const recipients = resolveRecipients({ place: "direct", choice: "me", selfId: ME, peerId: PEER, eligibleIds: [], pickedIds: [] });
    expect(recipients).toEqual({ includesSelf: true, others: [] });
    const copy = composerCopy({ place: "direct", recipients, peerName: "An", nameOf });
    expect(copy.title).toBe("Tạo nhiệm vụ");
    expect(copy.description).toBe("Việc riêng của bạn — An không thấy.");
    expect(recipientSummary(recipients, "me", nameOf)).toBe("Chỉ bạn");
  });

  it("Cho An is a suggestion An can agree to or decline", () => {
    const recipients = resolveRecipients({ place: "direct", choice: "peer", selfId: ME, peerId: PEER, eligibleIds: [], pickedIds: [] });
    const copy = composerCopy({ place: "direct", recipients, peerName: "An", nameOf });
    expect(copy).toEqual({ title: "Gợi ý nhiệm vụ", description: "An có thể đồng ý hoặc từ chối.", submitLabel: "Gửi gợi ý" });
    expect(composerSuccess(recipients, nameOf)).toBe("Đã gợi ý cho An.");
  });

  it("Cả hai is one task of mine and one suggestion", () => {
    const recipients = resolveRecipients({ place: "direct", choice: "both", selfId: ME, peerId: PEER, eligibleIds: [], pickedIds: [] });
    expect(recipients).toEqual({ includesSelf: true, others: [PEER] });
    const copy = composerCopy({ place: "direct", recipients, peerName: "An", nameOf });
    expect(copy.title).toBe("Tạo và gợi ý nhiệm vụ");
    expect(copy.submitLabel).toBe("Tạo và gửi gợi ý");
    expect(recipientSummary(recipients, "both", nameOf)).toBe("Gửi tới: An · và bạn");
  });
});

describe("3.24 / 3.25 · group", () => {
  it("Cả nhóm is everyone reachable, me included, one suggestion each", () => {
    const recipients = resolveRecipients({ place: "group", choice: "all", selfId: ME, peerId: null, eligibleIds: GROUP, pickedIds: [] });
    expect(recipients.includesSelf).toBe(true);
    expect(recipients.others).toHaveLength(4);
    expect(recipientSummary(recipients, "all", nameOf)).toBe("Cả nhóm: 5 người · gồm cả bạn");
    expect(composerSuccess(recipients, nameOf)).toBe("Đã tạo nhiệm vụ của bạn và gợi ý cho 4 người.");
  });

  it("Cả nhóm never reaches someone the server left out (blocked either way)", () => {
    const reachable = GROUP.filter((id) => id !== "u-dung");
    const recipients = resolveRecipients({ place: "group", choice: "all", selfId: ME, peerId: null, eligibleIds: reachable, pickedIds: [] });
    expect(recipients.others).not.toContain("u-dung");
  });

  it("Chọn người keeps only reachable picks and says who", () => {
    const recipients = resolveRecipients({
      place: "group",
      choice: "pick",
      selfId: ME,
      peerId: null,
      eligibleIds: GROUP.filter((id) => id !== "u-chau"),
      pickedIds: ["u-binh", "u-chau"],
    });
    expect(recipients).toEqual({ includesSelf: false, others: ["u-binh"] });
    expect(recipientSummary(recipients, "pick", nameOf)).toBe("Gửi tới: Bình");
    expect(composerCopy({ place: "group", recipients, peerName: "", nameOf }).description).toBe("Bình có thể đồng ý hoặc từ chối.");
  });

  it("finds Bình by typing binh, and pins Tôi first", () => {
    expect(matchesSearch("binh", ["Bình"])).toBe(true);
    const members = [
      { userId: "u-binh", displayName: "Bình", email: null, role: "member" as const, joinedAt: "" },
      { userId: ME, displayName: "Minh", email: "m@x.vn", role: "owner" as const, joinedAt: "" },
    ];
    const ordered = pickerMembers(members as never, ME);
    expect(ordered[0]?.userId).toBe(ME);
    expect(ordered[0]?.displayName).toBe("Tôi");
  });

  it("Cho tôi in a group is seen by the group", () => {
    const recipients = resolveRecipients({ place: "group", choice: "me", selfId: ME, peerId: null, eligibleIds: GROUP, pickedIds: [] });
    expect(composerCopy({ place: "group", recipients, peerName: "", nameOf }).description).toBe("Việc của bạn trong nhóm — cả nhóm thấy.");
  });
});

describe("3.26 / 3.27 · required fields", () => {
  it("name + deadline is enough; Ghi chú is optional", () => {
    expect(isTaskDraftComplete({ title: "Gửi hợp đồng", description: "", deadline: "2099-01-01" })).toBe(true);
    expect(validateTaskDraft({ title: "Gửi hợp đồng", description: "", deadline: "2099-01-01" }, "2026-09-29").value?.description).toBe("");
  });

  it("says what is missing above the button", () => {
    const missing = missingFields({ title: "Gửi", deadline: "", startAt: "", endAt: "", location: "", requiresPresence: false });
    expect(missingLine(missing)).toBe("Còn thiếu: hạn hoàn thành");
    const place = missingFields({ title: "Gửi", deadline: "2099-01-01", startAt: "", endAt: "", location: "Q1", requiresPresence: false });
    expect(missingLine(place)).toBe("Còn thiếu: giờ bắt đầu của Sự kiện");
    expect(missingLine([])).toBeNull();
  });
});

describe("Sự kiện / Hiện diện / Ghi chú lines", () => {
  const start = new Date(2026, 8, 30, 14, 0).toISOString();
  const end = new Date(2026, 8, 30, 15, 30).toISOString();

  it("summarises an Event in one line", () => {
    expect(eventSummary(start, end, "Văn phòng")).toBe("Sự kiện · T4 30/09 · 14:00–15:30 · Văn phòng");
    expect(eventSummary(null, null, "x")).toBeNull();
  });

  it("3.3: leaves 20 minutes before and reminds 15 before that", () => {
    expect(departureLine(start, 20, 15)).toBe("Lên đường 13:40 · nhắc lúc 13:25");
    expect(presenceSummary(true, start, 20, 15)).toBe("Hiện diện · Có mặt · đi 20 phút · nhắc 13:25");
    expect(presenceSummary(false, start, 20, 15)).toBeNull();
  });

  it("3.12: Đồng ý then 20 minutes → leave 13:40, reminded 13:30 (default 10)", () => {
    expect(departureLine(start, 20, 10)).toBe("Lên đường 13:40 · nhắc lúc 13:30");
  });

  it("suggests an end one hour after the start", () => {
    expect(suggestedEnd("2026-09-30T14:00", null)).toBe("2026-09-30T15:00");
    expect(suggestedEnd("2026-09-30T14:00", 45)).toBe("2026-09-30T14:45");
  });

  it("links get Mở link, places get Chép", () => {
    expect(isLinkLocation("https://meet.google.com/abc")).toBe(true);
    expect(isLinkLocation("Văn phòng Q1")).toBe(false);
  });

  it("shows the first line of Ghi chú without the bullet", () => {
    expect(noteSummary("- mang hợp đồng bản in\n- laptop")).toBe("Ghi chú · mang hợp đồng bản in");
    expect(noteSummary("   ")).toBeNull();
  });
});

describe("3.15 · the proposer sees đã đổi when the Event moved", () => {
  const suggestion = { startAt: "2026-09-30T07:00:00.000Z", endAt: null, location: "Q1", title: "Họp", deadline: "2026-09-30" };
  it("is quiet when nothing moved and speaks when it did", () => {
    expect(suggestionChanged(suggestion, { ...suggestion, startAt: "2026-09-30T07:00:00+00:00" })).toBe(false);
    expect(suggestionChanged(suggestion, { ...suggestion, startAt: "2026-09-30T09:00:00.000Z" })).toBe(true);
  });
});

describe("sending to several people", () => {
  it("counts honestly when one fails halfway", async () => {
    const sent: string[] = [];
    const result = await sendToRecipients({
      recipients: { includesSelf: true, others: ["u-an", "u-binh"] },
      createMine: async () => {
        sent.push("me");
      },
      proposeTo: async (id) => {
        if (id === "u-binh") throw new Error("Không gửi được.");
        sent.push(id);
      },
    });
    expect(sent).toEqual(["me", "u-an"]);
    expect(composerPartialFailure(result.done, result.total, result.error?.message ?? "")).toBe("Đã gửi 2/3. Không gửi được.");
  });
});

describe("travel belongs to the person who goes", () => {
  it("reads a private plan first, then the task row", () => {
    const task = { id: "t", startAt: "2026-09-30T07:00:00.000Z", travelDurationMinutes: null, departureReminderAt: null };
    expect(travelOf(task, [{ taskId: "t", travelMinutes: 20, reminderOffsetMinutes: 10, departureReminderAt: null }])).toEqual({
      travelMinutes: 20,
      reminderOffsetMinutes: 10,
    });
    const own = { ...task, travelDurationMinutes: 20, departureReminderAt: "2026-09-30T06:25:00.000Z" };
    expect(travelOf(own, [])).toEqual({ travelMinutes: 20, reminderOffsetMinutes: 15 });
  });
});
