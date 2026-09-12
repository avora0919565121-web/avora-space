import { describe, expect, it } from "vitest";

import {
  buildContextSnapshot,
  contextLink,
  contextTarget,
  CONTEXT_TASK_PARAM,
  DELETED_MESSAGE_NOTE,
  isOriginalMessageMissing,
  parseContextSnapshot,
  snapshotToJson,
  type ContextMessage,
} from "@/lib/task-context";

const MESSAGE: ContextMessage = {
  id: "m-7",
  senderId: "u-them",
  content: "Chiều mai gửi mình bản báo giá nhé",
  createdAt: "2026-09-09T03:00:00.000Z",
};

const NOW = new Date("2026-09-09T04:00:00.000Z");

function snapshot() {
  return buildContextSnapshot({
    conversationType: "direct",
    conversationId: "conv-1",
    conversationName: "Minh",
    message: MESSAGE,
    senderName: "Minh",
    userResponse: "Gửi báo giá bản PDF",
    now: NOW,
  });
}

describe("buildContextSnapshot", () => {
  it("copies the message that prompted the task, word for word", () => {
    const result = snapshot();
    expect(result.originalMessageId).toBe("m-7");
    expect(result.originalMessageText).toBe("Chiều mai gửi mình bản báo giá nhé");
    expect(result.originalMessageSenderId).toBe("u-them");
    expect(result.originalMessageSenderName).toBe("Minh");
    expect(result.originalMessageCreatedAt).toBe("2026-09-09T03:00:00.000Z");
    expect(result.userResponse).toBe("Gửi báo giá bản PDF");
    expect(result.snapshotCreatedAt).toBe("2026-09-09T04:00:00.000Z");
  });

  it("records an empty thread as having no quote rather than a blank author", () => {
    const result = buildContextSnapshot({
      conversationType: "group",
      conversationId: "conv-2",
      conversationName: "Nhóm dự án",
      message: null,
      senderName: "Minh",
      userResponse: "Chuẩn bị tài liệu",
      now: NOW,
    });
    expect(result.originalMessageId).toBeNull();
    expect(result.originalMessageText).toBe("");
    expect(result.originalMessageSenderName).toBe("");
    expect(result.originalMessageCreatedAt).toBeNull();
  });
});

describe("snapshotToJson", () => {
  it("carries every key the database insists on", () => {
    const json = snapshotToJson(snapshot());
    // The trigger rejects a snapshot missing any one of these, so all ten must be present
    // even when empty — a missing key and an empty value must not look the same.
    expect(Object.keys(json).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(json.conversation_type).toBe("direct");
    expect(json.conversation_id).toBe("conv-1");
  });

  it("survives a round trip back into a snapshot", () => {
    const original = snapshot();
    expect(parseContextSnapshot(snapshotToJson(original))).toEqual(original);
  });
});

describe("parseContextSnapshot", () => {
  it("reads nothing out of a value that is not a snapshot", () => {
    expect(parseContextSnapshot(null)).toBeNull();
    expect(parseContextSnapshot("chuỗi")).toBeNull();
    expect(parseContextSnapshot([])).toBeNull();
    expect(parseContextSnapshot({})).toBeNull();
  });

  it("refuses a snapshot with no conversation or an unknown kind of one", () => {
    const json = snapshotToJson(snapshot());
    expect(parseContextSnapshot({ ...json, conversation_id: "" })).toBeNull();
    expect(parseContextSnapshot({ ...json, conversation_type: "email" })).toBeNull();
  });

  it("treats a blank message id as no quote at all", () => {
    const json = { ...snapshotToJson(snapshot()), original_message_id: "" };
    expect(parseContextSnapshot(json)?.originalMessageId).toBeNull();
  });
});

describe("isOriginalMessageMissing", () => {
  it("stays quiet while the quoted message is still in the thread", () => {
    expect(isOriginalMessageMissing(snapshot(), ["m-6", "m-7", "m-8"])).toBe(false);
  });

  it("speaks up once the quoted message is gone", () => {
    expect(isOriginalMessageMissing(snapshot(), ["m-6", "m-8"])).toBe(true);
    expect(DELETED_MESSAGE_NOTE).toBe("Tin nhắn gốc đã bị xoá");
  });

  it("does not cry deletion over a task that never quoted anything", () => {
    const noQuote = buildContextSnapshot({
      conversationType: "direct",
      conversationId: "conv-1",
      conversationName: "Minh",
      message: null,
      senderName: "",
      userResponse: "Việc mới",
      now: NOW,
    });
    expect(isOriginalMessageMissing(noQuote, [])).toBe(false);
    expect(isOriginalMessageMissing(null, [])).toBe(false);
  });
});

describe("contextTarget", () => {
  it("points at the conversation and message the snapshot remembers", () => {
    expect(contextTarget(snapshot(), null)).toEqual({ conversationId: "conv-1", messageId: "m-7" });
  });

  it("falls back to the task's own conversation for tasks written before snapshots", () => {
    expect(contextTarget(null, "conv-9")).toEqual({ conversationId: "conv-9", messageId: null });
  });

  it("has nowhere to send a personal task", () => {
    expect(contextTarget(null, null)).toBeNull();
  });
});

describe("contextLink", () => {
  it("addresses the conversation and names the task that asked for it", () => {
    expect(contextLink("conv-1", "task-3")).toBe(`/tin-nhan/conv-1?${CONTEXT_TASK_PARAM}=task-3`);
  });
});

/**
 * A task can be raised from the composer, which quotes the end of the thread, or from a
 * particular bubble, which quotes that bubble. Both doors reach this same builder — what
 * differs is only which message is handed to it.
 */
describe("quoting a chosen message rather than the newest one", () => {
  const OLDER: ContextMessage = {
    id: "m-3",
    senderId: "u-them",
    content: "Tuần sau mình cần bản kế hoạch",
    createdAt: "2026-09-09T01:00:00.000Z",
  };
  const NEWEST: ContextMessage = {
    id: "m-9",
    senderId: "u-me",
    content: "Ok bạn nhé",
    createdAt: "2026-09-09T03:30:00.000Z",
  };

  function quoting(message: ContextMessage, senderName: string) {
    return buildContextSnapshot({
      conversationType: "group",
      conversationId: "conv-group",
      conversationName: "Nhóm dự án",
      message,
      senderName,
      userResponse: "Lập kế hoạch tuần",
      now: NOW,
    });
  }

  it("keeps the message it was given, even when later ones exist", () => {
    const result = quoting(OLDER, "Hoà");
    expect(result.originalMessageId).toBe("m-3");
    expect(result.originalMessageText).toBe("Tuần sau mình cần bản kế hoạch");
    expect(result.originalMessageSenderName).toBe("Hoà");
  });

  it("quotes the end of the thread when that is what was chosen", () => {
    const result = quoting(NEWEST, "Bạn");
    expect(result.originalMessageId).toBe("m-9");
    expect(result.originalMessageSenderName).toBe("Bạn");
  });

  it("names the author of the quoted message, not of the newest one", () => {
    expect(quoting(OLDER, "Hoà").originalMessageSenderId).toBe("u-them");
    expect(quoting(NEWEST, "Bạn").originalMessageSenderId).toBe("u-me");
  });

  it("still sends the reader to that exact message afterwards", () => {
    const target = contextTarget(quoting(OLDER, "Hoà"), null);
    expect(target).toEqual({ conversationId: "conv-group", messageId: "m-3" });
  });

  it("treats an older quote as present while the thread still holds it", () => {
    const snapshotOfOlder = quoting(OLDER, "Hoà");
    expect(isOriginalMessageMissing(snapshotOfOlder, ["m-3", "m-9"])).toBe(false);
    // And as deleted once that particular message is gone, even if newer ones remain.
    expect(isOriginalMessageMissing(snapshotOfOlder, ["m-9"])).toBe(true);
  });
});
