import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * Screenshots for the AVORA-61 / 62 / 63 report: the real screens with fixed fake data (no
 * account, no network), on a computer (1280×800) and an iPhone (390×844, on its side 844×390).
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
      rpc: (name: string) => builder(db.rpcs[name] ?? []),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { ConfirmHost } from "@/components/ConfirmHost";
import { DiaryList } from "@/components/chat/DiaryViews";
import { LandscapeRail } from "@/components/nav/LandscapeRail";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { NotesTree } from "@/components/notes/NotesTree";
import { QuickActionBubble } from "@/components/QuickActionBubble";
import { BoardUpdateCard } from "@/components/think-hub/BoardChanges";
import { GroupAvatarButton, GroupCardHost } from "@/components/GroupCard";
import { PersonAvatarButton, PersonCardHost } from "@/components/PersonCard";
import { Toaster } from "@/components/ui/sonner";
import type { Note, NoteFolder } from "@/lib/notes";
import { todayIso } from "@/lib/tasks";
import type { NotesData } from "@/lib/use-notes";
import { setSavedLook } from "@/lib/theme";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import ContactNameRepair from "@/pages/ContactNameRepair";
import Messages from "@/pages/Messages";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";
import Vault from "@/pages/Vault";

const OUT = "../../../docs/screens/2026-10-02";
const today = todayIso();
const now = new Date().toISOString();
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

// ------------------------------------------------------------------ a shared board with 8 columns
const COLUMNS = [
  { id: "c_gia", key: "c_gia", label: "Giá trị", type: "number" },
  { id: "c_web", key: "c_web", label: "Hồ sơ", type: "link" },
  { id: "c_kh", key: "c_kh", label: "Khách", type: "contact" },
  { id: "c_ky", key: "c_ky", label: "Đã ký", type: "checkbox" },
  { id: "c_tep", key: "c_tep", label: "Hợp đồng", type: "file" },
  { id: "c_kv", key: "c_kv", label: "Khu vực", type: "select", options: ["Miền Bắc", "Miền Trung", "Miền Nam"] },
];

function tableRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "b1",
    owner_user_id: "me",
    name: "Dự án chiếu sáng",
    position: 0,
    column_defs: COLUMNS,
    column_trash: [],
    project_id: null,
    conversation_id: "g1",
    parent_record_id: null,
    depth: 1,
    purpose: "Theo dõi báo giá và hợp đồng đèn cho các khu nghỉ dưỡng",
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
    ...part,
  };
}

function recordRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "r",
    table_id: "b1",
    owner_user_id: "me",
    title: "",
    status: "dang_lam",
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
    editor_ids: [],
    ...part,
  };
}

const RECORDS = [
  recordRow({ id: "r1", owner_user_id: "lan", title: "Dự án Hoiana — cung cấp đèn spotlight cho khu nghỉ dưỡng", status: "dang_lam", priority: "trung_binh", category: "Khai triển", next_action_date: "2026-10-12", extension_fields: { c_gia: 1_250_000_000, c_web: "https://hoiana.vn/ho-so", c_kh: "k-lan", c_ky: "1", c_kv: "Miền Trung" }, created_at: hoursAgo(1) }),
  recordRow({ id: "r2", title: "Dự án Sun Group", status: "cho", priority: "cao", category: "Báo giá", next_action_date: "2026-10-20", extension_fields: { c_gia: 860_000_000, c_kv: "Miền Bắc" }, created_at: hoursAgo(2) }),
  recordRow({ id: "r3", title: "Khách sạn Mường Thanh — thay đèn hành lang tầng 3 đến tầng 12", status: "moi", priority: "thap", category: "Khảo sát", next_action_date: "2026-10-25", extension_fields: { c_ky: "1", c_kv: "Miền Nam" }, created_at: hoursAgo(3) }),
  recordRow({ id: "r4", owner_user_id: "lan", title: "Resort Phú Quốc", status: "dang_lam", priority: "cao", category: "Khai triển", next_action_date: "2026-11-02", extension_fields: { c_gia: 2_100_000_000, c_web: "https://pq.example.vn" }, created_at: hoursAgo(4) }),
  recordRow({ id: "r5", title: "Văn phòng Landmark 81", status: "xong", priority: "trung_binh", category: "Bảo trì", extension_fields: { c_kv: "Miền Nam" }, created_at: hoursAgo(5) }),
  recordRow({ id: "r6", title: "Showroom Đà Nẵng", status: "moi", priority: "trung_binh", category: "Báo giá", extension_fields: {}, created_at: hoursAgo(6) }),
  // The sub-table of r1 and its rows.
  recordRow({ id: "s1", table_id: "b1-sub", title: "Khu A — sảnh chính", status: "dang_lam", extension_fields: {}, created_at: hoursAgo(1) }),
  recordRow({ id: "s2", table_id: "b1-sub", title: "Khu B — hồ bơi", status: "moi", extension_fields: {}, created_at: hoursAgo(2) }),
];

const SUB_TABLE = tableRow({ id: "b1-sub", name: "Hạng mục chi tiết Hoiana", parent_record_id: "r1", depth: 2, column_defs: [{ id: "c_sl", key: "c_sl", label: "Số lượng", type: "number" }], purpose: null });

const CHANGES = [
  // Lan's edits after my last visit — dots + "N thay đổi từ lần bạn xem trước".
  { id: "ch1", table_id: "b1", actor_id: "lan", kind: "record_edit", record_id: "r2", column_id: null, record_owner_id: "me", record_title: "Dự án Sun Group", cells: 2, before: { status: "moi", "ext:c_gia": 800000000 }, after: { status: "cho", "ext:c_gia": 860000000 }, created_at: hoursAgo(2), announced_at: null, announcement_id: null },
  { id: "ch2", table_id: "b1", actor_id: "lan", kind: "record_add", record_id: "r6", column_id: null, record_owner_id: "lan", record_title: "Showroom Đà Nẵng", cells: 1, before: null, after: { title: "Showroom Đà Nẵng" }, created_at: hoursAgo(2), announced_at: null, announcement_id: null },
  { id: "ch3", table_id: "b1", actor_id: "lan", kind: "record_delete", record_id: "r9", column_id: null, record_owner_id: "me", record_title: "Nhà máy Bình Dương", cells: 1, before: { title: "Nhà máy Bình Dương" }, after: null, created_at: hoursAgo(2), announced_at: null, announcement_id: null },
  // My own unannounced edits — `Báo nhóm · 5`, one of them on Lan's Hạng mục.
  { id: "ch4", table_id: "b1", actor_id: "me", kind: "record_edit", record_id: "r1", column_id: null, record_owner_id: "lan", record_title: "Dự án Hoiana — cung cấp đèn spotlight cho khu nghỉ dưỡng", cells: 3, before: { status: "moi", priority: "thap", "ext:c_ky": null }, after: { status: "dang_lam", priority: "trung_binh", "ext:c_ky": "1" }, created_at: hoursAgo(1), announced_at: null, announcement_id: null },
  { id: "ch5", table_id: "b1", actor_id: "me", kind: "record_edit", record_id: "r3", column_id: null, record_owner_id: "me", record_title: "Khách sạn Mường Thanh", cells: 2, before: { category: null, next_action_date: null }, after: { category: "Khảo sát", next_action_date: "2026-10-25" }, created_at: hoursAgo(1), announced_at: null, announcement_id: null },
];

function seed(options: { changes?: boolean } = {}): void {
  db.tables = {
    dismissed_guidance: [{ guidance_key: "plan_plus_hold" }, { guidance_key: "task_plus_hold" }],
    think_hub_table: [tableRow({}), SUB_TABLE],
    think_hub_record: RECORDS,
    think_hub_change_log: options.changes === false ? [] : CHANGES,
    contact: [
      { id: "k-lan", owner_user_id: "me", contact_type: "individual", name: "Lan Nguyễn", phone: "+84901234567", email: null, linked_user_id: "lan", needs_details: false, created_at: now, updated_at: now },
    ],
    tasks: [],
  };
  db.rpcs = {
    list_my_conversations: [
      { conversation_id: "g1", conversation_type: "group", group_name: "Dự án chiếu sáng", member_count: 3, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "Mai 7h họp nhé", last_message_at: now, last_message_sender_id: "lan", unread_count: 0, sort_at: now, is_connected: true, peer_pin: null, verification_status: null },
      { conversation_id: "c-lan", conversation_type: "direct", group_name: null, member_count: 2, peer_id: "lan", peer_display_name: "Lan Nguyễn", peer_email: null, last_message_content: "Ok anh", last_message_at: now, last_message_sender_id: "lan", unread_count: 0, sort_at: now, is_connected: true, peer_pin: "A-LAN12345", verification_status: null },
    ],
    list_my_connections: [
      { user_id: "lan", display_name: "Lan Nguyễn", pin: "A-LAN12345", created_at: now },
      { user_id: "minh", display_name: "Minh Trần", pin: "A-MINH0001", created_at: now },
    ],
    list_group_members: [
      { user_id: "me", display_name: "Thiện", role: "owner", joined_at: now },
      { user_id: "lan", display_name: "Lan Nguyễn", role: "member", joined_at: now },
      { user_id: "minh", display_name: "Minh Trần", role: "member", joined_at: now },
    ],
    // My last visit: before Lan's changes.
    mark_think_hub_table_seen: hoursAgo(5),
    preview_think_hub_table_delete: { records: 6, sub_tables: 1, tasks: 2, tasks_kept_by_assignee: 0 },
    vault_status: { has_code: true, has_data: true, unlocked: true, expires_at: null, locked_until: null, remaining: 5 },
  };
}

function Frame({ children, at = "/" }: { children: ReactNode; at?: string }) {
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

/** The signed-in frame (RequireAuth's own classes). */
function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:flex-row short:flex-row">
      <MobileTopBar />
      <LandscapeRail />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col short:pr-[var(--inset-r)]">{children}</main>
      <ToolBelt />
      <QuickActionBubble />
    </div>
  );
}

function Hubs({ at }: { at: string }) {
  return (
    <Frame at={at}>
      <AppFrame>
        <Routes>
          <Route path="/nhiem-vu" element={<Tasks />} />
          <Route path="/ke-hoach" element={<ThinkHub />} />
          <Route path="/tin-nhan" element={<Messages />} />
          <Route path="/ket-sat/*" element={<Vault />} />
        </Routes>
      </AppFrame>
    </Frame>
  );
}

async function settle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

/** A phone: no hovering fine pointer (the keys hint and hover captions stay away). */
function asTouchDevice(): () => void {
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => {
    if (!query.includes("pointer") && !query.includes("hover")) return original(query);
    const matches = query.includes("coarse") && !query.includes("not");
    return { matches, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false } as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function rightClick(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: rect.x + 10, clientY: rect.y + 10 }));
}

beforeEach(() => {
  seed();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("data-notch");
  document.documentElement.style.removeProperty("--inset-l");
  document.documentElement.style.removeProperty("--inset-r");
});

// ------------------------------------------------------------------ 61.1
for (const [name, at] of [
  ["ke-hoach", "/ke-hoach"],
  ["nhiem-vu", "/nhiem-vu?muc=viec"],
  ["ket-sat", "/ket-sat"],
  ["ket-noi", "/tin-nhan"],
] as const) {
  test(`61.1 · máy tính · ${name}: một nút +, không ▾, chuột phải mở menu ngay dưới nút`, async () => {
    await viewport(1280, 800);
    await render(<Hubs at={at} />);
    await settle(1200);
    const plus = document.querySelector("[data-plus-button]") as HTMLElement | null;
    expect(plus).not.toBeNull();
    const button = plus as HTMLElement;
    expect(document.querySelector('[aria-label="Chọn loại mới"]')).toBeNull();
    const rect = button.getBoundingClientRect();
    expect(Math.round(rect.width)).toBe(44);
    expect(Math.round(rect.height)).toBe(44);
    rightClick(button);
    await settle(400);
    const menu = document.querySelector("[data-plus-menu]") as HTMLElement | null;
    // Két sắt: each sub-tab has one kind to add, so its + has no menu yet (decision kept from 58–60).
    if (name === "ket-sat") expect(menu).toBeNull();
    else {
      expect(menu).not.toBeNull();
      const m = (menu as HTMLElement).getBoundingClientRect();
      expect(m.top).toBeGreaterThanOrEqual(rect.bottom);
      expect(m.top - rect.bottom).toBeLessThan(20);
      expect(Math.abs(m.right - rect.right)).toBeLessThan(16);
    }
    expect(window.getSelection()?.toString() ?? "").toBe("");
    await page.screenshot({ path: `${OUT}/61-1-cong-${name}-1280.png` });
  });
}

test("61.1 · rê chuột lên +: chú thích Bấm · Giữ", async () => {
  await viewport(1280, 800);
  await render(<Hubs at="/ke-hoach" />);
  await settle(1200);
  const button = document.querySelector("[data-plus-button]") as HTMLElement;
  await userEvent.hover(button);
  await settle(800);
  const caption = document.querySelector("[data-plus-caption]") as HTMLElement | null;
  expect(caption?.textContent).toBe("Bấm: Hạng mục mới · Giữ: thêm lựa chọn");
  await page.screenshot({ path: `${OUT}/61-1-chu-thich-cong-1280.png` });
});

// ------------------------------------------------------------------ 61.2 / 61.3
const folder = (id: string, name: string, color: NoteFolder["color"], parentId: string | null = null): NoteFolder => ({
  id, parentId, name, isSystem: false, systemKey: null, position: 0, createdAt: now, color,
});
const FOLDERS: NoteFolder[] = [
  folder("f1", "Bài giảng Chúa nhật", "cam"),
  folder("f2", "Họp dự án", "suong"),
  folder("f3", "Học tiếng Anh", "reu"),
  folder("f4", "Sức khoẻ gia đình", "man"),
  { ...folder("f9", "Ghi chép đọc sách", null), isSystem: true, systemKey: "reading", position: 99 },
];
const note = (id: string, folderId: string, title: string): Note => ({
  id, folderId, title, blocks: [], tags: [], pinnedAt: null, bookRecordId: null, bookTitle: null, deletedAt: null, createdAt: now, updatedAt: hoursAgo(3),
});
function fakeNotes(): NotesData {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, isPending: false };
  const notes = [note("n1", "f1", "Bài giảng tuần 39"), note("n2", "f2", "Họp sửa mái — chốt ngân sách"), note("n3", "f3", "50 từ vựng tuần 3")];
  return {
    userId: "me", folders: q(FOLDERS), notes: q(notes), liveNotes: notes, trashedNotes: [], attachments: q([]), urlOf: () => null,
    refresh: () => undefined, addFolder: m, move: m, rename: m, recolor: m, removeFolder: m, patch: m, removeAttachment: m,
  } as unknown as NotesData;
}
function Diary() {
  return (
    <Frame>
      <aside className="h-[100dvh] w-[360px] overflow-y-auto border-r border-border bg-card pt-4">
        <DiaryList
          journalId="j1"
          active="notes"
          counts={{ journal: 12, notes: 3, files: 2, links: 1, sources: 0 }}
          isWide
          onPaste={() => undefined}
          isPasting={false}
          notesTree={<NotesTree data={fakeNotes()} activeNoteId={null} showTrash={false} onOpenNote={() => undefined} onNewNote={() => undefined} onOpenTrash={() => undefined} />}
        />
      </aside>
    </Frame>
  );
}

test("61.3 · màu bìa: mỗi thư mục một màu, chọn trong ⋯ › Màu bìa", async () => {
  await viewport(1280, 800);
  window.localStorage.setItem("avora.notes.openFolders", JSON.stringify(["f1"]));
  const screen = await render(<Diary />);
  await expect.element(screen.getByText("Họp dự án")).toBeInTheDocument();
  const colors = [...document.querySelectorAll("[data-folder-color]")].map((element) => element.getAttribute("data-folder-color"));
  expect(new Set(colors).size).toBe(4);
  await page.screenshot({ path: `${OUT}/61-3-mau-bia-thu-muc-1280.png` });
  await userEvent.click(screen.getByRole("button", { name: "Thao tác thư mục Họp dự án" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Màu bìa/ }));
  await expect.element(screen.getByRole("radiogroup", { name: "Màu bìa của Họp dự án" })).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-3-chon-mau-bia-1280.png` });
});

test("61.2 · thu gọn Ghi chép → tải lại: vẫn thu gọn", async () => {
  await viewport(1280, 800);
  const first = await render(<Diary />);
  await userEvent.click(first.getByRole("button", { name: "Thu gọn cây Ghi chép" }));
  expect(document.querySelector('[aria-label="Cây ghi chép"]')).toBeNull();
  await first.unmount();
  const again = await render(<Diary />);
  await expect.element(again.getByRole("button", { name: "Mở rộng cây Ghi chép" })).toBeInTheDocument();
  expect(document.querySelector('[aria-label="Cây ghi chép"]')).toBeNull();
  await page.screenshot({ path: `${OUT}/61-2-ghi-chep-thu-gon-sau-tai-lai-1280.png` });
});

// ------------------------------------------------------------------ 61.4–61.7 + 62 (computer)
async function openBoard(width = 1280, height = 800, options: { changes?: boolean } = {}) {
  seed(options);
  await viewport(width, height);
  const screen = await render(<Hubs at="/ke-hoach?bang=b1" />);
  await expect.element(screen.getByRole("heading", { name: "Dự án chiếu sáng" })).toBeInTheDocument();
  await settle(900);
  return screen;
}

test("61.4 · ⋯ cạnh tên Bảng (bảng chung): Đề nghị xoá ở đây, không ở khu Hạng mục", async () => {
  const screen = await openBoard();
  expect(document.querySelector('[aria-label="Thêm thao tác với Bảng"]')).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với Bảng Dự án chiếu sáng" }));
  for (const label of ["Đổi tên", "Sửa mục tiêu", "Lịch sử thay đổi", "Báo thay đổi", "Đề nghị xoá"]) {
    await expect.element(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
  }
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-4-menu-bang-chung-1280.png` });
});

test("61.4 · Bảng của tôi → Xoá Bảng: xác nhận 2 lần (đếm, rồi gõ lại tên)", async () => {
  seed();
  db.tables.think_hub_table = [tableRow({ conversation_id: null, name: "Việc nhà" })];
  db.tables.think_hub_change_log = [];
  await viewport(1280, 800);
  const screen = await render(<Hubs at="/ke-hoach?bang=b1" />);
  await expect.element(screen.getByRole("heading", { name: "Việc nhà" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với Bảng Việc nhà" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Xoá Bảng" }));
  await expect.element(screen.getByText(/6 Hạng mục · 1 bảng con · 2 nhiệm vụ sẽ vào Thùng rác/)).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-4-xoa-bang-buoc-1-1280.png` });
  await userEvent.click(screen.getByRole("button", { name: "Vẫn xoá…" }));
  const confirm = screen.getByRole("button", { name: "Xoá Bảng" });
  await expect.element(confirm).toBeDisabled();
  await userEvent.fill(screen.getByRole("textbox", { name: "Gõ lại tên Bảng" }), "Việc nhà");
  await expect.element(confirm).toBeEnabled();
  await page.screenshot({ path: `${OUT}/61-4-xoa-bang-buoc-2-1280.png` });
});

test("61.5 / 61.6b · 4 loại cột mới trong lưới; ô Có / Không đã tích nền xanh", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  for (const label of ["Hồ sơ", "Khách", "Đã ký", "Hợp đồng"]) {
    await expect.element(screen.getByRole("columnheader", { name: new RegExp(label) })).toBeInTheDocument();
  }
  await expect.element(screen.getByRole("link", { name: /hoiana\.vn\/ho-so/ })).toHaveAttribute("target", "_blank");
  await expect.element(screen.getByRole("button", { name: "Lan Nguyễn" }).first()).toBeInTheDocument();
  const ticked = document.querySelector('[data-checkbox-cell="on"]')?.closest("td") as HTMLElement;
  const unticked = document.querySelector('[data-checkbox-cell="off"]')?.closest("td") as HTMLElement;
  expect(getComputedStyle(ticked).backgroundColor).not.toBe(getComputedStyle(unticked).backgroundColor);
  const grid = document.querySelector("table")?.parentElement as HTMLElement;
  grid.scrollLeft = grid.scrollWidth;
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-5-loai-cot-moi-1280.png` });
});

test("61.5 · sắp xếp cột Đã ký: Có trước", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với cột Đã ký" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Sắp xếp" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Có trước" }));
  await settle(300);
  const firstTwo = [...document.querySelectorAll("tbody tr[data-record-id]")].slice(0, 2).map((row) => row.getAttribute("data-record-id"));
  expect(firstTwo.sort()).toEqual(["r1", "r3"]);
  await page.screenshot({ path: `${OUT}/61-5-sap-xep-co-truoc-1280.png` });
});

test("61.6 · ⋯ đầu cột: mọi thao tác một chỗ; cột hệ thống mờ kèm lý do; Xoá cột ghi rõ N Hạng mục", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với cột Giá trị" }));
  for (const label of ["Đổi tên", "Đổi loại", "Sắp xếp", "Lọc", "Ẩn cột", "Độ rộng", "Xoá cột"]) {
    await expect.element(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
  }
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-6-menu-dau-cot-1280.png` });
  await userEvent.click(screen.getByRole("menuitem", { name: /Xoá cột/ }));
  await expect.element(screen.getByText(/3 Hạng mục đang có dữ liệu ở cột này/)).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-6-xac-nhan-xoa-cot-1280.png` });
  await userEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với cột Trạng thái" }));
  await expect.element(screen.getByText("Cột hệ thống không xoá được.")).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-6-cot-he-thong-1280.png` });
});

test("61.7 · Sửa Hạng mục: biểu tượng loại + chữ gợi ý; gõ chữ vào ô Số bị báo, chữ còn nguyên", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  await userEvent.click(screen.getByText("Showroom Đà Nẵng"));
  const number = screen.getByRole("textbox", { name: "Giá trị" });
  await expect.element(number).toHaveAttribute("placeholder", "Nhập số, vd. 1.000.000");
  await expect.element(screen.getByRole("textbox", { name: "Hồ sơ" })).toHaveAttribute("placeholder", "Dán link https://…");
  await expect.element(screen.getByRole("combobox", { name: "Khách" })).toBeInTheDocument();
  expect(document.querySelectorAll('[role="dialog"] [data-column-type]').length).toBeGreaterThanOrEqual(6);
  await userEvent.fill(number, "khoảng 2 tỷ");
  await expect.element(screen.getByText('Cột "Giá trị" chỉ nhận số, vd. 1.000.000.')).toBeInTheDocument();
  await expect.element(number).toHaveValue("khoảng 2 tỷ");
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-7-sua-hang-muc-goi-y-1280.png` });
});

test("61.10 · ▸ 1 → bảng con xổ ngay dưới Hạng mục, thêm được Hạng mục con; ▾ thu lại", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  const toggle = screen.getByRole("button", { name: /Mở bảng con của "Dự án Hoiana/ });
  await userEvent.click(toggle);
  await expect.element(screen.getByText("Khu A — sảnh chính")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Hạng mục con" })).toBeInTheDocument();
  const parent = document.querySelector('tr[data-record-id="r1"]') as HTMLElement;
  const sub = document.querySelector('[data-subtable-of="r1"]') as HTMLElement;
  expect(sub.getBoundingClientRect().top).toBeGreaterThanOrEqual(parent.getBoundingClientRect().bottom - 1);
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-10-bang-con-mo-tai-cho-1280.png` });
  await userEvent.click(screen.getByText("Khu A — sảnh chính"));
  await expect.element(screen.getByRole("dialog")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Tiêu đề", { exact: true })).toHaveValue("Khu A — sảnh chính");
  await userEvent.keyboard("{Escape}");
  await settle(400);
  await userEvent.click(screen.getByRole("button", { name: /Thu bảng con của "Dự án Hoiana/ }));
  expect(document.querySelector('[data-subtable-of="r1"]')).toBeNull();
});

test("62.1 / 62.6 · A có 5 thay đổi chưa báo: Báo nhóm · 5; thay đổi của Lan: chấm cam + dòng N thay đổi", async () => {
  const screen = await openBoard();
  await expect.element(screen.getByRole("button", { name: /Báo nhóm · 5/ })).toBeInTheDocument();
  await expect.element(screen.getByText(/thay đổi từ lần bạn xem trước/)).toBeInTheDocument();
  expect(document.querySelectorAll("[data-change-dot]").length).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `${OUT}/62-1-bao-nhom-va-cham-cam-1280.png` });
});

test("62.2 · bấm Báo nhóm: tóm tắt tự viết, Báo riêng cho Lan đã chọn sẵn", async () => {
  const screen = await openBoard();
  await userEvent.click(screen.getByRole("button", { name: /Báo nhóm · 5/ }));
  await expect.element(screen.getByText("Sửa 5 ô")).toBeInTheDocument();
  await expect.element(screen.getByRole("checkbox", { name: "Lan Nguyễn" })).toBeChecked();
  await expect.element(screen.getByRole("button", { name: "Gửi vào Dự án chiếu sáng" })).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/62-2-xem-truoc-bao-nhom-1280.png` });
});

test("62.4 · Xem thay đổi: ô đổi viền cam, Hạng mục mới nền cam nhạt, Hạng mục xoá hiện mờ", async () => {
  const screen = await openBoard();
  await userEvent.click(screen.getByText(/thay đổi từ lần bạn xem trước/));
  await expect.element(screen.getByRole("button", { name: "Đã xem hết" })).toBeInTheDocument();
  expect(document.querySelectorAll(".change-cell").length).toBeGreaterThanOrEqual(2);
  expect(document.querySelector('tr[data-record-id="r6"]')?.classList.contains("change-new")).toBe(true);
  await expect.element(screen.getByText("Nhà máy Bình Dương")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Khôi phục" })).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/62-4-danh-dau-thay-doi-1280.png` });
});

test("62.E · ⋯ › Lịch sử thay đổi: theo ngày, theo người, trước → sau", async () => {
  const screen = await openBoard();
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với Bảng Dự án chiếu sáng" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Lịch sử thay đổi" }));
  await expect.element(screen.getByRole("heading", { name: /Lịch sử thay đổi/ })).toBeInTheDocument();
  await expect.element(screen.getByText(/Xoá "Nhà máy Bình Dương"/)).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/62-E-lich-su-thay-doi-1280.png` });
});

test("62.F · ⋯ › Báo thay đổi (chủ bảng)", async () => {
  const screen = await openBoard();
  await userEvent.click(screen.getByRole("button", { name: "Thao tác với Bảng Dự án chiếu sáng" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Báo thay đổi" }));
  await expect.element(screen.getByText("Tóm tắt tự động cuối ngày")).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/62-F-cai-dat-bao-thay-doi-1280.png` });
});

function LeaveHarness() {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  return (
    <Frame at="/ke-hoach?bang=b1">
      <button type="button" onClick={() => setIsOpen(false)} className="fixed bottom-2 left-2 z-[100] text-[10px]">
        rời bảng
      </button>
      {isOpen ? (
        <AppFrame>
          <ThinkHub />
        </AppFrame>
      ) : (
        <div className="h-[100dvh] bg-background" />
      )}
    </Frame>
  );
}

test("62.5 · rời bảng sau khi sửa việc của Lan: một dòng nhắc; chỉ sửa việc của mình: không nhắc", async () => {
  await viewport(1280, 800);
  const screen = await render(<LeaveHarness />);
  await expect.element(screen.getByRole("button", { name: /Báo nhóm · 5/ })).toBeInTheDocument();
  await settle(600);
  await userEvent.click(screen.getByRole("button", { name: "rời bảng" }));
  await expect.element(page.getByText("Bạn đã đổi việc của Lan Nguyễn")).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Báo ngay" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/62-5-nhac-khi-roi-bang-1280.png` });
  await screen.unmount();

  window.localStorage.clear();
  seed();
  db.tables.think_hub_change_log = CHANGES.filter((change) => change.id === "ch5");
  const mine = await render(<LeaveHarness />);
  await expect.element(mine.getByRole("button", { name: /Báo nhóm · 2/ })).toBeInTheDocument();
  await settle(600);
  await userEvent.click(mine.getByRole("button", { name: "rời bảng" }));
  await settle(600);
  expect(page.getByText(/Bạn đã đổi việc của|Bạn đã xoá trong Bảng/).elements()).toHaveLength(0);
});

test("62.2 / 62.5b · thẻ báo trong chat, và dòng nhỏ khi tạo Bảng chung", async () => {
  await viewport(390, 844);
  await render(
    <Frame>
      <div className="flex min-h-[100dvh] flex-col gap-4 bg-background px-3 py-6">
        <p className="mx-auto max-w-md px-4 text-center text-[12.5px] text-muted-foreground">Lan Nguyễn tạo Bảng "Dự án chiếu sáng" · <span className="font-semibold text-primary">Mở</span></p>
        <p className="w-fit rounded-bubble bg-secondary px-4 py-2.5 text-[14px]">Mai 7h họp nhé</p>
        <BoardUpdateCard content={'Thiện cập nhật Bảng "Dự án chiếu sáng" · Thêm 2 Hạng mục · Sửa 5 ô · Xoá 1 Hạng mục · @Lan Nguyễn xem giúp giá Hoiana'} onView={() => undefined} />
      </div>
    </Frame>,
  );
  await expect.element(page.getByRole("button", { name: "Xem thay đổi" })).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/62-2-the-bao-trong-chat-390.png` });
});

// ------------------------------------------------------------------ 61.9 phone, upright
test("61.9 · điện thoại: mặc định Thẻ, tối đa 3 cột, ⚙ Cột trên thẻ", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  // AVORA-65 · C: one row on a phone — `Thẻ · Bảng · Theo trạng thái · Cây`.
  await expect.element(screen.getByRole("group", { name: "Kiểu xem" }).getByRole("button", { name: "Thẻ", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector('[data-phone-board="cards"]')).not.toBeNull();
  await expect.element(screen.getByRole("button", { name: /Cột trên thẻ/ })).toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${OUT}/61-9-dien-thoai-the-390.png` });
});

test("61.9 · điện thoại, dạng Bảng: tiêu đề hàng riêng; trượt một hàng → mọi hàng + tên cột trượt theo; tiêu đề dính đúng", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  await userEvent.click(screen.getByRole("group", { name: "Kiểu xem" }).getByRole("button", { name: "Bảng", exact: true }));
  await settle(400);
  const board = document.querySelector('[data-phone-board="table"]') as HTMLElement;
  expect(board).not.toBeNull();
  const title = board.querySelector("[data-record-title]") as HTMLElement;
  // The title LINE spans the screen; since 65 · H it also carries ★ and Tạo nhiệm vụ at its end.
  expect((title.parentElement as HTMLElement).getBoundingClientRect().width).toBeGreaterThan(340);
  expect(title.getBoundingClientRect().width).toBeGreaterThan(180);
  expect(title.getBoundingClientRect().height).toBeGreaterThan(30);
  await page.screenshot({ path: `${OUT}/61-9-bang-1-dau-390.png` });

  const titleLeftBefore = title.getBoundingClientRect().left;
  const rows = [...board.querySelectorAll('[data-sync-scroll="cells"]')] as HTMLElement[];
  const names = board.querySelector('[data-sync-scroll="names"]') as HTMLElement;
  rows[2].scrollLeft = 320;
  rows[2].dispatchEvent(new Event("scroll"));
  await settle(200);
  for (const row of [names, ...rows]) expect(Math.round(row.scrollLeft)).toBe(Math.round(rows[2].scrollLeft));
  // The title line never slides with the cells.
  expect(title.getBoundingClientRect().left).toBe(titleLeftBefore);
  expect(rows[2].scrollLeft).toBeGreaterThan(100);
  await page.screenshot({ path: `${OUT}/61-9-bang-2-truot-ngang-390.png` });

  const scroller = board.closest(".overflow-y-auto") as HTMLElement;
  scroller.scrollTop = 420;
  await settle(300);
  const head = board.querySelector(".sticky.top-0") as HTMLElement;
  const sections = [...board.querySelectorAll("section[data-record-id]")] as HTMLElement[];
  const stuck = sections
    .map((section) => section.querySelector("[data-record-title]")?.parentElement as HTMLElement)
    .find((element) => Math.abs(element.getBoundingClientRect().top - head.getBoundingClientRect().bottom) < 3);
  expect(stuck).toBeDefined();
  await page.screenshot({ path: `${OUT}/61-9-bang-3-truot-doc-tieu-de-dinh-390.png` });
});

test("61.10 · điện thoại: Bảng con · 1 ▸ mở danh sách thẻ con thụt vào", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  await userEvent.click(screen.getByRole("button", { name: /Mở bảng con của "Dự án Hoiana/ }).first());
  await expect.element(screen.getByText("Khu B — hồ bơi").first()).toBeInTheDocument();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await settle(300);
  await page.screenshot({ path: `${OUT}/61-10-bang-con-dien-thoai-390.png` });
});

// ------------------------------------------------------------------ 61.11
test("61.11 · Nhiệm vụ trên điện thoại: bong bóng chat nhỏ ở góc, không nút to, không Ctrl/⌘", async () => {
  seed();
  const base = {
    type: "1-1-shared", creator_id: "lan", assignee_id: "me", context_snapshot: null, conversation_id: "c-lan", description: "",
    status: "confirmed", confirmed_at: now, done_at: null, completed_confirmed_at: null, skipped_at: null, skipped_silently: false,
    deadline_date: today, deadline_time: null, deadline_tz: "Asia/Ho_Chi_Minh", task_category_id: null, is_important: false, is_milestone: false,
    progress_percent: null, output_value: null, recurrence: "none", recurrence_pattern: null, recurrence_spawned_at: null, deleted_by_creator: false,
    deleted_by_peer: false, created_at: now, estimated_duration_minutes: null, requires_presence: false, start_at: null, end_at: null, location: null,
    latitude: null, longitude: null, travel_duration_minutes: null, departure_reminder_at: null, source_transaction_id: null,
  };
  db.tables.tasks = [
    { ...base, id: "t1", title: "Gửi báo giá mái tôn", description: "Báo giá cho nhà anh Hùng" },
    { ...base, id: "t2", creator_id: "me", assignee_id: "lan", title: "Chụp ảnh hiện trạng mái", status: "pending_confirmation" },
    { ...base, id: "t3", type: "personal", creator_id: "me", assignee_id: null, conversation_id: null, title: "Đặt lịch khám răng" },
  ];
  await viewport(390, 844);
  // AVORA-65 · B: the keys hint follows the device; the test browser has a mouse, so act as a phone.
  const restore = asTouchDevice();
  const screen = await render(<Hubs at="/nhiem-vu?muc=viec&xem=tat-ca" />);
  await expect.element(screen.getByText("Gửi báo giá mái tôn").first()).toBeInTheDocument();
  await settle(800);
  expect(document.body.textContent ?? "").not.toContain("Ctrl/⌘");
  expect([...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Xem trong ngữ cảnh")).toHaveLength(0);
  const icon = document.querySelector('[data-task-context="chat"]') as HTMLElement | null;
  expect(icon?.getAttribute("aria-label")).toMatch(/trong cuộc trò chuyện/);
  await page.screenshot({ path: `${OUT}/61-11-nhiem-vu-gon-390.png` });
  restore();
});

// ------------------------------------------------------------------ 61.12 phone on its side, both ways
for (const side of ["left", "right"] as const) {
  test(`61.12 · nằm ngang, tai thỏ bên ${side === "left" ? "trái" : "phải"}: thanh 56px, bên không tai thỏ chỉ lề 16px`, async () => {
    await viewport(844, 390);
    // What NotchSync sets on an iPhone reporting 47px on both sides, notch on one.
    document.documentElement.setAttribute("data-notch", side);
    document.documentElement.style.setProperty("--inset-l", side === "left" ? "47px" : "0px");
    document.documentElement.style.setProperty("--inset-r", side === "right" ? "47px" : "0px");
    await render(<Hubs at="/nhiem-vu?muc=viec" />);
    await settle(1200);
    const rail = (document.querySelector("[data-landscape-rail]") as HTMLElement).getBoundingClientRect();
    expect(Math.round(rail.left)).toBe(0);
    expect(Math.round(rail.width)).toBe(side === "left" ? 56 + 47 : 56);
    const title = (document.querySelector("main h1") as HTMLElement).getBoundingClientRect();
    expect(Math.round(title.left - rail.right)).toBe(16);
    // The right edge keeps the notch inset only when the notch is there.
    const main = document.querySelector("main") as HTMLElement;
    expect(getComputedStyle(main).paddingRight).toBe(side === "right" ? "47px" : "0px");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(844);
    await page.screenshot({ path: `${OUT}/61-12-nam-ngang-tai-tho-${side === "left" ? "trai" : "phai"}-844.png` });
  });
}

// ------------------------------------------------------------------ 63
const NAME_CONTACTS = [
  ["k1", "NguyÃªn VÄƒn A", null, null],
  ["k2", "Trung Trýòc Lê", null, null],
  ["k3", "Võ Th? H?ng Ân", null, null],
  ["k4", "nguyễn văn bình", null, null],
  ["k5", "TRẦN THỊ HÀ", null, null],
  ["k6", "iPhone Shop Quận 3", null, null],
  ["k7", "Nguyênx Thiện", null, null],
  ["k8", "Hung", null, "lan"],
  ["k9", "Hung", "+84909", null],
  ["k10", "Tran Binh", "+84911", null],
  ["k11", "Trần Bình", "+84911", null],
].map(([id, name, phone, linked]) => ({
  id, owner_user_id: "me", contact_type: "individual", name, phone, email: null, linked_user_id: linked, needs_details: false, created_at: now, updated_at: now,
}));

for (const [width, height, label] of [[390, 844, "390"], [1280, 800, "1280"]] as const) {
  test(`63 · Sửa tên hàng loạt · ${label}: 4 nhóm, cũ → đề xuất, Áp dụng (N)`, async () => {
    seed();
    db.tables.contact = NAME_CONTACTS;
    db.rpcs.list_my_connections = [{ user_id: "lan", display_name: "Phạm Văn Hùng", pin: "A-LAN12345", created_at: now }];
    await viewport(width, height);
    const screen = await render(
      <Frame at="/lien-he/sua-ten">
        <Routes>
          <Route path="/lien-he/sua-ten" element={<ContactNameRepair />} />
        </Routes>
      </Frame>,
    );
    await expect.element(screen.getByRole("heading", { name: /Chữ bị vỡ/ })).toBeInTheDocument();
    for (const group of ["broken", "case", "typo", "accents"]) expect(document.querySelector(`[data-name-group="${group}"]`)).not.toBeNull();
    await expect.element(screen.getByRole("textbox", { name: 'Tên mới cho "NguyÃªn VÄƒn A"' })).toHaveValue("Nguyên Văn A");
    await expect.element(screen.getByRole("textbox", { name: 'Tên mới cho "Trung Trýòc Lê"' })).toHaveValue("Trung Trực Lê");
    await expect.element(screen.getByText("Không khôi phục được, sửa tay")).toBeInTheDocument();
    await expect.element(screen.getByRole("textbox", { name: 'Tên mới cho "nguyễn văn bình"' })).toHaveValue("Nguyễn Văn Bình");
    expect(screen.getByText("iPhone Shop Quận 3").elements()).toHaveLength(0);
    await expect.element(screen.getByRole("checkbox", { name: 'Sửa "Nguyênx Thiện"' })).not.toBeChecked();
    await expect.element(screen.getByText("· tên trên AVORA")).toBeInTheDocument();
    await expect.element(screen.getByText("· cùng số ở liên hệ khác")).toBeInTheDocument();
    // Ticked: 2 repaired + 2 case.
    await expect.element(screen.getByRole("button", { name: "Áp dụng (4)" })).toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await settle(300);
    await page.screenshot({ path: `${OUT}/63-sua-ten-${label}.png`});
  });
}

// ================================================================== AVORA-65 / 70 / 71 / 69
const OUT2 = OUT;

// ------------------------------------------------------------------ 65 · B
test("65.2 · điện thoại nằm ngang ở Nhiệm vụ: không còn chữ Ctrl/⌘", async () => {
  await viewport(844, 390);
  const restore = asTouchDevice();
  const screen = await render(<Hubs at="/nhiem-vu?muc=viec&xem=tat-ca" />);
  await settle(1000);
  expect(document.body.textContent ?? "").not.toContain("Ctrl/⌘");
  await expect.element(screen.getByText(/Kéo để đổi thứ tự/).first()).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/65-2-nhiem-vu-nam-ngang-844.png` });
  restore();
});

// ------------------------------------------------------------------ 65 · C
test("65.3 · Kế hoạch trên điện thoại: một hàng Thẻ · Bảng · Theo trạng thái · Cây; chữ không bị cắt nửa", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  const row = screen.getByRole("group", { name: "Kiểu xem" });
  const labels = [...(row.element() as HTMLElement).querySelectorAll("button")].map((button) => button.textContent?.trim());
  expect(labels).toEqual(["Thẻ", "Bảng", "Theo trạng thái", "Cây"]);
  expect(document.querySelector('[aria-label="Cách xem trên điện thoại"]')).toBeNull();
  await page.screenshot({ path: `${OUT2}/65-3-mot-hang-cach-xem-390.png` });
  await userEvent.click(row.getByRole("button", { name: "Bảng", exact: true }));
  await settle(400);
  const cells = document.querySelector('[data-sync-scroll="cells"]') as HTMLElement;
  expect(getComputedStyle(cells).maskImage || getComputedStyle(cells).webkitMaskImage).toContain("gradient");
  await page.screenshot({ path: `${OUT2}/65-3-bang-mep-mo-390.png` });
});

test("65.3b · máy tính giữ ba cách xem (không có Thẻ)", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  const labels = [...(screen.getByRole("group", { name: "Kiểu xem" }).element() as HTMLElement).querySelectorAll("button")].map((button) => button.textContent?.trim());
  expect(labels).toEqual(["Bảng", "Theo trạng thái", "Cây"]);
});

// ------------------------------------------------------------------ 65 · F
for (const [width, height, label] of [[1280, 800, "1280x800"], [1280, 720, "1280x720"], [1280, 600, "1280x600"], [390, 844, "390"]] as const) {
  test(`65F · Hạng mục mới → Ngày cần làm tiếp · ${label}: đủ lịch tháng, thân lịch > 200px`, async () => {
    const screen = await openBoard(width, height, { changes: false });
    const addButtons = screen.getByRole("button", { name: /Hạng mục$/ });
    await userEvent.click(addButtons.first());
    await userEvent.click(screen.getByRole("button", { name: /Ngày cần làm tiếp/ }));
    await settle(500);
    const panel = [...document.querySelectorAll('[role="dialog"]')].find((node) => node.querySelector("[data-day]") !== null) as HTMLElement | undefined;
    expect(panel).toBeDefined();
    const body = (panel as HTMLElement).querySelector(".overflow-y-auto") as HTMLElement;
    expect(body.getBoundingClientRect().height).toBeGreaterThan(200);
    expect((panel as HTMLElement).querySelectorAll("[data-day]").length).toBeGreaterThanOrEqual(28);
    const rect = (panel as HTMLElement).getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(height);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${OUT2}/65F-lich-ngay-can-lam-tiep-${label}.png` });
  });
}

// ------------------------------------------------------------------ 65 · G
for (const [width, height, label] of [[1280, 800, "1280"], [390, 844, "390"]] as const) {
  test(`65G · gợi ý Giữ nút + hiện đúng một lần, ghi đã đọc ngay, không đè ô nào · ${label}`, async () => {
    seed();
    db.tables.dismissed_guidance = [{ guidance_key: "task_plus_hold" }];
    await viewport(width, height);
    await render(<Hubs at="/ke-hoach" />);
    await settle(1200);
    const hint = document.querySelector('[data-plus-hint="plan_plus_hold"]') as HTMLElement | null;
    expect(hint).not.toBeNull();
    expect(getComputedStyle(hint as HTMLElement).pointerEvents).toBe("none");
    expect(hint?.textContent).not.toContain("Đã hiểu");
    await page.screenshot({ path: `${OUT2}/65G-goi-y-giu-cong-${label}.png` });
    await settle(6300);
    expect(document.querySelector("[data-plus-hint]")).toBeNull();
  });
}

// ------------------------------------------------------------------ 65 · H
test("65H · bảng con mở tại chỗ = cùng lưới: cột Tiêu đề, bộ cột riêng, Tạo nhiệm vụ, ★ (1280)", async () => {
  const screen = await openBoard(1280, 800, { changes: false });
  await userEvent.click(screen.getByRole("button", { name: /Mở bảng con của "Dự án Hoiana/ }).first());
  await settle(500);
  const sub = document.querySelector('[data-subtable="b1-sub"]') as HTMLElement;
  expect(sub).not.toBeNull();
  const heads = [...sub.querySelectorAll("th")].map((th) => th.textContent ?? "");
  expect(heads.some((text) => text.includes("Tiêu đề"))).toBe(true);
  expect(heads.some((text) => text.includes("Số lượng"))).toBe(true);
  expect(heads.some((text) => text.includes("Khu vực"))).toBe(false);
  // 65H.5: every row action of level 1 is on level 2 too.
  const actions = (scope: Element | Document, id: string): string[] =>
    [...(scope.querySelector(`[data-record-id="${id}"]`) as HTMLElement).querySelectorAll("[data-quick-task], [data-record-star], [data-subtable-toggle]")]
      .map((node) => (node.hasAttribute("data-quick-task") ? "task" : node.hasAttribute("data-record-star") ? "star" : "sub"));
  expect(actions(sub, "s1")).toEqual(expect.arrayContaining(["star", "task"]));
  expect(actions(document, "r2")).toEqual(expect.arrayContaining(["star", "task"]));
  // 65H.4: no header is cut mid-word.
  for (const th of document.querySelectorAll('[data-board-grid="1"] th')) {
    const label = th.querySelector("span.truncate, span") as HTMLElement | null;
    if (label !== null) expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
  }
  await page.screenshot({ path: `${OUT2}/65H-bang-con-cung-luoi-1280.png` });
});

test("65H · điện thoại: bảng con mở tại chỗ có ★ và Tạo nhiệm vụ trên thẻ con (390)", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  await userEvent.click(screen.getByRole("button", { name: /Mở bảng con của "Dự án Hoiana/ }).first());
  await settle(400);
  const sub = document.querySelector('[data-subtable="b1-sub"]') as HTMLElement;
  expect(sub.querySelector("[data-quick-task]")).not.toBeNull();
  expect(sub.querySelector("[data-record-star]")).not.toBeNull();
  await page.screenshot({ path: `${OUT2}/65H-bang-con-dien-thoai-390.png` });
});

// ------------------------------------------------------------------ 65 · E
test("65.5 · Bảng chung: ô Liên hệ của người khác hiện tên + của ai, không số", async () => {
  seed();
  db.tables.think_hub_record = RECORDS.map((row) =>
    row.id === "r4" ? { ...row, extension_fields: { ...(row.extension_fields as object), c_kh: "k-not-mine" }, contact_labels: { c_kh: { name: "Anh Hùng", by: "lan", by_name: "Lan" } } } : row,
  );
  await viewport(1280, 800);
  const screen = await render(<Hubs at="/ke-hoach?bang=b1" />);
  await expect.element(screen.getByText("Anh Hùng · của Lan").first()).toBeInTheDocument();
  expect(document.body.textContent ?? "").not.toContain("0909");
  await page.screenshot({ path: `${OUT2}/65-5-o-lien-he-bang-chung-1280.png` });
});

// ------------------------------------------------------------------ 70 · Nhật ký dạng dòng
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
function journalMessage(id: string, content: string, at: string, part: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, conversation_id: "j1", sender_id: "me", content, created_at: at, edited_at: null, deleted_at: null, reply_to_message_id: null,
    mentioned_user_ids: [], origin_group_id: null, attachment_count: 0, origin_content_id: null, origin_sender_id: null, system_kind: null,
    forward_bundle: null, is_urgent: false, ...part,
  };
}
function seedJournal(extraDayLines = 0): void {
  seed();
  const day = (offset: number, hour: number, minute = 0): string => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  db.tables.messages = [
    journalMessage("e1", "Tệp hồ sơ hoàn công đã gửi bên A", day(2, 21, 30), { attachment_count: 1 }),
    journalMessage("e2", "Nhắc mình: hỏi giá đèn Anam trước thứ Sáu", day(2, 9, 10)),
    journalMessage("e3", "Tin chuyển tiếp từ Lan: lịch khảo sát Cam Ranh tuần sau", day(1, 11, 7), { origin_content_id: "x", origin_sender_id: "lan" }),
    journalMessage("e4", "Báo giá đèn Anam https://anam.vn/bao-gia", day(1, 14, 5)),
    journalMessage("e5", "Lời bình: yêu thương là kiên nhẫn, là tử tế, không ghen tương, không khoe khoang.\nDòng hai của lời bình.\nDòng ba.", day(1, 17, 23)),
    ...Array.from({ length: extraDayLines }, (_value, index) => journalMessage(`d${index}`, `Ghi nhanh số ${index + 1} trong ngày`, day(0, 7 + Math.floor(index / 3), (index % 3) * 15))),
    journalMessage("e6", "Viết cho mình: hôm nay xong phần móng", minutesAgo(5)),
  ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  db.tables.message_attachments = [
    { id: "a1", message_id: "e1", conversation_id: "j1", attached_by: "me", kind: "file", storage_path: "j1/hoan-cong.pdf", file_name: "hồ sơ hoàn công.pdf", mime_type: "application/pdf", byte_size: 1_250_000, width: null, height: null, duration_seconds: null, permission: "export", origin_message_id: null, created_at: day(2, 21, 30) },
  ];
  db.rpcs.list_my_conversations = [
    { conversation_id: "j1", conversation_type: "personal", group_name: null, member_count: 1, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "Viết cho mình", last_message_at: now, last_message_sender_id: "me", unread_count: 0, sort_at: now, is_connected: null, peer_pin: null, verification_status: null },
    ...(db.rpcs.list_my_conversations as unknown[]),
  ];
}
/** Opens Nhật ký — every entry shows since AVORA-70 dropped the `Hiện tất cả` switch. */
async function openJournal(width: number, height: number, at = "/tin-nhan/j1?xem=nhat-ky") {
  await viewport(width, height);
  const screen = await render(<JournalHubs at={at} />);
  await expect.element(screen.getByText("Viết cho mình: hôm nay xong phần móng").first()).toBeInTheDocument();
  expect(document.querySelector('[role="switch"][aria-label="Hiện tất cả"]')).toBeNull();
  await settle(400);
  return screen;
}

function JournalHubs({ at }: { at: string }) {
  return (
    <Frame at={at}>
      <AppFrame>
        <Routes>
          <Route path="/tin-nhan" element={<Messages />} />
          <Route path="/tin-nhan/:conversationId" element={<Messages />} />
        </Routes>
      </AppFrame>
    </Frame>
  );
}

for (const [width, height, label] of [[1280, 800, "1280"], [390, 844, "390"]] as const) {
  test(`70.1 · Nhật ký của tôi: mỗi mục một dòng cao bằng nhau, gom ngày, mới ở dưới · ${label}`, async () => {
    seedJournal();
    await openJournal(width, height);
    const rows = [...document.querySelectorAll("[data-line] > div")] as HTMLElement[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const heights = new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    expect(heights.size).toBe(1);
    const days = [...document.querySelectorAll("[data-day-row]")] as HTMLElement[];
    expect(days.length).toBe(3);
    expect(days[0].getBoundingClientRect().height).toBeLessThan(rows[0].getBoundingClientRect().height);
    // Edge to edge: a line spans the whole thread column.
    const list = document.querySelector("[data-day-lines]") as HTMLElement;
    expect(Math.round(rows[0].getBoundingClientRect().width)).toBe(Math.round(list.getBoundingClientRect().width));
    // Oldest first, newest last (right above the composer).
    const ids = [...document.querySelectorAll("[data-line]")].map((node) => node.getAttribute("data-line"));
    expect(ids[ids.length - 1]).toBe("e6");
    expect(document.querySelector(".rounded-bubble")).toBeNull();
    await page.screenshot({ path: `${OUT2}/70-1-nhat-ky-dang-dong-${label}.png` });
  });
}

test("70.1b · cuộn qua một ngày 20 mục: hàng ngày dính trên cùng rồi nhường ngày kế (390)", async () => {
  seedJournal(20);
  await openJournal(390, 844);
  const scroller = (document.querySelector("[data-day-lines]") as HTMLElement).closest(".overflow-y-auto") as HTMLElement;
  const top = scroller.getBoundingClientRect().top;
  const sections = [...document.querySelectorAll("section[data-day]")] as HTMLElement[];
  const todaySection = sections[sections.length - 1];
  const yesterday = sections[sections.length - 2];
  // Halfway through today's 20 lines: today's row stands at the top.
  scroller.scrollTop += todaySection.getBoundingClientRect().top - top + 500;
  await settle(300);
  const stuck = todaySection.querySelector("[data-day-row]") as HTMLElement;
  expect(Math.abs(stuck.getBoundingClientRect().top - top)).toBeLessThan(3);
  await page.screenshot({ path: `${OUT2}/70-1b-ngay-dinh-1-390.png` });
  // Back into yesterday: yesterday's row holds the top until its last line passes.
  scroller.scrollTop += yesterday.getBoundingClientRect().top - top + 60;
  await settle(300);
  const held = yesterday.querySelector("[data-day-row]") as HTMLElement;
  expect(Math.abs(held.getBoundingClientRect().top - top)).toBeLessThan(3);
  await page.screenshot({ path: `${OUT2}/70-1b-ngay-dinh-2-390.png` });
});

test("70.2 · thu một ngày rồi tải lại: vẫn thu", async () => {
  seedJournal();
  const first = await openJournal(1280, 800);
  await expect.element(first.getByText("Báo giá đèn Anam https://anam.vn/bao-gia").first()).toBeInTheDocument();
  const dayButton = (document.querySelectorAll("[data-day-row] button[aria-expanded]")[1]) as HTMLElement;
  dayButton.click();
  await settle(200);
  expect(document.querySelector('[data-line="e4"]')).toBeNull();
  await first.unmount();
  await openJournal(1280, 800);
  expect(document.querySelector('[data-line="e4"]')).toBeNull();
  expect(document.querySelector('[data-line="e6"]')).not.toBeNull();
});

test("70.3 · điện thoại: bấm dòng dài → sổ xuống có ⤢ Xem toàn màn → toàn màn, ‹ về đúng dòng", async () => {
  seedJournal();
  const screen = await openJournal(390, 844);
  await userEvent.click(screen.getByText(/Lời bình: yêu thương là kiên nhẫn/).first());
  await settle(300);
  expect(document.querySelector('[data-line-detail="e5"]')).not.toBeNull();
  const detail = document.querySelector('[data-line-detail="e5"]') as HTMLElement;
  for (const label of ["Tạo nhiệm vụ", "Chuyển tiếp", "Ghim", "Sao chép", "Sửa", "Xoá"]) expect(detail.textContent).toContain(label);
  await page.screenshot({ path: `${OUT2}/70-3-so-xuong-390.png` });
  // The PDF entry is "long" by nature.
  await userEvent.click(screen.getByText("Tệp hồ sơ hoàn công đã gửi bên A").first());
  await userEvent.click(screen.getByRole("button", { name: /Xem toàn màn/ }));
  await settle(300);
  await expect.element(screen.getByRole("dialog", { name: "Tệp hồ sơ hoàn công đã gửi bên A" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/70-3-toan-man-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Quay lại", exact: true }));
  await settle(200);
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
});

test("70.7 · Chọn → tích 1 ngày + 2 dòng → Dọn dẹp (N)", async () => {
  seedJournal();
  db.rpcs.delete_journal_messages = 5;
  const screen = await openJournal(390, 844);
  await userEvent.click(screen.getByRole("button", { name: "Chọn", exact: true }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Chọn cả ngày/ }).nth(1));
  await userEvent.click(screen.getByRole("checkbox", { name: "Chọn: Nhắc mình: hỏi giá đèn Anam trước thứ Sáu" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Chọn: Viết cho mình: hôm nay xong phần móng" }));
  await expect.element(screen.getByRole("button", { name: "Dọn dẹp (5)" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/70-7-chon-don-dep-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Dọn dẹp (5)" }));
  await expect.element(screen.getByText("Đã dọn 5 mục")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Hoàn tác" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/70-7-da-don-hoan-tac-390.png` });
});

for (const [view, label] of [["file", "file"], ["lien-ket", "lien-ket"], ["nguon", "nguon"]] as const) {
  test(`70.5 · ${label}: cùng khung dòng, gom ngày (390)`, async () => {
    seedJournal();
    db.tables.tasks = [];
    await viewport(390, 844);
    await render(<JournalHubs at={`/tin-nhan/j1?xem=${view}`} />);
    await settle(1200);
    if (view !== "nguon") {
      expect(document.querySelectorAll("[data-day-row]").length).toBeGreaterThanOrEqual(1);
      expect(document.querySelectorAll("[data-line]").length).toBeGreaterThanOrEqual(1);
    }
    await page.screenshot({ path: `${OUT2}/70-5-${label}-390.png` });
  });
}

test("70.6 · chat 1-1 không đổi: vẫn bong bóng", async () => {
  seed();
  db.tables.messages = [journalMessage("m1", "Anh gửi giúp em báo giá nhé", minutesAgo(20), { conversation_id: "c-lan", sender_id: "lan" })];
  await viewport(390, 844);
  const screen = await render(<JournalHubs at="/tin-nhan/c-lan" />);
  await expect.element(screen.getByText("Anh gửi giúp em báo giá nhé").first()).toBeInTheDocument();
  expect(document.querySelector(".rounded-bubble")).not.toBeNull();
  expect(document.querySelector("[data-day-lines]")).toBeNull();
  await page.screenshot({ path: `${OUT2}/70-6-chat-1-1-khong-doi-390.png` });
});

// ------------------------------------------------------------------ 71
for (const [width, height, label] of [[390, 844, "390"], [1280, 800, "1280"]] as const) {
  test(`71.1 · Nhật ký: Ghi chép đứng đầu · ${label}`, async () => {
    await viewport(width, height);
    await render(<Diary />);
    await settle(300);
    const order = [...document.querySelectorAll("a, button")].map((node) => node.textContent?.trim() ?? "").filter((text) => /^(Ghi chép|Nhật ký của tôi|File của tôi|Liên kết|Nguồn tạo việc)/.test(text));
    expect(order[0]?.startsWith("Ghi chép")).toBe(true);
    await page.screenshot({ path: `${OUT2}/71-1-thu-tu-nhat-ky-${label}.png` });
  });
}

function groupChatSeed(): void {
  seed();
  db.tables.messages = [
    journalMessage("g-1", "Mai 7h họp ở công trình nhé cả nhà", minutesAgo(30), { conversation_id: "g1", sender_id: "lan" }),
    journalMessage("g-2", "Ok, em mang bản vẽ", minutesAgo(25), { conversation_id: "g1", sender_id: "me" }),
  ];
  db.rpcs.list_group_members = [
    { user_id: "me", display_name: "Thiện", role: "owner", joined_at: now },
    ...Array.from({ length: 29 }, (_value, index) => ({ user_id: index === 0 ? "lan" : index === 1 ? "minh" : `u${index}`, display_name: index === 0 ? "Lan Nguyễn" : index === 1 ? "Minh Trần" : `Thành viên ${index + 1}`, role: index === 2 ? "admin" : "member", joined_at: now })),
  ];
  db.tables.conversation_groups = [{ name: "Dự án chiếu sáng", owner_id: "me", conversation_id: "g1", parent_conversation_id: null }];
}

for (const [width, height, label] of [[1280, 800, "1280"], [390, 844, "390"]] as const) {
  test(`71.2 / 71.3 · menu tin: cùng một thứ tự; điện thoại 4 ô đầu Trả lời · Chuyển tiếp · Sao chép · Tạo nhiệm vụ · ${label}`, async () => {
    groupChatSeed();
    await viewport(width, height);
    const screen = await render(<JournalHubs at="/tin-nhan/g1" />);
    await expect.element(screen.getByText("Mai 7h họp ở công trình nhé cả nhà").first()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tuỳ chọn tin nhắn: Mai 7h họp/ }));
    await settle(300);
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent?.trim() ?? "").filter((text) => text !== "" && !/^\p{Extended_Pictographic}/u.test(text));
    const words = items.filter((text) => /^(Trả lời|Chuyển tiếp|Sao chép|Tạo nhiệm vụ|Lưu vào Nhật ký|Xem sau|Ghim|Chọn nhiều tin|Chi tiết|Đề nghị thu hồi|Báo cáo tin nhắn)$/.test(text));
    expect(words.slice(0, 4)).toEqual(["Trả lời", "Chuyển tiếp", "Sao chép", "Tạo nhiệm vụ"]);
    expect(words[words.length - 1]).toBe("Báo cáo tin nhắn");
    await page.screenshot({ path: `${OUT2}/71-2-menu-tin-${label}.png` });
  });
}

for (const [width, height, label] of [[390, 844, "390"], [844, 390, "844"]] as const) {
  test(`71.4 / 71.7 · ⋯ Nhóm 30 người: Nhiệm vụ / Bảng thấy ngay, Thành viên thu gọn, Hạn chế cuối · ${label}`, async () => {
    groupChatSeed();
    await viewport(width, height);
    const screen = await render(<JournalHubs at="/tin-nhan/g1" />);
    await expect.element(screen.getByText("Mai 7h họp ở công trình nhé cả nhà").first()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Thêm", exact: true }));
    await settle(600);
    expect(document.querySelector("[data-quick-row]")).not.toBeNull();
    const members = document.querySelector('[data-fold="members"]') as HTMLElement;
    expect(members.querySelector('[aria-label="Danh sách thành viên"]')).toBeNull();
    const boards = screen.getByRole("region", { name: "Bảng" }).element() as HTMLElement;
    expect(boards.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await page.screenshot({ path: `${OUT2}/71-4-ba-cham-nhom-${label}.png` });
    if (label === "390") {
      await userEvent.click(members.querySelector("button") as HTMLElement);
      await settle(300);
      await expect.element(screen.getByRole("searchbox", { name: "Tìm thành viên" })).toBeInTheDocument();
      await expect.element(screen.getByRole("button", { name: /Xem thêm/ })).toBeInTheDocument();
      await page.screenshot({ path: `${OUT2}/71-7-thanh-vien-mo-tai-cho-390.png` });
    }
  });
}

test("71.8 · ⋯ › Lịch → đóng: về lại ⋯", async () => {
  groupChatSeed();
  await viewport(390, 844);
  const screen = await render(<JournalHubs at="/tin-nhan/g1" />);
  await expect.element(screen.getByText("Mai 7h họp ở công trình nhé cả nhà").first()).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Thêm", exact: true }));
  await settle(400);
  await userEvent.click((document.querySelector("[data-quick-row]") as HTMLElement).querySelectorAll("button")[1] as HTMLElement);
  await settle(400);
  await page.screenshot({ path: `${OUT2}/71-8-lich-tren-ba-cham-1-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Đóng lịch" }));
  await settle(400);
  expect(document.querySelector("[data-quick-row]")).not.toBeNull();
  await page.screenshot({ path: `${OUT2}/71-8-dong-ve-ba-cham-2-390.png` });
});

// ------------------------------------------------------------------ 71 · D / E — cards
function CardsFrame({ children }: { children: ReactNode }) {
  return (
    <Frame>
      {children}
      <PersonCardHost />
      <GroupCardHost />
    </Frame>
  );
}

for (const [width, height, label] of [[390, 844, "390"], [1280, 800, "1280"]] as const) {
  test(`71.6 · chạm ảnh Nhóm → thẻ Nhóm; chạm thành viên → thẻ người · ${label}`, async () => {
    groupChatSeed();
    await viewport(width, height);
    const screen = await render(
      <CardsFrame>
        <div className="p-6">
          <GroupAvatarButton group={{ conversationId: "g1", name: "Dự án chiếu sáng", memberCount: 30 }} />
        </div>
      </CardsFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Xem thẻ nhóm Dự án chiếu sáng" }));
    await expect.element(screen.getByText("30 thành viên")).toBeInTheDocument();
    for (const tile of ["Nhắn", "Lịch", "Thông báo"]) await expect.element(screen.getByRole("button", { name: tile, exact: true })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "+22" })).toBeInTheDocument();
    const card = document.querySelector("[data-group-card]") as HTMLElement;
    expect(card.textContent ?? "").not.toMatch(/@|\+84|PIN/);
    await settle(300);
    await page.screenshot({ path: `${OUT2}/71-6-the-nhom-${label}.png` });
  });
}

test("71.9 · thẻ người theo quan hệ: bạn có Liên hệ / bạn chưa lưu / chưa kết bạn (390)", async () => {
  groupChatSeed();
  db.tables.contact = [
    { id: "k-lan", owner_user_id: "me", contact_type: "individual", name: "Chị Lan kế toán", phone: "+84901234567", email: "lan@congty.vn", note: "Gọi sau 14h", linked_user_id: "lan", needs_details: false, created_at: now, updated_at: now },
  ];
  db.tables.user_aliases = [{ target_user_id: "u5", alias: "Anh thợ điện" }];
  await viewport(390, 844);
  const screen = await render(
    <CardsFrame>
      <div className="flex gap-3 p-6">
        <PersonAvatarButton person={{ userId: "lan", name: "Lan Nguyễn", groupId: "g1" }} />
        <PersonAvatarButton person={{ userId: "minh", name: "Minh Trần", groupId: "g1" }} />
        <PersonAvatarButton person={{ userId: "u5", name: "Thành viên 6", groupId: "g1" }} />
      </div>
    </CardsFrame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Xem thẻ của Lan Nguyễn" }));
  await expect.element(screen.getByText("Chị Lan kế toán")).toBeInTheDocument();
  await expect.element(screen.getByText("lan@congty.vn")).toBeInTheDocument();
  await expect.element(screen.getByText("PIN A-LAN12345")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/71-9-ban-co-lien-he-390.png` });
  await userEvent.keyboard("{Escape}");
  await settle(300);
  await userEvent.click(screen.getByRole("button", { name: "Xem thẻ của Minh Trần" }));
  await expect.element(screen.getByText("PIN A-MINH0001")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Thêm vào Liên hệ" })).toBeInTheDocument();
  expect((document.querySelector("[data-person-card]") as HTMLElement).textContent ?? "").not.toContain("@");
  await page.screenshot({ path: `${OUT2}/71-9-ban-chua-luu-390.png` });
  await userEvent.keyboard("{Escape}");
  await settle(300);
  await userEvent.click(screen.getByRole("button", { name: "Xem thẻ của Thành viên 6" }));
  // 71.10: my alias big, their own name small; no PIN, no number, no email.
  await expect.element(screen.getByText("Anh thợ điện")).toBeInTheDocument();
  await expect.element(screen.getByText("PIN chỉ hiện giữa bạn bè")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Sửa tên gợi nhớ" })).toBeInTheDocument();
  const stranger = (document.querySelector("[data-person-card]") as HTMLElement).textContent ?? "";
  expect(stranger).toContain("Thành viên 6");
  expect(stranger).not.toMatch(/@|\+84|A-/);
  await page.screenshot({ path: `${OUT2}/71-10-chua-ket-ban-ten-goi-nho-390.png` });
});

// ------------------------------------------------------------------ 69 · Di chuyển Bảng
for (const [width, height, label] of [[1280, 800, "1280"], [390, 844, "390"]] as const) {
  test(`69 · ⋯ › Di chuyển Bảng…: chọn nơi, quyền, xem trước; không có Sao chép sang · ${label}`, async () => {
    seed();
    db.tables.think_hub_table = [tableRow({ conversation_id: null }), SUB_TABLE];
    await viewport(width, height);
    const screen = await render(<Hubs at="/ke-hoach?bang=b1" />);
    await expect.element(screen.getByRole("heading", { name: "Dự án chiếu sáng" })).toBeInTheDocument();
    await settle(800);
    await userEvent.click(screen.getByRole("button", { name: "Thao tác với Bảng Dự án chiếu sáng" }));
    expect(screen.getByRole("menuitem", { name: /Sao chép sang/ }).elements()).toHaveLength(0);
    await userEvent.click(screen.getByRole("menuitem", { name: /Di chuyển Bảng/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Dự án chiếu sáng/ }).first());
    await expect.element(screen.getByRole("radio", { name: /Cùng sửa/ })).toHaveAttribute("aria-checked", "true");
    const preview = document.querySelector("[data-move-preview]") as HTMLElement;
    expect(preview.textContent).toContain("1 bảng con");
    expect(preview.textContent).toContain("Tất cả đi theo Bảng");
    await settle(300);
    await page.screenshot({ path: `${OUT2}/69-di-chuyen-bang-${label}.png` });
  });
}

test("69 · Bảng chung: dòng Đang ở {nơi} · Chỉ xem dưới tên Bảng", async () => {
  seed();
  db.tables.think_hub_table = [tableRow({ share_mode: "view" }), SUB_TABLE];
  await viewport(1280, 800);
  const screen = await render(<Hubs at="/ke-hoach?bang=b1" />);
  await expect.element(screen.getByText(/Đang ở Dự án chiếu sáng · Chỉ xem/)).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/69-dang-o-chi-xem-1280.png` });
});

test("69 · thẻ chia sẻ Bảng trong chat", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <div className="flex min-h-[100dvh] flex-col gap-4 bg-background px-3 py-6">
        <p className="w-fit rounded-bubble bg-secondary px-4 py-2.5 text-[14px]">Mai 7h họp nhé</p>
        <BoardUpdateCard content={'Thiện chia sẻ Bảng "Dự án chiếu sáng" · 6 Hạng mục'} onView={() => undefined} viewLabel="Mở" />
        <p className="mx-auto max-w-md px-4 text-center text-[12.5px] text-muted-foreground">Bảng "Báo giá cũ" đã chuyển sang nhóm "Kho"</p>
      </div>
    </Frame>,
  );
  await expect.element(screen.getByRole("button", { name: "Mở" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT2}/69-the-chia-se-trong-chat-390.png` });
});

// ------------------------------------------------------------------ 74 · Sắc màu × Tông màu on real screens
function seedTasksForLook(): void {
  seed();
  const base = {
    type: "1-1-shared", creator_id: "lan", assignee_id: "me", context_snapshot: null, conversation_id: "c-lan", description: "",
    status: "confirmed", confirmed_at: now, done_at: null, completed_confirmed_at: null, skipped_at: null, skipped_silently: false,
    deadline_date: today, deadline_time: null, deadline_tz: "Asia/Ho_Chi_Minh", task_category_id: null, is_important: false, is_milestone: false,
    progress_percent: null, output_value: null, recurrence: "none", recurrence_pattern: null, recurrence_spawned_at: null, deleted_by_creator: false,
    deleted_by_peer: false, created_at: now, estimated_duration_minutes: null, requires_presence: false, start_at: null, end_at: null, location: null,
    latitude: null, longitude: null, travel_duration_minutes: null, departure_reminder_at: null, source_transaction_id: null,
  };
  db.tables.tasks = [
    { ...base, id: "t1", title: "Gửi báo giá mái tôn", is_important: true },
    { ...base, id: "t2", creator_id: "me", assignee_id: "lan", title: "Chụp ảnh hiện trạng mái", status: "pending_confirmation" },
    { ...base, id: "t3", type: "personal", creator_id: "me", assignee_id: null, conversation_id: null, title: "Đặt lịch khám răng" },
  ];
}

const LOOK_SCREENS = [
  ["ket-noi", () => { groupChatSeed(); return <JournalHubs at="/tin-nhan/g1" />; }, "Ok, em mang bản vẽ"],
  ["nhiem-vu", () => { seedTasksForLook(); return <Hubs at="/nhiem-vu?muc=viec&xem=tat-ca" />; }, "Gửi báo giá mái tôn"],
  ["ke-hoach", () => { seed({ changes: false }); return <Hubs at="/ke-hoach?bang=b1" />; }, "Dự án Sun Group"],
] as const;

for (const tone of ["avora", "bien", "ngoc", "tim", "than"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    for (const [name, make, marker] of LOOK_SCREENS) {
      for (const [width, height] of name === "ket-noi" ? ([[390, 844], [1280, 800]] as const) : ([[390, 844]] as const)) {
        test(`74 · ${tone} × ${scheme} · ${name} · ${width}`, async () => {
          setSavedLook({ scheme, tone });
          await viewport(width, height);
          const screen = await render(make());
          await expect.element(screen.getByText(marker).first()).toBeInTheDocument();
          await settle(700);
          // Brand stays terracotta whatever the tone: the + of the area and the wordmark area.
          expect(getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()).toBe("13 73% 56%");
          expect(document.documentElement.classList.contains("dark")).toBe(scheme === "dark");
          await page.screenshot({ path: `${OUT2}/74-${tone}-${scheme === "light" ? "sang" : "toi"}-${name}-${width}.png` });
        });
      }
    }
  }
}
afterAll(() => setSavedLook({ scheme: "light", tone: "avora" }));
