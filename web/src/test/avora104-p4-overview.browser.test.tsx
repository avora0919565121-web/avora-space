import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * AVORA-104 · PHẦN 4 — Toàn cảnh dự án trong Kế hoạch (P.1–P.4c; P.5–P.6 are in
 * supabase/tests/avora104_p4_tree.sql). The real Kế hoạch page, fixed fake data.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data, error: null, count: Array.isArray(rows) ? rows.length : 0 });
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
      rpc: (rawName: string) => builder(db.rpcs[rawName === "inbox_page" ? "list_my_conversations" : rawName] ?? []),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { ConfirmHost } from "@/components/ConfirmHost";
import { Toaster } from "@/components/ui/sonner";
import { todayIso } from "@/lib/tasks";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import ThinkHub from "@/pages/ThinkHub";

const OUT = "../../../docs/screens/2026-10-10";
const now = new Date().toISOString();
const today = todayIso();

function table(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "b0", owner_user_id: "me", name: "Hoiana – chiếu sáng", position: 0, column_defs: [
      { id: "c_sl", key: "c_sl", label: "Số lượng", type: "number" },
      { id: "c_ncc", key: "c_ncc", label: "Nhà cung cấp", type: "text" },
    ], column_trash: [], project_id: "p1", conversation_id: null, parent_record_id: null, depth: 1, purpose: null,
    created_at: now, updated_at: now, deleted_at: null, status_options: null, title_label: null, default_view: null,
    mobile_columns: [], source_template_key: null, archived_at: null, kind: null, orphan_origin: null,
    announce_who: "members", announce_mode: "manual", share_mode: "edit", ...part,
  };
}
function record(id: string, tableId: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, table_id: tableId, owner_user_id: "me", title, status: "dang_lam", priority: "trung_binh", category: null,
    next_action_date: null, remind_at: null, tags: [], notes: null, extension_fields: extra, project_id: "p1",
    created_at: now, updated_at: now, deleted_at: null, archived_at: null,
  };
}
function task(id: string, title: string, part: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, type: "group-shared", creator_id: "me", assignee_id: "u2", context_snapshot: null, conversation_id: "pc",
    title, description: "", status: "confirmed", confirmed_at: now, done_at: null, completed_confirmed_at: null,
    skipped_at: null, skipped_silently: false, deadline_date: today, deadline_time: null, deadline_tz: "Asia/Ho_Chi_Minh",
    task_category_id: null, is_important: false, is_milestone: false, progress_percent: null, output_value: null,
    recurrence: "none", recurrence_pattern: null, recurrence_spawned_at: null, deleted_by_creator: false, deleted_by_peer: false,
    created_at: now, updated_at: now, estimated_duration_minutes: null, requires_presence: false, start_at: null, end_at: null,
    location: null, latitude: null, longitude: null, travel_duration_minutes: null, departure_reminder_at: null,
    source_transaction_id: null, pending_decision_id: null, ...part,
  };
}
const node = (kind: string, id: string, parent: string | null, title: string, depth: number, order: number, done: number, total: number, own = 0) => ({
  node_kind: kind, node_id: id, parent_id: parent, title, depth, sort_order: order, done, total, own_total: own,
});

function seed(): void {
  db.tables = {
    projects: [{ id: "p1", conversation_id: "pc", created_by: "me", title: "Hoiana – chiếu sáng", objective: "Đèn sảnh", scope: null, assumptions: null, status: "active", value_orientation: "quality", start_date: today, target_end_date: today, closed_at: null, created_at: now, updated_at: now, deleted_at: null, conversation: { parent_group_id: null } }],
    think_hub_table: [table({}), table({ id: "b2", name: "Vật tư sảnh", parent_record_id: "r1", depth: 2 })],
    think_hub_record: [
      record("r1", "b0", "Sảnh chính"), record("r2", "b0", "Hành lang tầng 2"),
      record("r3", "b2", "Đèn panel 600×600", { c_sl: 120, c_ncc: "STED" }), record("r4", "b2", "Ray nam châm", { c_sl: 40, c_ncc: "Nexa" }),
    ],
    tasks: [
      task("t1", "Đặt 120 bộ panel"),
      task("t2", "Xin mẫu thử", { status: "done", done_at: now, completed_confirmed_at: now }),
      task("t3", "Kiểm hàng về kho"),
      task("t4", "Chốt ngày giao"),
    ],
    project_tasks: [
      { task_id: "t1", project_id: "p1", record_id: "r3", linked_by: "me" },
      { task_id: "t2", project_id: "p1", record_id: "r3", linked_by: "me" },
      { task_id: "t3", project_id: "p1", record_id: "r4", linked_by: "me" },
      { task_id: "t4", project_id: "p1", record_id: null, linked_by: "me" },
    ],
  };
  db.rpcs = {
    think_hub_tree: [
      node("project", "b0", null, "Hoiana – chiếu sáng", 0, 1, 1, 4),
      node("record", "r1", "b0", "Sảnh chính", 1, 1, 1, 3),
      node("record", "r2", "b0", "Hành lang tầng 2", 1, 2, 0, 0),
      node("table", "b2", "r1", "Vật tư sảnh", 2, 1, 1, 3),
      node("record", "r3", "b2", "Đèn panel 600×600", 3, 1, 1, 2, 2),
      node("record", "r4", "b2", "Ray nam châm", 3, 2, 0, 1, 1),
      node("unlinked", "b0", "b0", "Việc chưa gắn Hạng mục", 1, 1000000, 0, 1, 1),
    ],
  };
}

function Where() {
  const location = useLocation();
  return <span data-where={`${location.pathname}${location.search}`} hidden />;
}

function App({ at }: { at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <main className="flex h-[100dvh] min-h-0 flex-col overflow-y-auto">
            <Routes>
              <Route path="/ke-hoach" element={<ThinkHub />} />
            </Routes>
          </main>
          <Where />
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const settle = (ms = 500): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const where = (): string => document.querySelector("[data-where]")?.getAttribute("data-where") ?? "";
const columnCount = (): number => Number(document.querySelector("[data-overview-columns]")?.getAttribute("data-column-count") ?? 0);
const columnTitle = (): string => document.querySelector("[data-column-title]")?.textContent ?? "";

beforeEach(() => {
  seed();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("P.1 · 1440: bảng con `Vật tư sảnh` → 3 cột, Cây gốc là dự án, đường dẫn đúng", async () => {
  await page.viewport(1440, 900);
  await render(
    <Shell>
      <App at="/ke-hoach?ke=6&bang=b2" />
    </Shell>,
  );
  await expect.poll(() => document.querySelector("[data-overview-desk]") !== null, { timeout: 4000 }).toBe(true);
  await settle();
  const tree = document.querySelector("[data-overview-tree]") as HTMLElement;
  expect(tree.querySelector('[data-tree-node="b0"]')?.textContent ?? "").toContain("Hoiana – chiếu sáng");
  expect(tree.querySelector('[data-tree-node="b2"]')?.textContent ?? "").toContain("Vật tư sảnh");
  expect(tree.textContent ?? "").toContain("Việc chưa gắn Hạng mục");
  expect(document.querySelector("[data-overview-middle] h2")?.textContent).toBe("Vật tư sảnh");
  expect(document.querySelector('nav[aria-label="Vị trí bảng"]')?.textContent ?? "").toContain("Sảnh chính");
  expect(document.querySelector('[data-task-tally="r3"]')?.textContent).toBe("1/2");
  expect(document.querySelector("[data-overview-right]")).not.toBeNull();
  await page.screenshot({ path: `${OUT}/104-P1-toan-canh-1440.png` });
});

test("P.2 · 1440: Hạng mục → việc → thẻ → `‹` về danh sách; cột giữa không đổi", async () => {
  await page.viewport(1440, 900);
  await render(<App at="/ke-hoach?ke=6&bang=b2" />);
  await expect.poll(() => document.querySelector('[data-task-tally="r3"]') !== null, { timeout: 4000 }).toBe(true);
  await userEvent.click(document.querySelector('[data-task-tally="r3"]') as HTMLElement);
  await expect.poll(() => document.querySelector('[data-overview-pane="list"]')?.textContent ?? "").toContain("Đèn panel 600×600 · 2 việc");
  expect(where()).toContain("muc=r3");
  await page.screenshot({ path: `${OUT}/104-P2-viec-cua-hang-muc-1440.png` });
  await userEvent.click(document.querySelector('[data-overview-pane="list"] [data-overview-task="t1"]') as HTMLElement);
  await expect.poll(() => document.querySelector("[data-overview-right] [data-card-embedded]") !== null).toBe(true);
  expect(document.querySelector("[data-overview-middle] h2")?.textContent).toBe("Vật tư sảnh");
  expect(where()).toContain("viec=t1");
  await page.screenshot({ path: `${OUT}/104-P2-the-trong-cot-phai-1440.png` });
  await userEvent.click(page.getByRole("button", { name: "Đèn panel 600×600", exact: true }));
  await expect.poll(() => document.querySelector('[data-overview-pane="list"]') !== null).toBe(true);
  expect(where()).not.toContain("viec=");
  expect(document.querySelector("[data-overview-middle] h2")?.textContent).toBe("Vật tư sảnh");
});

test("P.2b · chạm việc trong Cây: mở thẳng thẻ, tô dòng Hạng mục ở cột giữa", async () => {
  await page.viewport(1440, 900);
  await render(<App at="/ke-hoach?ke=6&bang=b2&muc=r3" />);
  await expect.poll(() => document.querySelector('[data-tree-task="t1"]') !== null, { timeout: 4000 }).toBe(true);
  await userEvent.click(document.querySelector('[data-tree-task="t1"]') as HTMLElement);
  await expect.poll(() => document.querySelector("[data-overview-right] [data-card-embedded]") !== null).toBe(true);
  expect(document.querySelector('[data-overview-middle] tr[data-record-id="r3"], [data-overview-middle] [data-record-id="r3"]')?.className ?? "").toContain("bg-personal/10");
});

test("P.3 · Chỉ việc chưa xong: ẩn việc xong, số đếm chỉ còn việc mở", async () => {
  await page.viewport(1440, 900);
  await render(<App at="/ke-hoach?ke=6&bang=b2&muc=r3" />);
  await expect.poll(() => document.querySelectorAll('[data-overview-pane="list"] [data-overview-task]').length, { timeout: 4000 }).toBe(2);
  await userEvent.click(document.querySelector("[data-overview-tree] [data-only-open]") as HTMLElement);
  await expect.poll(() => document.querySelectorAll('[data-overview-pane="list"] [data-overview-task]').length).toBe(1);
  expect(document.querySelector('[data-tree-node="r3"] [data-tree-tally]')?.textContent).toBe("1");
  expect(document.querySelector('[data-overview-pane="list"]')?.textContent ?? "").not.toContain("Xin mẫu thử");
});

test("P.4 · 390: Dự án → Hạng mục → Bảng con → Hạng mục → thẻ, mỗi lúc một cột; `‹` lùi đúng một cột", async () => {
  await page.viewport(390, 844);
  await render(<App at="/ke-hoach?ke=6&bang=b0" />);
  await expect.poll(() => columnCount(), { timeout: 4000 }).toBe(1);
  expect(columnTitle()).toContain("Hoiana – chiếu sáng");
  expect(document.querySelector("[data-column-handle]")).toBeNull();
  await page.screenshot({ path: `${OUT}/104-P4-cot-du-an-390.png` });

  await userEvent.click(document.querySelector('[data-column-row="r1"]') as HTMLElement);
  await expect.poll(() => columnCount()).toBe(2);
  expect(document.querySelectorAll("[data-overview-column]").length).toBe(1);
  expect(document.querySelector("[data-column-handle]")?.getAttribute("aria-label")).toBe("Hiện lại Hoiana – chiếu sáng · 2 hạng mục");
  expect(columnTitle()).toBe("Sảnh chính");

  await userEvent.click(document.querySelector('[data-column-row="b2"]') as HTMLElement);
  await expect.poll(() => columnCount()).toBe(3);
  await userEvent.click(document.querySelector('[data-column-row="r3"]') as HTMLElement);
  await expect.poll(() => columnCount()).toBe(4);
  expect(document.querySelector("[data-column-path]")?.textContent).toBe("Sảnh chính › Vật tư sảnh");
  await page.screenshot({ path: `${OUT}/104-P4-cot-hang-muc-390.png` });

  await userEvent.click(document.querySelector('[data-overview-task="t1"]') as HTMLElement);
  await expect.poll(() => columnCount()).toBe(5);
  expect(document.querySelector('[data-overview-column="task"] [data-card-embedded]')).not.toBeNull();
  expect(document.querySelector("[data-column-handle]")?.getAttribute("aria-label")).toBe("Hiện lại Việc · Đèn panel 600×600");
  await page.screenshot({ path: `${OUT}/104-P4-the-390.png` });

  await userEvent.click(document.querySelector("[data-column-back]") as HTMLElement);
  await expect.poll(() => columnCount()).toBe(4);
  expect(columnTitle()).toBe("Đèn panel 600×600");
});

test("P.4b · 390: kéo tay kéo → chọn dòng khác: cột đổi nội dung, số cột không tăng", async () => {
  await page.viewport(390, 844);
  await render(<App at="/ke-hoach?ke=6&bang=b2&muc=r3&viec=t1" />);
  await expect.poll(() => columnCount(), { timeout: 4000 }).toBe(5);
  await userEvent.click(document.querySelector("[data-column-handle]") as HTMLElement);
  await expect.poll(() => document.querySelector("[data-column-pull]") !== null).toBe(true);
  expect(document.querySelector('[data-column-pull] [data-overview-task="t1"]')?.className ?? "").toContain("bg-personal/10");
  await settle(400);
  await page.screenshot({ path: `${OUT}/104-P4b-keo-ra-390.png` });
  await userEvent.click(document.querySelector('[data-column-pull] [data-overview-task="t2"]') as HTMLElement);
  await expect.poll(() => where()).toContain("viec=t2");
  expect(columnCount()).toBe(5);
  await expect.poll(() => document.querySelector("[data-column-pull]")).toBeNull();

  // One column up: the Hạng mục list of the sub-board, pick another Hạng mục.
  await userEvent.click(document.querySelector("[data-column-back]") as HTMLElement);
  await expect.poll(() => columnCount()).toBe(4);
  await userEvent.click(document.querySelector("[data-column-handle]") as HTMLElement);
  await expect.poll(() => document.querySelector('[data-column-pull] [data-column-row="r4"]') !== null).toBe(true);
  await userEvent.click(document.querySelector('[data-column-pull] [data-column-row="r4"]') as HTMLElement);
  await expect.poll(() => columnTitle()).toBe("Ray nam châm");
  expect(columnCount()).toBe(4);
  await userEvent.click(document.querySelector("[data-column-back]") as HTMLElement);
  await expect.poll(() => columnCount()).toBe(3);
  expect(columnTitle()).toBe("Vật tư sảnh");
});

test("P.4c · 768 dọc một cột; 900 ngang hai cột", async () => {
  await page.viewport(768, 1024);
  const screen = await render(<App at="/ke-hoach?ke=6&bang=b2&muc=r3" />);
  await expect.poll(() => columnCount(), { timeout: 4000 }).toBe(4);
  expect(document.querySelector("[data-overview-columns]")?.getAttribute("data-visible")).toBe("1");
  await screen.unmount();
  await page.viewport(900, 600);
  await render(<App at="/ke-hoach?ke=6&bang=b2&muc=r3" />);
  await expect.poll(() => columnCount(), { timeout: 4000 }).toBe(4);
  expect(document.querySelector("[data-overview-columns]")?.getAttribute("data-visible")).toBe("2");
  expect(document.querySelectorAll("[data-overview-column]").length).toBe(2);
  expect(document.querySelector("[data-column-handle]")?.getAttribute("aria-label")).toBe("Hiện lại Sảnh chính");
  await page.screenshot({ path: `${OUT}/104-P4c-hai-cot-900.png` });
});

test("P.0 · `Chỉ bảng` nhớ theo bảng; bảng riêng không có bảng con mặc định Chỉ bảng", async () => {
  await page.viewport(1440, 900);
  const screen = await render(<App at="/ke-hoach?ke=6&bang=b2" />);
  await expect.poll(() => document.querySelector("[data-overview-desk]") !== null, { timeout: 4000 }).toBe(true);
  await userEvent.click(page.getByRole("radio", { name: "Chỉ bảng" }));
  await expect.poll(() => document.querySelector("[data-overview-desk]")).toBeNull();
  await screen.unmount();
  await render(<App at="/ke-hoach?ke=6&bang=b2" />);
  await settle(800);
  expect(document.querySelector("[data-overview-desk]")).toBeNull();
  expect(page.getByRole("radio", { name: "Chỉ bảng" }).element().getAttribute("aria-checked")).toBe("true");
});
