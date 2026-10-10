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

import {
  clockText,
  elapsedMs,
  isExpired,
  isFinished,
  parseSession,
  recordedSeconds,
  remainingMs,
  resumeSession,
  startSession,
  stopSession,
} from "@/lib/habit-timer";
import { setHabitAlarmSender, type HabitAlarm } from "@/lib/habit-alarm";
import { flush, resetHabitStore, startHabits } from "@/lib/use-habits";
import {
  abandonHabitTimer,
  beginHabitTimer,
  checkHabitTimer,
  closeHabitTimer,
  completeHabitTimer,
  leaveHabitTimer,
  loadHabitTimer,
  openHabitTimer,
  returnToHabitTimer,
  resetHabitTimer,
  resumeHabitTimer,
  stopHabitTimer,
} from "@/lib/use-habit-timer";

/*
 * AVORA-107 · PHẦN 2 — đồng hồ đếm ngược (đặc tả mục 5 + 10): counted from marks, stops when left,
 * one session, a stopped session past 24:00 cancels itself, only on this device.
 */
const TODAY = "2026-10-10";
const T0 = Date.parse("2026-10-10T08:00:00");
// PHẦN 2 rules = `Dừng khi rời`; `Cứ chạy` (VMT 10/10 21:11) is tested at the end.
const READ = { id: "h-read", name: "Đọc sách", targetMinutes: 15, windows: [{ time: "21:00", remind: true }], whenAway: "stop" as const };
const MOVE = { id: "h-move", name: "Vận động", targetMinutes: 20, windows: [{ time: "06:30", remind: true }], whenAway: "stop" as const };
const READ_KEEP = { ...READ, whenAway: "keep" as const };
const MOVE_KEEP = { ...MOVE, whenAway: "keep" as const };

function base() {
  return startSession({ habitId: "h", habitName: "Đọc sách", windowIndex: 0, windowTime: "21:00", localDate: TODAY, targetMinutes: 15, whenAway: "stop" }, T0);
}

describe("mốc tích luỹ", () => {
  test("đếm theo mốc, không theo nhịp: dừng / chạy lại cộng đúng phần đã chạy", () => {
    let session = base();
    expect(elapsedMs(session, T0 + 61_000)).toBe(61_000);
    session = stopSession(session, T0 + 61_000, "hidden");
    // Ten minutes away (screen dark) count nothing.
    expect(elapsedMs(session, T0 + 661_000)).toBe(61_000);
    session = resumeSession(session, T0 + 661_000);
    expect(elapsedMs(session, T0 + 700_000)).toBe(100_000);
    expect(remainingMs(session, T0 + 700_000)).toBe(800_000);
    expect(clockText(remainingMs(session, T0 + 700_000))).toBe("13:20");
    // Stopping twice changes nothing.
    const stopped = stopSession(session, T0 + 700_000, "user");
    expect(stopSession(stopped, T0 + 900_000, "user")).toBe(stopped);
  });

  test("hết giờ = xong; số giây ghi không vượt mục tiêu", () => {
    const session = base();
    expect(isFinished(session, T0 + 899_000)).toBe(false);
    expect(isFinished(session, T0 + 900_000)).toBe(true);
    expect(recordedSeconds(session, T0 + 950_000)).toBe(900);
    expect(clockText(remainingMs(session, T0 + 899_100))).toBe("00:01");
    expect(clockText(0)).toBe("00:00");
  });

  test("qua 24:00: phiên đang dừng tự huỷ, phiên đang chạy thì không", () => {
    const running = base();
    expect(isExpired(running, "2026-10-11")).toBe(false);
    const stopped = stopSession(running, T0 + 5_000, "left");
    expect(isExpired(stopped, TODAY)).toBe(false);
    expect(isExpired(stopped, "2026-10-11")).toBe(true);
  });

  test("đọc lại phiên đã lưu; hỏng thì bỏ", () => {
    const session = base();
    expect(parseSession(JSON.stringify(session))).toEqual(session);
    expect(parseSession("{bad")).toBeNull();
    expect(parseSession(JSON.stringify({ habitId: 1 }))).toBeNull();
  });
});

describe("một phiên trên máy này", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    storage.clear();
    vi.stubGlobal("window", {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    vi.stubGlobal("navigator", { onLine: false });
    resetHabitStore();
    startHabits("user-a");
    resetHabitTimer();
    loadHabitTimer("user-a", TODAY);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("Bắt đầu → rời màn = dừng (chip) → mở lại không tự chạy → Hoàn thành giữa chừng ghi thời lượng thực", async () => {
    openHabitTimer(READ, 0, TODAY);
    beginHabitTimer(T0);
    closeHabitTimer(T0 + 300_000);
    const raw = storage.get("avora-habit-session:user-a");
    expect(raw).toBeDefined();
    const stored = parseSession(raw ?? null);
    expect(stored?.runningSince).toBeNull();
    expect(stored?.stoppedBy).toBe("left");
    expect(stored?.gatheredMs).toBe(300_000);
    resumeHabitTimer(T0 + 400_000);
    completeHabitTimer(T0 + 520_000);
    expect(storage.has("avora-habit-session:user-a")).toBe(false);
    vi.stubGlobal("navigator", { onLine: true });
    await flush();
    const call = rpc.mock.calls.find((item) => item[0] === "log_habit");
    expect(call?.[1]).toMatchObject({ p_habit: "h-read", p_local_date: TODAY, p_window: 0, p_source: "timer", p_duration_seconds: 420 });
  });

  test("hết giờ tự ghi Đã làm; một phiên một lúc", async () => {
    openHabitTimer(READ, 0, TODAY);
    beginHabitTimer(T0);
    openHabitTimer(MOVE, 0, TODAY);
    // Still the first session: no second one begins.
    beginHabitTimer(T0 + 1_000);
    expect(checkHabitTimer(TODAY, T0 + 900_000)).toBe("finished");
    vi.stubGlobal("navigator", { onLine: true });
    await flush();
    const logs = rpc.mock.calls.filter((item) => item[0] === "log_habit");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.[1]).toMatchObject({ p_habit: "h-read", p_duration_seconds: 900 });
  });

  test("Bỏ phiên ghi số phút + ghi chú; mất focus = dừng", async () => {
    openHabitTimer(MOVE, 0, TODAY);
    beginHabitTimer(T0);
    stopHabitTimer("hidden", T0 + 360_000);
    abandonHabitTimer("  Có khách  ", T0 + 999_000);
    vi.stubGlobal("navigator", { onLine: true });
    await flush();
    const call = rpc.mock.calls.find((item) => item[0] === "abandon_habit_session");
    expect(call?.[1]).toMatchObject({ p_habit: "h-move", p_duration_seconds: 360, p_note: "Có khách" });
    expect(rpc.mock.calls.some((item) => item[0] === "log_habit")).toBe(false);
  });

  test("phiên đang dừng qua 24:00 tự huỷ, không ghi gì", async () => {
    openHabitTimer(READ, 0, TODAY);
    beginHabitTimer(T0);
    closeHabitTimer(T0 + 60_000);
    expect(checkHabitTimer("2026-10-11", T0 + 86_400_000)).toBe("expired");
    expect(storage.has("avora-habit-session:user-a")).toBe(false);
    vi.stubGlobal("navigator", { onLine: true });
    await flush();
    expect(rpc.mock.calls.some((item) => item[0] === "log_habit" || item[0] === "abandon_habit_session")).toBe(false);
  });

  test("mở lại app khi phiên đang chạy: giữ phiên nhưng dừng, không tính phần không ai nhìn", () => {
    const running = startSession({ habitId: "h-read", habitName: "Đọc sách", windowIndex: 0, windowTime: "21:00", localDate: TODAY, targetMinutes: 15, whenAway: "stop" }, T0);
    storage.set("avora-habit-session:user-b", JSON.stringify({ ...running, gatheredMs: 120_000 }));
    loadHabitTimer("user-b", TODAY);
    const stored = parseSession(storage.get("avora-habit-session:user-b") ?? null);
    expect(stored?.runningSince).toBeNull();
    expect(stored?.gatheredMs).toBe(120_000);
  });
});

describe("Cứ chạy (VMT 10/10 21:11)", () => {
  const storage = new Map<string, string>();
  const alarms: HabitAlarm[] = [];
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    storage.clear();
    alarms.length = 0;
    setHabitAlarmSender((alarm) => {
      alarms.push(alarm);
      return Promise.resolve();
    });
    vi.stubGlobal("window", {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    vi.stubGlobal("navigator", { onLine: true });
    resetHabitStore();
    startHabits("user-a");
    resetHabitTimer();
    loadHabitTimer("user-a", TODAY);
  });
  afterEach(() => {
    setHabitAlarmSender(null);
    vi.unstubAllGlobals();
  });

  test("ẩn tab 2 phút không dừng; quay lại thấy ~2 phút và thẻ xác nhận, không tự ghi", async () => {
    openHabitTimer(READ_KEEP, 0, TODAY);
    beginHabitTimer(T0);
    expect(alarms[alarms.length - 1]).toMatchObject({ habitId: "h-read", windowIndex: 0, at: T0 + 900_000 });
    leaveHabitTimer("blur", T0 + 1_000);
    closeHabitTimer(T0 + 2_000);
    leaveHabitTimer("hidden", T0 + 3_000);
    const stored = parseSession(storage.get("avora-habit-session:user-a") ?? null);
    expect(stored?.runningSince).toBe(T0);
    expect(stored?.awaySince).toBe(T0 + 3_000);
    // Two minutes away: nothing is written on its own, even when the clock is looked at.
    expect(checkHabitTimer(TODAY, T0 + 123_000)).toBeNull();
    returnToHabitTimer();
    const after = parseSession(storage.get("avora-habit-session:user-a") ?? null);
    expect(after?.awaySince).toBeNull();
    expect(elapsedMs(after!, T0 + 123_000)).toBe(123_000);
    await flush();
    expect(rpc.mock.calls.some((item) => item[0] === "log_habit")).toBe(false);
    // `Ghi Đã làm (n phút)`: the real n.
    completeHabitTimer(T0 + 123_000);
    await flush();
    expect(rpc.mock.calls.find((item) => item[0] === "log_habit")?.[1]).toMatchObject({ p_habit: "h-read", p_source: "timer", p_duration_seconds: 123 });
    expect(alarms[alarms.length - 1]).toMatchObject({ habitId: "h-read", at: null });
  });

  test("quá mục tiêu khi vắng: không tự ghi; ghi n thật, không cắt trần", async () => {
    openHabitTimer(READ_KEEP, 0, TODAY);
    beginHabitTimer(T0);
    leaveHabitTimer("hidden", T0 + 10_000);
    expect(checkHabitTimer(TODAY, T0 + 1_020_000)).toBeNull();
    returnToHabitTimer();
    await flush();
    expect(rpc.mock.calls.some((item) => item[0] === "log_habit")).toBe(false);
    completeHabitTimer(T0 + 1_020_000);
    await flush();
    expect(rpc.mock.calls.find((item) => item[0] === "log_habit")?.[1]).toMatchObject({ p_duration_seconds: 1_020 });
  });

  test("mở lại app (đã đóng tab): phiên vẫn chạy, hỏi trước khi ghi", () => {
    const running = startSession({ habitId: "h-read", habitName: "Đọc sách", windowIndex: 0, windowTime: "21:00", localDate: TODAY, targetMinutes: 15, whenAway: "keep" }, T0);
    storage.set("avora-habit-session:user-b", JSON.stringify(running));
    loadHabitTimer("user-b", TODAY, T0 + 600_000);
    const stored = parseSession(storage.get("avora-habit-session:user-b") ?? null);
    expect(stored?.runningSince).toBe(T0);
    expect(elapsedMs(stored!, T0 + 600_000)).toBe(600_000);
  });

  test("Dừng khi rời vẫn như cũ; hai phiên không chồng nhau", () => {
    openHabitTimer(MOVE, 0, TODAY);
    beginHabitTimer(T0);
    expect(alarms).toHaveLength(0);
    leaveHabitTimer("hidden", T0 + 60_000);
    let stored = parseSession(storage.get("avora-habit-session:user-a") ?? null);
    expect(stored?.runningSince).toBeNull();
    expect(stored?.stoppedBy).toBe("hidden");
    openHabitTimer(READ_KEEP, 0, TODAY);
    beginHabitTimer(T0 + 70_000);
    stored = parseSession(storage.get("avora-habit-session:user-a") ?? null);
    expect(stored?.habitId).toBe("h-move");
    expect(stored?.gatheredMs).toBe(60_000);
  });

  test("qua 24:00: phiên Cứ chạy (đang chạy) tự huỷ, không ghi, huỷ giờ báo", async () => {
    openHabitTimer(MOVE_KEEP, 0, TODAY);
    beginHabitTimer(T0);
    expect(isExpired(parseSession(storage.get("avora-habit-session:user-a") ?? null)!, "2026-10-11")).toBe(true);
    expect(checkHabitTimer("2026-10-11", T0 + 57_600_000)).toBe("expired");
    expect(storage.has("avora-habit-session:user-a")).toBe(false);
    expect(alarms[alarms.length - 1]).toMatchObject({ habitId: "h-move", at: null });
    await flush();
    expect(rpc.mock.calls.some((item) => item[0] === "log_habit" || item[0] === "abandon_habit_session")).toBe(false);
  });
});
