import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

// Pure-logic tests; the client refuses to construct without real credentials, so the rpc
// surface is a mock whose arguments the assertions inspect.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  canManageSuggestion,
  editTaskSuggestion,
  pendingInConversation,
  suggestionsAwaiting,
  suggestionsProposed,
  toVietnameseSuggestionError,
  upsertSuggestion,
  withdrawTaskSuggestion,
  type TaskSuggestion,
} from "@/lib/task-suggestions";

const ME = "u-me";
const PEER = "u-peer";
const OTHER = "u-other";

function makeSuggestion(overrides: Partial<TaskSuggestion> & { id: string }): TaskSuggestion {
  return {
    conversationId: "conv-1",
    messageId: "msg-1",
    proposerId: ME,
    assigneeId: PEER,
    title: "Soạn báo cáo",
    description: "Tổng hợp số liệu",
    deadline: "2099-09-20",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    contextSnapshot: null,
    status: "pending",
    skippedSilently: false,
    acceptedTaskId: null,
    resolvedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function makeRow(status: string) {
  return {
    id: "a",
    conversation_id: "conv-1",
    message_id: "msg-1",
    proposer_id: ME,
    assignee_id: PEER,
    proposed_title: "Bản mới",
    proposed_description: "Mô tả mới",
    proposed_deadline: "2099-09-25",
    proposed_deadline_time: "09:30:00",
    proposed_deadline_tz: "Asia/Ho_Chi_Minh",
    context_snapshot: null,
    status,
    skipped_silently: false,
    accepted_task_id: null,
    resolved_at: status === "pending" ? null : "2026-09-02T05:00:00+00",
    created_at: "2026-09-01T00:00:00Z",
  };
}

describe("only the proposer manages a still-open suggestion", () => {
  it("the proposer may reword or take it back while it is pending", () => {
    expect(canManageSuggestion(makeSuggestion({ id: "s1" }), ME)).toBe(true);
  });

  it("the assignee cannot manage somebody else's ask", () => {
    expect(canManageSuggestion(makeSuggestion({ id: "s2" }), PEER)).toBe(false);
  });

  it("a bystander cannot either", () => {
    expect(canManageSuggestion(makeSuggestion({ id: "s3" }), OTHER)).toBe(false);
  });

  it("once answered, nobody manages it — accepted, skipped or withdrawn alike", () => {
    expect(
      canManageSuggestion(
        makeSuggestion({ id: "s4", status: "accepted", resolvedAt: "2026-09-02T00:00:00Z" }),
        ME,
      ),
    ).toBe(false);
    expect(
      canManageSuggestion(
        makeSuggestion({ id: "s5", status: "skipped", resolvedAt: "2026-09-02T00:00:00Z" }),
        ME,
      ),
    ).toBe(false);
    expect(
      canManageSuggestion(
        makeSuggestion({ id: "s6", status: "withdrawn", resolvedAt: "2026-09-02T00:00:00Z" }),
        ME,
      ),
    ).toBe(false);
  });

  it("signed out, nothing is manageable", () => {
    expect(canManageSuggestion(makeSuggestion({ id: "s7" }), undefined)).toBe(false);
  });
});

describe("a withdrawn question leaves every list", () => {
  const list = [
    makeSuggestion({ id: "a", status: "withdrawn", resolvedAt: "2026-09-02T00:00:00Z" }),
    makeSuggestion({ id: "b" }),
  ];

  it("no longer counted among what this person proposed", () => {
    expect(suggestionsProposed(list, ME).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("no longer waiting on the assignee", () => {
    expect(suggestionsAwaiting(list, PEER).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("no longer pending in the conversation", () => {
    expect(pendingInConversation(list, "conv-1").map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("the cache follows a withdrawal", () => {
  it("replaces the pending row with the resolved one", () => {
    const cached = [makeSuggestion({ id: "a" })];
    const next = upsertSuggestion(
      cached,
      makeSuggestion({ id: "a", status: "withdrawn", resolvedAt: "2026-09-02T00:00:00Z" }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe("withdrawn");
    expect(next[0]?.resolvedAt).toBe("2026-09-02T00:00:00Z");
  });

  it("keeps the same reference when nothing actually changed", () => {
    const cached = [makeSuggestion({ id: "a" })];
    expect(upsertSuggestion(cached, makeSuggestion({ id: "a" }))).toBe(cached);
  });
});

describe("errors in plain words", () => {
  it("names the proposer's monopoly", () => {
    expect(toVietnameseSuggestionError(undefined, "avora_task_not_proposer")).toBe(
      "Chỉ người gợi ý mới làm được điều này.",
    );
  });

  it("keeps the answered and missing wordings", () => {
    expect(toVietnameseSuggestionError(undefined, "avora_suggestion_already_answered")).toBe(
      "Gợi ý này đã được trả lời rồi.",
    );
    expect(toVietnameseSuggestionError(undefined, "avora_suggestion_not_found")).toBe(
      "Không tìm thấy gợi ý này. Có thể nó đã được gỡ.",
    );
  });
});

describe("an edit sends only the wording", () => {
  it("passes title, description, deadline and time; maps the row back", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow("pending"), error: null });
    const result = await editTaskSuggestion("a", {
      title: "Bản mới",
      description: "Mô tả mới",
      deadline: "2099-09-25",
      deadlineTime: "09:30",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "edit_task_suggestion",
      expect.objectContaining({
        p_suggestion_id: "a",
        p_title: "Bản mới",
        p_description: "Mô tả mới",
        p_deadline: "2099-09-25",
        p_deadline_time: "09:30",
      }),
    );
    expect(result.title).toBe("Bản mới");
    expect(result.status).toBe("pending");
    // Postgres answers with HH:MM:SS; the suggestion carries the form's HH:MM.
    expect(result.deadlineTime).toBe("09:30");
  });

  it("refuses an answered suggestion in Vietnamese", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "avora_suggestion_already_answered" },
    });
    await expect(
      editTaskSuggestion("a", {
        title: "T",
        description: "D",
        deadline: "2099-09-25",
        deadlineTime: null,
      }),
    ).rejects.toThrow("Gợi ý này đã được trả lời rồi.");
  });
});

describe("a withdrawal resolves the question", () => {
  it("carries the withdrawn status back", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow("withdrawn"), error: null });
    const result = await withdrawTaskSuggestion("a");
    expect(rpcMock).toHaveBeenCalledWith("withdraw_task_suggestion", { p_suggestion_id: "a" });
    expect(result.status).toBe("withdrawn");
    expect(result.resolvedAt).toBe("2026-09-02T05:00:00+00");
    expect(result.skippedSilently).toBe(false);
  });

  it("surfaces a refusal as a Vietnamese error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "avora_task_not_proposer" },
    });
    await expect(withdrawTaskSuggestion("a")).rejects.toThrow(
      "Chỉ người gợi ý mới làm được điều này.",
    );
  });
});
