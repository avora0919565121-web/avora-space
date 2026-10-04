import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * AVORA-77 report screens: Kế hoạch as a six-shelf library, Kệ sách you can read in, and each tab
 * remembering its place. Real screens, fixed fake data (no account, no network), at 1280×800,
 * 390×844 and 844×390.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  writes: [] as { table: string; row: unknown }[],
  errors: {} as Record<string, { message: string; code: string }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown, table = "", failure: unknown = null): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data: failure === null ? data : null, error: failure, count: Array.isArray(rows) ? rows.length : 0 });
            return done.then.bind(done);
          }
          if (key === "update" || key === "upsert" || key === "insert") {
            return (row: unknown) => {
              db.writes.push({ table, row });
              return proxy;
            };
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
      from: (table: string) => builder(db.tables[table] ?? [], table),
      rpc: (name: string, args: unknown) => {
        db.calls.push({ name, args });
        return builder(db.rpcs[name] ?? [], name, db.errors[name] ?? null);
      },
      storage: { from: () => builder([]) },
      channel: () => builder([]),
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

// The reader's text comes from the Edge Function; here a fixed public-domain passage.
const reader = vi.hoisted(() => ({ server: null as unknown, saved: [] as { locator: string; percent: number }[] }));
vi.mock("@/lib/reading-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reading-state")>("@/lib/reading-state");
  const paragraphs = (n: number, seed: string) =>
    Array.from({ length: n }, (_, i) => ({
      k: "p" as const,
      t: `${seed} ${i + 1}. It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families.`,
    }));
  return {
    ...actual,
    loadBookText: async () => ({
      source: "gutenberg",
      sourceId: "1342",
      title: "Pride and Prejudice",
      authors: "Jane Austen",
      language: "en",
      sourceUrl: "https://www.gutenberg.org/ebooks/1342",
      epubUrl: null,
      license: [
        "The Project Gutenberg eBook of Pride and Prejudice",
        "This eBook is for the use of anyone anywhere in the United States and most other parts of the world at no cost and with almost no restrictions whatsoever. You may copy it, give it away or re-use it under the terms of the Project Gutenberg License included with this eBook or online at www.gutenberg.org.",
      ],
      chapters: [
        { title: "Chapter I.", blocks: [{ k: "h", t: "Chapter I.", l: 2 }, ...paragraphs(14, "¶")] },
        { title: "Chapter II.", blocks: [{ k: "h", t: "Chapter II.", l: 2 }, ...paragraphs(10, "§")] },
        { title: "Chapter III.", blocks: [{ k: "h", t: "Chapter III.", l: 2 }, ...paragraphs(8, "·")] },
      ],
      fetchedAt: "2026-10-03T00:00:00Z",
    }),
    fetchReadingState: async () => reader.server,
    localPosition: async () => null,
    flushPositions: async () => 0,
    savePosition: async (_id: string, locator: string, percent: number) => {
      reader.saved.push({ locator, percent });
      return "sent";
    },
  };
});

import { ConfirmHost } from "@/components/ConfirmHost";
import { LandscapeRail } from "@/components/nav/LandscapeRail";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { Toaster } from "@/components/ui/sonner";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import { useTabMemory } from "@/lib/tab-memory";
import { paintLook, resolveLook } from "@/lib/theme";
import BookReader from "@/pages/BookReader";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";

const OUT = "../../../docs/screens/2026-10-03";
const now = new Date().toISOString();
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function tableRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "b",
    owner_user_id: "me",
    name: "",
    position: 0,
    column_defs: [],
    column_trash: [],
    project_id: null,
    conversation_id: null,
    parent_record_id: null,
    depth: 1,
    purpose: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    status_options: null,
    title_label: null,
    default_view: null,
    mobile_columns: [],
    source_template_key: null,
    archived_at: null,
    kind: null,
    orphan_origin: null,
    announce_who: "members",
    announce_mode: "manual",
    share_mode: "edit",
    sync_source: null,
    lifecycle: "waiting",
    thinking_type: null,
    ...part,
  };
}

function recordRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "r",
    table_id: "b1",
    owner_user_id: "me",
    title: "",
    status: "moi",
    priority: "trung_binh",
    category: null,
    next_action_date: null,
    remind_at: null,
    tags: [],
    notes: null,
    extension_fields: {},
    project_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...part,
  };
}

const SHELF_COLUMNS = [
  { id: "a", key: "c_author", label: "Tác giả", type: "text" },
  { id: "s", key: "c_source", label: "Nguồn", type: "select", options: ["Kindle", "Sách giấy", "Gutenberg", "Wikisource", "Tự soạn", "Khác", "PDF"] },
  { id: "l", key: "c_link", label: "Link", type: "text" },
  { id: "p", key: "c_pos", label: "Đang ở", type: "text" },
  { id: "k", key: "c_lesson", label: "Bài học chính", type: "text" },
];

const TABLES = [
  tableRow({ id: "b1", name: "Có nên mở xưởng thứ hai?", purpose: "Có nên mở xưởng thứ hai?", lifecycle: "thinking", thinking_type: "weigh", source_template_key: "weigh_options", updated_at: daysAgo(1) }),
  tableRow({ id: "b2", name: "Chọn trường cho con", purpose: "Trường nào hợp với con nhất?", lifecycle: "waiting", thinking_type: "weigh", updated_at: daysAgo(3) }),
  tableRow({ id: "b3", name: "Dự án chiếu sáng", conversation_id: "g1", purpose: "Báo giá và hợp đồng đèn cho khu nghỉ dưỡng", lifecycle: "concluded", updated_at: daysAgo(2) }),
  tableRow({ id: "b4", name: "Kế hoạch năm 2027", purpose: null, updated_at: daysAgo(6) }),
  tableRow({ id: "b5", name: "Sửa nhà", purpose: "Làm gì trước khi mùa mưa tới?", lifecycle: "thinking", conversation_id: "c-lan", updated_at: daysAgo(0) }),
  tableRow({ id: "sb", name: "Danh bạ | Danh sách cơ hội", sync_source: "contact_opportunities", purpose: "Ai đang là cơ hội, đang ở giai đoạn nào, bước tiếp theo là gì?", position: -1 }),
  tableRow({ id: "shelf", name: "Kệ sách", kind: "bookshelf", column_defs: SHELF_COLUMNS, source_template_key: "reading", thinking_type: "learn" }),
];

const RECORDS = [
  recordRow({ id: "r1", table_id: "b1", title: "Vay ngân hàng 2 tỷ", next_action_date: yesterday }),
  recordRow({ id: "r2", table_id: "b1", title: "Thuê nhà xưởng Bình Dương", next_action_date: today }),
  recordRow({ id: "r3", table_id: "b2", title: "Trường Lê Quý Đôn", next_action_date: today }),
  recordRow({ id: "r4", table_id: "b3", title: "Resort Phú Quốc" }),
  recordRow({ id: "r5", table_id: "b1", title: "Thuê thêm 6 thợ", notes: null }),
  // Kệ sách
  recordRow({ id: "k1", table_id: "shelf", title: "Pride and Prejudice", status: "dang_doc", extension_fields: { c_author: "Jane Austen", c_source: "Gutenberg", c_link: "https://www.gutenberg.org/ebooks/1342", c_pos: "Chương 3 · 38%" } }),
  recordRow({ id: "k2", table_id: "shelf", title: "Truyện Kiều", status: "muon_doc", extension_fields: { c_author: "Nguyễn Du", c_source: "Wikisource", c_link: "https://vi.wikisource.org/wiki/Truy%E1%BB%87n_Ki%E1%BB%81u" } }),
  recordRow({ id: "k3", table_id: "shelf", title: "Đắc nhân tâm", status: "muon_doc", extension_fields: { c_author: "Dale Carnegie", c_source: "Sách giấy" } }),
  recordRow({ id: "k4", table_id: "shelf", title: "Meditations", status: "muon_doc", extension_fields: { c_author: "Marcus Aurelius", c_source: "Gutenberg", c_link: "https://www.gutenberg.org/ebooks/2680" } }),
  recordRow({ id: "k5", table_id: "shelf", title: "Lục Vân Tiên", status: "da_doc", extension_fields: { c_author: "Nguyễn Đình Chiểu", c_lesson: "Giữ chữ tín trước, lợi sau." } }),
];

const CATALOG = [
  { source: "wikisource", source_id: "Truyện Kiều", title: "Truyện Kiều", authors: "Nguyễn Du", language: "vi", category: "tho", epub_url: null },
  { source: "wikisource", source_id: "Lục Vân Tiên (bản Quốc ngữ 2082 câu)", title: "Lục Vân Tiên", authors: "Nguyễn Đình Chiểu", language: "vi", category: "tho", epub_url: null },
  { source: "wikisource", source_id: "Chinh phụ ngâm", title: "Chinh phụ ngâm", authors: "Đặng Trần Côn; Đoàn Thị Điểm (dịch)", language: "vi", category: "tho", epub_url: null },
  { source: "wikisource", source_id: "Kinh Thánh Cựu Ước và Tân Ước 1925", title: "Kinh Thánh Cựu Ước và Tân Ước (bản Truyền thống 1925)", authors: "Phan Khôi và cộng sự (dịch)", language: "vi", category: "kinh_thanh", epub_url: null },
  { source: "wikisource", source_id: "Bình Ngô đại cáo", title: "Bình Ngô đại cáo", authors: "Nguyễn Trãi", language: "vi", category: "lich_su", epub_url: null },
  { source: "wikisource", source_id: "Gia huấn ca", title: "Gia huấn ca", authors: "Nguyễn Trãi (tương truyền)", language: "vi", category: "tho", epub_url: null },
];

function seed(options: { vaultUnlocked?: boolean; empty?: boolean } = {}): void {
  db.calls = [];
  db.writes = [];
  db.errors = {};
  db.tables = {
    dismissed_guidance: [{ guidance_key: "plan_plus_hold" }, { guidance_key: "task_plus_hold" }],
    think_hub_table: options.empty === true ? [TABLES[5], tableRow({ id: "t-default", name: "Bảng tổng hợp" }), TABLES[6]] : TABLES,
    think_hub_record: options.empty === true ? [] : RECORDS,
    think_hub_conclusions:
      options.empty === true
        ? []
        : [
            { id: "c1", table_id: "b1", body: "Nên, nếu vay được 2 tỷ", created_by: "me", created_at: daysAgo(3) },
            { id: "c0", table_id: "b1", body: "Chưa nên, chờ đơn hàng quý 4", created_by: "me", created_at: daysAgo(10) },
            { id: "c3", table_id: "b3", body: "Chốt nhà cung cấp Rạng Đông", created_by: "me", created_at: daysAgo(2) },
          ],
    book_reading_state: [{ record_id: "k1", locator: "c2:p3", percent: 38, device_label: "Mac · Chrome", updated_at: daysAgo(0) }],
    notes: [],
    note_folders: [],
    tasks: [],
  };
  db.rpcs = {
    list_my_conversations: [
      { conversation_id: "g1", conversation_type: "group", group_name: "Đội chiếu sáng", member_count: 3, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "", last_message_at: now, last_message_sender_id: "me", unread_count: 0, sort_at: now, is_connected: true, peer_pin: null, verification_status: null },
      { conversation_id: "c-lan", conversation_type: "direct", group_name: null, member_count: 2, peer_id: "lan", peer_display_name: "Lan Nguyễn", peer_email: null, last_message_content: "", last_message_at: now, last_message_sender_id: "lan", unread_count: 0, sort_at: now, is_connected: true, peer_pin: "A-LAN12345", verification_status: null },
      { conversation_id: "j1", conversation_type: "personal", group_name: null, member_count: 1, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "", last_message_at: now, last_message_sender_id: "me", unread_count: 0, sort_at: now, is_connected: true, peer_pin: null, verification_status: null },
    ],
    search_book_catalog: CATALOG,
    vault_status: { has_code: true, has_data: true, unlocked: options.vaultUnlocked ?? false, expires_at: null, locked_until: null, remaining: 5 },
  };
}

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          {children}
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Memory() {
  useTabMemory("me");
  return null;
}

function App({ at }: { at: string }) {
  return (
    <Frame at={at}>
      <Memory />
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:flex-row short:flex-row">
        <MobileTopBar />
        <LandscapeRail />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col short:pr-[var(--inset-r)]">
          <Routes>
            <Route path="/tong-quan" element={<Dashboard />} />
            <Route path="/ke-hoach" element={<ThinkHub />} />
            <Route path="/ke-hoach/ke-sach/doc/:recordId" element={<BookReader />} />
            <Route path="/nhiem-vu" element={<Tasks />} />
          </Routes>
        </main>
        <ToolBelt />
      </div>
    </Frame>
  );
}

async function settle(ms = 600): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

const SIZES = [
  [1280, 800],
  [390, 844],
  [844, 390],
] as const;

beforeEach(() => {
  // Headless Chromium resizes the frame on Fullscreen; the reader asks for it on the first tap.
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: undefined });
  seed();
  reader.server = null;
  reader.saved = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  // AVORA-93 · 93.6: the one-time zones overlay is covered by its own test.
  window.localStorage.setItem("avora.reader.zones-seen", "1");
});

// ------------------------------------------------------------------ 77.1 → AVORA-89 · 88.1 (the room: first visit = kệ 2)
for (const [w, h] of SIZES) {
  test(`88.1 · Kế hoạch lần đầu = kệ 2 Tổng quan · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach" />);
    await settle(1200);
    expect(document.querySelector("[data-room-bar]")?.getAttribute("data-room-bar")).toBe("2");
    expect(document.querySelector('[data-room-shelf="2"]')).not.toBeNull();
    // Kệ 2 is about thinking: questions, never deadlines or assignments.
    const text = document.querySelector('[data-room-shelf="2"]')?.textContent ?? "";
    expect(text).toContain("Điều gì còn chưa thông suốt?");
    expect(text).not.toMatch(/Quá hạn|Trễ hạn|cần chốt|giao/);
    // No arrangement row, no `Theo cách nghĩ` anywhere.
    expect(document.body.textContent).not.toContain("Theo cách nghĩ");
    expect(document.querySelector("[data-arranged]")).toBeNull();
    await page.screenshot({ path: `${OUT}/88-1-ke-2-${w}.png` });
  });
}

// ------------------------------------------------------------------ 77.3 / 77.4 / 77.6
test("77.3 · kệ 01 khi Két sắt khoá: một ô Đang khoá, không lộ tên", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=mac-dinh" />);
  await settle(1000);
  const locked = document.querySelector("[data-vault-locked]");
  expect(locked?.textContent).toContain("Đang khoá · Mở Két sắt để xem");
  expect(document.querySelector('[data-default-board="sb"]')).not.toBeNull();
  await page.screenshot({ path: `${OUT}/77-3-ke-01-ket-sat-khoa-1280.png` });
});

for (const [w, h] of SIZES) {
  test(`88.5 · kệ 3 ma trận nơi × tiến trình (từ ?ke=trang-thai) · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=trang-thai" />);
    await settle(1000);
    const lane = (id: string) => [...document.querySelectorAll(`[data-matrix-full] [data-cell$=":${id}"] [data-matrix-card]`)].map((node) => node.getAttribute("data-matrix-card"));
    expect(lane("waiting").sort()).toEqual(["b2", "b4"]);
    expect(lane("thinking").sort()).toEqual(["b1", "b5"]);
    expect(lane("concluded")).toEqual(["b3"]);
    // Each board once; no Bảng Avora, no bookshelf; place rows.
    expect(document.querySelectorAll("[data-matrix-full] [data-matrix-card]").length).toBe(5);
    expect(document.querySelector('[data-matrix-card="sb"], [data-matrix-card="shelf"]')).toBeNull();
    expect(document.querySelector('[data-matrix-full] [data-cell="group:concluded"] [data-matrix-card="b3"]')).not.toBeNull();
    expect(document.querySelector('[data-matrix-full] [data-cell="direct:thinking"] [data-matrix-card="b5"]')).not.toBeNull();
    expect(document.querySelector("[data-matrix-store]")?.textContent).toMatch(/Lưu trữ \d+.*Thùng rác \d+/);
    expect(document.body.textContent).not.toContain("Theo cách nghĩ");
    await page.screenshot({ path: `${OUT}/88-5-ke-3-${w}.png` });
  });
}

test("88.5 · điện thoại: chạm ô Nhóm · Đã chốt → danh sách ngay dưới lưới", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=3" />);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "1" }).nth(0));
  document.querySelector<HTMLButtonElement>('[data-matrix-cell="group:concluded"]')?.click();
  await settle(300);
  expect(document.querySelector("[data-matrix-picked]")?.textContent).toContain("Nhóm · Đã chốt 1");
  expect(document.querySelector('[data-matrix-picked] [data-matrix-card="b3"]')).not.toBeNull();
  await page.screenshot({ path: `${OUT}/88-5-ke-3-o-390.png` });
});

test("77.4 · đánh dấu Đang suy nghĩ ở kệ 3 đi qua RPC set_board_lifecycle", async () => {
  await viewport(1280, 800);
  const screen = await render(<App at="/ke-hoach?ke=3" />);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu “Chọn trường cho con”" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Đánh dấu Đang suy nghĩ" }));
  await settle(300);
  expect(db.calls.find((call) => call.name === "set_board_lifecycle")?.args).toEqual({ p_table_id: "b2", p_lifecycle: "thinking" });
});

test("77.6 · Kho ở cuối kệ 3 (từ ?ke=khac), tài khoản trống", async () => {
  seed({ empty: true });
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=khac" />);
  await settle(1000);
  expect(document.querySelector('[data-room-shelf="3"]')).not.toBeNull();
  expect(document.querySelector("[data-matrix-store]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Lưu trữ 0 Thùng rác 0");
  expect(document.body.textContent).not.toContain("Ý chưa xếp");
  await page.screenshot({ path: `${OUT}/77-6-kho-1280.png` });
});

test("77.23 · người mới: thư viện không có chữ hướng dẫn dài", async () => {
  seed({ empty: true });
  await viewport(390, 844);
  await render(<App at="/ke-hoach" />);
  await settle(1000);
  await page.screenshot({ path: `${OUT}/77-23-nguoi-moi-390.png` });
});

// ------------------------------------------------------------------ 77.5 → kệ 5 Đọc & Nhật ký
test("77.5 · ?ke=nhat-ky mở kệ 5, phần Nhật ký có lối vào", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=nhat-ky" />);
  await settle(1000);
  expect(document.querySelector('[data-room-shelf="5"] [data-room-section="diary"] [data-diary-door]')).not.toBeNull();
  expect(document.querySelector('[data-room-shelf="5"] [data-room-section="books"]')).not.toBeNull();
  await page.screenshot({ path: `${OUT}/77-5-ke-5-1280.png` });
});

// ------------------------------------------------------------------ D1 kệ 04
for (const [w, h] of SIZES) {
  test(`D1 · kệ 04 Kệ sách + Thư viện mở · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=ke-sach" />);
    await settle(1400);
    expect(document.querySelector("[data-continue-reading]")?.textContent).toContain("Pride and Prejudice");
    // Truyện Kiều is already on the shelf: the catalogue says so instead of offering it again.
    const results = document.querySelector("[data-catalog-results]");
    expect(results?.textContent).toContain("Trên kệ của bạn");
    await page.screenshot({ path: `${OUT}/77-d1-ke-sach-${w}.png` });
  });
}

// ------------------------------------------------------------------ A4 board head
for (const [w, h] of SIZES) {
  test(`77.17 · đầu Bảng: câu hỏi · kết luận · vòng đời · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=hoach-dinh&bang=b1" />);
    await settle(1000);
    expect(document.querySelector("[data-board-question]")?.textContent).toBe("Có nên mở xưởng thứ hai?");
    expect(document.querySelector("[data-lifecycle]")?.textContent).toContain("Đang suy nghĩ");
    expect(document.querySelector("[data-conclusion]")?.textContent).toContain("Nên, nếu vay được 2 tỷ");
    await page.screenshot({ path: `${OUT}/77-17-dau-bang-${w}.png` });
  });
}

test("77.17 · lịch sử kết luận: 2 dòng có ngày", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=hoach-dinh&bang=b1" />);
  await settle(1000);
  (document.querySelector("[data-conclusion]") as HTMLElement).click();
  await settle(400);
  expect(document.querySelectorAll("[data-conclusion-history] li").length).toBe(2);
  await page.screenshot({ path: `${OUT}/77-17-lich-su-ket-luan-1280.png` });
});

test("77.19 · Bảng Avora mặc định: không vòng đời, câu hỏi không sửa", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?bang=sb" />);
  await settle(1000);
  expect(document.querySelector("[data-lifecycle]")).toBeNull();
  expect(document.querySelector('[aria-label="Sửa câu hỏi của Bảng"]')).toBeNull();
});

test("77.20 · Hạng mục trống trong Bảng Cân nhắc: câu hỏi dẫn mờ", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=hoach-dinh&bang=b1" />);
  await settle(1000);
  (document.querySelector('[data-record-id="r5"]') as HTMLElement).click();
  await settle(500);
  const notes = document.querySelector("#record-notes") as HTMLTextAreaElement | null;
  expect(notes?.placeholder).toBe("Nếu chọn cái này mà sai thì vì sao?");
  await page.screenshot({ path: `${OUT}/77-20-cau-hoi-dan-can-nhac-1280.png` });
});

// ------------------------------------------------------------------ 77.16 focus room
for (const [w, h] of SIZES) {
  test(`77.16 · ⤢ mở to tập trung rồi ⤡ · ${w}x${h}`, async () => {
    await viewport(w, h);
    const screen = await render(<App at="/ke-hoach?ke=hoach-dinh&bang=b1" />);
    await settle(1000);
    await userEvent.click(screen.getByRole("button", { name: "Mở to tập trung" }));
    await settle(500);
    expect(document.querySelector("[data-focus-room]")).not.toBeNull();
    expect(document.querySelector("[data-reminder-tiles]")).toBeNull();
    expect(document.querySelector("[data-shelf-cards], [data-shelf-list]")).toBeNull();
    await page.screenshot({ path: `${OUT}/77-16-phong-tap-trung-${w}.png` });
    await userEvent.keyboard("{Escape}");
    await settle(500);
    expect(document.querySelector("[data-focus-room]")).toBeNull();
    expect(document.querySelector("[data-board-question]")?.textContent).toBe("Có nên mở xưởng thứ hai?");
    await page.screenshot({ path: `${OUT}/77-16-thu-nho-${w}.png` });
  });
}

// ------------------------------------------------------------------ 77.7 / 77.8 the reader (AVORA-81: full screen)
/** AVORA-93 · 4.1 (ADR-061): the reading tools now live on the top band (was: the middle third). */
const tapMiddle = async (): Promise<void> => {
  const view = document.querySelector("[data-reader] article")?.parentElement as HTMLElement;
  view.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: window.innerWidth / 2, clientY: 30 }));
  await settle(250);
};

for (const [w, h] of SIZES) {
  test(`77.7 · đọc trong Avora · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1200);
    const article = document.querySelector("[data-reader] article") as HTMLElement;
    expect(article.getAttribute("lang")).toBe("en");
    expect(article.closest("[translate]")).toBeNull();
    await page.screenshot({ path: `${OUT}/77-7-doc-sach-${w}.png` });
  });
}

test("77.7 · mục lục + cuối sách có Về bản này", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Mục lục" }));
  await settle(300);
  await page.screenshot({ path: `${OUT}/77-7-muc-luc-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Chapter III/ }));
  await settle(700);
  const about = document.querySelector("[data-about-edition]") as HTMLElement;
  expect(about.textContent).toContain("Project Gutenberg License");
  await page.screenshot({ path: `${OUT}/77-7-ve-ban-nay-390.png` });
});

test("77.8 · máy khác đọc xa hơn: hỏi, không tự nhảy", async () => {
  reader.server = { recordId: "k1", locator: "c1:p4", percent: 52, deviceLabel: "iPhone · Safari", updatedAt: new Date().toISOString() };
  await viewport(1280, 800);
  await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  expect(document.querySelector("[data-reading-offer]")?.textContent).toContain("Bạn đã đọc tới 52% trên iPhone · Safari — mở tới đó?");
  // Still on chapter 1 — it did not jump by itself.
  expect(document.querySelector("[data-reader] article")?.textContent).toContain("¶ 1.");
  await page.screenshot({ path: `${OUT}/77-8-may-khac-doc-xa-hon-1280.png` });
});

// ------------------------------------------------------------------ AVORA-81 · 79.7 – 79.15 the reader
/** The first paragraph whose start is on the visible page. */
const firstVisibleBlock = (): number => {
  const view = (document.querySelector("[data-reader] article")?.parentElement as HTMLElement).getBoundingClientRect();
  for (const node of document.querySelectorAll<HTMLElement>("[data-reader] article [data-b]")) {
    const r = node.getClientRects()[0];
    if (r !== undefined && r.left >= view.left - 2 && r.left < view.right - 2) return Number(node.dataset.b);
  }
  return -1;
};

for (const [w, h] of SIZES) {
  test(`79.7 · tràn màn; chạm giữa hiện / ẩn công cụ; chạm phải sang trang · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1200);
    const root = document.querySelector("[data-reader]") as HTMLElement;
    const rect = root.getBoundingClientRect();
    expect([rect.left, rect.top, Math.round(rect.width), Math.round(rect.height)]).toEqual([0, 0, w, h]);
    expect(document.querySelector("[data-reader-tools]")).toBeNull();
    await page.screenshot({ path: `${OUT}/79-7-doc-tran-man-${w}.png` });
    await tapMiddle();
    expect(document.querySelector("[data-reader-tools]")).not.toBeNull();
    await page.screenshot({ path: `${OUT}/79-7-cong-cu-${w}.png` });
    await tapMiddle();
    expect(document.querySelector("[data-reader-tools]")).toBeNull();
    const article = document.querySelector("[data-reader] article") as HTMLElement;
    const before = Number(article.dataset.page);
    article.parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: window.innerWidth - 10, clientY: rect.height / 2 }));
    await settle(400);
    expect(Number((document.querySelector("[data-reader] article") as HTMLElement).dataset.page)).toBe(before + 1);
  });
}

/** Paragraphs with any line on the visible page. */
const visibleBlocks = (): number[] => {
  const view = (document.querySelector("[data-reader] article")?.parentElement as HTMLElement).getBoundingClientRect();
  const out: number[] = [];
  for (const node of document.querySelectorAll<HTMLElement>("[data-reader] article [data-b]")) {
    if ([...node.getClientRects()].some((r) => r.width > 0 && r.left >= view.left - 2 && r.left < view.right - 2)) out.push(Number(node.dataset.b));
  }
  return out;
};

test("79.8 · đổi cỡ chữ nấc 2 → 7 giữa chương: vẫn đúng đoạn", async () => {
  db.tables.profiles = [{ prefs: { reader: { size: 1 } } }];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await userEvent.keyboard("{ArrowRight}");
  await userEvent.keyboard("{ArrowRight}");
  await settle(400);
  // The paragraph being read = the one at the top of the page (it may have begun on the page before).
  const anchor = visibleBlocks()[0];
  expect(anchor).toBeGreaterThan(0);
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Chữ và giao diện" }));
  await userEvent.click(screen.getByRole("button", { name: "Nấc 7" }));
  await settle(600);
  expect(document.querySelector("[data-size-step]")?.getAttribute("data-size-step")).toBe("7");
  await userEvent.keyboard("{Escape}");
  await document.fonts.ready;
  await settle(600);
  expect(visibleBlocks()).toContain(anchor);
  await page.screenshot({ path: `${OUT}/79-8-co-chu-7-390.png` });
});

test("79.8 · Aa: 7 nấc, 4 kiểu chữ, 4 giao diện, lề, giãn dòng, cách sang trang", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Chữ và giao diện" }));
  await settle(300);
  const panel = document.querySelector("[data-reader-aa]") as HTMLElement;
  expect(panel.querySelectorAll('[aria-label^="Nấc "]').length).toBe(7);
  for (const label of ["Literata", "Source Serif 4", "Inter Tight", "Atkinson", "Trắng", "Kem", "Xanh dịu", "Đêm", "Hẹp", "Rộng", "Gọn", "Thoáng", "Lật trái / phải", "Cuộn liền", "Căn đều hai bên", "Hiệu ứng lật giấy"]) expect(panel.textContent).toContain(label);
  await page.screenshot({ path: `${OUT}/79-8-aa-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Đêm/ }));
  await settle(200);
  expect(db.writes.filter((item) => item.table === "profiles").slice(-1)[0]?.row).toMatchObject({ prefs: { reader: { theme: "dem" } } });
});

test("79.9 · máy tính 1280 ngang: 2 trang cạnh nhau", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  expect(document.querySelector("[data-reader]")?.hasAttribute("data-spread")).toBe(true);
  await page.screenshot({ path: `${OUT}/79-9-hai-trang-1280.png` });
});

test("79.10 · giảm chuyển động + lật giấy bật: chỉ mờ dần", async () => {
  db.tables.profiles = [{ prefs: { reader: { curl: true } } }];
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => (query.includes("reduced-motion") ? ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList) : original(query))) as typeof window.matchMedia;
  try {
    await viewport(390, 844);
    await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1200);
    expect(document.querySelector("[data-reader]")?.getAttribute("data-turn-effect")).toBe("fade");
  } finally {
    window.matchMedia = original;
  }
});

test("79.11 · Chrome có Translator: dịch trên máy, 55% chương → chương sau dịch sẵn, không request dịch", async () => {
  const urls: string[] = [];
  const realFetch = window.fetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    return realFetch(input, init);
  }) as typeof window.fetch;
  (globalThis as Record<string, unknown>).Translator = {
    availability: async () => "available",
    create: async () => ({ translate: async (value: string) => `VI ${value}` }),
  };
  // AVORA-93 · 92.3: whole-chapter machine translation only once VMT approves the engine.
  db.tables.app_config = [{ key: "chapter_mt_engines", value: ["chrome_translator"] }, { key: "translation_paid_enabled", value: false }];
  try {
    await viewport(390, 844);
    const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1200);
    await tapMiddle();
    await userEvent.click(screen.getByRole("button", { name: "Dịch" }));
    await userEvent.click(screen.getByRole("button", { name: "Dịch cả chương sang Tiếng Việt" }));
    await settle(800);
    expect(document.querySelector("[data-reader] article")?.textContent).toContain("VI ¶ 1.");
    for (let i = 0; i < 12; i += 1) {
      const article = document.querySelector("[data-reader] article") as HTMLElement;
      const total = Number(document.querySelector("[data-reader-foot]")?.textContent?.match(/\/ (\d+)/)?.[1] ?? "1");
      if (Number(article.dataset.page) / Math.max(1, total - 1) >= 0.55) break;
      await userEvent.keyboard("{ArrowRight}");
      await settle(150);
    }
    await settle(800);
    expect(document.querySelector("[data-translation-line]")?.textContent).toContain("chương 2 đã dịch sẵn");
    expect(urls.filter((url) => /translat/i.test(url))).toEqual([]);
    await page.screenshot({ path: `${OUT}/79-11-dich-tren-may-390.png` });
  } finally {
    window.fetch = realFetch;
    delete (globalThis as Record<string, unknown>).Translator;
  }
});

test("79.12 · không có API: Dịch mở hướng dẫn; chương sau đã nạp sẵn trong trang", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  expect(document.querySelector("[data-next-chapter]")?.textContent).toContain("§ 1.");
  expect(document.querySelector("[data-next-chapter]")?.getAttribute("lang")).toBe("en");
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Dịch" }));
  await settle(300);
  expect(document.querySelector("[data-translate-help]")?.textContent?.length ?? 0).toBeGreaterThan(10);
  await page.screenshot({ path: `${OUT}/79-12-huong-dan-dich-390.png` });
});

const incoming = (): void => {
  window.dispatchEvent(new CustomEvent("avora:incoming-message", { detail: { conversationId: "c-lan", senderId: "lan", mentionsViewer: false, isReading: false } }));
};
const MESSAGE = { id: "m1", conversation_id: "c-lan", sender_id: "lan", content: "Anh ơi tối nay họp lúc 8 giờ nhé", created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_to_message_id: null, mentioned_user_ids: [], origin_group_id: null, attachment_count: 0, origin_content_id: null, origin_sender_id: null, system_kind: null, forward_bundle: null, is_urgent: false };

test("79.13 · tin nhắn khi đang đọc → Xem nhanh → Quay lại: đúng trang", async () => {
  db.tables.messages = [MESSAGE];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await userEvent.keyboard("{ArrowRight}");
  await settle(300);
  const at = (document.querySelector("[data-reader] article") as HTMLElement).dataset.page;
  incoming();
  await settle(500);
  expect(document.querySelector("[data-message-strip]")?.textContent).toContain("Lan Nguyễn");
  await page.screenshot({ path: `${OUT}/79-13-dai-tin-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Xem nhanh" }));
  await settle(500);
  expect(document.querySelector("[data-quick-peek]")?.textContent).toContain("Anh ơi tối nay họp lúc 8 giờ nhé");
  await page.screenshot({ path: `${OUT}/79-13-xem-nhanh-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Quay lại trang/ }));
  await settle(400);
  expect((document.querySelector("[data-reader] article") as HTMLElement).dataset.page).toBe(at);
});

test("79.14 · ☾ bật: không dải tin; tắt ☾ → `Có 1 tin nhắn…`", async () => {
  db.tables.messages = [MESSAGE];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Đọc yên tĩnh" }));
  await settle(200);
  expect(db.calls.find((call) => call.name === "set_quiet_reading")?.args).toEqual({ p_on: true });
  incoming();
  await settle(500);
  expect(document.querySelector("[data-message-strip]")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Đọc yên tĩnh" }));
  await settle(300);
  expect(db.calls.filter((call) => call.name === "set_quiet_reading").slice(-1)[0]?.args).toEqual({ p_on: false });
  expect(document.body.textContent).toContain("Có 1 tin nhắn trong lúc bạn đọc");
});

test("79.15 · ghim cuốn thứ 4: hỏi bỏ ghim cuốn nào", async () => {
  db.errors.set_book_pin = { message: "avora_pin_full", code: "P0001" };
  db.tables.book_reading_state = [
    { record_id: "k2", locator: "c0:p0", percent: 0, device_label: null, updated_at: daysAgo(1), pinned_at: daysAgo(1) },
    { record_id: "k3", locator: "c0:p0", percent: 0, device_label: null, updated_at: daysAgo(1), pinned_at: daysAgo(2) },
    { record_id: "k4", locator: "c0:p0", percent: 0, device_label: null, updated_at: daysAgo(1), pinned_at: daysAgo(3) },
  ];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await tapMiddle();
  await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Ghim để đọc trước/ }));
  await settle(400);
  const sheet = document.querySelector("[data-pin-full]") as HTMLElement;
  expect(sheet.textContent).toContain("Đã ghim 3 cuốn");
  expect(sheet.textContent).toContain("Truyện Kiều");
  expect(sheet.textContent).toContain("Meditations");
  await page.screenshot({ path: `${OUT}/79-15-ghim-day-390.png` });
});

test("77.10 · bôi chọn → thanh Chép vào Ghi chép sách", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  const paragraph = document.querySelector('[data-reader] article p[data-b="2"]') as HTMLElement;
  const range = document.createRange();
  range.setStart(paragraph.firstChild as Node, 5);
  range.setEnd(paragraph.firstChild as Node, 70);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await settle(300);
  expect(document.querySelector('[role="toolbar"][aria-label="Đoạn đang chọn"]')?.textContent).toMatch(/Dịch.*Ghi chú.*Chép/);
  await page.screenshot({ path: `${OUT}/77-10-chep-y-1280.png` });
});

// ------------------------------------------------------------------ 77.15 / 77.22
for (const [w, h] of SIZES) {
  test(`77.15 · Avora Space: một hàng Góc kế hoạch · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/tong-quan" />);
    await settle(1400);
    const row = document.querySelector("[data-plan-row]") as HTMLElement;
    expect(row.textContent).toContain("Quá hạn");
    row.scrollIntoView({ block: "center" });
    await settle(300);
    await page.screenshot({ path: `${OUT}/77-15-goc-ke-hoach-${w}.png` });
  });
}

for (const [w, h] of SIZES) {
  test(`77.22 · tông Biển: vùng của bạn đổi màu, vùng Avora giữ cam · ${w}x${h}`, async () => {
    paintLook(resolveLook({ scheme: "light", tone: "bien" }));
    try {
      await viewport(w, h);
      await render(<App at="/ke-hoach?ke=hoach-dinh&bang=b1" />);
      await settle(1200);
      expect(document.documentElement.dataset.tone).toBe("bien");
      await page.screenshot({ path: `${OUT}/77-22-tong-bien-${w}.png` });
    } finally {
      paintLook(resolveLook({ scheme: "light", tone: "avora" }));
    }
  });
}

// ------------------------------------------------------------------ 77.11 D5
test("77.11 · Đã đọc: hỏi `Bạn giữ lại điều gì?` một lần, lưu vào Bài học chính", async () => {
  db.rpcs.update_think_hub_record = recordRow({ id: "k4", table_id: "shelf", title: "Meditations", status: "da_doc" });
  await viewport(1280, 800);
  const screen = await render(<App at="/ke-hoach?ke=ke-sach&sach=k4" />);
  await settle(1200);
  await userEvent.click(screen.getByRole("button", { name: "Đã đọc", exact: true }));
  await expect.element(screen.getByRole("alertdialog")).toHaveTextContent("Bạn giữ lại điều gì?");
  await userEvent.fill(screen.getByRole("textbox", { name: "Bạn giữ lại điều gì?" }), "Việc trong tầm tay mới đáng lo.");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await settle(400);
  const updates = db.calls.filter((call) => call.name === "update_think_hub_record").map((call) => call.args as { p_record_id: string; p_patch: Record<string, unknown> });
  expect(updates[0].p_patch).toEqual({ status: "da_doc" });
  const lessonKey = SHELF_COLUMNS.find((column) => column.label === "Bài học chính")?.key as string;
  expect((updates[1].p_patch.extension_fields as Record<string, unknown>)[lessonKey]).toBe("Việc trong tầm tay mới đáng lo.");
  // Once only: back to Muốn đọc and to Đã đọc again asks nothing.
  await userEvent.click(screen.getByRole("button", { name: "Muốn đọc", exact: true }));
  await settle(300);
  await userEvent.click(screen.getByRole("button", { name: "Đã đọc", exact: true }));
  await settle(400);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

// ------------------------------------------------------------------ 77.24 / 88.9 tab memory
test("88.9 · rời ở kệ 5 → Nhiệm vụ → Kế hoạch: về kệ 5; bấm lại tab → kệ 2", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=ke-sach" />);
  await settle(1200);
  await userEvent.click(screen.getByRole("link", { name: /Nhiệm vụ/ }));
  await settle(800);
  await userEvent.click(screen.getByRole("link", { name: /Kế hoạch/ }));
  await settle(1000);
  expect(document.querySelector('[data-room-shelf="5"]')).not.toBeNull();
  await userEvent.click(screen.getByRole("link", { name: /Kế hoạch/ }));
  await settle(800);
  expect(document.querySelector('[data-room-shelf="2"]')).not.toBeNull();
});

// ------------------------------------------------------------------ AVORA-89 · PHẦN 2 · the room (88.x)
const OUT79 = OUT;
const ROOM_TEMPLATES = [
  { key: "weigh_options", name: "Cân nhắc lựa chọn", thinking_type: "weigh", guiding_question: "Nếu chọn cái này mà sai thì vì sao?", description: null, scopes: ["journal", "direct", "group", "project"], column_defs: [{ type: "text", label: "Lợi" }, { type: "text", label: "Hại" }], status_options: [{ key: "a", label: "Đang cân nhắc" }], title_label: "Lựa chọn", sub_template_key: null, sort_order: 60, is_active: true, audiences: ["moi_nguoi"], when_to_use: "Phải chọn giữa vài phương án.", example_rows: null },
  { key: "objections", name: "Xử lý lời từ chối", thinking_type: "learn", guiding_question: "Khách thật sự lo điều gì?", description: null, scopes: ["journal", "direct", "group"], column_defs: [{ type: "text", label: "Lo thật" }, { type: "text", label: "Cách đáp" }], status_options: [{ key: "a", label: "Đang thử" }], title_label: "Khách nói", sub_template_key: null, sort_order: 340, is_active: true, audiences: ["sales"], when_to_use: "Gom câu khách hay nói và cách đáp tốt.", example_rows: [{ title: "“Giá cao quá”", "Lo thật": "Sợ không đáng tiền" }, { title: "“Để anh suy nghĩ thêm”", "Lo thật": "Chưa đủ tin" }] },
  { key: "choose_school", name: "Chọn trường · chọn ngành", thinking_type: "weigh", guiding_question: "Mình hợp với điều gì nhất?", description: null, scopes: ["journal", "direct", "group"], column_defs: [{ type: "number", label: "Điểm chuẩn" }], status_options: [{ key: "a", label: "Đang cân nhắc" }], title_label: "Trường / ngành", sub_template_key: null, sort_order: 240, is_active: true, audiences: ["hoc_sinh"], when_to_use: "Chọn nguyện vọng.", example_rows: null },
  { key: "biz_idea", name: "Ý tưởng kinh doanh", thinking_type: "weigh", guiding_question: "Ai cần điều này?", description: null, scopes: ["journal", "group"], column_defs: [{ type: "text", label: "Ai cần" }], status_options: [{ key: "a", label: "Đang nghĩ" }], title_label: "Ý tưởng", sub_template_key: null, sort_order: 300, is_active: true, audiences: ["doanh_nhan"], when_to_use: "Có ý mới.", example_rows: null },
];

for (const [w, h] of SIZES) {
  test(`88.5b · kệ 6 Bàn làm việc: chỉ bảng trên bàn + Chỗ trống · ${w}x${h}`, async () => {
    db.tables.think_hub_desk = [
      { table_id: "b1", placed_at: daysAgo(1) },
      { table_id: "b5", placed_at: daysAgo(0) },
      { table_id: "b3", placed_at: daysAgo(2) },
    ];
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=6" />);
    await settle(1300);
    expect(document.querySelector("[data-plan-search-button]")).not.toBeNull();
    expect(document.querySelector("[data-desk-count]")?.textContent).toBe("3/5");
    expect(document.querySelectorAll("[data-desk-card]").length).toBe(3);
    expect(document.querySelectorAll("[data-desk-slot]").length).toBe(2);
    expect(document.querySelector('[data-desk-card="b2"]')).toBeNull();
    await page.screenshot({ path: `${OUT79}/88-5b-ke-6-${w}.png` });
  });
}

test("88.5b · Đặt xuống → remove_from_desk", async () => {
  db.tables.think_hub_desk = [{ table_id: "b1", placed_at: daysAgo(1) }];
  await viewport(1280, 800);
  const screen = await render(<App at="/ke-hoach?ke=6" />);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Thêm cho “Có nên mở xưởng thứ hai?”" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Đặt xuống" }));
  await settle(300);
  expect(db.calls.find((call) => call.name === "remove_from_desk")?.args).toEqual({ p_table_id: "b1" });
});

test("79.1 · 🔍 mở ô tìm ngay tại chỗ; Huỷ đóng", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach" />);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: "Tìm trong Kế hoạch" }));
  await userEvent.fill(screen.getByRole("textbox", { name: "Tìm trong Kế hoạch" }), "xuong");
  await settle(300);
  expect(document.querySelector("[data-library-results]")?.textContent).toContain("Có nên mở xưởng thứ hai?");
  await page.screenshot({ path: `${OUT79}/79-1-tim-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(document.querySelector("[data-plan-search]")).toBeNull();
});

test("79.2 · kệ 6 gõ câu hỏi: tạo Bảng Của tôi, câu hỏi = câu gõ, Đang suy nghĩ, lên bàn", async () => {
  seed({ empty: true });
  db.tables.think_hub_desk = [];
  db.rpcs.create_think_hub_table = tableRow({ id: "new1", name: "Năm tới tôi muốn học gì?", purpose: "Năm tới tôi muốn học gì?" });
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=6" />);
  await settle(1000);
  await page.screenshot({ path: `${OUT79}/79-2-ban-trong-390.png` });
  await userEvent.fill(screen.getByRole("textbox", { name: "Điều gì đang ở trong đầu bạn?" }), "Năm tới tôi muốn học gì?");
  await userEvent.click(screen.getByRole("button", { name: /Đặt lên bàn/ }));
  await settle(500);
  const created = db.calls.find((call) => call.name === "create_think_hub_table")?.args as Record<string, unknown>;
  expect(created).toMatchObject({ p_name: "Năm tới tôi muốn học gì?", p_purpose: "Năm tới tôi muốn học gì?" });
  expect(db.calls.find((call) => call.name === "set_board_lifecycle")?.args).toEqual({ p_table_id: "new1", p_lifecycle: "thinking" });
  expect(db.calls.find((call) => call.name === "place_on_desk")?.args).toEqual({ p_table_id: "new1" });
});

test("79.3 · bàn đủ 5 → khung `Bàn đã đủ 5`", async () => {
  db.tables.think_hub_desk = ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ table_id: id, placed_at: daysAgo(1) }));
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=6" />);
  await settle(1000);
  window.dispatchEvent(new CustomEvent("avora:desk-full", { detail: "new6" }));
  await settle(500);
  expect(document.querySelector("[data-desk-full]")?.textContent).toContain("Bàn đã đủ 5");
  await page.screenshot({ path: `${OUT79}/79-3-ban-day-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Dự án chiếu sáng|Báo giá và hợp đồng/ }).last());
  await settle(400);
  expect(db.calls.find((call) => call.name === "remove_from_desk")?.args).toEqual({ p_table_id: "b3" });
});

test("88.1b · kệ 2: Đang nghĩ (câu hỏi = mục đích, ô trống) · Để lâu · chưa có câu hỏi · Vừa thông suốt", async () => {
  db.tables.think_hub_desk = [{ table_id: "b1", placed_at: daysAgo(1) }];
  db.tables.think_hub_board_opened = [{ board_key: "b2", opened_at: daysAgo(10) }];
  db.rpcs.think_hub_open_questions = [{ table_id: "b5", empty_cells: 3, has_conclusion: false, others_changed_at: null }];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=2" />);
  await settle(1100);
  const thinking = document.querySelector('[data-overview="thinking"]');
  // On the desk first, then by last open; questions shown as the purpose.
  expect([...(thinking?.querySelectorAll("[data-open-question]") ?? [])].map((n) => n.getAttribute("data-open-question"))).toEqual(["b1", "b5"]);
  expect(thinking?.textContent).toContain("“Làm gì trước khi mùa mưa tới?”");
  expect(thinking?.textContent).toContain("Còn trống 3 ô");
  expect(document.querySelector('[data-overview="dusty"]')?.textContent).toContain("10 ngày chưa mở");
  expect(document.querySelector('[data-overview="no-question"]')?.textContent).toContain("1 bảng chưa có câu hỏi");
  expect(document.querySelector('[data-overview="settled"]')?.textContent).toContain("Chốt nhà cung cấp Rạng Đông");
  await page.screenshot({ path: `${OUT79}/88-1b-ke-2-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Làm gì trước khi mùa mưa tới/ }));
  await settle(600);
  expect(document.querySelector("[data-board-question]")?.textContent).toBe("Làm gì trước khi mùa mưa tới?");
});

test("88.2 · đi đủ 6 kệ bằng ‹ › và nút lên/xuống; 1/4 không có ‹, 3/6 không có ›", async () => {
  await viewport(390, 844);
  await render(<App at="/ke-hoach?ke=1" />);
  await settle(1000);
  const at = () => Number(document.querySelector("[data-room-bar]")?.getAttribute("data-room-bar"));
  const click = (sel: string) => document.querySelector<HTMLButtonElement>(sel)?.click();
  const seen: number[] = [];
  for (const step of ["", "[data-room-next]", "[data-room-next]", "[data-room-updown]", "[data-room-prev]", "[data-room-prev]"]) {
    if (step !== "") click(step);
    await settle(450);
    seen.push(at());
    const id = at();
    expect(document.querySelector("[data-room-prev]") === null).toBe(id === 1 || id === 4);
    expect(document.querySelector("[data-room-next]") === null).toBe(id === 3 || id === 6);
    expect(document.querySelector("[data-room-minimap] [data-on]")).not.toBeNull();
    await page.screenshot({ path: `${OUT79}/88-2-ke-${id}-390.png` });
  }
  expect(seen).toEqual([1, 2, 3, 6, 5, 4]);
});

test("88.3 · chạm bản đồ → tấm Cả phòng → ô 6", async () => {
  await viewport(390, 844);
  await render(<App at="/ke-hoach?ke=2" />);
  await settle(900);
  document.querySelector<HTMLButtonElement>("[data-room-map-button]")?.click();
  await settle(500);
  expect(document.querySelectorAll("[data-room-sheet] [data-room-tile]").length).toBe(6);
  expect(document.querySelector('[data-room-tile="2"]')?.getAttribute("aria-current")).toBe("true");
  await page.screenshot({ path: `${OUT79}/88-3-ca-phong-390.png` });
  document.querySelector<HTMLButtonElement>('[data-room-tile="6"]')?.click();
  await settle(500);
  expect(document.querySelector('[data-room-shelf="6"]')).not.toBeNull();
});

test("88.4 · kệ 1: 6 gáy khác kiểu; chạm gáy nhô lên, xem bên trong, không chuyển kệ", async () => {
  await viewport(390, 844);
  await render(<App at="/ke-hoach?ke=1" />);
  await settle(1000);
  expect([...document.querySelectorAll("[data-spine]")].map((n) => n.getAttribute("data-spine-kind"))).toEqual(["binder", "box", "binder", "book", "notebook", "box"]);
  expect(document.querySelector("[data-spine-hint]")).not.toBeNull();
  await page.screenshot({ path: `${OUT79}/88-4-ke-1-390.png` });
  document.querySelector<HTMLButtonElement>('[data-spine="books"]')?.click();
  await settle(400);
  expect(document.querySelector('[data-spine="books"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[data-spine-preview="books"]')?.textContent).toContain("Pride and Prejudice");
  expect(document.querySelector('[data-room-shelf="1"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("Thùng rác");
  await page.screenshot({ path: `${OUT79}/88-4-ke-1-gay-sach-390.png` });
  document.querySelector<HTMLButtonElement>("[data-spine-primary]")?.click();
  await settle(500);
  expect(document.querySelector('[data-room-shelf="5"]')).not.toBeNull();
});

test("88.4b / 88.14 · gáy Mẫu bảng: hỏi một lần; 3 mẫu; chạm mẫu → chọn Nhóm → tạo, mở tập trung, lên bàn", async () => {
  db.tables.think_hub_template = ROOM_TEMPLATES;
  db.tables.think_hub_user_template = [];
  db.tables.think_hub_desk = [];
  db.rpcs.create_think_hub_table_from_template = tableRow({ id: "nt1", name: "Cân nhắc lựa chọn", conversation_id: "g1", source_template_key: "weigh_options" });
  db.tables.think_hub_table = [...(db.tables.think_hub_table as Record<string, unknown>[]), tableRow({ id: "nt1", name: "Cân nhắc lựa chọn", conversation_id: "g1", source_template_key: "weigh_options" })];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=1" />);
  await settle(1000);
  document.querySelector<HTMLButtonElement>('[data-spine="templates"]')?.click();
  await settle(500);
  expect(document.querySelector("[data-audience-ask]")).not.toBeNull();
  await page.screenshot({ path: `${OUT79}/88-14-hoi-mot-lan-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Sales" }));
  await userEvent.click(screen.getByRole("button", { name: "Doanh nhân" }));
  await userEvent.click(screen.getByRole("button", { name: "Xem mẫu hợp với tôi" }));
  await settle(500);
  const saved = db.writes.filter((item) => item.table === "profiles").map((item) => JSON.stringify(item.row)).join(" ");
  expect(saved).toContain("template_audiences");
  expect(saved).toContain("sales");
  // The library opens as a focus screen; my groups stand first and are picked.
  expect(document.querySelector("[data-template-library]")).not.toBeNull();
  expect([...document.querySelectorAll("[data-filter-audience] [data-audience]")].slice(0, 2).map((n) => n.getAttribute("data-audience")).sort()).toEqual(["doanh_nhan", "sales"]);
  expect(document.querySelector("[data-template-count]")?.textContent).toMatch(/^2 mẫu hợp với (Sales · Doanh nhân|Doanh nhân · Sales)$/);
  await page.screenshot({ path: `${OUT79}/88-14-thu-vien-mau-390.png` });
  document.querySelector<HTMLButtonElement>("[data-focus-back]")?.click();
  await settle(400);
  expect(document.querySelectorAll("[data-template-quick]").length).toBe(3);
  await page.screenshot({ path: `${OUT79}/88-4b-gay-mau-bang-390.png` });
  document.querySelector<HTMLButtonElement>('[data-template-quick="weigh_options"]')?.click();
  await settle(400);
  document.querySelector<HTMLButtonElement>('[data-place-picker] [data-place="g1"]')?.click();
  await settle(800);
  expect(db.calls.find((call) => call.name === "create_think_hub_table_from_template")?.args).toMatchObject({ p_template_key: "weigh_options", p_conversation_id: "g1" });
  expect(db.calls.find((call) => call.name === "place_on_desk")?.args).toEqual({ p_table_id: "nt1" });
});

test("88.15 / 88.16 · lọc Quyết định × Học sinh; xem trước 2 Hạng mục ví dụ (không lưu)", async () => {
  db.tables.think_hub_template = ROOM_TEMPLATES;
  db.tables.think_hub_user_template = [];
  db.tables.profiles = [{ prefs: { template_audiences: [], template_audiences_asked: true } }];
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=1" />);
  await settle(900);
  document.querySelector<HTMLButtonElement>('[data-spine="templates"]')?.click();
  await settle(300);
  expect(document.querySelector("[data-audience-ask]")).toBeNull();
  document.querySelector<HTMLButtonElement>("[data-open-library-full]")?.click();
  await settle(400);
  const typeChip = () => document.querySelector<HTMLButtonElement>('[data-filter-type] button:nth-child(5)');
  expect(typeChip()?.textContent).toBe("Quyết định");
  typeChip()?.click();
  document.querySelector<HTMLButtonElement>('[data-audience="hoc_sinh"]')?.click();
  await settle(200);
  expect([...document.querySelectorAll("[data-template-card]")].map((n) => n.getAttribute("data-template-card"))).toEqual(["choose_school"]);
  typeChip()?.click();
  document.querySelector<HTMLButtonElement>('[data-audience="hoc_sinh"]')?.click();
  await settle(200);
  document.querySelector<HTMLButtonElement>('[data-template-card="objections"]')?.click();
  await settle(400);
  expect(document.querySelectorAll("[data-template-preview] [data-example-row]").length).toBe(2);
  await page.screenshot({ path: `${OUT79}/88-16-xem-truoc-390.png` });
  expect(db.calls.some((call) => call.name.includes("record"))).toBe(false);
});

test("88.7 · mở Bảng từ kệ 6: chỉ còn Bảng, mũi tên mép trái (→5) và trên (→3); ‹ về kệ 6", async () => {
  db.tables.think_hub_desk = [{ table_id: "b1", placed_at: daysAgo(1) }];
  await viewport(390, 844);
  await render(<App at="/ke-hoach?ke=6" />);
  await settle(1000);
  document.querySelector<HTMLButtonElement>('[data-desk-card="b1"] button')?.click();
  await settle(800);
  expect(document.querySelector("[data-room-bar]")).toBeNull();
  expect(document.querySelector("[data-room-updown]")).toBeNull();
  expect(document.querySelector("[data-focus-title]")?.textContent).toContain("Bàn làm việc");
  expect([...document.querySelectorAll("[data-edge-arrow]")].map((n) => n.getAttribute("data-edge-arrow")).sort()).toEqual(["left", "up"]);
  expect(document.querySelector('[data-edge-arrow="left"]')?.getAttribute("aria-label")).toBe("Rời Có nên mở xưởng thứ hai?, sang Đọc & Nhật ký");
  await page.screenshot({ path: `${OUT79}/88-7-tap-trung-390.png` });
  document.querySelector<HTMLButtonElement>("[data-focus-back]")?.click();
  await settle(600);
  expect(document.querySelector('[data-room-shelf="6"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-desk-card="b1"] button')?.click();
  await settle(600);
  document.querySelector<HTMLButtonElement>('[data-edge-arrow="left"]')?.click();
  await settle(600);
  expect(document.querySelector('[data-room-shelf="5"]')).not.toBeNull();
});

for (const [at, shelf] of [["/ke-hoach?bay=tien-trinh", "3"], ["/ke-hoach?ke=ke-sach", "5"], ["/ke-hoach?ngan=avora", "4"], ["/ke-hoach?bay=noi", "3"]] as const) {
  test(`88.11 · liên kết cũ ${at} → kệ ${shelf}`, async () => {
    await viewport(1280, 800);
    await render(<App at={at} />);
    await settle(800);
    expect(document.querySelector("[data-room-bar]")?.getAttribute("data-room-bar")).toBe(shelf);
  });
}

test("88.12 · máy tính bấm ↓ từ kệ 2 → kệ 5; giảm chuyển động: không trượt", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=2" />);
  await settle(800);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await settle(500);
  expect(document.querySelector('[data-room-shelf="5"]')).not.toBeNull();
  // The slide class exists; under prefers-reduced-motion the CSS swaps it for a fade (index.css).
  expect(document.querySelector("[data-room-stage]")?.className).toContain("room-in-down");
  const css = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText); } catch { return []; } }).join(" ");
  expect(css).toMatch(/prefers-reduced-motion: reduce[^}]*room-in-down/);
});

test("88.13 · 844×390 nằm ngang: kệ 2 không vỡ", async () => {
  await viewport(844, 390);
  await render(<App at="/ke-hoach?ke=2" />);
  await settle(900);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({ path: `${OUT79}/88-13-ngang-844.png` });
});

// ------------------------------------------------------------------ AVORA-94 · B2.4 (kệ 2 · kệ 5 · màn đọc, 3 khổ)
const OUT94 = "../../../docs/screens/2026-10-04";
const SIZES94 = [
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

function seedStats(): void {
  db.rpcs.think_hub_room_stats = {
    boards_by_status: { waiting: 3, thinking: 4, concluded: 1 },
    records_total: 15,
    records_new: 2,
    open_tasks: 25,
    top_items: [
      { board_key: "b1", name: "Có nên mở xưởng thứ hai?", value: 42 },
      { board_key: "b3", name: "Chọn nhà cung cấp đèn", value: 18 },
    ],
    top_opens: [{ board_key: "b1", name: "Có nên mở xưởng thứ hai?", value: 6 }],
    top_time: [{ board_key: "b1", name: "Có nên mở xưởng thứ hai?", value: 2880 }],
    viewed: [
      { kind: "board", item_key: "b1", name: "Có nên mở xưởng thứ hai?", opens: 6, seconds: 2880, last_day: daysAgo(0).slice(0, 10) },
      { kind: "book", item_key: "k1", name: "Pride and Prejudice", opens: 4, seconds: 4200, last_day: daysAgo(0).slice(0, 10) },
    ],
  };
  const day = (ago: number): string => {
    const at = new Date(Date.now() - ago * 86_400_000);
    return `${at.getFullYear()}-${`${at.getMonth() + 1}`.padStart(2, "0")}-${`${at.getDate()}`.padStart(2, "0")}`;
  };
  db.tables.activity_daily = [
    { day: day(0), item_key: "k1", active_seconds: 1500 },
    { day: day(1), item_key: "k1", active_seconds: 2400 },
    { day: day(3), item_key: "k1", active_seconds: 900 },
  ];
  db.tables.notes = [
    { id: "n1", folder_id: null, title: "", blocks: [{ id: "a", level: null, text: "“It is a truth universally acknowledged…”" }, { id: "b", level: null, text: "Câu mở đầu tự giễu chính nó." }], tags: ["Pride and Prejudice"], pinned_at: daysAgo(1), book_record_id: "k1", book_title: "Pride and Prejudice", book_locator: "0:1", deleted_at: null, created_at: daysAgo(1), updated_at: daysAgo(1) },
  ];
}

for (const [w, h] of SIZES94) {
  test(`94 · ảnh kệ 2 số liệu · ${w}x${h}`, async () => {
    seedStats();
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=2" />);
    await settle(1400);
    expect(document.querySelector('[data-room-shelf="2"]')).not.toBeNull();
    await page.screenshot({ path: `${OUT94}/94-ke-2-${w}.png` });
  });
  test(`94 · ảnh kệ 5 thời gian đọc + ghi chú sách · ${w}x${h}`, async () => {
    seedStats();
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=5" />);
    await settle(1400);
    const top = document.querySelector("[data-room-five-top]") as HTMLElement;
    expect(top).not.toBeNull();
    if (w >= 768) {
      // Two columns on a computer / tablet: left (time + books) beside right (notes + diary).
      const left = document.querySelector('[data-room-five-col="left"]')?.getBoundingClientRect();
      const right = document.querySelector('[data-room-five-col="right"]')?.getBoundingClientRect();
      expect(left !== undefined && right !== undefined && right.left >= left.right - 1).toBe(true);
    }
    await page.screenshot({ path: `${OUT94}/94-ke-5-${w}.png` });
  });
  test(`94 · ảnh màn đọc 4 vùng · ${w}x${h}`, async () => {
    window.localStorage.removeItem("avora.reader.zones-seen");
    await viewport(w, h);
    await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1400);
    await page.screenshot({ path: `${OUT94}/94-doc-4-vung-${w}.png` });
  });
}
