import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { MessageAttachment } from "@/lib/attachments";
import type { ChatMessage } from "@/lib/chat-cache";
import {
  DIARY_VIEWS,
  diaryFileNotes,
  diaryFileSourceLabel,
  isFileOnlyNote,
  journalTimeline,
} from "@/lib/diary-views";
import {
  buildPasteSnapshot,
  descriptionFromPaste,
  isPasteEmpty,
  isPastedTask,
  ORIGIN_CONTENT_MAX_LEN,
  pasteFromDataTransfer,
  pasteSourceTasks,
} from "@/lib/paste-intake";
import { parseContextSnapshot, snapshotToJson } from "@/lib/task-context";
import { TASK_DESCRIPTION_MAX_LEN, type TaskItem } from "@/lib/tasks";

const ME = "u-me";
const NOW = new Date("2026-09-25T02:00:00.000Z");

function makeTask(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: "t1",
    type: "personal",
    creatorId: ME,
    assigneeId: null,
    contextSnapshot: null,
    conversationId: null,
    title: "Việc cần làm",
    description: "Mô tả cụ thể",
    status: "confirmed",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: "2026-09-30",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    isMilestone: false,
    outputValue: null,
    progressPercent: null,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    estimatedDurationMinutes: null,
    requiresPresence: false,
    startAt: null,
    endAt: null,
    location: null,
    latitude: null,
    longitude: null,
    travelDurationMinutes: null,
    departureReminderAt: null,
    createdAt: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

function message(id: string, content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, conversationId: "j1", senderId: ME, content, createdAt: `2026-09-2${id.length}T00:00:00Z`, ...overrides };
}

function attachment(id: string, messageId: string, overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id,
    messageId,
    conversationId: "j1",
    attachedBy: ME,
    kind: "image",
    storagePath: `j1/${id}.png`,
    fileName: `${id}.png`,
    mimeType: "image/png",
    byteSize: 100,
    width: 10,
    height: 10,
    durationSeconds: null,
    permission: "export",
    originMessageId: null,
    createdAt: "2026-09-21T00:00:00Z",
    ...overrides,
  };
}

function pastedSnapshot(text: string, fileNames: string[] = []) {
  return buildPasteSnapshot({
    journalId: "j1",
    journalName: "Nhật ký",
    text,
    fileNames,
    fileNote: fileNames.length === 0 ? null : { id: "m-files", senderId: ME, content: "", createdAt: NOW.toISOString() },
    description: text.trim(),
    now: NOW,
  });
}

describe("A1 — reading what was pasted", () => {
  it("takes plain text and files from a paste event", () => {
    const file = new File(["x"], "bao-gia.pdf", { type: "application/pdf" });
    const paste = pasteFromDataTransfer({
      getData: (type: string) => (type === "text/plain" ? "Báo giá tháng 10" : "<b>ignored</b>"),
      files: [file] as unknown as FileList,
    });
    expect(paste.text).toBe("Báo giá tháng 10");
    expect(paste.files.map((item) => item.name)).toEqual(["bao-gia.pdf"]);
  });

  it("treats blank text with no files as nothing pasted", () => {
    expect(isPasteEmpty({ text: "  \n ", files: [] })).toBe(true);
    expect(isPasteEmpty({ text: "", files: [new File(["x"], "a.png")] })).toBe(false);
  });

  it("fills only the description, trimmed to what a task can hold", () => {
    expect(descriptionFromPaste("  Gọi lại cho chị Lan  ")).toEqual({ description: "Gọi lại cho chị Lan", isTrimmed: false });
    const long = descriptionFromPaste("a".repeat(TASK_DESCRIPTION_MAX_LEN + 50));
    expect(long.description).toHaveLength(TASK_DESCRIPTION_MAX_LEN);
    expect(long.isTrimmed).toBe(true);
  });
});

describe("A2 — the task remembers where it came from", () => {
  it("marks the snapshot external_paste and keeps the pasted words and file names", () => {
    const json = snapshotToJson(pastedSnapshot("Báo giá: 12.500.000đ", ["bao-gia.pdf", "anh.png"]));
    expect(json.origin_type).toBe("external_paste");
    expect(json.origin_content).toBe("Báo giá: 12.500.000đ");
    expect(json.origin_file_names).toEqual(["bao-gia.pdf", "anh.png"]);
    expect(json.conversation_type).toBe("personal");
  });

  it("points at the Diary note holding the files, so Xem trong ngữ cảnh opens them", () => {
    expect(pastedSnapshot("x", ["a.png"]).originalMessageId).toBe("m-files");
    expect(pastedSnapshot("chỉ chữ").originalMessageId).toBeNull();
  });

  it("still carries every key the database requires", () => {
    const json = snapshotToJson(pastedSnapshot("x"));
    for (const key of [
      "conversation_type",
      "conversation_id",
      "conversation_name",
      "original_message_id",
      "original_message_text",
      "original_message_sender_id",
      "original_message_sender_name",
      "original_message_created_at",
      "user_response",
      "snapshot_created_at",
    ]) {
      expect(json).toHaveProperty(key);
    }
  });

  it("survives a round trip, and chat snapshots gain no origin", () => {
    const original = pastedSnapshot("Nội dung", ["f.pdf"]);
    expect(parseContextSnapshot(snapshotToJson(original))).toEqual(original);
    const plain = { ...snapshotToJson(original) };
    delete plain.origin_type;
    expect(parseContextSnapshot(plain)?.origin).toBeUndefined();
  });

  it("caps the stored origin text", () => {
    const origin = pastedSnapshot("b".repeat(ORIGIN_CONTENT_MAX_LEN + 10)).origin;
    expect(origin?.content).toHaveLength(ORIGIN_CONTENT_MAX_LEN);
  });
});

describe("A3 — Nguồn tạo việc", () => {
  const pasted = (id: string, createdAt: string, extra: Partial<TaskItem> = {}) =>
    makeTask({ id, createdAt, contextSnapshot: pastedSnapshot("x"), ...extra });

  it("lists only my own pasted personal tasks, newest first, leaving out the bin", () => {
    const tasks = [
      pasted("old", "2026-09-10T00:00:00Z"),
      pasted("new", "2026-09-22T00:00:00Z"),
      pasted("binned", "2026-09-23T00:00:00Z", { deletedByCreator: true }),
      pasted("theirs", "2026-09-24T00:00:00Z", { creatorId: "u-other" }),
      makeTask({ id: "chat", createdAt: "2026-09-24T00:00:00Z" }),
    ];
    expect(pasteSourceTasks(tasks, ME).map((task) => task.id)).toEqual(["new", "old"]);
    expect(pasteSourceTasks(tasks, undefined)).toEqual([]);
  });

  it("recognises a pasted task by its origin, not by its wording", () => {
    expect(isPastedTask(pasted("p", "2026-09-22T00:00:00Z"))).toBe(true);
    expect(isPastedTask(makeTask({}))).toBe(false);
  });
});

describe("A3 — Nhật ký của bạn and File của bạn", () => {
  const typed = message("m1", "Hôm nay nghĩ về kế hoạch quý");
  const bareFile = message("m22", "");
  const captioned = message("m333", "Ảnh bảng trắng buổi họp");
  const voice = message("m4444", "");
  const deleted = message("m55555", "", { deletedAt: "2026-09-25T00:00:00Z" });
  const files: MessageAttachment[] = [
    attachment("a1", "m22"),
    attachment("a2", "m333", { originMessageId: "src-1", createdAt: "2026-09-24T00:00:00Z" }),
    attachment("a3", "m4444", { kind: "voice", mimeType: "audio/webm" }),
  ];
  const attachmentsOf = (id: string) => files.filter((item) => item.messageId === id);

  it("keeps words, voice notes and deleted notes in the timeline; moves bare files out", () => {
    expect(isFileOnlyNote(bareFile, attachmentsOf("m22"))).toBe(true);
    expect(isFileOnlyNote(captioned, attachmentsOf("m333"))).toBe(false);
    expect(isFileOnlyNote(voice, attachmentsOf("m4444"))).toBe(false);
    expect(isFileOnlyNote(deleted, [])).toBe(false);
    const all = [typed, bareFile, captioned, voice, deleted];
    expect(journalTimeline(all, attachmentsOf).map((item) => item.id)).toEqual(["m1", "m333", "m4444", "m55555"]);
  });

  it("keeps a bare file note in the timeline when a task has just pointed at it", () => {
    expect(journalTimeline([typed, bareFile], attachmentsOf, new Set(["m22"])).map((item) => item.id)).toEqual([
      "m1",
      "m22",
    ]);
  });

  it("lists every photo and file, newest first, with its note and where it came from", () => {
    const notes = diaryFileNotes(files, [typed, bareFile, captioned, voice], new Set());
    expect(notes.map((entry) => entry.messageId)).toEqual(["m333", "m22"]);
    expect(notes[0].note).toBe("Ảnh bảng trắng buổi họp");
    expect(notes[0].source).toBe("forwarded");
    expect(notes[1].source).toBe("uploaded");
  });

  it("names files pasted in to make a task", () => {
    const notes = diaryFileNotes(files, [bareFile], new Set(["m22"]));
    expect(notes.find((entry) => entry.messageId === "m22")?.source).toBe("pasted");
    expect(diaryFileSourceLabel("pasted")).toBe("Dán vào để tạo việc");
    expect(diaryFileSourceLabel("forwarded")).toBe("Chuyển tiếp vào Diary");
  });

  it("offers exactly the three views, with Bảng kept outside them", () => {
    expect(DIARY_VIEWS.map((view) => view.label)).toEqual(["Nhật ký của bạn", "File của bạn", "Nguồn tạo việc"]);
  });
});

describe("Diary list addresses (AVORA 32)", () => {
  it("reads and writes each view as a slug; no slug means the Diary list on a phone", async () => {
    const { diaryViewFromSlug, diaryViewSlug, countDiaryFileNotes } = await import("@/lib/diary-views");
    for (const view of ["journal", "files", "sources"] as const) {
      expect(diaryViewFromSlug(diaryViewSlug(view))).toBe(view);
    }
    expect(diaryViewFromSlug(null)).toBeNull();
    expect(diaryViewFromSlug("khac")).toBeNull();
    const at = (messageId: string, kind: string) => ({ messageId, kind }) as never;
    expect(countDiaryFileNotes([at("m1", "image"), at("m1", "file"), at("m2", "voice"), at("m3", "file")])).toBe(2);
  });
});
