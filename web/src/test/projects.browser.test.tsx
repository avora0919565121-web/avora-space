import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router-dom";

import type { ConversationSummary } from "@/lib/chat";
import type { Project } from "@/lib/projects";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";

const state = vi.hoisted(() => ({
  tables: [] as ThinkTable[],
  records: [] as ThinkRecord[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));
vi.mock("@/lib/use-think-hub", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-think-hub")>("@/lib/use-think-hub");
  return {
    ...actual,
    useThinkTables: () => ({ data: state.tables, isPending: false }),
    useThinkRecords: () => ({ data: state.records, isPending: false }),
  };
});

const { ProjectList } = await import("@/components/projects/ProjectList");

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    conversationId: "c-group",
    parentGroupId: null,
    createdBy: "u-me",
    title: "Ra mắt bản thử",
    valueOrientation: "Phục vụ khách",
    objective: "Giao hàng đúng hạn",
    scope: null,
    assumptions: null,
    startDate: "2026-09-20",
    targetEndDate: "2026-10-20",
    status: "active",
    closedAt: null,
    thanksMessageId: null,
    deletedAt: null,
    deleteReason: null,
    createdAt: "2026-09-17T08:00:00.000Z",
    updatedAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

function table(overrides: Partial<ThinkTable> & { id: string; name: string }): ThinkTable {
  return {
    ownerUserId: "u-me",
    position: 0,
    columns: [],
    projectId: null,
    conversationId: null,
    parentRecordId: null,
    depth: 1,
    purpose: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    statusOptions: null, titleLabel: null, defaultView: null, mobileColumns: [], sourceTemplateKey: null, archivedAt: null, kind: null, orphanOrigin: null, 
    ...overrides,
  };
}

function record(overrides: Partial<ThinkRecord> & { id: string; tableId: string; title: string }): ThinkRecord {
  return {
    ownerUserId: "u-me",
    status: "moi",
    priority: "trung_binh",
    category: null,
    nextActionDate: null,
    remindAt: null,
    tags: [],
    notes: null,
    extensionFields: {},
    projectId: null,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    deletedAt: null,
    movedFrom: null,
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
    sortAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

const CONVERSATIONS: ConversationSummary[] = [
  conversation(),
  conversation({ conversationId: "c-direct", kind: "direct", peerId: "u-ngoc", peerName: "Ngọc", memberCount: 2 }),
  conversation({ conversationId: "c-group", kind: "group", groupName: "Nhóm sản phẩm", memberCount: 4 }),
];

async function renderList(projects: Project[]) {
  const client = new QueryClient();
  return await render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectList projects={projects} conversations={CONVERSATIONS} activeProjectId={undefined} isPending={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the Dự án tab: group projects only", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    state.tables = [];
    state.records = [];
  });

  // KT-07b (CEO 12/11 · 4, QA-02 CC-33): this tab shows projects only — boards live in Thư phòng › Kế hoạch.
  test("shows projects only — no Danh sách bảng, no personal or 1-1 sections", async () => {
    state.tables = [table({ id: "t-mine", name: "Sổ riêng" }), table({ id: "t-project", name: "Bảng của dự án", projectId: "p1" })];
    const screen = await renderList([]);
    await expect.element(screen.getByText("Trò chuyện dự án", { exact: true })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Danh sách bảng");
    expect(document.body.textContent).not.toContain("Sổ riêng");
    expect(document.body.textContent).not.toContain("Bảng của dự án");
    expect(document.body.textContent).not.toContain("Cá nhân");
  });

  test("lists only projects living in a group, each pointing at its conversation (52 · E)", async () => {
    const screen = await renderList([
      project({ id: "p-42", conversationId: "c-group", title: "Ra mắt bản thử" }),
      project({ id: "p-old", conversationId: "c-journal", title: "Dự án cũ trong Nhật ký" }),
    ]);
    const link = screen.getByRole("link", { name: /Ra mắt bản thử/ });
    await expect.element(link).toHaveAttribute("href", "/tin-nhan/c-group");
    expect(document.body.textContent).not.toContain("Dự án cũ trong Nhật ký");
  });

  test("holds back a project whose conversation it cannot place, rather than mislabelling it", async () => {
    await renderList([project({ id: "p-unknown", conversationId: "c-not-loaded", title: "Dự án lạ" })]);
    expect(document.body.textContent).not.toContain("Dự án lạ");
  });
});
