import { expect, test, describe, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { ConversationSummary } from "@/lib/chat";
import type { Project } from "@/lib/projects";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { ProjectList } = await import("@/components/projects/ProjectList");

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    conversationId: "c-journal",
    createdBy: "u-me",
    title: "Ra mắt bản thử",
    purpose: null,
    scope: null,
    successCriteria: null,
    assumptions: null,
    status: "active",
    createdAt: "2026-09-17T08:00:00.000Z",
    updatedAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: "c-journal",
    kind: "personal",
    peerId: null,
    peerName: "",
    peerEmail: null,
    groupName: null,
    memberCount: 1,
    lastMessageContent: null,
    lastMessageAt: null,
    lastMessageSenderId: null,
    unreadCount: 0,
    peerLastReadAt: null,
    sortAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

const CONVERSATIONS: ConversationSummary[] = [
  conversation(),
  conversation({
    conversationId: "c-direct",
    kind: "direct",
    peerId: "u-ngoc",
    peerName: "Ngọc",
    peerEmail: "ngoc@vidu.com",
    memberCount: 2,
  }),
  conversation({
    conversationId: "c-group",
    kind: "group",
    groupName: "Nhóm sản phẩm",
    memberCount: 4,
  }),
];

async function renderList(projects: Project[], onNewProject: () => void = () => {}) {
  return await render(
    <MemoryRouter>
      <ProjectList
        projects={projects}
        conversations={CONVERSATIONS}
        activeProjectId={undefined}
        onNewProject={onNewProject}
        isPending={false}
      />
    </MemoryRouter>,
  );
}

describe("the Dự án tab groups projects by who can see them", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("shows the three headings, so nobody has to guess who a project is shared with", async () => {
    const screen = await renderList([]);

    // Exact matching: the heading "1-1" is also a substring of the empty-state sentence
    // underneath it, and "Nhóm" of the group's own name.
    await expect.element(screen.getByText("Cá nhân", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("1-1", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Nhóm", { exact: true })).toBeInTheDocument();
  });

  test("names each project under its own group, and says who else is in it", async () => {
    const screen = await renderList([
      project({ id: "p1", conversationId: "c-journal", title: "Dọn nhà cửa" }),
      project({ id: "p2", conversationId: "c-direct", title: "Hợp tác với Ngọc" }),
      project({ id: "p3", conversationId: "c-group", title: "Ra mắt bản thử" }),
    ]);

    await expect.element(screen.getByText("Dọn nhà cửa")).toBeInTheDocument();
    await expect.element(screen.getByText("Hợp tác với Ngọc")).toBeInTheDocument();
    await expect.element(screen.getByText("Ra mắt bản thử")).toBeInTheDocument();

    // A personal project says so plainly; the other two name the room they belong to.
    await expect.element(screen.getByText("Chỉ mình bạn")).toBeInTheDocument();
    // Exact: the peer's name also appears inside the project title "Hợp tác với Ngọc".
    await expect.element(screen.getByText("Ngọc", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Nhóm sản phẩm")).toBeInTheDocument();
  });

  test("points each row at its project", async () => {
    const screen = await renderList([project({ id: "p-42", title: "Dọn nhà cửa" })]);

    const link = screen.getByRole("link", { name: /Dọn nhà cửa/ });
    await expect.element(link).toHaveAttribute("href", "/du-an/p-42");
  });

  test("explains each empty group instead of leaving a blank column", async () => {
    const screen = await renderList([]);

    await expect
      .element(screen.getByText(/Chưa có dự án riêng nào/))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Chưa có dự án nào với một người/))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/Chưa có dự án nhóm nào/)).toBeInTheDocument();
  });

  test("offers to open a personal project, the one kind that starts outside a chat", async () => {
    let opened = 0;
    const screen = await renderList([], () => {
      opened += 1;
    });

    await screen.getByRole("button", { name: "Dự án riêng mới" }).click();
    expect(opened).toBe(1);
  });

  test("holds back a project whose conversation it cannot place, rather than mislabelling it", async () => {
    // Filing it under the wrong heading would misstate who can read it. It appears as soon as
    // the inbox answers for that conversation.
    const screen = await renderList([
      project({ id: "p-unknown", conversationId: "c-not-loaded", title: "Dự án lạ" }),
    ]);

    await expect.element(screen.getByText(/Chưa có dự án riêng nào/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Dự án lạ");
  });
});
