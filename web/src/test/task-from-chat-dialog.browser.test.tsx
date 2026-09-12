import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { TaskFromChatDialog } from "@/components/chat/TaskFromChatDialog";
import type { GroupMember } from "@/lib/groups";
import type { SharedTaskTarget, TaskDraft } from "@/lib/tasks";

/** Every call the dialog makes to create a task, captured in order. */
const state = vi.hoisted(() => ({
  calls: [] as { target: SharedTaskTarget; draft: TaskDraft }[],
  toasts: [] as string[],
  failOn: null as number | null,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

vi.mock("@/lib/use-tasks", () => ({
  useTaskActions: () => ({
    addShared: {
      isPending: false,
      mutateAsync: async (input: { target: SharedTaskTarget; draft: TaskDraft }) => {
        state.calls.push(input);
        if (state.failOn !== null && state.calls.length === state.failOn) {
          throw new Error("Mất kết nối");
        }
        return { id: `t-${state.calls.length}` };
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => state.toasts.push(`success:${message}`),
    error: (message: string) => state.toasts.push(`error:${message}`),
  },
}));

function member(userId: string, displayName: string): GroupMember {
  return {
    userId,
    displayName,
    email: `${userId}@avora.vn`,
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
  };
}

const MEMBERS: GroupMember[] = [
  member("u-hoa", "Nguyễn Thị Hoà"),
  member("u-dung", "Trần Dũng"),
  member("u-dat", "Đặng Văn Đạt"),
  member("u-me", "Chính tôi"),
];

const MESSAGE = {
  id: "m-42",
  senderId: "u-hoa",
  content: "Tuần này mình cần bản kế hoạch nhé",
  createdAt: "2026-09-10T02:00:00.000Z",
};

function renderDialog() {
  return render(
    <TaskFromChatDialog
      open
      onOpenChange={() => {}}
      conversationId="conv-group"
      conversationKind="group"
      conversationName="Nhóm dự án"
      peerId={null}
      peerName="Nhóm dự án"
      members={MEMBERS}
      contextMessage={MESSAGE}
      contextSenderName="Nguyễn Thị Hoà"
    />,
  );
}

/** Fills the three required fields, then picks the named people. */
async function fillAndAssign(
  screen: Awaited<ReturnType<typeof renderDialog>>,
  names: RegExp[],
): Promise<void> {
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Lập kế hoạch tuần");
  await userEvent.fill(screen.getByLabelText("Mô tả cụ thể"), "Mỗi người một phần, gửi trước thứ sáu");
  await userEvent.fill(screen.getByLabelText("Hạn hoàn thành"), "2099-09-20");

  for (const name of names) {
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name }));
  }
}

beforeEach(() => {
  state.calls = [];
  state.toasts = [];
  state.failOn = null;
});

test("choosing three people creates three separate tasks, one per person", async () => {
  const screen = await renderDialog();
  await fillAndAssign(screen, [/Hoà/, /Dũng/, /Đạt/]);

  await userEvent.click(screen.getByRole("button", { name: "Giao việc" }));

  await vi.waitFor(() => expect(state.calls).toHaveLength(3));
  expect(state.calls.map((call) => call.target.assigneeId)).toEqual(["u-hoa", "u-dung", "u-dat"]);
});

test("each of the three carries the same wording, deadline and quoted message", async () => {
  const screen = await renderDialog();
  await fillAndAssign(screen, [/Hoà/, /Dũng/, /Đạt/]);
  await userEvent.click(screen.getByRole("button", { name: "Giao việc" }));
  await vi.waitFor(() => expect(state.calls).toHaveLength(3));

  const titles = new Set(state.calls.map((call) => call.draft.title));
  const deadlines = new Set(state.calls.map((call) => call.draft.deadline));
  const quoted = new Set(state.calls.map((call) => call.target.contextSnapshot?.originalMessageId));

  expect(titles).toEqual(new Set(["Lập kế hoạch tuần"]));
  expect(deadlines).toEqual(new Set(["2099-09-20"]));
  expect(quoted).toEqual(new Set(["m-42"]));
});

test("the three rows differ in exactly one thing: who was asked", async () => {
  const screen = await renderDialog();
  await fillAndAssign(screen, [/Hoà/, /Dũng/, /Đạt/]);
  await userEvent.click(screen.getByRole("button", { name: "Giao việc" }));
  await vi.waitFor(() => expect(state.calls).toHaveLength(3));

  const assignees = state.calls.map((call) => call.target.assigneeId);
  expect(new Set(assignees).size).toBe(3);

  // Nothing else about the target varies — no shared row, no group ownership.
  for (const call of state.calls) {
    expect(call.target.type).toBe("group-shared");
    expect(call.target.conversationId).toBe("conv-group");
  }
});

test("one person still means exactly one task", async () => {
  const screen = await renderDialog();
  await fillAndAssign(screen, [/Dũng/]);
  await userEvent.click(screen.getByRole("button", { name: "Giao việc" }));

  await vi.waitFor(() => expect(state.calls).toHaveLength(1));
  expect(state.calls[0].target.assigneeId).toBe("u-dung");
});

test("nothing is created until somebody is chosen", async () => {
  const screen = await renderDialog();
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Việc gì đó");
  await userEvent.fill(screen.getByLabelText("Mô tả cụ thể"), "Mô tả");
  await userEvent.fill(screen.getByLabelText("Hạn hoàn thành"), "2099-09-20");

  await expect.element(screen.getByRole("button", { name: "Giao việc" })).toBeDisabled();
  expect(state.calls).toEqual([]);
});

test("a failure halfway is reported honestly rather than claiming all of them landed", async () => {
  state.failOn = 2;
  const screen = await renderDialog();
  await fillAndAssign(screen, [/Hoà/, /Dũng/, /Đạt/]);

  await userEvent.click(screen.getByRole("button", { name: "Giao việc" }));

  await vi.waitFor(() => expect(state.toasts).toHaveLength(1));
  expect(state.toasts[0]).toContain("error:");
  expect(state.toasts[0]).toContain("1/3");
});

test("the message being answered is quoted on the task", async () => {
  const screen = await renderDialog();
  await expect.element(screen.getByText("Tuần này mình cần bản kế hoạch nhé")).toBeVisible();
  await expect.element(screen.getByText("Gắn với tin nhắn của Nguyễn Thị Hoà")).toBeVisible();
});
