import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { ChatTaskPanel } from "@/components/chat/ChatTaskPanel";
import type { GroupMember } from "@/lib/groups";
import type { TaskItem } from "@/lib/tasks";

const ME = "u-me";
const BOSS = "u-boss";
const HOA = "u-hoa";
const DUNG = "u-dung";

const state = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

vi.mock("@/lib/use-tasks", () => ({
  useTasks: () => ({ data: state.tasks }),
  useTaskActions: () => ({
    confirmShared: { mutateAsync: async () => {}, isPending: false },
    markSharedDone: { mutateAsync: async () => {}, isPending: false },
    reviewSharedDone: { mutateAsync: async () => {}, isPending: false },
    returnShared: { mutateAsync: async () => {}, isPending: false },
    deleteShared: { mutateAsync: async () => {}, isPending: false },
  }),
}));

function task(overrides: Partial<TaskItem> & { id: string; title: string }): TaskItem {
  return {
    type: "group-shared",
    creatorId: BOSS,
    assigneeId: ME,
    contextSnapshot: null,
    conversationId: "conv-group",
    description: "Mô tả",
    status: "pending_confirmation",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    deadline: "2099-09-20",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function member(userId: string, displayName: string): GroupMember {
  return {
    userId,
    displayName,
    email: `${userId}@avora.vn`,
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
  };
}

const MEMBERS: GroupMember[] = [member(BOSS, "Sếp Minh"), member(ME, "Chính tôi"), member(HOA, "Hoà")];

function panel(scope: "mine" | "all") {
  return render(
    <div style={{ width: 375 }}>
      <ChatTaskPanel
        conversationId="conv-group"
        peerName="Nhóm dự án"
        members={MEMBERS}
        highlightTaskId={null}
        scope={scope}
      />
    </div>,
  );
}

beforeEach(() => {
  state.tasks = [];
});

test("the panel is called Nhiệm vụ chung", async () => {
  state.tasks = [task({ id: "t1", title: "Việc của tôi" })];
  const screen = await panel("mine");

  await expect.element(screen.getByRole("region", { name: "Nhiệm vụ chung" })).toBeInTheDocument();
  await expect.element(screen.getByText("Nhiệm vụ chung")).toBeVisible();
});

test("a group chat shows the viewer's own work and leaves out everybody else's", async () => {
  state.tasks = [
    task({ id: "mine", title: "Việc giao cho tôi", assigneeId: ME, creatorId: BOSS }),
    task({ id: "gave", title: "Việc tôi giao cho Hoà", assigneeId: HOA, creatorId: ME }),
    task({ id: "theirs", title: "Việc giữa hai người khác", assigneeId: HOA, creatorId: BOSS }),
    task({ id: "more", title: "Việc của Dũng", assigneeId: DUNG, creatorId: BOSS }),
  ];
  const screen = await panel("mine");

  await expect.element(screen.getByText("Việc giao cho tôi")).toBeVisible();
  // The creator keeps sight of what they are waiting on — they alone can close it.
  await expect.element(screen.getByText("Việc tôi giao cho Hoà")).toBeVisible();

  expect(screen.container.textContent).not.toContain("Việc giữa hai người khác");
  expect(screen.container.textContent).not.toContain("Việc của Dũng");
});

test("a 1-1 chat still shows the whole thread, because there are only two people in it", async () => {
  state.tasks = [
    task({ id: "a", title: "Việc của tôi", type: "1-1-shared", conversationId: "conv-group" }),
    task({
      id: "b",
      title: "Việc tôi giao lại",
      type: "1-1-shared",
      creatorId: ME,
      assigneeId: BOSS,
      conversationId: "conv-group",
    }),
  ];
  const screen = await panel("all");

  await expect.element(screen.getByText("Việc của tôi")).toBeVisible();
  await expect.element(screen.getByText("Việc tôi giao lại")).toBeVisible();
});

test("a group task the viewer must accept still reaches them", async () => {
  state.tasks = [
    task({ id: "mine", title: "Việc cần nhận", assigneeId: ME, status: "pending_confirmation" }),
  ];
  const screen = await panel("mine");

  await expect.element(screen.getByRole("button", { name: "Nhận việc" })).toBeVisible();
});

test("nothing of the viewer's own means no panel at all, rather than an empty one", async () => {
  state.tasks = [task({ id: "theirs", title: "Việc của người khác", assigneeId: HOA, creatorId: BOSS })];
  const screen = await panel("mine");

  expect(screen.container.textContent).toBe("");
});
