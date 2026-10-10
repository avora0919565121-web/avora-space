import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * AVORA-107 · PHẦN 1 — Thói quen on the real screens with fixed fake data (no account, no network):
 * Nhiệm vụ › Thói quen, Tạo thói quen, the detail, Hôm nay's block, Bảng `Thói quen`, Avora Space.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  handlers: {} as Record<string, (args: Record<string, unknown>) => void>,
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
      rpc: (rawName: string, args: unknown) => {
        const name = rawName === "inbox_page" ? "list_my_conversations" : rawName;
        db.calls.push({ name, args });
        db.handlers[name]?.(args as Record<string, unknown>);
        return builder(db.rpcs[name] ?? []);
      },
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
import { HabitSpaceLine } from "@/components/habits/HabitSpaceLine";
import { ViewBoardPanel } from "@/components/library/ViewBoardPanel";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { Toaster } from "@/components/ui/sonner";
import { addDays, localDateOf } from "@/lib/habits";
import { resetHabitStore } from "@/lib/use-habits";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import Tasks from "@/pages/Tasks";

const OUT = "../../../docs/screens/2026-10-10";
const today = localDateOf();
const yesterday = addDays(today, -1);
const created = new Date(Date.now() - 20 * 86_400_000).toISOString();

function habitRow(part: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "h",
    name: "",
    kind: "check",
    target_minutes: null,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    windows: [{ time: "08:00", remind: true }],
    reminders_on: true,
    paused_at: null,
    archived_at: null,
    version: 1,
    created_at: created,
    ...part,
  };
}

function logRow(habitId: string, day: string, windowIndex: number, part: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `${habitId}-${day}-${windowIndex}`, habit_id: habitId, local_date: day, window_index: windowIndex, status: "done", done_at: `${day}T02:00:00.000Z`, source: "manual", duration_seconds: null, note: null, ...part };
}

const WATER = habitRow({
  id: "h-water",
  name: "Uống đủ nước",
  windows: [{ time: "08:00", remind: true }, { time: "11:00", remind: true }, { time: "14:00", remind: true }, { time: "17:00", remind: true }],
});
const READ = habitRow({ id: "h-read", name: "Đọc sách", kind: "timed", target_minutes: 15, windows: [{ time: "21:00", remind: true }] });
const EARLY = habitRow({ id: "h-early", name: "Dậy sớm", windows: [{ time: "06:00", remind: true }] });
const REST = habitRow({ id: "h-rest", name: "Vận động", kind: "timed", target_minutes: 20, paused_at: created, windows: [{ time: "06:30", remind: true }] });

function seed(withHabits: boolean): void {
  db.calls = [];
  db.tables = {
    dismissed_guidance: [{ guidance_key: "plan_plus_hold" }, { guidance_key: "task_plus_hold" }],
    tasks: [],
    habits: withHabits ? [WATER, READ, EARLY, REST] : [],
    habit_logs: withHabits
      ? [
          logRow("h-water", today, 0),
          logRow("h-water", today, 1),
          logRow("h-water", yesterday, 0),
          logRow("h-water", yesterday, 1),
          logRow("h-early", today, 0),
          logRow("h-read", yesterday, 0, { status: "abandoned", source: "timer", duration_seconds: 360, note: "Có khách", id: "ab1" }),
        ]
      : [],
  };
  db.rpcs = { my_habit_totals: withHabits ? [{ habit_id: "h-water", done_total: 48 }, { habit_id: "h-early", done_total: 12 }] : [] };
}

/** The fake server keeps what the RPCs write, so a read after a write sees it (like the real one). */
function patchHabit(id: unknown, patch: Record<string, unknown>): void {
  db.tables.habits = (db.tables.habits as Record<string, unknown>[]).map((row) => (row.id === id ? { ...row, ...patch, version: Number(row.version) + 1 } : row));
}
db.handlers = {
  create_habit: (a) => {
    db.tables.habits = [...(db.tables.habits ?? []), habitRow({ id: a.p_id, name: a.p_name, kind: a.p_kind, target_minutes: a.p_target_minutes, weekdays: a.p_weekdays, windows: a.p_windows, reminders_on: a.p_reminders_on, created_at: new Date().toISOString() })];
  },
  log_habit: (a) => {
    db.tables.habit_logs = [...(db.tables.habit_logs ?? []), logRow(String(a.p_habit), String(a.p_local_date), Number(a.p_window), { id: a.p_id })];
  },
  unlog_habit: (a) => {
    db.tables.habit_logs = (db.tables.habit_logs as Record<string, unknown>[]).filter((row) => !(row.habit_id === a.p_habit && row.local_date === a.p_local_date && row.window_index === a.p_window && row.status === "done"));
  },
  pause_habit: (a) => patchHabit(a.p_id, { paused_at: a.p_paused === true ? new Date().toISOString() : null }),
  archive_habit: (a) => patchHabit(a.p_id, { archived_at: a.p_archived === true ? new Date().toISOString() : null }),
};

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:flex-row short:flex-row">
            <MobileTopBar />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
            <ToolBelt />
          </div>
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function screen(at: string) {
  return render(
    <Frame at={at}>
      <Routes>
        <Route path="/nhiem-vu" element={<Tasks />} />
      </Routes>
    </Frame>,
  );
}

const settle = (ms = 600): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

beforeEach(() => {
  window.localStorage.clear();
  resetHabitStore();
});

test("107.1 · 390: Thói quen hôm nay — đánh dấu, bỏ được trong ngày, không dòng đôi", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-water"]')).not.toBeNull();
  const water = (): HTMLElement => q('[data-habit-id="h-water"]') as HTMLElement;
  expect(water().querySelector("[data-habit-tally]")?.textContent).toContain("Hôm nay 2/4");
  // Today's three, by first window; Vận động rests below, quieter.
  expect([...document.querySelectorAll('[data-habits-part="today"] [data-habit-id]')].map((row) => row.getAttribute("data-habit-id"))).toEqual(["h-early", "h-water", "h-read"]);
  expect(q('[data-habits-part="resting"]')?.textContent).toContain("Vận động");
  expect(q('[data-habits-head="today"]')?.textContent).toBe("Hôm nay · 1/3");
  await settle(300);
  await page.screenshot({ path: `${OUT}/107-P1-thoi-quen-hom-nay-390.png` });

  await userEvent.click(water().querySelector('[data-habit-window="2"]') as HTMLElement);
  await expect.poll(() => water().querySelector("[data-habit-tally]")?.textContent).toContain("Hôm nay 3/4");
  await userEvent.click(water().querySelector('[data-habit-window="2"]') as HTMLElement);
  await expect.poll(() => water().querySelector("[data-habit-tally]")?.textContent).toContain("Hôm nay 2/4");
  await settle(200);
  // A tick taken back before it left the device is never sent; nothing doubled.
  expect(db.calls.filter((call) => call.name === "log_habit").length).toBeLessThanOrEqual(1);
  expect(water().querySelectorAll('[aria-pressed="true"]').length).toBe(2);
  // Quiet words only.
  expect(document.body.textContent ?? "").not.toMatch(/chuỗi|streak|huy hiệu|điểm|thất bại|quá hạn/i);
});

test("107.2 / chi tiết: hôm qua ghi `Chưa làm`, phiên bỏ có ghi chú, Tổng cộng dồn", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen&thoi-quen=h-water");
  await expect.poll(() => q('[data-habit-detail="h-water"]')).not.toBeNull();
  const detail = q('[data-habit-detail="h-water"]') as HTMLElement;
  const day = detail.querySelector(`[data-habit-history-day="${yesterday}"]`) as HTMLElement;
  expect([...day.querySelectorAll("[data-habit-history]")].map((line) => line.getAttribute("data-habit-history"))).toEqual(["done", "done", "missed", "missed"]);
  expect(day.textContent).toContain("Chưa làm");
  // 48 done in all, of which today's 2 + yesterday's 2 are loaded here.
  expect(detail.querySelector("[data-habit-total]")?.textContent).toBe("48 lần");
  expect(detail.querySelector("[data-habit-weeks]")?.textContent?.split(" · ")).toHaveLength(4);
  await settle(400);
  await page.screenshot({ path: `${OUT}/107-P1-chi-tiet-lich-su-390.png` });
});

test("Tạo thói quen: gợi ý trung tính, khung giờ bắt buộc, lưu ngay trên máy", async () => {
  seed(false);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q("[data-habits-empty]")).not.toBeNull();
  await page.screenshot({ path: `${OUT}/107-P1-thoi-quen-trong-390.png` });
  await userEvent.click(page.getByRole("button", { name: "Tạo thói quen" }).first());
  await expect.poll(() => q("[data-habit-editor]")).not.toBeNull();
  const editor = q("[data-habit-editor]") as HTMLElement;
  const chips = [...editor.querySelectorAll('section[aria-label="Gợi ý"] button')].map((button) => button.textContent);
  expect(chips).toEqual(["Dậy sớm", "Uống đủ nước", "Vận động", "Đọc sách", "Ngủ đúng giờ", "Thói quen của tôi"]);
  await userEvent.click(page.getByRole("button", { name: "Uống đủ nước" }));
  await expect.poll(() => editor.querySelectorAll("[data-habit-window-row]").length).toBe(4);
  expect(editor.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Chỉ đánh dấu");
  await settle(300);
  await page.screenshot({ path: `${OUT}/107-P1-tao-thoi-quen-390.png` });
  // Enter in the name never saves.
  const name = editor.querySelector("input") as HTMLInputElement;
  name.focus();
  await userEvent.keyboard("{Enter}");
  expect(q("[data-habit-editor]")).not.toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Tạo thói quen" }).last());
  await expect.poll(() => document.querySelectorAll('[data-habits-part="today"] [data-habit-id]').length).toBe(1);
  expect(q('[data-habits-part="today"]')?.textContent).toContain("Uống đủ nước");
  expect(q('[data-habits-part="today"] [data-habit-tally]')?.textContent).toContain("Hôm nay 0/4");
  await expect.poll(() => db.calls.some((call) => call.name === "create_habit")).toBe(true);
  const sent = db.calls.find((call) => call.name === "create_habit")?.args as { p_windows: unknown[]; p_kind: string };
  expect(sent.p_kind).toBe("check");
  expect(sent.p_windows).toHaveLength(4);
});

test("107.4 · Tạm nghỉ / Lưu trữ: rời danh sách Hôm nay, có Hoàn tác", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"]')).not.toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Thêm cho Đọc sách" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Tạm nghỉ" }));
  await expect.poll(() => q('[data-habits-part="today"] [data-habit-id="h-read"]')).toBeNull();
  expect(q('[data-habits-part="resting"]')?.textContent).toContain("Đọc sách");
  await userEvent.click(page.getByRole("button", { name: "Thêm cho Dậy sớm" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Lưu trữ" }));
  await expect.poll(() => q('[data-habit-id="h-early"]')).toBeNull();
  await expect.poll(() => document.body.textContent ?? "").toContain("Lịch sử vẫn còn");
  await expect.poll(() => db.calls.map((call) => call.name)).toEqual(expect.arrayContaining(["pause_habit", "archive_habit"]));
});

test("Hôm nay: khối `Thói quen · 1/3` ở cuối, mở ra từng dòng còn treo", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu");
  await expect.poll(() => q('[data-my-day-head="habits"]')?.textContent).toBe("Thói quen · 1/3");
  await userEvent.click(q('[data-my-day-part="habits"] button[aria-expanded]') as HTMLElement);
  // Dậy sớm is done → it left the part that still needs doing.
  expect([...document.querySelectorAll('[data-my-day-part="habits"] [data-habit-id]')].map((row) => row.getAttribute("data-habit-id"))).toEqual(["h-water", "h-read"]);
  await settle(300);
  await page.screenshot({ path: `${OUT}/107-P1-hom-nay-khoi-thoi-quen-390.png` });
});

test("107.5 · bảng `Thói quen`: chưa có thói quen → màn trống đúng câu; có thì đủ cột", async () => {
  seed(false);
  await page.viewport(390, 844);
  const { unmount } = await render(
    <Frame at="/ke-hoach">
      <ViewBoardPanel boardKey="habits" isFullscreen={false} onFullscreen={() => undefined} onClose={() => undefined} />
    </Frame>,
  );
  await expect.poll(() => q("[data-view-empty]")?.textContent).toContain("Tạo thói quen đầu tiên ở Nhiệm vụ › Thói quen");
  expect(q("[data-board-goal]")?.textContent).toBe("Tôi đang duy trì những thói quen nào, và tuần này giữ được bao nhiêu?");
  expect(document.body.textContent).not.toContain("Đổi tên");
  await unmount();
  resetHabitStore();
  seed(true);
  await page.viewport(1280, 800);
  await render(
    <Frame at="/ke-hoach">
      <ViewBoardPanel boardKey="habits" isFullscreen={false} onFullscreen={() => undefined} onClose={() => undefined} />
    </Frame>,
  );
  await expect.poll(() => document.querySelectorAll("[data-view-row]").length).toBe(4);
  expect(q('[data-view-row="h-water"]')?.textContent).toContain("2/4");
  expect(q('[data-view-row="h-water"]')?.textContent).toContain("48");
  await settle(300);
  await page.screenshot({ path: `${OUT}/107-P1-bang-thoi-quen-1280.png` });
});

test("Avora Space: một dòng `Thói quen hôm nay 1/3 ›` chỉ để mở; không có thói quen thì không hiện", async () => {
  seed(false);
  await page.viewport(390, 844);
  const empty = await render(
    <Frame at="/tong-quan">
      <HabitSpaceLine href="/nhiem-vu?muc=thoi-quen" />
    </Frame>,
  );
  await settle(400);
  expect(q("[data-space-habits]")).toBeNull();
  await empty.unmount();
  resetHabitStore();
  seed(true);
  await render(
    <Frame at="/tong-quan">
      <HabitSpaceLine href="/nhiem-vu?muc=thoi-quen" />
    </Frame>,
  );
  await expect.poll(() => q("[data-space-habits]")?.textContent).toBe("Thói quen hôm nay 1/3");
  expect(q<HTMLAnchorElement>("[data-space-habits]")?.getAttribute("href")).toBe("/nhiem-vu?muc=thoi-quen");
  // View only (ADR-013): nothing to tick here.
  expect(document.querySelectorAll("[data-habit-window]").length).toBe(0);
});

for (const [w, h] of [[844, 390], [1280, 800]] as const) {
  test(`ảnh · Thói quen hôm nay ${w}×${h}`, async () => {
    seed(true);
    await page.viewport(w, h);
    await screen("/nhiem-vu?muc=thoi-quen");
    await expect.poll(() => q('[data-habit-id="h-water"]')).not.toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    await settle(300);
    await page.screenshot({ path: `${OUT}/107-P1-thoi-quen-hom-nay-${w}.png` });
  });
}
