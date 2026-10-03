import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * AVORA-81 · PHẦN 1 (AVORA-78) report screens: Avora lập sẵn — eleven system boards, Bảng xem read
 * live. Fixed fake data, no account, no network. Két sắt data comes from mocked device hooks.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  writes: [] as { table: string; op: string; row: unknown }[],
}));
const vaultState = vi.hoisted(() => ({ open: false }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string, rows: unknown): unknown => {
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
          if (key === "upsert" || key === "update" || key === "insert") {
            return (row: unknown) => {
              db.writes.push({ table, op: String(key), row });
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
      from: (table: string) => builder(table, db.tables[table] ?? []),
      rpc: (name: string, args: unknown) => {
        db.calls.push({ name, args });
        return builder(name, db.rpcs[name] ?? []);
      },
      storage: { from: () => builder("storage", []) },
      channel: () => builder("channel", []),
      removeChannel: () => undefined,
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

const dates = vi.hoisted(() => {
  const today = new Date().toISOString().slice(0, 10);
  const plus = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { today, plus, thisMonth: today.slice(0, 7), lastMonthDate: `${d.toISOString().slice(0, 7)}-10` };
});
const plus = dates.plus;

// Két sắt, decrypted on the device (mocked hooks — the network never sees any of it).
vi.mock("@/lib/use-finance", async () => {
  const account = { id: "a1", name: "Ví tiền mặt", type: "cash", openingBalanceCents: 0, balanceCents: 0, currency: "VND", otherPersonName: null, accountNumber: null, tags: [], createdAt: "", deletedAt: null };
  const base = { accountId: "a1", categoryId: null, currency: "VND", amountInBaseCents: null, baseCurrency: null, conversionRate: null, businessRelated: false, businessPurpose: null, receiptPath: null, isRecurring: false, recurringFrequency: null, recurringLabel: null, contactId: null, dueDate: null, status: "ke_hoach", settledCents: 0, taxPeriodStart: null, taxPeriodEnd: null, createdAt: "", deletedAt: null, account, category: null };
  const entries = [
    { ...base, id: "t1", type: "income", amountCents: 2_000_000_000, description: "Lương tháng trước", date: dates.lastMonthDate },
    { ...base, id: "t2", type: "expense", amountCents: 500_000_000, description: "Tiền nhà", date: dates.lastMonthDate },
    { ...base, id: "t3", type: "expense", amountCents: 120_000_000, description: "Cà phê với khách", date: `${dates.thisMonth}-01` },
    { ...base, id: "l1", type: "vay", amountCents: 3_000_000_000, settledCents: 1_000_000_000, description: "Vay anh Minh", contactId: "c-minh", dueDate: dates.plus(3), date: dates.lastMonthDate },
  ];
  return {
    useLedger: () => ({ accounts: [account], categories: [], allEntries: entries, entries, baseEntries: entries, currency: "VND", rates: {}, unvalued: [], isConverting: false, isLoading: false, error: null }),
  };
});
vi.mock("@/lib/use-vault-e2ee", () => ({
  useHasMasterKey: () => vaultState.open,
  useKeyring: () => ({ ring: vaultState.open ? {} : undefined, isPending: false }),
  useVaultItems: (section: string) => ({
    items:
      vaultState.open && section === "certificates"
        ? [{ id: "v1", section: "certificates", remindOn: null, deletedAt: null, createdAt: "", updatedAt: "2026-09-01T00:00:00Z", files: [], payload: { v: 1, type: "passport", title: "Hộ chiếu", owner_label: "", owner_contact_id: null, fields: { number: "C7654321", expires_on: dates.plus(20) }, tags: [], note: "", links: [], show_name_in_reminder: false } }]
        : [],
    isPending: false,
    error: null,
  }),
}));

import { ConfirmHost } from "@/components/ConfirmHost";
import { PlanBoardsCard } from "@/components/PlanBoardsCard";
import { Toaster } from "@/components/ui/sonner";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import ThinkHub from "@/pages/ThinkHub";

const OUT = "../../../docs/screens/2026-10-03";
const now = new Date().toISOString();

function seed(options: { vaultOpen?: boolean; empty?: boolean } = {}): void {
  vaultState.open = options.vaultOpen ?? false;
  db.calls = [];
  db.writes = [];
  const empty = options.empty === true;
  db.tables = {
    dismissed_guidance: [{ guidance_key: "plan_plus_hold" }],
    think_hub_table: [
      { id: "sb", owner_user_id: "me", name: "Danh bạ | Danh sách cơ hội", sync_source: "contact_opportunities", purpose: "Ai đang là cơ hội, đang ở giai đoạn nào, bước tiếp theo là gì?", position: -1, column_defs: [], column_trash: [], project_id: null, conversation_id: null, parent_record_id: null, depth: 1, created_at: now, updated_at: now, deleted_at: null, status_options: null, title_label: null, default_view: null, mobile_columns: [], source_template_key: null, archived_at: null, kind: null, orphan_origin: null, announce_who: "members", announce_mode: "manual", share_mode: "edit", lifecycle: "waiting", thinking_type: null },
    ],
    think_hub_record: [],
    think_hub_view_row_meta: [],
    contact: empty ? [] : [{ id: "c-minh", owner_user_id: "me", contact_type: "individual", name: "Minh Trần", date_of_birth: `1990-${plus(5).slice(5)}`, phone: null, email: null, linked_user_id: null, created_at: now, updated_at: now }],
    profiles: [{ prefs: {} }],
    notes: [],
    note_folders: [],
    tasks: [],
  };
  db.rpcs = {
    list_my_conversations: [
      { conversation_id: "g1", conversation_type: "group", group_name: "Đội chiếu sáng", member_count: 3, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "", last_message_at: now, last_message_sender_id: "me", unread_count: 0, sort_at: now, is_connected: true, peer_pin: null, verification_status: null },
    ],
    list_my_decisions: empty ? [] : [{ decision_id: "d1", conversation_id: "g1", kind: "meeting_note", title: "Chốt nhà cung cấp Rạng Đông", summary: "", settled_at: now, settled_by: "me", settled_by_name: "Thiện" }],
    list_my_projects_summary: empty ? [] : [{ project_id: "p1", conversation_id: "pg1", parent_group_id: "g1", title: "Chiếu sáng resort Phú Quốc", status: "active", target_end_date: plus(60), total: 8, done: 5, overdue: 1 }],
    list_assigned_by_me: empty ? [] : [{ kind: "task", item_id: "t-b", conversation_id: "g1", title: "Gửi báo giá đèn", assignee_id: "b", assignee_name: "Bình", deadline: plus(-4), status: "confirmed", done_at: null }],
    vault_status: { has_code: true, has_data: true, unlocked: options.vaultOpen ?? false, expires_at: null, locked_until: null, remaining: 5 },
    ensure_default_categories: [],
  };
}

function Where() {
  const location = useLocation();
  return <span data-where={`${location.pathname}${location.search}`} />;
}

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card">
            <main className="flex min-h-0 flex-1 flex-col">
              <Routes>
                <Route path="/ke-hoach" element={<ThinkHub />} />
                <Route path="/cai-dat" element={<div className="p-4"><PlanBoardsCard /></div>} />
                <Route path="*" element={<p data-landed="">landed</p>} />
              </Routes>
            </main>
          </div>
          <Where />
          {children}
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 600): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

beforeEach(() => {
  seed();
  window.localStorage.clear();
});

const SIZES = [
  [1280, 800],
  [390, 844],
  [844, 390],
] as const;

for (const [w, h] of SIZES) {
  test(`78.1 · tài khoản trống: đủ 11 bảng, mỗi bảng có Mục tiêu · ${w}x${h}`, async () => {
    seed({ empty: true, vaultOpen: true });
    await viewport(w, h);
    await render(<Frame at="/ke-hoach?ke=mac-dinh"><span /></Frame>);
    await settle(1400);
    const links = [...document.querySelectorAll("[data-view-board-link]")];
    expect(links.length + document.querySelectorAll("[data-default-board]").length).toBe(11);
    for (const link of links) expect(link.textContent?.includes("?")).toBe(true);
    await page.screenshot({ path: `${OUT}/78-1-avora-lap-san-${w}.png` });
  });
}

test("78.1 · bảng trống: Mục tiêu + câu màn trống", async () => {
  seed({ empty: true, vaultOpen: true });
  await viewport(390, 844);
  await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=decisions"><span /></Frame>);
  await settle(1000);
  expect(document.querySelector("[data-board-goal]")?.textContent).toBe("Những gì đã chốt, chốt ở đâu, ai đã xác nhận?");
  expect(document.querySelector("[data-view-empty]")?.textContent).toContain("Dữ liệu vào đây khi");
  // 78.11: a view board offers nothing that edits its shape.
  for (const label of ["Thêm cột", "Đổi tên", "Xoá Bảng", "Lưu trữ", "Chuyển"]) expect(document.body.textContent).not.toContain(label);
  await page.screenshot({ path: `${OUT}/78-1-bang-trong-390.png` });
});

test("78.3 · Két sắt khoá: Thu chi Đang khoá, không lộ tên dòng", async () => {
  seed({ vaultOpen: false });
  await viewport(1280, 800);
  await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=cashflow"><span /></Frame>);
  await settle(1000);
  expect(document.querySelector("[data-view-board] [data-vault-locked]")?.textContent).toContain("Đang khoá · Mở Két sắt để xem");
  expect(document.body.textContent).not.toContain("Cà phê với khách");
  expect(document.body.textContent).not.toContain("Vay anh Minh");
  // Nothing about money was asked of the server.
  expect(db.calls.map((call) => call.name)).not.toContain("ensure_default_categories");
  await page.screenshot({ path: `${OUT}/78-3-thu-chi-khoa-1280.png` });
});

for (const [w, h] of SIZES) {
  test(`78.5 · khoản vay hạn 3 ngày: chữ màu nhấn ở Avora lập sẵn · ${w}x${h}`, async () => {
    seed({ vaultOpen: true });
    await viewport(w, h);
    await render(<Frame at="/ke-hoach?ke=mac-dinh"><span /></Frame>);
    await settle(1400);
    expect(document.querySelector('[data-view-board-link="loans"]')?.hasAttribute("data-hot")).toBe(true);
    expect(document.querySelector('[data-view-board-link="payment_calendar"]')?.hasAttribute("data-hot")).toBe(true);
    expect(document.querySelector('[data-view-board-link="assigned_by_me"]')?.hasAttribute("data-hot")).toBe(true);
    await page.screenshot({ path: `${OUT}/78-5-can-chu-y-${w}.png` });
  });
}

test("78.5 · Lịch thanh toán có khoản vay", async () => {
  seed({ vaultOpen: true });
  await viewport(1280, 800);
  await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=payment_calendar"><span /></Frame>);
  await settle(1000);
  expect(document.querySelector('[data-view-row="l1"]')?.textContent).toContain("Vay anh Minh");
  await page.screenshot({ path: `${OUT}/78-5-lich-thanh-toan-1280.png` });
});

test("78.2 · Thu chi › Theo tháng: 2 dòng tổng", async () => {
  seed({ vaultOpen: true });
  await viewport(1280, 800);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=cashflow"><span /></Frame>);
  await settle(1000);
  await userEvent.click(screen.getByRole("tab", { name: "Theo tháng" }));
  await settle(300);
  expect(document.querySelectorAll("[data-view='month'] [data-month]").length).toBe(2);
  await page.screenshot({ path: `${OUT}/78-2-thu-chi-theo-thang-1280.png` });
});

test("78.6 · Việc tôi giao: trễ 4 ngày; Theo người", async () => {
  await viewport(390, 844);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=assigned_by_me"><span /></Frame>);
  await settle(1000);
  expect(document.querySelector('[data-view-row="task:t-b"]')?.textContent).toContain("Trễ 4 ngày");
  await userEvent.click(screen.getByRole("tab", { name: "Theo người" }));
  await settle(300);
  expect(document.querySelector("[data-view='person']")?.textContent).toContain("trễ 1");
  await page.screenshot({ path: `${OUT}/78-6-viec-toi-giao-390.png` });
});

test("78.8 · ★ trên dòng Sổ quyết định lưu vào meta của tôi", async () => {
  await viewport(1280, 800);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=decisions"><span /></Frame>);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu quan trọng" }));
  await settle(300);
  const write = db.writes.find((item) => item.table === "think_hub_view_row_meta");
  expect(write?.row).toMatchObject({ board_key: "decisions", source_key: "d1", starred: true, note_sealed: null });
});

test("78.9 · Tạo việc từ dòng Lịch thanh toán: form điền sẵn, nguồn = bảng + khoản", async () => {
  seed({ vaultOpen: true });
  await viewport(1280, 800);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=payment_calendar"><span /></Frame>);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Thêm cho Vay anh Minh" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Tạo việc/ }));
  await settle(500);
  expect((document.querySelector('input[placeholder="Việc cần làm là gì?"]') as HTMLInputElement | null)?.value).toBe("Vay anh Minh");
  expect(document.body.textContent).toContain("Tài chính | Lịch thanh toán · Vay anh Minh");
  await page.screenshot({ path: `${OUT}/78-9-tao-viec-1280.png` });
});

test("78.10 · bấm dòng Dự án của tôi → trang Dự án, đường về đúng bảng", async () => {
  await viewport(390, 844);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=my_projects"><span /></Frame>);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: /^Chiếu sáng resort Phú Quốc/ }));
  await settle(400);
  const where = document.querySelector("[data-where]")?.getAttribute("data-where") ?? "";
  expect(where.startsWith("/du-an/p1?")).toBe(true);
  const back = new URLSearchParams(where.split("?")[1]).get("tu") ?? "";
  expect(back).toContain("/ke-hoach");
  expect(back).toContain("xem=my_projects");
});

test("78.12 · Ẩn Ngày đáng nhớ: ghi vào cài đặt của tôi", async () => {
  await viewport(1280, 800);
  const screen = await render(<Frame at="/ke-hoach?ke=mac-dinh&xem=memorable_days"><span /></Frame>);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với Ngày đáng nhớ" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Ẩn khỏi danh sách/ }));
  await settle(400);
  expect(db.writes.find((item) => item.table === "profiles")?.row).toEqual({ prefs: { hidden_boards: ["memorable_days"] } });
});

test("78.12 · Cài đặt › Kế hoạch → Hiện lại", async () => {
  db.tables.profiles = [{ prefs: { hidden_boards: ["memorable_days"] } }];
  await viewport(1280, 800);
  const screen = await render(<Frame at="/cai-dat"><span /></Frame>);
  await settle(800);
  expect(document.querySelector("[data-plan-boards-card]")?.textContent).toContain("Ngày đáng nhớ");
  await page.screenshot({ path: `${OUT}/78-12-cai-dat-ke-hoach-1280.png` });
  await userEvent.click(screen.getByRole("button", { name: /Hiện lại/ }));
  await settle(300);
  expect(db.writes.filter((item) => item.table === "profiles").slice(-1)[0]?.row).toEqual({ prefs: { hidden_boards: [] } });
});
