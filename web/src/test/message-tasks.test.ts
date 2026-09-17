import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  describeMessageTasks,
  summarizeMessageTasks,
  type MessageTaskMark,
} from "@/lib/message-tasks";

const ME = "u-me";
const THEM = "u-them";
const THIRD = "u-third";
const MSG = "m1";
const OTHER_MSG = "m2";

function mark(overrides: Partial<MessageTaskMark> = {}): MessageTaskMark {
  return {
    suggestionId: "s1",
    messageId: MSG,
    assigneeId: THEM,
    taskId: null,
    ...overrides,
  };
}

describe("what a message is marked with", () => {
  it("shows nothing at all when no work came out of it", () => {
    expect(summarizeMessageTasks([], MSG, ME)).toBeNull();
  });

  it("ignores work belonging to a different message", () => {
    const marks = [mark({ messageId: OTHER_MSG })];
    expect(summarizeMessageTasks(marks, MSG, ME)).toBeNull();
  });

  it("is somebody else's work when the reader is not the one carrying it", () => {
    const summary = summarizeMessageTasks([mark({ assigneeId: THEM })], MSG, ME);
    expect(summary?.tone).toBe("others");
  });

  it("is the reader's own when it was assigned to them", () => {
    const summary = summarizeMessageTasks([mark({ assigneeId: ME })], MSG, ME);
    expect(summary?.tone).toBe("mine");
  });

  /**
   * The rule that decides the colour when a message produced work for several people: the
   * reader's own promise is the reason they would look twice at an old message, so it wins.
   */
  it("prefers the reader's own when one message produced work for several people", () => {
    const marks = [
      mark({ suggestionId: "s1", assigneeId: THEM }),
      mark({ suggestionId: "s2", assigneeId: ME }),
      mark({ suggestionId: "s3", assigneeId: THIRD }),
    ];
    const summary = summarizeMessageTasks(marks, MSG, ME);
    expect(summary?.tone).toBe("mine");
    expect(summary?.count).toBe(3);
  });

  it("collapses several pieces of work into one mark rather than a row of dots", () => {
    const marks = [
      mark({ suggestionId: "s1", assigneeId: THEM }),
      mark({ suggestionId: "s2", assigneeId: THIRD }),
    ];
    const summary = summarizeMessageTasks(marks, MSG, ME);
    expect(summary?.count).toBe(2);
  });

  it("is other people's work when the reader is signed out entirely", () => {
    const summary = summarizeMessageTasks([mark({ assigneeId: ME })], MSG, undefined);
    expect(summary?.tone).toBe("others");
  });
});

describe("where pressing the mark leads", () => {
  it("opens the task once one exists", () => {
    const summary = summarizeMessageTasks([mark({ taskId: "t1" })], MSG, ME);
    expect(summary?.taskId).toBe("t1");
  });

  it("falls back to the suggestion while the work is still a question", () => {
    const summary = summarizeMessageTasks([mark({ suggestionId: "s9" })], MSG, ME);
    expect(summary?.taskId).toBeNull();
    expect(summary?.suggestionId).toBe("s9");
  });

  /** A dot that leads nowhere is worse than no dot, so a real task is always preferred. */
  it("prefers a mark that became a task over one still waiting", () => {
    const marks = [
      mark({ suggestionId: "pending", assigneeId: ME, taskId: null }),
      mark({ suggestionId: "accepted", assigneeId: ME, taskId: "t7" }),
    ];
    const summary = summarizeMessageTasks(marks, MSG, ME);
    expect(summary?.taskId).toBe("t7");
  });

  it("still prefers the reader's own over a stranger's finished task", () => {
    const marks = [
      mark({ suggestionId: "theirs", assigneeId: THEM, taskId: "t-theirs" }),
      mark({ suggestionId: "mine", assigneeId: ME, taskId: "t-mine" }),
    ];
    const summary = summarizeMessageTasks(marks, MSG, ME);
    expect(summary?.taskId).toBe("t-mine");
  });
});

describe("what the mark says out loud", () => {
  it("names whose work it is", () => {
    const mine = summarizeMessageTasks([mark({ assigneeId: ME })], MSG, ME);
    const theirs = summarizeMessageTasks([mark({ assigneeId: THEM })], MSG, ME);
    expect(describeMessageTasks(mine!)).toContain("nhiệm vụ của bạn");
    expect(describeMessageTasks(theirs!)).toContain("nhiệm vụ");
  });

  it("counts out loud only when there is more than one", () => {
    const one = summarizeMessageTasks([mark()], MSG, ME);
    expect(describeMessageTasks(one!)).not.toContain("(");

    const many = summarizeMessageTasks(
      [mark({ suggestionId: "a" }), mark({ suggestionId: "b" })],
      MSG,
      ME,
    );
    expect(describeMessageTasks(many!)).toContain("(2)");
  });
});
