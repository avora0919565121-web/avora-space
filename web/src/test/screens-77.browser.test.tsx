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
      rpc: (name: string, args: unknown) => {
        db.calls.push({ name, args });
        return builder(db.rpcs[name] ?? []);
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
import BookReader from "@/pages/BookReader";
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
  seed();
  reader.server = null;
  reader.saved = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

// ------------------------------------------------------------------ 77.1
for (const [w, h] of SIZES) {
  test(`77.1 · Kế hoạch lần đầu · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach" />);
    await settle(1200);
    // A1: four soft tiles.
    expect(document.querySelector('[data-tile="overdue"]')?.textContent).toContain("cần chốt");
    expect(document.querySelector('[data-tile="today"]')?.textContent).toContain("cần tập trung");
    if (w === 390) {
      // B1: a phone shows the six shelves as a list, no shelf open yet.
      expect(document.querySelectorAll("[data-shelf-list] [data-shelf]").length).toBe(6);
      expect(document.querySelector("[data-open-shelf]")).toBeNull();
    } else {
      expect(document.querySelectorAll("[data-shelf-cards] [data-shelf]").length).toBe(6);
      expect(document.querySelector('[data-shelf="hoach-dinh"]')?.getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector('[data-open-shelf="hoach-dinh"]')).not.toBeNull();
    }
    await page.screenshot({ path: `${OUT}/77-1-thu-vien-${w}.png` });
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
  test(`77.4 · kệ 03 theo trạng thái · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach?ke=trang-thai" />);
    await settle(1000);
    const lane = (id: string) => [...document.querySelectorAll(`[data-lane="${id}"] [data-lane-card]`)].map((node) => node.getAttribute("data-lane-card"));
    expect(lane("waiting").sort()).toEqual(["b2", "b4"]);
    expect(lane("thinking").sort()).toEqual(["b1", "b5"]);
    expect(lane("concluded")).toEqual(["b3"]);
    // Neither the system board nor the bookshelf stands here.
    expect(document.querySelector('[data-lane-card="sb"]')).toBeNull();
    expect(document.querySelector('[data-lane-card="shelf"]')).toBeNull();
    await page.screenshot({ path: `${OUT}/77-4-ke-03-trang-thai-${w}.png` });
  });
}

test("77.4 · chuyển Bảng sang Đang suy nghĩ đi qua RPC set_board_lifecycle", async () => {
  await viewport(1280, 800);
  const screen = await render(<App at="/ke-hoach?ke=trang-thai" />);
  await settle(1000);
  await userEvent.click(screen.getByRole("button", { name: 'Chuyển "Chọn trường cho con" sang trạng thái khác' }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Chuyển sang Đang suy nghĩ" }));
  await settle(300);
  expect(db.calls.find((call) => call.name === "set_board_lifecycle")?.args).toEqual({ p_table_id: "b2", p_lifecycle: "thinking" });
});

test("77.6 · kệ 06 trên tài khoản trống", async () => {
  seed({ empty: true });
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=khac" />);
  await settle(1000);
  expect(document.querySelector('[data-shelf="khac"]')?.textContent).toContain("Không có gì cần xếp");
  expect(document.body.textContent).not.toContain("Ý chưa xếp");
  await page.screenshot({ path: `${OUT}/77-6-ke-06-trong-1280.png` });
});

test("77.23 · người mới: thư viện không có chữ hướng dẫn dài", async () => {
  seed({ empty: true });
  await viewport(390, 844);
  await render(<App at="/ke-hoach" />);
  await settle(1000);
  await page.screenshot({ path: `${OUT}/77-23-nguoi-moi-390.png` });
});

// ------------------------------------------------------------------ 77.5 kệ 05
test("77.5 · kệ 05 Nhật ký là lối vào: 5 thẻ", async () => {
  await viewport(1280, 800);
  await render(<App at="/ke-hoach?ke=nhat-ky" />);
  await settle(1000);
  expect(document.querySelectorAll("[data-diary-door]").length).toBe(5);
  await page.screenshot({ path: `${OUT}/77-5-ke-05-nhat-ky-1280.png` });
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

// ------------------------------------------------------------------ 77.7 / 77.8 the reader
for (const [w, h] of SIZES) {
  test(`77.7 · đọc trong Avora · ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
    await settle(1200);
    const article = document.querySelector("[data-reader] article") as HTMLElement;
    expect(article.getAttribute("lang")).toBe("en");
    expect(article.closest("[translate]")).toBeNull();
    expect(document.querySelector("[data-translate-line]")?.textContent).toBe("Sách tiếng Anh. Dịch bằng trình duyệt — bản dịch không lưu.");
    await page.screenshot({ path: `${OUT}/77-7-doc-sach-${w}.png` });
  });
}

test("77.7 · mục lục + cuối sách có Về bản này", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  await userEvent.click(screen.getByRole("button", { name: "Mục lục" }));
  await settle(300);
  await page.screenshot({ path: `${OUT}/77-7-muc-luc-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Chapter III/ }));
  await settle(600);
  const about = document.querySelector("[data-about-edition]") as HTMLElement;
  expect(about.textContent).toContain("Project Gutenberg License");
  about.scrollIntoView();
  await settle(300);
  await page.screenshot({ path: `${OUT}/77-7-ve-ban-nay-390.png` });
});

test("77.8 · máy khác đọc xa hơn: hỏi, không tự nhảy", async () => {
  reader.server = { recordId: "k1", locator: "c1:p4", percent: 52, deviceLabel: "iPhone · Safari", updatedAt: new Date().toISOString() };
  await viewport(1280, 800);
  await render(<App at="/ke-hoach/ke-sach/doc/k1" />);
  await settle(1200);
  const offer = document.querySelector("[data-reading-offer]");
  expect(offer?.textContent).toContain("Bạn đã đọc tới 52% trên iPhone · Safari — mở tới đó?");
  // Still on chapter 1 — it did not jump by itself.
  expect(document.querySelector("[data-reader] header")?.textContent).toContain("Chapter I.");
  await page.screenshot({ path: `${OUT}/77-8-may-khac-doc-xa-hon-1280.png` });
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
  expect(document.querySelector('[role="toolbar"][aria-label="Đoạn đang chọn"]')?.textContent).toContain("Chép vào Ghi chép sách");
  await page.screenshot({ path: `${OUT}/77-10-chep-y-1280.png` });
});

// ------------------------------------------------------------------ 77.24 tab memory
test("77.24 · Kế hoạch › kệ 04 → Nhiệm vụ → bấm Kế hoạch: về đúng kệ 04", async () => {
  await viewport(390, 844);
  const screen = await render(<App at="/ke-hoach?ke=ke-sach" />);
  await settle(1200);
  await userEvent.click(screen.getByRole("link", { name: /Nhiệm vụ/ }));
  await settle(800);
  await userEvent.click(screen.getByRole("link", { name: /Kế hoạch/ }));
  await settle(1000);
  expect(document.querySelector('[data-open-shelf="ke-sach"]')).not.toBeNull();
  // 77.25: pressing Kế hoạch again goes to its root — on a phone, the six shelves.
  await userEvent.click(screen.getByRole("link", { name: /Kế hoạch/ }));
  await settle(800);
  expect(document.querySelector("[data-open-shelf]")).toBeNull();
  expect(document.querySelector("[data-shelf-list]")).not.toBeNull();
});
