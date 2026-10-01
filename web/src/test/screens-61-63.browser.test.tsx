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
import { Toaster } from "@/components/ui/sonner";
import type { Note, NoteFolder } from "@/lib/notes";
import { todayIso } from "@/lib/tasks";
import type { NotesData } from "@/lib/use-notes";
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
  await expect.element(screen.getByRole("group", { name: "Cách xem trên điện thoại" }).getByRole("button", { name: "Thẻ", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector('[data-phone-board="cards"]')).not.toBeNull();
  await expect.element(screen.getByRole("button", { name: /Cột trên thẻ/ })).toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${OUT}/61-9-dien-thoai-the-390.png` });
});

test("61.9 · điện thoại, dạng Bảng: tiêu đề hàng riêng; trượt một hàng → mọi hàng + tên cột trượt theo; tiêu đề dính đúng", async () => {
  const screen = await openBoard(390, 844, { changes: false });
  await userEvent.click(screen.getByRole("group", { name: "Cách xem trên điện thoại" }).getByRole("button", { name: "Bảng", exact: true }));
  await settle(400);
  const board = document.querySelector('[data-phone-board="table"]') as HTMLElement;
  expect(board).not.toBeNull();
  const title = board.querySelector("[data-record-title]") as HTMLElement;
  expect(title.getBoundingClientRect().width).toBeGreaterThan(260);
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
  const screen = await render(<Hubs at="/nhiem-vu?muc=viec&xem=tat-ca" />);
  await expect.element(screen.getByText("Gửi báo giá mái tôn").first()).toBeInTheDocument();
  await settle(800);
  expect(document.body.textContent ?? "").not.toContain("Ctrl/⌘");
  expect([...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Xem trong ngữ cảnh")).toHaveLength(0);
  const icon = document.querySelector('[data-task-context="chat"]') as HTMLElement | null;
  expect(icon?.getAttribute("aria-label")).toMatch(/trong cuộc trò chuyện/);
  await page.screenshot({ path: `${OUT}/61-11-nhiem-vu-gon-390.png` });
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
