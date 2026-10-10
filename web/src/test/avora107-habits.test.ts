import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        gte: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { habitBoardRows } from "@/lib/avora-default-boards";
import {
  addDays,
  dayTally,
  doneIndexOf,
  fourWeeks,
  habitAlarms,
  habitChimeAllowed,
  habitReview,
  habitsForDay,
  historyLineText,
  historyOf,
  isoWeekday,
  pendingWindows,
  readingRepeatTask,
  tallyText,
  todaySummary,
  validateDraft,
  weekTally,
  type Habit,
  type HabitLog,
} from "@/lib/habits";
import {
  createHabit,
  flush,
  logHabit,
  resetHabitStore,
  startHabits,
  unlogHabit,
} from "@/lib/use-habits";

const TODAY = "2026-10-10"; // Thứ Bảy
const habit = (over: Partial<Habit> = {}): Habit => ({
  id: "h1",
  name: "Uống đủ nước",
  kind: "check",
  targetMinutes: null,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  windows: [{ time: "08:00", remind: true }, { time: "11:00", remind: true }, { time: "14:00", remind: true }, { time: "17:00", remind: false }],
  remindersOn: true,
  whenAway: "keep",
  pausedAt: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const log = (habitId: string, localDate: string, windowIndex: number, over: Partial<HabitLog> = {}): HabitLog => ({
  id: `${habitId}-${localDate}-${windowIndex}`,
  habitId,
  localDate,
  windowIndex,
  status: "done",
  doneAt: `${localDate}T09:00:00.000Z`,
  source: "manual",
  durationSeconds: null,
  note: null,
  ...over,
});

describe("AVORA-107 · PHẦN 1 · luật", () => {
  test("107.1 · `Hôm nay 2/4`, một khung một dấu", () => {
    const done = doneIndexOf([log("h1", TODAY, 0), log("h1", TODAY, 2), log("h1", TODAY, 2)]);
    expect(tallyText(dayTally(habit(), done, TODAY))).toBe("2/4");
    expect(pendingWindows(habit(), done, TODAY)).toEqual([1, 3]);
  });

  test("107.2 · qua 24:00: hôm qua ghi `Chưa làm`, hôm nay bắt đầu 0/4, không dồn", () => {
    const yesterday = addDays(TODAY, -1);
    const logs = [log("h1", yesterday, 0), log("h1", yesterday, 1)];
    const done = doneIndexOf(logs);
    expect(tallyText(dayTally(habit(), done, TODAY))).toBe("0/4");
    const history = historyOf(habit(), logs, TODAY, 2);
    const day = history.find((entry) => entry.day === yesterday);
    expect(day?.lines.map(historyLineText)).toEqual(["Đã làm", "Đã làm", "Chưa làm", "Chưa làm"]);
    // Today never reads `Chưa làm`: it still hangs until 24:00.
    expect(history.find((entry) => entry.day === TODAY)).toBeUndefined();
  });

  test("tuần này / 4 tuần gần nhất / Hôm nay của mọi thói quen", () => {
    expect(isoWeekday(TODAY)).toBe(6);
    const read = habit({ id: "h2", name: "Đọc sách", kind: "timed", targetMinutes: 15, windows: [{ time: "21:00", remind: true }] });
    const logs = ["2026-10-05", "2026-10-06", "2026-10-08"].map((day) => log("h2", day, 0));
    const done = doneIndexOf(logs);
    expect(tallyText(weekTally(read, done, TODAY))).toBe("3/7");
    expect(fourWeeks(read, done, TODAY).map(tallyText)).toEqual(["0/7", "0/7", "0/7", "3/7"]);
    expect(todaySummary([read, habit()], doneIndexOf([log("h2", TODAY, 0)]), TODAY)).toEqual({ done: 1, total: 2 });
  });

  test("107.4 · tạm nghỉ / lưu trữ không hiện, không nhắc; ngày không có trong lịch cũng không", () => {
    const list = [habit({ id: "a" }), habit({ id: "b", pausedAt: "2026-10-09T00:00:00Z" }), habit({ id: "c", archivedAt: "2026-10-09T00:00:00Z" }), habit({ id: "d", weekdays: [1] })];
    expect(habitsForDay(list, TODAY).map((item) => item.id)).toEqual(["a"]);
    const alarms = habitAlarms(list, doneIndexOf([log("a", TODAY, 0)]), TODAY);
    expect(alarms.map((alarm) => alarm.key)).toEqual([`hb:a:${TODAY}:1`, `hb:a:${TODAY}:2`]);
  });

  test("107.3 · chế độ yên lặng thắng: tập trung, Tắt toàn AVORA, ngày nghỉ", () => {
    const saturday = new Date(2026, 9, 10, 9);
    const base = { focusActive: false, avoraMuted: false, restWeekday: 0, now: saturday, soundOn: true };
    expect(habitChimeAllowed(base)).toBe(true);
    expect(habitChimeAllowed({ ...base, focusActive: true })).toBe(false);
    expect(habitChimeAllowed({ ...base, avoraMuted: true })).toBe(false);
    expect(habitChimeAllowed({ ...base, restWeekday: 6 })).toBe(false);
  });

  test("tạo: khung giờ bắt buộc, có đồng hồ cần số phút", () => {
    const draft = { name: "Vận động", kind: "timed" as const, targetMinutes: 15, weekdays: [1], windows: [{ time: "06:30", remind: true }], remindersOn: true, whenAway: "keep" as const };
    expect(validateDraft(draft)).toBeNull();
    expect(validateDraft({ ...draft, windows: [] })).toBe("Thêm ít nhất một khung giờ.");
    expect(validateDraft({ ...draft, targetMinutes: null })).toBe("Số phút từ 1 đến 600.");
    expect(validateDraft({ ...draft, name: "  " })).toBe("Đặt tên cho thói quen.");
  });

  test("lịch sử: phiên bỏ ghi `Đã bỏ phiên · 12 phút · ghi chú`, không tính đã làm", () => {
    const logs = [log("h1", addDays(TODAY, -1), 0, { id: "x", status: "abandoned", durationSeconds: 720, note: "Có khách" })];
    const line = historyOf(habit(), logs, TODAY, 2)[0]?.lines.find((item) => item.kind === "abandoned");
    expect(line === undefined ? "" : historyLineText(line)).toBe("Đã bỏ phiên · 12 phút · Có khách");
    expect(doneIndexOf(logs).size).toBe(0);
  });

  test("107.5 · bảng `Thói quen`: dòng lưu trữ biến mất, cột đúng đặc tả", () => {
    const rows = habitBoardRows([habit(), habit({ id: "z", archivedAt: "2026-10-01T00:00:00Z" })], doneIndexOf([log("h1", TODAY, 0)]), TODAY, () => 48);
    expect(rows.map((row) => row.key)).toEqual(["h1"]);
    expect(rows[0]?.cells).toMatchObject({ title: "Uống đủ nước", kind: "Chỉ đánh dấu", today: "1/4", total: 48 });
    expect(rows[0]?.href).toBe("/nhiem-vu?muc=thoi-quen&thoi-quen=h1");
  });

  test("Nhìn lại: Đã giữ · Chưa làm theo khung", () => {
    const done = doneIndexOf([log("h1", "2026-10-09", 0), log("h1", "2026-10-09", 1), log("h1", TODAY, 0)]);
    expect(habitReview([habit()], done, "2026-10-09", TODAY)).toEqual([{ habitId: "h1", name: "Uống đủ nước", kept: 3, missed: 5 }]);
  });

  test("D6: gợi ý chuyển việc lặp lại đọc sách — chỉ khi chưa có thói quen đọc", () => {
    const tasks = [{ id: "t1", title: "Đọc sách 20 trang", type: "personal", status: "confirmed", recurrence: "daily" }];
    expect(readingRepeatTask(tasks, [])?.id).toBe("t1");
    expect(readingRepeatTask(tasks, [habit({ name: "Đọc sách" })])).toBeNull();
    expect(readingRepeatTask([{ ...tasks[0], recurrence: "none" }], [])).toBeNull();
  });

  test("107.7 · không chữ chuỗi / streak / huy hiệu / điểm / thất bại / quá hạn trong phần Thói quen", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      ...readdirSync(path.join(root, "components/habits")).map((file) => path.join(root, "components/habits", file)),
      path.join(root, "lib/habits.ts"),
      path.join(root, "lib/use-habits.ts"),
    ];
    for (const file of files) {
      // Visible words only: comments may name what we chose not to build.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n")
        .replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/chuỗi|streak|huy hiệu|điểm|thất bại|quá hạn/i);
    }
  });
});

describe("AVORA-107 · PHẦN 1 · offline (107.6)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: () => undefined });
    vi.stubGlobal("navigator", { onLine: false });
    resetHabitStore();
    startHabits("user-a");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("mất mạng: tạo + đánh dấu chạy trên máy; có mạng thì gửi đúng thứ tự, không trùng", async () => {
    const id = createHabit({ name: "Uống đủ nước", kind: "check", targetMinutes: null, weekdays: [1, 2, 3, 4, 5, 6, 7], windows: [{ time: "14:00", remind: true }, { time: "08:00", remind: true }], remindersOn: true, whenAway: "keep" });
    logHabit(id, TODAY, 0);
    logHabit(id, TODAY, 0);
    logHabit(id, TODAY, 1);
    unlogHabit(id, TODAY, 1);
    await flush();
    expect(rpc).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { onLine: true });
    await flush();
    const names = rpc.mock.calls.map((call) => call[0]);
    expect(names.slice(0, 2)).toEqual(["create_habit", "log_habit"]);
    expect(names.filter((name) => name === "log_habit")).toHaveLength(1);
    expect(names).not.toContain("unlog_habit");
    const created = rpc.mock.calls[0]?.[1] as { p_id: string; p_windows: { time: string }[] };
    expect(created.p_id).toBe(id);
    // Windows go sorted by time, the order the server keeps.
    expect(created.p_windows.map((window) => window.time)).toEqual(["08:00", "14:00"]);
  });

  test("bị từ chối (xung đột phiên bản) → bỏ thay đổi đó, không lặp lại mãi", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    rpc.mockImplementation((name: string) => Promise.resolve(name === "create_habit" ? { data: null, error: { code: "40001", message: "avora_habit_conflict" } } : { data: [], error: null }));
    createHabit({ name: "Dậy sớm", kind: "check", targetMinutes: null, weekdays: [1], windows: [{ time: "06:00", remind: true }], remindersOn: true, whenAway: "keep" });
    await flush();
    await flush();
    expect(rpc.mock.calls.filter((call) => call[0] === "create_habit")).toHaveLength(1);
  });
});
