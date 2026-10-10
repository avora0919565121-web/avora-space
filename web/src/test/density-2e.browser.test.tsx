import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * AVORA-101B · KHỐI 2E — mật độ 5 tab ở 390×844: trạng thái mặc định với dữ liệu thường ngày
 * (6 cuộc trò chuyện, 5 việc hôm nay, 2 thói quen). Đo phần còn phải cuộn của từng tab; một font gốc.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  writes: [] as { table: string; row: unknown }[],
  errors: {} as Record<string, { message: string; code: string }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown, table = "", failure: unknown = null): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data: failure === null ? data : null, error: failure, count: Array.isArray(rows) ? rows.length : 0 });
            return done.then.bind(done);
          }
          if (key === "update" || key === "upsert" || key === "insert") {
            return (row: unknown) => {
              db.writes.push({ table, row });
              return proxy;
            };
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
      from: (table: string) => builder(db.tables[table] ?? [], table),
      rpc: (rawName: string, args: unknown) => {
        const name = rawName === "inbox_page" ? "list_my_conversations" : rawName;
        db.calls.push({ name, args });
        return builder(db.rpcs[name] ?? [], name, db.errors[name] ?? null);
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

import { ConfirmHost } from "@/components/ConfirmHost";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { Toaster } from "@/components/ui/sonner";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import Messages from "@/pages/Messages";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import SettingsGuide from "@/pages/SettingsGuide";
import SettingsPreferences from "@/pages/SettingsPreferences";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";
import Vault from "@/pages/Vault";

const OUT = "../../../docs/screens/2026-10-10";
const now = new Date().toISOString();

function seed(): void {
  db.calls = [];
  db.writes = [];
  db.errors = {};
  db.tables = { dismissed_guidance: [{ guidance_key: "plan_plus_hold" }, { guidance_key: "task_plus_hold" }], think_hub_table: [], think_hub_record: [], tasks: [], notes: [], note_folders: [], habits: [], habit_logs: [] };
  const day = new Date();
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const task = (id: string, title: string, time: string | null): Record<string, unknown> => ({
    id, type: "personal", creator_id: "me", assignee_id: null, context_snapshot: null, conversation_id: null, title, description: "", status: "confirmed",
    confirmed_at: null, done_at: null, completed_confirmed_at: null, skipped_at: null, skipped_silently: false, deadline_date: ymd, deadline_time: time,
    deadline_tz: "Asia/Ho_Chi_Minh", task_category_id: null, is_important: false, is_milestone: false, progress_percent: null, output_value: null,
    recurrence: "none", recurrence_pattern: null, recurrence_spawned_at: null, deleted_by_creator: false, deleted_by_peer: false, created_at: now,
    updated_at: now, estimated_duration_minutes: null, requires_presence: false, start_at: null, end_at: null, location: null, latitude: null,
    longitude: null, travel_duration_minutes: null, departure_reminder_at: null, source_transaction_id: null,
  });
  db.tables.tasks = [
    task("t1", "Gọi lại anh Tuấn về báo giá", "09:00"),
    task("t2", "Gửi hợp đồng cho chị Mai", "10:30"),
    task("t3", "Họp nhóm thiết kế", "14:00"),
    task("t4", "Mua quà sinh nhật mẹ", null),
    task("t5", "Đọc lại đề xuất dự án", null),
  ];
  const habit = (id: string, name: string, kind: string, minutes: number | null, time: string): Record<string, unknown> => ({
    id, name, kind, target_minutes: minutes, weekdays: [1, 2, 3, 4, 5, 6, 7], windows: [{ time, remind: true }], reminders_on: true, when_away: "keep",
    paused_at: null, archived_at: null, version: 1, created_at: "2026-09-01T00:00:00.000Z",
  });
  db.tables.habits = [habit("h1", "Đọc sách", "timed", 15, "21:00"), habit("h2", "Uống đủ nước", "check", null, "08:00")];
  const chat = (id: string, name: string, text: string, unread: number): Record<string, unknown> => ({
    conversation_id: id, conversation_type: "direct", group_name: null, member_count: 2, peer_id: id, peer_display_name: name, peer_email: null,
    last_message_content: text, last_message_at: now, last_message_sender_id: id, unread_count: unread, sort_at: now, is_connected: true, peer_pin: null, verification_status: null,
  });
  db.rpcs = {
    list_my_conversations: [
      chat("c-1", "Minh Trần", "Mai gặp lúc 8 giờ nhé", 1),
      chat("c-2", "Hương Phạm", "Đã gửi file rồi đó", 0),
      chat("c-3", "Anh Tuấn", "Báo giá ổn, chốt nhé", 0),
      chat("c-4", "Chị Mai", "Cảm ơn em", 0),
      { conversation_id: "c-lan", conversation_type: "direct", group_name: null, member_count: 2, peer_id: "lan", peer_display_name: "Lan Nguyễn", peer_email: null, last_message_content: "Hẹn 9 giờ nhé", last_message_at: now, last_message_sender_id: "lan", unread_count: 2, sort_at: now, is_connected: true, peer_pin: "A-LAN12345", verification_status: null },
      { conversation_id: "j1", conversation_type: "personal", group_name: null, member_count: 1, peer_id: null, peer_display_name: "", peer_email: null, last_message_content: "", last_message_at: now, last_message_sender_id: "me", unread_count: 0, sort_at: now, is_connected: true, peer_pin: null, verification_status: null },
    ],
    vault_status: { has_code: true, has_data: true, unlocked: false, expires_at: null, locked_until: null, remaining: 5 },
  };
}

function App({ at }: { at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:flex-row short:flex-row">
            <MobileTopBar />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Routes>
                <Route path="/tin-nhan" element={<Messages />} />
                <Route path="/nhiem-vu" element={<Tasks />} />
                <Route path="/ke-hoach" element={<ThinkHub />} />
                <Route path="/ket-sat" element={<Vault />}>
                  <Route index element={<div />} />
                </Route>
                <Route path="/cai-dat" element={<Settings />}>
                  <Route index element={<Profile />} />
                  <Route path="thiet-lap" element={<SettingsPreferences />} />
                  <Route path="huong-dan" element={<SettingsGuide />} />
                </Route>
              </Routes>
            </main>
            <ToolBelt />
          </div>
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 600): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}


const TABS = [
  { name: "Kết nối", at: "/tin-nhan?tab=1-1" },
  { name: "Nhiệm vụ", at: "/nhiem-vu" },
  { name: "Kế hoạch", at: "/ke-hoach" },
  { name: "Két sắt", at: "/ket-sat" },
  { name: "Cài đặt", at: "/cai-dat" },
  { name: "Cài đặt › Tuỳ chọn chung", at: "/cai-dat/thiet-lap" },
] as const;

type Density = { view: number; content: number; overflow: number; scrolls: boolean };

/** The tab's own vertical scroller (the tallest one in <main>), or the main column itself. */
function density(): Density {
  const main = document.querySelector("main") as HTMLElement;
  let best: HTMLElement = main;
  let bestHeight = 0;
  for (const node of main.querySelectorAll<HTMLElement>("*")) {
    const style = getComputedStyle(node);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    if (node.clientHeight < 120) continue;
    if (node.clientHeight > bestHeight) {
      best = node;
      bestHeight = node.clientHeight;
    }
  }
  const overflow = Math.max(0, best.scrollHeight - best.clientHeight);
  return { view: best.clientHeight, content: best.scrollHeight, overflow, scrolls: overflow > 1 };
}

beforeEach(() => {
  seed();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("mật độ 5 tab · 390×844 — phần còn phải cuộn ở trạng thái mặc định", async () => {
  await page.viewport(390, 844);
  await expect.poll(() => window.innerWidth).toBe(390);
  const rows: Record<string, Density> = {};
  for (const tab of TABS) {
    const screen = await render(<App at={tab.at} />);
    await settle(1100);
    rows[tab.name] = density();
    await page.screenshot({ path: `${OUT}/2E-mat-do-${tab.at.slice(1).split("?")[0]?.replace("/", "-") ?? "x"}-390.png` });
    await screen.unmount();
  }
  console.log(`DENSITY_TABLE ${JSON.stringify(rows)}`);
  expect(Object.keys(rows)).toHaveLength(6);
});

test("một font gốc: body đọc --font-sans; đổi phông ở Cài đặt đổi cả trang", async () => {
  await page.viewport(390, 844);
  await render(<App at="/cai-dat/thiet-lap" />);
  await expect.poll(() => document.querySelector("[data-font-pref]")).not.toBeNull();
  const family = (): string => getComputedStyle(document.body).fontFamily;
  expect(family()).toContain("Inter Tight");
  const title = document.querySelector("[data-top-title]") as HTMLElement;
  (document.querySelector('[data-font-option="be-vietnam"]') as HTMLElement).click();
  await expect.poll(family).toContain("Be Vietnam Pro");
  expect(getComputedStyle(title).fontFamily).toContain("Be Vietnam Pro");
  expect(getComputedStyle(document.querySelector("[data-sub-tab]") as HTMLElement).fontFamily).toContain("Be Vietnam Pro");
  expect(window.localStorage.getItem("avora.font")).toBe("be-vietnam");
  await page.screenshot({ path: `${OUT}/2E-phong-chu-390.png` });
  (document.querySelector('[data-font-option="inter-tight"]') as HTMLElement).click();
  await expect.poll(family).toContain("Inter Tight");
  expect(window.localStorage.getItem("avora.font")).toBeNull();
});
