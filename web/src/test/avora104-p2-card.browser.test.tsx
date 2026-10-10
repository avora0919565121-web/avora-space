import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * AVORA-104 · PHẦN 2 — Một thẻ nhiệm vụ (T.1–T.9, T.11; T.10 is the SQL probe).
 * One `TaskCard` for creating, seeing and editing, everywhere, in the same ten-row order.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: [] as { table: string; op: string; values: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  uploads: [] as string[],
  failWrites: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string, rows: unknown): unknown => {
    let single = false;
    let pending: { op: string; values: Record<string, unknown> } | null = null;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            if (pending !== null) db.writes.push({ table, ...pending });
            if (pending !== null && db.failWrites && table === "tasks") {
              const failed = Promise.resolve({ data: null, error: { code: "08006", message: "Failed to fetch" } });
              return failed.then.bind(failed);
            }
            let data: unknown = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            if (pending !== null && single && data !== null && typeof data === "object") data = { ...(data as object), ...pending.values };
            if (pending !== null && single && (data === null || data === undefined)) data = { id: `${table}-new`, ...pending.values };
            const done = Promise.resolve({ data, error: null, count: Array.isArray(rows) ? rows.length : 0 });
            return done.then.bind(done);
          }
          if (key === "single" || key === "maybeSingle") {
            return () => {
              single = true;
              return proxy;
            };
          }
          if (key === "update" || key === "insert" || key === "upsert") {
            return (values: Record<string, unknown>) => {
              pending = { op: String(key), values };
              return proxy;
            };
          }
          if (key === "upload") {
            return (path: string) => {
              db.uploads.push(path);
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
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        db.rpcs.push({ name, args });
        if (name === "task_recipient_ids") return builder(`rpc:${name}`, ["me", "u2", "u3"]);
        const row = (db.tables.tasks ?? [])[0] ?? null;
        return builder(`rpc:${name}`, name.includes("shared_task") ? row : name === "create_record_task" ? "t-new" : []);
      },
      storage: { from: () => builder("storage", []) },
      channel: () => builder("channel", []),
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

import { TaskFromChatDialog } from "@/components/chat/TaskFromChatDialog";
import { PasteTaskDialog } from "@/components/chat/PasteTaskDialog";
import { ProjectTaskDialog } from "@/components/projects/ProjectTaskDialog";
import { TaskCard } from "@/components/tasks/TaskCard";
import { QuickTaskDialog } from "@/components/think-hub/QuickTaskDialog";
import { Toaster } from "@/components/ui/sonner";
import { CARD_ROW_ORDER } from "@/lib/task-card";
import { todayIso, type TaskItem } from "@/lib/tasks";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";

const OUT = "../../../docs/screens/2026-10-10";
const today = todayIso();
const plusDays = (n: number): string => {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function taskRow(part: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: "t1", type: "personal", creator_id: "me", assignee_id: null, context_snapshot: null, conversation_id: null,
    title: "Gọi lại cho anh Tuấn về báo giá", description: "", status: "confirmed", confirmed_at: null, done_at: null,
    completed_confirmed_at: null, skipped_at: null, skipped_silently: false, deadline_date: plusDays(3), deadline_time: null,
    deadline_tz: "Asia/Ho_Chi_Minh", task_category_id: null, is_important: false, is_milestone: false, progress_percent: null,
    output_value: null, recurrence: "none", recurrence_pattern: null, recurrence_spawned_at: null, deleted_by_creator: false,
    deleted_by_peer: false, created_at: now, updated_at: now, estimated_duration_minutes: null, requires_presence: false,
    start_at: null, end_at: null, location: null, latitude: null, longitude: null, travel_duration_minutes: null,
    departure_reminder_at: null, source_transaction_id: null, ...part,
  };
}

function asItem(row: Record<string, unknown>): TaskItem {
  return {
    id: row.id, type: row.type, creatorId: row.creator_id, assigneeId: row.assignee_id, contextSnapshot: null, conversationId: row.conversation_id,
    title: row.title, description: row.description, status: row.status, confirmedAt: null, doneAt: null,
    completedConfirmedAt: null, skippedAt: null, skippedSilently: false, deadline: row.deadline_date, deadlineTime: row.deadline_time,
    deadlineTz: "Asia/Ho_Chi_Minh", categoryId: null, isImportant: false, isMilestone: false, progressPercent: null,
    outputValue: null, recurrence: "none", recurrencePattern: null, recurrenceSpawnedAt: null, deletedByCreator: false,
    deletedByPeer: false, createdAt: row.created_at, estimatedDurationMinutes: null, requiresPresence: false, startAt: null,
    endAt: null, location: null, latitude: null, longitude: null, travelDurationMinutes: null, departureReminderAt: null,
    sourceTransactionId: null,
  } as unknown as TaskItem;
}

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/nhiem-vu"]}>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 250): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** The card's rows, in the order they are drawn. */
function rowOrder(): string[] {
  const card = document.querySelector("[data-task-card]") as HTMLElement;
  return Array.from(card.querySelectorAll<HTMLElement>("[data-card-row]")).map((node) => node.getAttribute("data-card-row") ?? "");
}

async function expand(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("[data-card-expand]");
  if (button !== null) await userEvent.click(button);
  await settle(200);
}

async function pickCardDay(row: "when" | "reminder", day: string): Promise<void> {
  const rowNode = document.querySelector(`[data-card-row="${row}"] button`) as HTMLElement;
  if (document.querySelector(`[data-card-row="${row}"] [data-inline-calendar]`) === null) await userEvent.click(rowNode);
  for (let i = 0; i < 3; i += 1) {
    const cell = document.querySelector<HTMLButtonElement>(`[data-card-row="${row}"] [data-card-day="${day}"]:not([disabled])`);
    if (cell !== null) {
      await userEvent.click(cell);
      return;
    }
    await userEvent.click(document.querySelector(`[data-card-row="${row}"] [aria-label="Tháng sau"]`) as HTMLElement);
  }
  throw new Error(`day ${day} not in the card calendar`);
}

const member = (userId: string, name: string) => ({ userId, displayName: name, role: "member" as const, joinedAt: "" });

beforeEach(() => {
  db.writes = [];
  db.rpcs = [];
  db.uploads = [];
  db.failWrites = false;
  db.tables = {};
  window.localStorage.removeItem("avora-task-card-groups");
});

const ENTRIES: { name: string; node: () => ReactNode }[] = [
  { name: "tab-nhiem-vu", node: () => <TaskCard open onOpenChange={() => undefined} place="personal" onCreateMine={async () => undefined} /> },
  {
    name: "hang-muc",
    node: () => (
      <QuickTaskDialog
        record={{ id: "r1", tableId: "b1", title: "Cty Hoà Phát", nextActionDate: null, status: "moi" } as unknown as ThinkRecord}
        table={{ id: "b1", name: "Khách hàng", conversationId: null } as unknown as ThinkTable}
        project={undefined}
        conversationKind={null}
        conversationName=""
        onOpenChange={() => undefined}
      />
    ),
  },
  {
    name: "chat-1-1",
    node: () => (
      <TaskFromChatDialog open onOpenChange={() => undefined} conversationId="c1" conversationKind="direct" conversationName="Lan" peerId="u2" peerName="Lan" members={[]} contextMessage={null} contextSenderName="" />
    ),
  },
  {
    name: "chat-nhom",
    node: () => (
      <TaskFromChatDialog open onOpenChange={() => undefined} conversationId="g1" conversationKind="group" conversationName="Nhóm Hoiana" peerId={null} peerName="" members={[member("me", "Thiện"), member("u2", "Lan"), member("u3", "Minh")]} contextMessage={null} contextSenderName="" />
    ),
  },
  { name: "dan-noi-dung", node: () => <PasteTaskDialog open onOpenChange={() => undefined} journalId="j1" journalName="Nhật ký" initialPaste={null} /> },
  {
    name: "du-an",
    node: () => (
      <ProjectTaskDialog open onOpenChange={() => undefined} project={{ id: "p1", conversationId: "g1", title: "Hoiana – chiếu sáng" }} groupName="Hoiana" members={[member("me", "Thiện"), member("u2", "Lan")]} records={[]} initialRecordId={null} />
    ),
  },
];

for (const entry of ENTRIES) {
  test(`T.1 · ${entry.name}: cùng một TaskCard, cùng thứ tự 10 dòng (390)`, async () => {
    await page.viewport(390, 844);
    await render(<Frame>{entry.node()}</Frame>);
    await settle(400);
    expect(document.querySelector('[data-task-card="create"]')).not.toBeNull();
    await page.screenshot({ path: `${OUT}/104-T1-${entry.name}-nhanh-390.png` });
    await expand();
    const order = rowOrder();
    // Every row present sits in the one fixed order; title, when, assign, note are always there.
    const known = order.filter((row) => CARD_ROW_ORDER.includes(row));
    expect(known).toEqual(CARD_ROW_ORDER.filter((row) => known.includes(row)));
    for (const row of ["title", "when", "assign", "note"]) expect(known).toContain(row);
    await page.screenshot({ path: `${OUT}/104-T1-${entry.name}-mo-rong-390.png` });
  });
}

test("T.2 · tạo: tên → Mở rộng → 2 bước, Nhắc, Lặp hằng tuần, 1 tệp, Ghi chú → Tạo: lưu đủ", async () => {
  await page.viewport(390, 844);
  db.tables.tasks = [taskRow({ id: "t-new" })];
  await render(
    <Frame>
      <TaskCard
        open
        onOpenChange={() => undefined}
        place="personal"
        onCreateMine={async () => ({ id: "t-new" })}
      />
    </Frame>,
  );
  await settle(300);
  await userEvent.fill(page.getByLabelText("Tên việc"), "Gọi lại cho anh Tuấn về báo giá");
  await expand();
  for (const step of ["Xem lại báo giá v3", "Hỏi số lượng đèn kho"]) {
    await userEvent.fill(page.getByLabelText("Thêm bước"), step);
    await userEvent.keyboard("{Enter}");
  }
  await pickCardDay("when", plusDays(2));
  await pickCardDay("reminder", plusDays(1));
  await userEvent.click(document.querySelector('[data-card-row="repeat"] button') as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Hằng tuần" }));
  const input = document.querySelector<HTMLInputElement>("[data-task-file-input]") as HTMLInputElement;
  const file = new File(["bao gia"], "bao-gia-v3.pdf", { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(100);
  await userEvent.fill(page.getByLabelText("Ghi chú"), "Anh Tuấn cần trước thứ Sáu.");
  await page.screenshot({ path: `${OUT}/104-T2-tao-day-du-390.png` });
  await userEvent.click(document.querySelector("[data-card-submit]") as HTMLElement);
  await expect.poll(() => db.writes.filter((w) => w.table === "checklist_items" && w.op === "insert").length).toBe(2);
  await expect.poll(() => db.rpcs.find((c) => c.name === "set_task_recurrence")?.args.p_recurrence).toBe("weekly");
  await expect.poll(() => db.writes.some((w) => w.table === "task_reminders" && w.op === "insert")).toBe(true);
  await expect.poll(() => db.uploads.some((path) => path.startsWith("t-new/") && path.endsWith("bao-gia-v3.pdf"))).toBe(true);
  await expect.poll(() => db.writes.some((w) => w.table === "task_files" && w.op === "insert")).toBe(true);
});

test("T.3 · mở việc có sẵn: không có nút Sửa; đổi Ngày diễn ra → Đã lưu ✓ và gửi đúng ngày", async () => {
  await page.viewport(390, 844);
  const row = taskRow({});
  db.tables.tasks = [row];
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  expect(Array.from(document.querySelectorAll("button")).some((b) => /^\s*Sửa\s*$/.test(b.textContent ?? ""))).toBe(false);
  await page.screenshot({ path: `${OUT}/104-T3-the-sua-390.png` });
  const target = plusDays(8);
  await pickCardDay("when", target);
  await expect.poll(() => db.writes.find((w) => w.table === "tasks" && w.op === "update" && "deadline_date" in w.values)?.values.deadline_date).toBe(target);
  await expect.poll(() => document.querySelector("[data-save-state]")?.textContent ?? "").toContain("Đã lưu");
});

test("T.4 · việc trễ hạn → dời sang ngày mai: lưu được", async () => {
  await page.viewport(390, 844);
  const row = taskRow({ deadline_date: plusDays(-4) });
  db.tables.tasks = [row];
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  await pickCardDay("when", plusDays(1));
  await expect.poll(() => db.writes.find((w) => w.table === "tasks" && w.op === "update" && "deadline_date" in w.values)?.values.deadline_date).toBe(plusDays(1));
});

test("T.5 · việc chung: người được giao đổi Ngày → qua RPC việc chung", async () => {
  await page.viewport(390, 844);
  const row = taskRow({ type: "1-1-shared", creator_id: "u2", assignee_id: "me", conversation_id: "c1", status: "confirmed" });
  db.tables.tasks = [row];
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  await pickCardDay("when", plusDays(5));
  await expect.poll(() => db.rpcs.find((c) => c.name === "update_shared_task_details")?.args.p_deadline).toBe(plusDays(5));
});

test("T.6 · gợi ý đang chờ (người nhận): chỉ đọc + Đồng ý / Từ chối; đồng ý gọi confirm", async () => {
  await page.viewport(390, 844);
  const row = taskRow({ type: "1-1-shared", creator_id: "u2", assignee_id: "me", conversation_id: "c1", status: "pending_confirmation" });
  db.tables.tasks = [row];
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  expect((document.getElementById("task-card-title") as HTMLTextAreaElement).readOnly).toBe(true);
  expect(document.querySelector('[data-card-row="when"] button')).toBeNull();
  await page.screenshot({ path: `${OUT}/104-T6-goi-y-cho-390.png` });
  await userEvent.click(page.getByRole("button", { name: "Đồng ý" }));
  await expect.poll(() => db.rpcs.some((c) => c.name === "confirm_shared_task")).toBe(true);
});

test("T.7 · thu cụm THỜI GIAN, mở lại: vẫn thu, có dòng tóm tắt", async () => {
  await page.viewport(390, 844);
  const row = taskRow({});
  db.tables.tasks = [row];
  const first = await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  await userEvent.click(document.querySelector('[data-card-group="time"] > button') as HTMLElement);
  expect(document.querySelector('[data-card-row="when"]')).toBeNull();
  // A fresh card (as after a reload) reads the fold back from this device.
  await first.rerender(
    <Frame>
      <TaskCard key="again" task={asItem({ ...row, id: "t1b" })} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  expect(document.querySelector('[data-card-row="when"]')).toBeNull();
  expect(document.querySelector('[data-card-group="time"] [data-group-summary]')?.textContent ?? "").toMatch(/\d{2}\/\d{2}/);
});

test("T.8 · máy tính 1440: thẻ ở khung phải 420–480 px; nút bên trái vẫn bấm được", async () => {
  await page.viewport(1440, 900);
  const row = taskRow({});
  db.tables.tasks = [row];
  let clicks = 0;
  await render(
    <Frame>
      <button type="button" data-list-row="" onClick={() => (clicks += 1)} style={{ position: "fixed", left: 40, top: 200, width: 300, height: 48 }}>
        Việc khác trong danh sách
      </button>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(500);
  const card = document.querySelector("[data-task-card]") as HTMLElement;
  const rect = card.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(420);
  expect(rect.width).toBeLessThanOrEqual(480);
  expect(Math.abs(rect.right - 1440)).toBeLessThanOrEqual(2);
  await userEvent.click(document.querySelector("[data-list-row]") as HTMLElement);
  expect(clicks).toBe(1);
  expect(document.querySelector("[data-task-card]")).not.toBeNull();
  await page.screenshot({ path: `${OUT}/104-T8-khung-phai-1440.png` });
});

test("T.9 · chọn ngày: lịch mở trong thẻ, không lớp nổi", async () => {
  await page.viewport(390, 844);
  const row = taskRow({});
  db.tables.tasks = [row];
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  await userEvent.click(document.querySelector('[data-card-row="when"] button') as HTMLElement);
  const calendar = document.querySelector('[data-card-row="when"] [data-inline-calendar]') as HTMLElement;
  expect(calendar).not.toBeNull();
  expect((document.querySelector("[data-task-card]") as HTMLElement).contains(calendar)).toBe(true);
  expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
  await page.screenshot({ path: `${OUT}/104-T9-lich-trong-the-390.png` });
});

test("T.11 · mất mạng khi đang sửa: Chưa lưu được · Thử lại; chữ không mất", async () => {
  await page.viewport(390, 844);
  const row = taskRow({});
  db.tables.tasks = [row];
  db.failWrites = true;
  await render(
    <Frame>
      <TaskCard task={asItem(row)} open onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(300);
  await userEvent.fill(page.getByLabelText("Ghi chú"), "Ghi lại số lượng 120 bộ");
  (document.getElementById("task-card-title") as HTMLElement).focus();
  await expect.poll(() => document.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("error");
  expect(document.querySelector("[data-save-state]")?.textContent ?? "").toContain("Thử lại");
  expect((page.getByLabelText("Ghi chú").element() as HTMLTextAreaElement).value).toBe("Ghi lại số lượng 120 bộ");
  db.failWrites = false;
  await userEvent.click(page.getByRole("button", { name: "Thử lại" }));
  await expect.poll(() => document.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("saved");
});
