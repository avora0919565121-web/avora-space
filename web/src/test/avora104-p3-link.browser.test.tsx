import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * AVORA-104 · PHẦN 3 — Gắn việc vào Hạng mục sau khi tạo (L.1–L.4; the rules themselves are in
 * supabase/tests/avora104_p3_link.sql). From the card: chip → tìm / gần đây → chọn; linked: Nguồn =
 * Bảng › Hạng mục with Đổi / Bỏ gắn. From a Hạng mục: `Gắn việc có sẵn`.
 */
const db = vi.hoisted(() => ({
  rpcData: {} as Record<string, unknown>,
  rpcError: {} as Record<string, string>,
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  tables: {} as Record<string, unknown[]>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown, error: { message: string } | null = null): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data: error === null ? data : null, error, count: 0 });
            return done.then.bind(done);
          }
          if (key === "single" || key === "maybeSingle") {
            return () => {
              single = true;
              return proxy;
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: (table: string) => builder(db.tables[table] ?? []),
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        db.rpcs.push({ name, args });
        const message = db.rpcError[name];
        return builder(db.rpcData[name] ?? [], message === undefined ? null : { message });
      },
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { TaskPicker } from "@/components/tasks/LinkPickers";
import { TaskCard } from "@/components/tasks/TaskCard";
import { Toaster } from "@/components/ui/sonner";
import { todayIso, type TaskItem } from "@/lib/tasks";

const OUT = "../../../docs/screens/2026-10-10";
const today = todayIso();

function task(part: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "t1", type: "personal", creatorId: "me", assigneeId: null, contextSnapshot: null, conversationId: null,
    title: "Gọi lại cho anh Tuấn về báo giá", description: "", status: "confirmed", confirmedAt: null, doneAt: null,
    completedConfirmedAt: null, skippedAt: null, skippedSilently: false, deadline: today, deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh", categoryId: null, isImportant: false, isMilestone: false, progressPercent: null,
    outputValue: null, recurrence: "none", recurrencePattern: null, recurrenceSpawnedAt: null, deletedByCreator: false,
    deletedByPeer: false, createdAt: new Date().toISOString(), estimatedDurationMinutes: null, requiresPresence: false, startAt: null,
    endAt: null, location: null, latitude: null, longitude: null, travelDurationMinutes: null, departureReminderAt: null,
    sourceTransactionId: null, ...part,
  } as unknown as TaskItem;
}

function Where() {
  const location = useLocation();
  return <span data-where={`${location.pathname}${location.search}`} hidden />;
}

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/nhiem-vu"]}>
        {children}
        <Where />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RECENT = [
  { record_id: "r1", record_title: "Cty Hoà Phát", table_id: "b1", table_name: "Khách hàng", path: "Bảng Khách hàng", is_current: false },
  { record_id: "r2", record_title: "Đèn panel 600×600", table_id: "b2", table_name: "Vật tư sảnh", path: "Hoiana › Vật tư sảnh", is_current: false },
  { record_id: "r3", record_title: "Sảnh chính", table_id: "b3", table_name: "Hạng mục thi công", path: "Hoiana › Hạng mục thi công", is_current: false },
];

beforeEach(() => {
  db.rpcData = {};
  db.rpcError = {};
  db.rpcs = [];
  db.tables = {};
});

test("L.1 · việc chưa gắn: chip `Gắn vào Hạng mục` → GẦN ĐÂY + đường dẫn → chọn → gắn", async () => {
  await page.viewport(390, 844);
  db.rpcData.task_record_of = [];
  db.rpcData.list_linkable_records = RECENT;
  db.rpcData.link_task_to_record = { record_id: "r1" };
  await render(
    <Frame>
      <TaskCard task={task()} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle();
  await userEvent.click(page.getByRole("button", { name: "Gắn vào Hạng mục" }));
  await settle(400);
  expect(document.querySelector("[data-link-picker]")?.textContent ?? "").toContain("Gần đây");
  expect(document.querySelectorAll("[data-link-row]").length).toBe(3);
  expect(document.querySelector("[data-link-picker]")?.textContent ?? "").toContain("Hoiana › Vật tư sảnh");
  await page.screenshot({ path: `${OUT}/104-L1-gan-hang-muc-390.png` });
  await userEvent.click(page.getByRole("button", { name: /Cty Hoà Phát/ }));
  await expect.poll(() => db.rpcs.find((c) => c.name === "link_task_to_record")?.args).toEqual({ p_task_id: "t1", p_record_id: "r1" });
});

test("L.2 · việc đã gắn: Nguồn = Bảng › Hạng mục, chạm mở; ⋯ › Bỏ gắn", async () => {
  await page.viewport(390, 844);
  db.rpcData.task_record_of = [{ record_id: "r1", record_title: "Cty Hoà Phát", table_id: "b1", table_name: "Khách hàng", path: "Bảng Khách hàng", can_edit: true }];
  await render(
    <Frame>
      <TaskCard task={task()} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle();
  expect(document.querySelector("[data-card-record]")?.textContent ?? "").toContain("Bảng Khách hàng › Cty Hoà Phát");
  expect(document.querySelector("[data-card-link-chip]")).toBeNull();
  await page.screenshot({ path: `${OUT}/104-L2-da-gan-390.png` });
  await userEvent.click(page.getByRole("button", { name: "Tuỳ chọn Hạng mục" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Bỏ gắn" }));
  await expect.poll(() => db.rpcs.find((c) => c.name === "unlink_task_from_record")?.args).toEqual({ p_task_id: "t1" });
  await userEvent.click(document.querySelector("[data-card-record] [data-card-source] button") as HTMLElement);
  await expect.poll(() => document.querySelector("[data-where]")?.getAttribute("data-where") ?? "").toContain("bang=b1");
});

test("L.3 · khác nơi: lời từ chối nói việc thuộc đâu", async () => {
  await page.viewport(390, 844);
  db.rpcData.task_record_of = [];
  db.rpcData.list_linkable_records = RECENT;
  db.rpcError.link_task_to_record = "Việc này thuộc Nhật ký, chỉ gắn được vào Hạng mục cùng nơi.";
  await render(
    <Frame>
      <TaskCard task={task()} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle();
  await userEvent.click(page.getByRole("button", { name: "Gắn vào Hạng mục" }));
  await settle(400);
  await userEvent.click(page.getByRole("button", { name: /Sảnh chính/ }));
  await expect.poll(() => document.body.textContent ?? "").toContain("Việc này thuộc Nhật ký, chỉ gắn được vào Hạng mục cùng nơi.");
});

test("L.4 · từ Hạng mục: `Gắn việc có sẵn` — việc chưa gắn trước, chọn là gắn", async () => {
  await page.viewport(1280, 800);
  db.rpcData.list_linkable_tasks = [
    { task_id: "t7", title: "Đặt 120 bộ panel", deadline_date: today, status: "confirmed", linked_record_title: null },
    { task_id: "t8", title: "Chốt ngày giao", deadline_date: null, status: "confirmed", linked_record_title: "Ray nam châm" },
  ];
  await render(
    <Frame>
      <TaskPicker recordId="r2" recordTitle="Đèn panel 600×600" open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(400);
  const rows = Array.from(document.querySelectorAll("[data-link-row]")).map((node) => node.textContent ?? "");
  expect(rows[0]).toContain("chưa gắn Hạng mục");
  expect(rows[1]).toContain("đang ở Ray nam châm");
  await page.screenshot({ path: `${OUT}/104-L4-gan-viec-co-san-1280.png` });
  await userEvent.click(page.getByRole("button", { name: /Đặt 120 bộ panel/ }));
  await expect.poll(() => db.rpcs.find((c) => c.name === "link_task_to_record")?.args).toEqual({ p_task_id: "t7", p_record_id: "r2" });
});
