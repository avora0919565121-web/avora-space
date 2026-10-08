import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";

/**
 * AVORA-104 · PHẦN 1 — chọn ngày mà không lưu. Three roads, at 390×844 and 1280×800:
 *  D.1 Hạng mục › Tạo nhiệm vụ (QuickTaskDialog → TaskComposer) — pick a day → Tạo
 *  D.2 Nhiệm vụ › a task (TaskDetailSheet) › Sửa (TaskEditComposer) — move the day → Lưu
 *  D.3 as D.2 on an overdue task — move it to tomorrow → Lưu
 * Each checks the field shows the new day right after the tap AND that the server got that day.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: [] as { table: string; op: string; values: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
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
            let data: unknown = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            if (pending !== null && single && data !== null && typeof data === "object") data = { ...(data as object), ...pending.values };
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
        return builder(`rpc:${name}`, name === "update_shared_task_details" ? (db.tables.tasks ?? [])[0] ?? null : []);
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

import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { QuickTaskDialog } from "@/components/think-hub/QuickTaskDialog";
import { Toaster } from "@/components/ui/sonner";
import { todayIso, type TaskItem } from "@/lib/tasks";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";

const today = todayIso();
const plusDays = (n: number): string => {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function taskRow(part: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: "t1", type: "personal", creator_id: "me", assignee_id: null, context_snapshot: null, conversation_id: null,
    title: "Gọi lại cho khách", description: "", status: "confirmed", confirmed_at: null, done_at: null,
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
    id: row.id, type: "personal", creatorId: "me", assigneeId: null, contextSnapshot: null, conversationId: null,
    title: row.title, description: row.description, status: "confirmed", confirmedAt: null, doneAt: null,
    completedConfirmedAt: null, skippedAt: null, skippedSilently: false, deadline: row.deadline_date, deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh", categoryId: null, isImportant: false, isMilestone: false, progressPercent: null,
    outputValue: null, recurrence: "none", recurrencePattern: null, recurrenceSpawnedAt: null, deletedByCreator: false,
    deletedByPeer: false, createdAt: row.created_at, estimatedDurationMinutes: null, requiresPresence: false, startAt: null,
    endAt: null, location: null, latitude: null, longitude: null, travelDurationMinutes: null, departureReminderAt: null,
    sourceTransactionId: null,
  } as unknown as TaskItem;
}

/** Where the router is — a sheet must not have been closed / reopened by a stray Back. */
function WhereAmI() {
  const location = useLocation();
  return <span data-where={`${location.pathname}${location.search}`} hidden />;
}

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="*" element={<>{children}<WhereAmI /></>} />
        </Routes>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 250): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opens the date field and taps `day` in Lịch Avora (moving months when needed). */
async function pickDay(fieldLabel: RegExp, day: string): Promise<void> {
  const field = page.getByRole("button", { name: fieldLabel });
  await userEvent.click(field);
  for (let i = 0; i < 3; i += 1) {
    const cell = document.querySelector<HTMLButtonElement>(`[data-day="${day}"]:not([disabled])`);
    if (cell !== null) {
      await userEvent.click(cell);
      return;
    }
    const next = document.querySelector<HTMLButtonElement>('[aria-label="Tới trước"]');
    if (next === null) break;
    await userEvent.click(next);
    await settle(80);
  }
  throw new Error(`day ${day} not found in the calendar`);
}

const SIZES: readonly [number, number][] = [
  [390, 844],
  [1280, 800],
];

for (const [w, h] of SIZES) {
  test(`D.1 · Hạng mục › Tạo nhiệm vụ: chọn ngày → ô hiện ngày mới → Tạo gửi đúng ngày (${w}x${h})`, async () => {
    await page.viewport(w, h);
    db.writes = [];
    db.rpcs = [];
    const record = { id: "r1", tableId: "b1", title: "Khách Lan", nextActionDate: plusDays(2), status: "moi" } as unknown as ThinkRecord;
    const table = { id: "b1", name: "Khách hàng", conversationId: null } as unknown as ThinkTable;
    await render(
      <Frame at="/ke-hoach?bang=b1&hm=r1">
        <QuickTaskDialog record={record} table={table} project={undefined} conversationKind={null} conversationName="" onOpenChange={() => undefined} />
      </Frame>,
    );
    const target = plusDays(9);
    await pickDay(/^Hạn hoàn thành/, target);
    await settle();
    // The field shows the new day straight away.
    const field = document.getElementById("composer-deadline");
    expect(field?.textContent ?? "").not.toBe("");
    expect(document.querySelector('[role="dialog"][aria-label^="Chọn"]')).toBeNull();
    await userEvent.click(page.getByRole("button", { name: /^Tạo|Giao|Lưu/ }).last());
    await expect.poll(() => db.rpcs.find((c) => c.name === "create_record_task")?.args.p_deadline).toBe(target);
  });

  test(`D.2 · Nhiệm vụ › Sửa: đổi ngày → ô hiện ngày mới → Lưu gửi đúng ngày, sheet không đóng / mở lại (${w}x${h})`, async () => {
    await page.viewport(w, h);
    db.writes = [];
    db.rpcs = [];
    const row = taskRow({});
    db.tables.tasks = [row];
    await render(
      <Frame at="/nhiem-vu?mo=t1">
        <TaskDetailSheet task={asItem(row)} today={today} open onOpenChange={() => undefined} />
      </Frame>,
    );
    await userEvent.click(page.getByRole("button", { name: /^Sửa/ }).first());
    await settle(300);
    const before = document.querySelector("[data-where]")?.getAttribute("data-where");
    const target = plusDays(12);
    await pickDay(/^Hạn hoàn thành/, target);
    await settle(300);
    // Still editing: the composer did not close and the address did not move.
    expect(document.getElementById("composer-deadline")).not.toBeNull();
    expect(document.querySelector("[data-where]")?.getAttribute("data-where")).toBe(before);
    await userEvent.click(page.getByRole("button", { name: "Lưu thay đổi" }));
    await expect.poll(() => db.writes.find((w2) => w2.table === "tasks" && w2.op === "update" && "deadline_date" in w2.values)?.values.deadline_date).toBe(target);
  });

  test(`D.3 · việc đã trễ hạn › Sửa: dời sang ngày mai → Lưu gửi đúng ngày (${w}x${h})`, async () => {
    await page.viewport(w, h);
    db.writes = [];
    db.rpcs = [];
    const row = taskRow({ deadline_date: plusDays(-4) });
    db.tables.tasks = [row];
    await render(
      <Frame at="/nhiem-vu?mo=t1">
        <TaskDetailSheet task={asItem(row)} today={today} open onOpenChange={() => undefined} />
      </Frame>,
    );
    await userEvent.click(page.getByRole("button", { name: /^Sửa/ }).first());
    await settle(300);
    const target = plusDays(1);
    await pickDay(/^Hạn hoàn thành/, target);
    await settle(300);
    expect(document.getElementById("composer-deadline")).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Lưu thay đổi" }));
    await expect.poll(() => db.writes.find((w2) => w2.table === "tasks" && w2.op === "update" && "deadline_date" in w2.values)?.values.deadline_date).toBe(target);
  });
}
