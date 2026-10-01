import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * Screenshots for the AVORA-58 / 59 / 60 report: the real screens with fixed fake data (no
 * account, no network), at an iPhone held upright (390×844) and on its side (844×390).
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

import { PersonAvatarButton, PersonCardHost } from "@/components/PersonCard";
import { LandscapeRail } from "@/components/nav/LandscapeRail";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { QuickActionBubble } from "@/components/QuickActionBubble";
import { CalendarPeekSheet } from "@/components/tasks/CalendarPeekSheet";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { Toaster } from "@/components/ui/sonner";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import { todayIso, type TaskItem } from "@/lib/tasks";
import Messages from "@/pages/Messages";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";

const OUT = "../../../docs/screens/2026-10-01";
const today = todayIso();
const now = new Date().toISOString();
const LONG_NOTE = Array.from({ length: 14 }, (_, index) => `${index + 1}. Ghi lại ý chính phần ${index + 1}, ai nói, ai nhận việc.`).join("\n");

function taskRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "t",
    type: "personal",
    creator_id: "me",
    assignee_id: null,
    context_snapshot: null,
    conversation_id: null,
    title: "",
    description: "",
    status: "confirmed",
    confirmed_at: null,
    done_at: null,
    completed_confirmed_at: null,
    skipped_at: null,
    skipped_silently: false,
    deadline_date: today,
    deadline_time: null,
    deadline_tz: "Asia/Ho_Chi_Minh",
    task_category_id: null,
    is_important: false,
    is_milestone: false,
    progress_percent: null,
    output_value: null,
    recurrence: "none",
    recurrence_pattern: null,
    recurrence_spawned_at: null,
    deleted_by_creator: false,
    deleted_by_peer: false,
    created_at: now,
    estimated_duration_minutes: null,
    requires_presence: false,
    start_at: null,
    end_at: null,
    location: null,
    latitude: null,
    longitude: null,
    travel_duration_minutes: null,
    departure_reminder_at: null,
    source_transaction_id: null,
    ...part,
  };
}

const ROWS = [
  taskRow({ id: "t1", type: "1-1-shared", creator_id: "lan", assignee_id: "me", conversation_id: "c-lan", status: "pending_confirmation", title: "Gửi báo giá mái tôn", description: "Báo giá cho nhà anh Hùng" }),
  taskRow({ id: "t2", type: "1-1-shared", creator_id: "me", assignee_id: "lan", conversation_id: "c-lan", status: "pending_confirmation", title: "Chụp ảnh hiện trạng mái", description: "Bốn góc nhà" }),
  taskRow({ id: "t3", title: "Đặt lịch khám răng", description: "Phòng khám gần nhà" }),
  taskRow({ id: "t4", type: "group-shared", creator_id: "minh", assignee_id: "lan", conversation_id: "g1", title: "Mua thước dây", description: "Loại 5 mét" }),
  taskRow({ id: "t5", type: "group-shared", creator_id: "lan", assignee_id: "me", conversation_id: "g1", title: "Soạn biên bản họp tuần", description: LONG_NOTE }),
];

function item(row: Record<string, unknown>): TaskItem {
  return {
    id: row.id as string,
    type: row.type as TaskItem["type"],
    creatorId: row.creator_id as string,
    assigneeId: (row.assignee_id as string | null) ?? null,
    contextSnapshot: null,
    conversationId: (row.conversation_id as string | null) ?? null,
    title: row.title as string,
    description: row.description as string,
    status: row.status as TaskItem["status"],
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: today,
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    isMilestone: false,
    progressPercent: null,
    outputValue: null,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    createdAt: now,
    estimatedDurationMinutes: null,
    requiresPresence: false,
    startAt: null,
    endAt: null,
    location: null,
    latitude: null,
    longitude: null,
    travelDurationMinutes: null,
    departureReminderAt: null,
    sourceTransactionId: null,
  };
}

function conversation(part: Record<string, unknown>): Record<string, unknown> {
  return {
    peer_id: null,
    peer_display_name: "",
    peer_email: null,
    group_name: null,
    member_count: 2,
    last_message_content: "Ok anh",
    last_message_at: now,
    last_message_sender_id: "lan",
    unread_count: 0,
    sort_at: now,
    is_connected: true,
    peer_pin: null,
    verification_status: null,
    ...part,
  };
}

function message(id: string, sender: string, content: string, minutesAgo: number): Record<string, unknown> {
  return {
    id,
    conversation_id: "c-lan",
    sender_id: sender,
    content,
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    edited_at: null,
    deleted_at: null,
    reply_to_message_id: null,
    mentioned_user_ids: [],
    origin_group_id: null,
    attachment_count: 0,
    origin_content_id: null,
    origin_sender_id: null,
    system_kind: null,
    forward_bundle: null,
    is_urgent: false,
  };
}

function seed(): void {
  db.tables = {
    // The one-time hold hints are read already (their own picture is 60-6).
    dismissed_guidance: [{ guidance_key: "plan_plus_hold" }, { guidance_key: "task_plus_hold" }],
    tasks: ROWS,
    contact: [
      { id: "k-lan", owner_user_id: "me", contact_type: "individual", name: "Lan Nguyễn", phone: "+84901234567", email: null, linked_user_id: "lan", needs_details: false, created_at: now, updated_at: now },
    ],
    messages: [
      message("m1", "lan", "Anh gửi giúp em báo giá mái tôn nhé", 40),
      message("m2", "me", "Ok, chiều nay anh gửi", 35),
      message("m3", "lan", "Em chụp ảnh hiện trạng sau", 20),
    ],
  };
  db.rpcs = {
    list_my_conversations: [
      conversation({ conversation_id: "c-lan", conversation_type: "direct", peer_id: "lan", peer_display_name: "Lan Nguyễn", peer_pin: "A-LAN12345" }),
      conversation({ conversation_id: "g1", conversation_type: "group", group_name: "Dự án Sửa mái", member_count: 3, last_message_content: "Mai 7h họp nhé", last_message_sender_id: "minh" }),
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
    get_conversation_peer: [{ peer_id: "lan", peer_display_name: "Lan Nguyễn", peer_email: null }],
  };
}

function Frame({ children, at = "/" }: { children: ReactNode; at?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          {children}
          <PersonCardHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The signed-in frame (RequireAuth's own classes), so the phone-on-its-side layout is the real one. */
function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:flex-row short:flex-row">
      <MobileTopBar />
      <LandscapeRail />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col short:pr-[env(safe-area-inset-right)]">{children}</main>
      <ToolBelt />
      <QuickActionBubble />
    </div>
  );
}

async function settle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

/** A finger resting on a control — the hold the browser would see from a phone. */
async function hold(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect();
  const init: PointerEventInit = { bubbles: true, cancelable: true, pointerType: "touch", button: 0, isPrimary: true, pointerId: 7, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  await settle(650);
  element.dispatchEvent(new PointerEvent("pointerup", init));
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function noSideScroll(width: number): void {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
}

beforeEach(() => {
  seed();
  window.localStorage.clear();
  window.getSelection()?.removeAllRanges();
  document.documentElement.style.removeProperty("--keyboard-inset");
  delete document.documentElement.dataset.keyboard;
});

test("59.1 · việc được giao cho tôi, mở từ Lịch: Nhận việc ngay tại chỗ", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <TaskDetailSheet task={item(ROWS[0])} today={today} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await expect.element(screen.getByRole("button", { name: "Nhận việc" })).toBeInTheDocument();
  await expect.element(screen.getByText("Của tôi · từ Lan Nguyễn").first()).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Mở cuộc trò chuyện" })).toBeInTheDocument();
  expect(document.body.textContent ?? "").not.toMatch(/Người khác giao|nằm trong cuộc trò chuyện|@/);
  await settle();
  await page.screenshot({ path: `${OUT}/59-1-nhan-viec-tai-cho-390.png` });
});

test("59.1 · đã nhận: nút cam là Xong", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <TaskDetailSheet task={item({ ...ROWS[4], status: "confirmed" })} today={today} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await expect.element(screen.getByRole("button", { name: "Xong", exact: true })).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/59-1-xong-tai-cho-390.png` });
});

test("59.2 · việc tôi giao: không có Xong, dòng Giao … · chờ nhận", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <TaskDetailSheet task={item(ROWS[1])} today={today} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await expect.element(screen.getByText("Giao Lan Nguyễn · chờ nhận").first()).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Xong", exact: true }).elements()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Nhận việc" }).elements()).toHaveLength(0);
  await settle();
  await page.screenshot({ path: `${OUT}/59-2-viec-toi-giao-390.png` });
});

test("59.3 · Tất cả: việc của tôi có vạch cam", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame at="/nhiem-vu?muc=viec">
      <AppFrame>
        <Tasks />
      </AppFrame>
    </Frame>,
  );
  await expect.element(screen.getByText("Đặt lịch khám răng").first()).toBeInTheDocument();
  await settle(800);
  const mine = document.querySelectorAll("[data-task-mine='true']");
  expect(mine.length).toBeGreaterThan(0);
  expect(getComputedStyle(mine[0] as HTMLElement).borderLeftWidth).toBe("3px");
  noSideScroll(390);
  await page.screenshot({ path: `${OUT}/59-3-tat-ca-vach-cam-390.png` });
});

test("59.8 · chi tiết dài, cuộn xuống giữa: vẫn thấy ‹ và ‹ đóng được", async () => {
  await viewport(390, 844);
  let isOpen = true;
  const screen = await render(
    <Frame>
      <TaskDetailSheet task={item({ ...ROWS[4], status: "confirmed" })} today={today} open onOpenChange={(next) => (isOpen = next)} />
    </Frame>,
  );
  const back = screen.getByRole("button", { name: "Quay lại" });
  await expect.element(back).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
  const scroller = document.querySelector("[role='dialog'] .overflow-y-auto") as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight / 2;
  await settle();
  const rect = back.element().getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  // Above the task's own title row, never under it.
  const title = screen.getByRole("heading", { name: "Soạn biên bản họp tuần" }).element().getBoundingClientRect();
  expect(rect.bottom).toBeLessThanOrEqual(title.top + 1);
  await page.screenshot({ path: `${OUT}/59-8-chi-tiet-dai-van-thay-quay-lai-390.png` });
  await userEvent.click(back);
  expect(isOpen).toBe(false);
});

test("59.7 / 60.1 · sửa nhiệm vụ khi bàn phím mở: tiêu đề form và Lưu vẫn thấy, ô ≥ 16px", async () => {
  await viewport(390, 844);
  // A phone keyboard cannot be opened in a headless browser: KeyboardSync's own signal is set by
  // hand (iOS: 336px covered), and a grey block stands in for the keys in the picture.
  document.documentElement.style.setProperty("--keyboard-inset", "336px");
  document.documentElement.dataset.keyboard = "open";
  const screen = await render(
    <Frame>
      <TaskComposer
        open
        onOpenChange={() => undefined}
        mode="edit-task"
        place="personal"
        initial={{ title: "Đặt lịch khám răng", deadline: today, description: "Phòng khám gần nhà" }}
        onSave={async () => undefined}
      />
      <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-[100] flex h-[336px] items-center justify-center bg-[#cfd3d9] text-[13px] text-black/50">
        Bàn phím iPhone (giả lập)
      </div>
    </Frame>,
  );
  const field = screen.getByLabelText("Tên việc");
  await expect.element(field).toBeInTheDocument();
  await userEvent.click(field);
  await userEvent.keyboard(" — buổi sáng");
  expect(Number.parseFloat(getComputedStyle(field.element()).fontSize)).toBeGreaterThanOrEqual(16);
  const heading = screen.getByText("Sửa nhiệm vụ").element().getBoundingClientRect();
  const save = screen.getByRole("button", { name: "Lưu thay đổi" }).element().getBoundingClientRect();
  expect(heading.top).toBeGreaterThanOrEqual(0);
  expect(save.bottom).toBeLessThanOrEqual(844 - 336 + 1);
  noSideScroll(390);
  await settle();
  await page.screenshot({ path: `${OUT}/59-7-sua-nhiem-vu-ban-phim-mo-390.png` });
});

test("60.1 · chi tiết → Sửa → gõ → Lưu: không phóng to, ‹ vẫn thấy", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <TaskDetailSheet task={item(ROWS[2])} today={today} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Sửa", exact: true }));
  const field = screen.getByLabelText("Tên việc");
  await expect.element(field).toBeInTheDocument();
  await userEvent.click(field);
  await userEvent.keyboard(" ở quận 3");
  expect(Number.parseFloat(getComputedStyle(field.element()).fontSize)).toBeGreaterThanOrEqual(16);
  await userEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  await settle(700);
  const back = screen.getByRole("button", { name: "Quay lại" }).element().getBoundingClientRect();
  expect(back.top).toBeGreaterThanOrEqual(0);
  expect(back.left).toBeGreaterThanOrEqual(0);
  expect(window.visualViewport?.scale ?? 1).toBe(1);
  noSideScroll(390);
  await page.screenshot({ path: `${OUT}/60-1-sau-khi-luu-van-thay-quay-lai-390.png` });
});

test("59.6 · giữ + ở Kế hoạch: menu ngay dưới nút, không bôi chữ", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame at="/ke-hoach">
      <AppFrame>
        <ThinkHub />
      </AppFrame>
    </Frame>,
  );
  const plus = screen.getByRole("button", { name: /Tạo bảng mới|Thêm Hạng mục/ });
  await expect.element(plus).toBeInTheDocument();
  await settle(600);
  const button = plus.element() as HTMLElement;
  expect(getComputedStyle(button).userSelect).toBe("none");
  await hold(button);
  const menu = document.querySelector("[data-plus-menu]") as HTMLElement | null;
  expect(menu).not.toBeNull();
  const b = button.getBoundingClientRect();
  const m = (menu as HTMLElement).getBoundingClientRect();
  expect(m.top).toBeGreaterThanOrEqual(b.bottom);
  expect(m.top - b.bottom).toBeLessThan(20);
  expect(Math.abs(m.right - b.right)).toBeLessThan(16);
  expect(window.getSelection()?.toString() ?? "").toBe("");
  await page.screenshot({ path: `${OUT}/59-6-giu-cong-ke-hoach-390.png` });
});

test("60.6 · Nhiệm vụ: giữ + → 4 mục ngay dưới nút; chạm + → form tạo", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame at="/nhiem-vu?muc=viec">
      <AppFrame>
        <Tasks />
      </AppFrame>
    </Frame>,
  );
  const plus = screen.getByRole("button", { name: /Thêm nhiệm vụ/ });
  await expect.element(plus).toBeInTheDocument();
  await settle(600);
  const button = plus.element() as HTMLElement;
  await hold(button);
  for (const label of ["Nhiệm vụ cho tôi", "Giao việc cho người khác", "Sự kiện", "Ghi chú nhanh"]) {
    await expect.element(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
  }
  const b = button.getBoundingClientRect();
  const m = (document.querySelector("[data-plus-menu]") as HTMLElement).getBoundingClientRect();
  expect(m.top).toBeGreaterThanOrEqual(b.bottom);
  expect(Math.abs(m.right - b.right)).toBeLessThan(16);
  await page.screenshot({ path: `${OUT}/60-6-giu-cong-nhiem-vu-390.png` });

  await userEvent.keyboard("{Escape}");
  await settle(300);
  await userEvent.click(button);
  await expect.element(screen.getByLabelText("Tên việc")).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/60-6-cham-cong-mo-form-390.png` });
});

for (const [name, at, page_] of [
  ["nhiem-vu", "/nhiem-vu?muc=viec", "tasks"],
  ["ke-hoach", "/ke-hoach", "plan"],
  ["ket-noi", "/tin-nhan", "chat"],
  ["trong-chat", "/tin-nhan/c-lan", "chat"],
] as const) {
  test(`59.5 · nằm ngang 844×390 · ${name}: biểu tượng không bị cắt, không gì đè nhau`, async () => {
    await viewport(844, 390);
    await render(
      <Frame at={at}>
        <AppFrame>
          <Routes>
            <Route path="/nhiem-vu" element={<Tasks />} />
            <Route path="/ke-hoach" element={<ThinkHub />} />
            <Route path="/tin-nhan" element={<Messages />} />
            <Route path="/tin-nhan/:conversationId" element={<Messages />} />
          </Routes>
        </AppFrame>
      </Frame>,
    );
    await settle(1200);
    const rail = document.querySelector("nav[aria-label='Điều hướng chính']") as HTMLElement;
    const railRect = rail.getBoundingClientRect();
    expect(railRect.width).toBeGreaterThanOrEqual(60);
    for (const link of rail.querySelectorAll("a")) {
      const rect = link.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(railRect.left);
      expect(rect.right).toBeLessThanOrEqual(railRect.right);
    }
    const bubble = document.querySelector("button[aria-label][class*='fixed']") as HTMLElement | null;
    const plus = document.querySelector("[data-plus-button]") as HTMLElement | null;
    if (bubble !== null && plus !== null) expect(overlaps(bubble.getBoundingClientRect(), plus.getBoundingClientRect())).toBe(false);
    if (page_ !== "chat") {
      const header = document.querySelector("main header") as HTMLElement;
      expect(header.getBoundingClientRect().height / 390).toBeLessThanOrEqual(0.35);
      if (bubble !== null) {
        const title = header.querySelector("h1") as HTMLElement;
        expect(overlaps(bubble.getBoundingClientRect(), title.getBoundingClientRect())).toBe(false);
      }
    }
    noSideScroll(844);
    await page.screenshot({ path: `${OUT}/59-5-nam-ngang-${name}-844.png` });
  });
}

test("60.3 · trong chat 1-1 → ⋯ → Lịch: tuần này, lọc việc chung", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <CalendarPeekSheet
        open
        onOpenChange={() => undefined}
        title="Lịch · Lan Nguyễn"
        initialMode="week"
        placement="top"
        onOpenTask={() => undefined}
        sharedFilter={{ label: "Chỉ việc chung với Lan Nguyễn", test: (task) => task.conversationId === "c-lan" }}
      />
    </Frame>,
  );
  await expect.element(screen.getByRole("radio", { name: "Chỉ việc chung với Lan Nguyễn" })).toHaveAttribute("aria-checked", "true");
  await expect.element(screen.getByRole("tab", { name: "Tuần" })).toHaveAttribute("aria-selected", "true");
  await expect.element(screen.getByText("Gửi báo giá mái tôn").first()).toBeInTheDocument();
  await settle();
  expect(screen.getByText("Đặt lịch khám răng").elements()).toHaveLength(0);
  await page.screenshot({ path: `${OUT}/60-3-lich-trong-chat-390.png` });
  await userEvent.click(screen.getByRole("radio", { name: "Cả lịch của tôi" }));
  await expect.element(screen.getByText("Đặt lịch khám răng").first()).toBeInTheDocument();
});

test("60.4 · chạm ảnh đại diện trong nhóm → thẻ người: tên, PIN, nút nhanh, không email", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <div className="flex h-[100dvh] flex-col gap-3 bg-card p-4">
        <div className="flex items-end gap-2">
          <PersonAvatarButton person={{ userId: "lan", name: "Lan Nguyễn", groupId: "g1" }} size="sm" />
          <p className="w-fit rounded-bubble bg-secondary px-4 py-2.5 text-[14px]">Mai 7h họp nhé cả nhà</p>
        </div>
      </div>
    </Frame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Xem thẻ của Lan Nguyễn" }));
  const card = screen.getByText("PIN A-LAN12345");
  await expect.element(card).toBeInTheDocument();
  for (const label of ["Nhắn riêng", "Gọi", "Việc chung · 4", "Mở Liên hệ", "Chặn", "Báo cáo"]) {
    await expect.element(screen.getByRole(label === "Gọi" ? "link" : "button", { name: label, exact: true })).toBeInTheDocument();
  }
  expect(document.querySelector("[data-person-card]")?.textContent ?? "").not.toContain("@");
  await settle();
  await page.screenshot({ path: `${OUT}/60-4-the-nguoi-390.png` });
});

test("60.5 · người không có trong Liên hệ: không số điện thoại, không Gọi", async () => {
  await viewport(390, 844);
  const screen = await render(
    <Frame>
      <PersonAvatarButton person={{ userId: "hoa", name: "Hoa Lê", groupId: "g1" }} />
    </Frame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Xem thẻ của Hoa Lê" }));
  await expect.element(screen.getByRole("button", { name: "Kết bạn" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Gọi" }).elements()).toHaveLength(0);
  expect(screen.getByLabelText("Sao chép số điện thoại").elements()).toHaveLength(0);
});
