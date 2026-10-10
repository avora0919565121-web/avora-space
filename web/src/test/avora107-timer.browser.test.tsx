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
import { HabitTimerHost } from "@/components/habits/HabitTimerHost";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { Toaster } from "@/components/ui/sonner";
import { addDays, localDateOf } from "@/lib/habits";
import { resetHabitStore } from "@/lib/use-habits";
import { beginHabitTimer, openHabitTimer, resetHabitTimer } from "@/lib/use-habit-timer";
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
          <HabitTimerHost />
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
  resetHabitTimer();
  calm(false);
});

/** Space Rhythm Tĩnh follows the device's reduce-motion setting (lib/motion). */
const realMatchMedia = window.matchMedia.bind(window);
function calm(on: boolean): void {
  window.matchMedia = ((query: string) => {
    if (query.includes("prefers-reduced-motion")) return { matches: on, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false } as MediaQueryList;
    return realMatchMedia(query);
  }) as typeof window.matchMedia;
}

const timer = (): string | null => q("[data-habit-timer]")?.getAttribute("data-habit-timer") ?? null;


test("đồng hồ · Bắt đầu → toàn màn → rời màn là dừng, chip ở góc → mở lại → Hoàn thành giữa chừng = Đã làm thời lượng thực", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
  // Only habits with a clock offer it; Uống đủ nước is marked by hand.
  expect(q('[data-habit-id="h-water"] [data-habit-start]')).toBeNull();
  expect(q('[data-habit-id="h-read"] [data-habit-start]')?.textContent).toBe("Bắt đầu · 15 phút");
  await userEvent.click(q('[data-habit-id="h-read"] [data-habit-start]') as HTMLElement);
  await expect.poll(timer).toBe("ready");
  expect(q("[data-habit-timer-clock]")?.textContent).toBe("15:00");
  expect(q("[data-habit-timer-name]")?.textContent).toBe("Đọc sách");
  await page.screenshot({ path: `${OUT}/107-P2-san-sang-390.png` });

  await userEvent.click(q("[data-habit-timer-start]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  await settle(1300);
  expect(q("[data-habit-timer-clock]")?.textContent).toMatch(/^14:5\d$/);
  // Full screen: nothing of the tab shows through.
  const rect = (q("[data-habit-timer]") as HTMLElement).getBoundingClientRect();
  expect([rect.top, rect.left, rect.width, rect.height]).toEqual([0, 0, 390, 844]);
  await page.screenshot({ path: `${OUT}/107-P2-dang-chay-390.png` });

  await userEvent.click(q("[data-habit-timer-close]") as HTMLElement);
  await expect.poll(() => q("[data-habit-timer-chip]")).not.toBeNull();
  expect(timer()).toBeNull();
  const before = q("[data-habit-timer-chip]")?.textContent;
  await settle(1200);
  // Stopped: the chip does not count.
  expect(q("[data-habit-timer-chip]")?.textContent).toBe(before);
  await page.screenshot({ path: `${OUT}/107-P2-chip-goc-390.png` });

  await userEvent.click(q("[data-habit-timer-chip]") as HTMLElement);
  await expect.poll(timer).toBe("stopped");
  expect(q("[data-habit-timer-line]")?.textContent).toBe("Đã dừng khi bạn rời màn đồng hồ.");
  await userEvent.click(q("[data-habit-timer-resume]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  await userEvent.click(q("[data-habit-timer-complete]") as HTMLElement);
  await expect.poll(timer).toBe("done");
  expect(q("[data-habit-timer-done]")?.textContent).toBe("Đã làm");
  await page.screenshot({ path: `${OUT}/107-P2-da-lam-390.png` });
  await expect.poll(() => db.calls.find((call) => call.name === "log_habit")?.args).toMatchObject({ p_habit: "h-read", p_window: 0, p_source: "timer" });
  const seconds = (db.calls.find((call) => call.name === "log_habit")?.args as { p_duration_seconds: number }).p_duration_seconds;
  expect(seconds).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeLessThan(10);
  await userEvent.click(q("[data-habit-timer-dismiss]") as HTMLElement);
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-window="0"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(q("[data-habit-timer-chip]")).toBeNull();
});

test("đồng hồ · mất focus / khoá màn hình = dừng; một phiên một lúc", async () => {
  seed(true);
  db.tables.habits = [...(db.tables.habits as unknown[]), habitRow({ id: "h-walk", name: "Đi bộ", kind: "timed", target_minutes: 10, windows: [{ time: "18:00", remind: true }] })];
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
  await userEvent.click(q('[data-habit-id="h-read"] [data-habit-start]') as HTMLElement);
  await userEvent.click(q("[data-habit-timer-start]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  window.dispatchEvent(new Event("blur"));
  await expect.poll(timer).toBe("stopped");
  expect(q("[data-habit-timer-line]")?.textContent).toBe("Đã dừng khi màn hình tắt hoặc bạn chuyển ứng dụng.");
  await userEvent.click(q("[data-habit-timer-resume]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  await expect.poll(timer).toBe("stopped");

  await userEvent.click(q("[data-habit-timer-close]") as HTMLElement);
  await expect.poll(() => q('[data-habit-id="h-walk"] [data-habit-start]')).not.toBeNull();
  await userEvent.click(q('[data-habit-id="h-walk"] [data-habit-start]') as HTMLElement);
  // The waiting session opens instead of a second one.
  await expect.poll(() => q("[data-habit-timer-name]")?.textContent).toBe("Đọc sách");
  await expect.poll(() => document.body.textContent).toContain("Đang có một phiên: Đọc sách");
});

test("đồng hồ · Bỏ phiên có ghi chú tuỳ chọn → lịch sử `Đã bỏ phiên · n phút · ghi chú`; Enter không gửi", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
  await userEvent.click(q('[data-habit-id="h-read"] [data-habit-start]') as HTMLElement);
  await userEvent.click(q("[data-habit-timer-start]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  await userEvent.click(q("[data-habit-timer-abandon]") as HTMLElement);
  await expect.poll(() => q("[data-habit-abandon]")).not.toBeNull();
  expect(timer()).toBe("stopped");
  await userEvent.type(q("[data-habit-abandon-note]") as HTMLElement, "Con gọi{Enter}");
  expect(q("[data-habit-abandon]")).not.toBeNull();
  await page.screenshot({ path: `${OUT}/107-P2-bo-phien-390.png` });
  await userEvent.click(q("[data-habit-abandon-confirm]") as HTMLElement);
  await expect.poll(timer).toBeNull();
  await expect.poll(() => db.calls.find((call) => call.name === "abandon_habit_session")?.args).toMatchObject({ p_habit: "h-read", p_note: "Con gọi" });
  // The window stays open: no `Đã làm`, no chip.
  expect(db.calls.some((call) => call.name === "log_habit")).toBe(false);
  expect(q('[data-habit-id="h-read"] [data-habit-window="0"]')?.getAttribute("aria-pressed")).toBe("false");
  expect(q("[data-habit-timer-chip]")).toBeNull();
});

test("đồng hồ · hết giờ tự ghi Đã làm (mục tiêu đủ phút)", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
  openHabitTimer({ id: "h-read", name: "Đọc sách", targetMinutes: 15, windows: [{ time: "21:00", remind: true }] }, 0, today);
  // Started 14 min 59 s ago (marks, not ticks): it ends on its own a moment later.
  beginHabitTimer(Date.now() - 899_400);
  await expect.poll(timer, { timeout: 4000 }).toBe("done");
  await expect.poll(() => db.calls.find((call) => call.name === "log_habit")?.args).toMatchObject({ p_habit: "h-read", p_source: "timer", p_duration_seconds: 900 });
});

test("đồng hồ · giảm chuyển động / Space Rhythm Tĩnh: vòng không trượt, nền không thở", async () => {
  seed(true);
  await page.viewport(390, 844);
  await screen("/nhiem-vu?muc=thoi-quen");
  await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
  calm(false);
  await userEvent.click(q('[data-habit-id="h-read"] [data-habit-start]') as HTMLElement);
  await userEvent.click(q("[data-habit-timer-start]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  expect((q("[data-habit-timer-ring]") as unknown as SVGElement).style.transition).toContain("stroke-dashoffset");
  expect(document.querySelector('[data-habit-timer] [class*="habit-breathe"]')).not.toBeNull();
  await userEvent.click(q("[data-habit-timer-stop]") as HTMLElement);
  calm(true);
  await userEvent.click(q("[data-habit-timer-resume]") as HTMLElement);
  await expect.poll(timer).toBe("running");
  await settle(400);
  expect((q("[data-habit-timer-ring]") as unknown as SVGElement).style.transition).toBe("none");
  expect(document.querySelector('[data-habit-timer] [class*="habit-breathe"]')).toBeNull();
});

for (const [w, h] of [[844, 390], [1280, 800]] as const) {
  test(`ảnh · đồng hồ ${w}×${h}`, async () => {
    seed(true);
    await page.viewport(w, h);
    await screen("/nhiem-vu?muc=thoi-quen");
    await expect.poll(() => q('[data-habit-id="h-read"] [data-habit-start]')).not.toBeNull();
    await userEvent.click(q('[data-habit-id="h-read"] [data-habit-start]') as HTMLElement);
    await userEvent.click(q("[data-habit-timer-start]") as HTMLElement);
    await settle(1200);
    await page.screenshot({ path: `${OUT}/107-P2-dang-chay-${w}.png` });
    await userEvent.click(q("[data-habit-timer-close]") as HTMLElement);
    await settle(300);
    await page.screenshot({ path: `${OUT}/107-P2-chip-goc-${w}.png` });
  });
}
