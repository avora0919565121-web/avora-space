import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { bundleSummary, fileLabel, groupBySpeaker, transcriptText } from "@/lib/chat-transcript";
import { firstUnreadByCount, firstUnreadMessageId, formatDayLabel } from "@/lib/chat-cache";
import { draftPreview } from "@/lib/chat-drafts";
import { dueReminders, shouldChime, tabTitle, unreadConversationCount } from "@/lib/in-app-alerts";
import { eventDurationLabel, eventEndFor } from "@/lib/task-composer";
import { buildContextSnapshot, parseContextSnapshot, snapshotToJson } from "@/lib/task-context";

describe("A5 / B1 · a run of messages as a conversation", () => {
  const items = [
    { name: "An", text: "Chốt lịch thứ sáu", files: 0 },
    { name: "An", text: "14h nhé", files: 0 },
    { name: "Bình", text: "", files: 1, images: 1 },
    { name: "Bình", text: "Ok", files: 0 },
  ];

  it("groups consecutive lines from the same speaker", () => {
    expect(groupBySpeaker(items)).toEqual([
      { name: "An", lines: ["Chốt lịch thứ sáu", "14h nhé"] },
      { name: "Bình", lines: ["[Ảnh]", "Ok"] },
    ]);
  });

  it("writes Tên: nội dung blocks and cuts with …", () => {
    expect(transcriptText(items, 2000)).toBe("An: Chốt lịch thứ sáu\n14h nhé\n\nBình: [Ảnh]\nOk");
    expect(transcriptText(items, 12).endsWith("…")).toBe(true);
    expect(transcriptText(items, 12).length).toBeLessThanOrEqual(12);
  });

  it("labels files-only messages", () => {
    expect(fileLabel(1, 1)).toBe("[Ảnh]");
    expect(fileLabel(3, 3)).toBe("[3 ảnh]");
    expect(fileLabel(2, 0)).toBe("[2 tệp]");
  });

  it("summarises a bundle with at most three names", () => {
    expect(bundleSummary(5, ["An", "Bình"])).toBe("Đoạn hội thoại · 5 tin · An, Bình");
    expect(bundleSummary(9, ["A", "B", "C", "D", "E"])).toBe("Đoạn hội thoại · 9 tin · A, B, C +2");
  });

  it("keeps every picked id on the snapshot, first one quoted", () => {
    const snapshot = buildContextSnapshot({
      conversationType: "direct",
      conversationId: "c",
      conversationName: "An",
      message: { id: "m1", senderId: "u", content: "x", createdAt: "2026-09-29T00:00:00Z" },
      senderName: "An",
      userResponse: "",
      selectedMessageIds: ["m1", "m2", "m3"],
    });
    const json = snapshotToJson(snapshot);
    expect(json.original_message_id).toBe("m1");
    expect(json.selected_message_ids).toEqual(["m1", "m2", "m3"]);
    expect(parseContextSnapshot(json)?.selectedMessageIds).toEqual(["m1", "m2", "m3"]);
  });
});

describe("A8 · drafts", () => {
  it("shows the first line", () => {
    expect(draftPreview("Mai gặp nhé\nnhớ mang hợp đồng")).toBe("✎ Nháp: Mai gặp nhé");
  });
});

describe("A9 · day lines and the unread line", () => {
  const now = new Date(2026, 8, 29, 10, 0);
  it("says Hôm nay / Hôm qua / Thứ Hai, 28/09 and adds the year only when different", () => {
    expect(formatDayLabel(new Date(2026, 8, 29, 8).toISOString(), now)).toBe("Hôm nay");
    expect(formatDayLabel(new Date(2026, 8, 28, 8).toISOString(), now)).toBe("Hôm qua");
    expect(formatDayLabel(new Date(2026, 8, 21, 8).toISOString(), now)).toBe("Thứ Hai, 21/09");
    expect(formatDayLabel(new Date(2025, 8, 29, 8).toISOString(), now)).toBe("Thứ Hai, 29/09/2025");
  });

  const thread = [
    { id: "a", senderId: "peer", createdAt: "2026-09-29T01:00:00Z" },
    { id: "b", senderId: "me", createdAt: "2026-09-29T02:00:00Z" },
    { id: "c", senderId: "peer", createdAt: "2026-09-29T03:00:00Z" },
    { id: "d", senderId: "peer", createdAt: "2026-09-29T04:00:00Z" },
  ];
  it("sits before the first unread message from someone else", () => {
    expect(firstUnreadByCount(thread, "me", 2)).toBe("c");
    expect(firstUnreadByCount(thread, "me", 0)).toBeNull();
    expect(firstUnreadMessageId(thread, "me", "2026-09-29T02:30:00Z")).toBe("c");
  });
});

describe("A11 · tab title, badge and sounds", () => {
  const allow = () => ({ blocked: false, decidedBy: null, exception: null }) as const;
  const blockGroups = (event: { surface: string }) =>
    event.surface === "group"
      ? ({ blocked: true, decidedBy: "group", exception: null } as const)
      : ({ blocked: false, decidedBy: null, exception: null } as const);
  const inbox = [
    { unreadCount: 2, kind: "direct" },
    { unreadCount: 1, kind: "group" },
    { unreadCount: 0, kind: "direct" },
    { unreadCount: 4, kind: "personal" },
  ] as never;

  it("counts conversations, not messages, and skips muted ones", () => {
    expect(unreadConversationCount(inbox, allow)).toBe(2);
    expect(unreadConversationCount(inbox, blockGroups as never)).toBe(1);
    expect(tabTitle(3)).toBe("(3) AVORA");
    expect(tabTitle(0)).toBe("AVORA");
  });

  it("stays quiet on the thread being read, when muted, or within 3 seconds", () => {
    const base = { soundOn: true, lastChimeAt: 0, now: 10_000, decision: allow() };
    const signal = { conversationId: "c", senderId: "p", mentionsViewer: false, isReading: false };
    expect(shouldChime({ ...base, signal })).toBe(true);
    expect(shouldChime({ ...base, signal: { ...signal, isReading: true } })).toBe(false);
    expect(shouldChime({ ...base, signal, lastChimeAt: 8_000 })).toBe(false);
    expect(shouldChime({ ...base, signal, soundOn: false })).toBe(false);
  });

  it("rings a reminder once, only when it just came due", () => {
    const now = Date.parse("2026-09-29T07:00:30Z");
    const list = [
      { key: "r1", at: "2026-09-29T07:00:00Z", title: "Họp", href: "/" },
      { key: "r2", at: "2026-09-29T05:00:00Z", title: "Cũ", href: "/" },
      { key: "r3", at: "2026-09-29T08:00:00Z", title: "Sau", href: "/" },
    ];
    expect(dueReminders(list, new Set(), now).map((item) => item.key)).toEqual(["r1"]);
    expect(dueReminders(list, new Set(["r1"]), now)).toEqual([]);
  });
});

describe("A12 · the end always follows the start", () => {
  it("starts at +60 minutes, then keeps the length", () => {
    expect(eventEndFor("2026-10-01T18:00", "", "")).toBe("2026-10-01T19:00");
    expect(eventEndFor("2026-10-01T19:00", "2026-10-01T18:00", "2026-10-01T19:00")).toBe("2026-10-01T20:00");
    expect(eventEndFor("2026-10-01T19:00", "2026-10-01T18:00", "2026-10-01T21:00")).toBe("2026-10-01T22:00");
  });

  it("replaces an end that is not after the start", () => {
    expect(eventEndFor("2026-10-01T18:00", "2026-10-01T09:00", "2026-10-01T10:00")).toBe("2026-10-01T19:00");
    expect(eventEndFor("2026-10-01T18:00", "2026-10-01T18:00", "2026-10-01T10:00")).toBe("2026-10-01T19:00");
  });

  it("never crosses midnight", () => {
    expect(eventEndFor("2026-10-01T23:30", "", "")).toBe("2026-10-01T23:55");
  });

  it("says the length", () => {
    expect(eventDurationLabel("2026-10-01T18:00", "2026-10-01T21:30")).toBe("3 giờ 30 phút");
    expect(eventDurationLabel("2026-10-01T18:00", "2026-10-01T19:00")).toBe("1 giờ");
    expect(eventDurationLabel("2026-10-01T18:00", "2026-10-01T18:45")).toBe("45 phút");
    expect(eventDurationLabel("2026-10-01T18:00", "2026-10-01T17:00")).toBeNull();
  });
});

import { quickScheduleTimes, sendAtLine } from "@/lib/scheduled-messages";
import { bundleSpan, parseForwardBundle } from "@/lib/chat-transcript";
import { forwardSummaryText } from "@/lib/forwarding";

describe("B2 · quick send-later times", () => {
  it("rounds 'Sau 1 giờ' up to 5 minutes and hides 'Tối nay' from 19:55", () => {
    const early = quickScheduleTimes(new Date(2026, 8, 29, 14, 2, 30));
    expect(early.map((item) => item.id)).toEqual(["hour", "tonight", "morning"]);
    expect(early[0].at.getHours()).toBe(15);
    expect(early[0].at.getMinutes()).toBe(5);
    const late = quickScheduleTimes(new Date(2026, 8, 29, 19, 55));
    expect(late.map((item) => item.id)).toEqual(["hour", "morning"]);
    expect(late[1].at.getDate()).toBe(30);
    expect(late[1].at.getHours()).toBe(8);
  });

  it("says exactly when", () => {
    const now = new Date(2026, 8, 28, 10, 0);
    expect(sendAtLine(new Date(2026, 8, 28, 20, 0), now)).toBe("20:00, hôm nay 28/09");
    expect(sendAtLine(new Date(2026, 8, 29, 8, 0), now)).toBe("08:00, ngày mai 29/09");
  });
});

describe("B1 · the bundle as stored", () => {
  it("reads defensively and never exposes ids", () => {
    const bundle = parseForwardBundle({
      v: 1,
      count: 2,
      first_at: new Date(2026, 8, 28, 14, 2).toISOString(),
      last_at: new Date(2026, 8, 28, 14, 10).toISOString(),
      items: [{ name: "An", text: "Chào", files: 0 }, { name: "", text: "", files: 1 }],
    });
    expect(bundle?.items[1].name).toBe("Thành viên AVORA");
    expect(bundleSpan(bundle?.firstAt ?? null, bundle?.lastAt ?? null)).toBe("28/09 · 14:02–14:10");
    expect(parseForwardBundle("x")).toBeNull();
  });

  it("toasts one conversation and says files stayed", () => {
    expect(forwardSummaryText({ forwarded: 5, filesCarried: 0, filesBlocked: 0, asBundle: true, filesLeftBehind: 1 }, "Nhóm A")).toBe(
      "Đã chuyển 5 tin thành một đoạn hội thoại tới Nhóm A · 1 tệp không đi kèm",
    );
  });

  it("AVORA-57 · B: names the images carried and the ones left behind", () => {
    expect(
      forwardSummaryText(
        { forwarded: 4, filesCarried: 2, filesBlocked: 1, asBundle: true, filesLeftBehind: 1, imagesCarried: 2, imagesBlocked: 1 },
        "Minh",
      ),
    ).toBe("Đã chuyển 4 tin thành một đoạn hội thoại tới Minh · kèm 2 ảnh · 1 ảnh không chuyển được");
  });
});
