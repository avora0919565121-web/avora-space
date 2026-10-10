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
      rpc: (rawName: string) => { const name = rawName === "inbox_page" ? "list_my_conversations" : rawName; return builder(db.rpcs[name] ?? []); },
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


import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import { todayIso } from "@/lib/tasks";
import Messages from "@/pages/Messages";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";
import Vault from "@/pages/Vault";
import Settings from "@/pages/Settings";
import SettingsPolicy from "@/pages/SettingsPolicy";
import Finance from "@/pages/Finance";

/*
 * AVORA-94 · B2.2 (89 · 3.A4, bộ 86.x) — every tab at 390 wide: content and the section strip sit
 * inside the 16 px side margins, and nothing scrolls sideways. Text that lives in a strip that
 * scrolls on its own (chips, tabs) is judged by its strip, not by each chip.
 */

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
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const GUTTER = 16;
const WIDTH = 390;

/** Inside a strip that scrolls sideways on its own (or is clipped on purpose)? */
function inSideScroller(element: HTMLElement, root: HTMLElement): boolean {
  for (let node = element.parentElement; node !== null && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}

/** Elements that carry their own words, visible on screen. */
function textLeaves(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (element.closest(".sr-only, [aria-hidden='true'], nav[aria-label='Các Hub']") !== null) continue;
    const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    if (!hasText) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (getComputedStyle(element).visibility === "hidden") continue;
    out.push(element);
  }
  return out;
}

const TABS = [
  { name: "ket-noi", at: "/tin-nhan" },
  { name: "nhiem-vu", at: "/nhiem-vu" },
  { name: "ke-hoach", at: "/ke-hoach" },
  { name: "ket-sat", at: "/ket-sat" },
  { name: "cai-dat", at: "/cai-dat/chinh-sach" },
] as const;

beforeEach(() => {
  seed();
  window.localStorage.clear();
});

for (const tab of TABS) {
  test(`86.x · ${tab.name} · 390: trong lề 16 px, không cuộn ngang`, async () => {
    await page.viewport(WIDTH, 844);
    await expect.poll(() => window.innerWidth).toBe(WIDTH);
    await render(
      <Frame at={tab.at}>
        <Routes>
          <Route path="/tin-nhan" element={<Messages />} />
          <Route path="/nhiem-vu" element={<Tasks />} />
          <Route path="/ke-hoach" element={<ThinkHub />} />
          <Route path="/ket-sat" element={<Vault />}>
            <Route index element={<Finance />} />
          </Route>
          <Route path="/cai-dat" element={<Settings />}>
            <Route path="chinh-sach" element={<SettingsPolicy />} />
          </Route>
        </Routes>
      </Frame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);
    const main = document.querySelector("main") as HTMLElement;
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth + 1);
    const outside: string[] = [];
    const leaves = textLeaves(main);
    // Guard against a vacuous pass: the screen really rendered words to measure.
    expect(leaves.length).toBeGreaterThan(3);
    for (const element of leaves) {
      if (inSideScroller(element, main)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < GUTTER - 1 || rect.right > WIDTH - GUTTER + 1) {
        outside.push(`${(element.textContent ?? "").trim().slice(0, 30)} [${Math.round(rect.left)}–${Math.round(rect.right)}]`);
      }
    }
    expect(outside).toEqual([]);
  });
}

// AVORA-94 · B2.4: the five tabs at three sizes, for the report (beside Tab-Sua-91.png).
const SHOT_SIZES = [
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
for (const tab of TABS) {
  for (const [w, h] of SHOT_SIZES) {
    test(`94 · ảnh ${tab.name} · ${w}x${h}`, async () => {
      await page.viewport(w, h);
      await expect.poll(() => window.innerWidth).toBe(w);
      await render(
        <Frame at={tab.at}>
          <Routes>
            <Route path="/tin-nhan" element={<Messages />} />
            <Route path="/nhiem-vu" element={<Tasks />} />
            <Route path="/ke-hoach" element={<ThinkHub />} />
            <Route path="/ket-sat" element={<Vault />}>
              <Route index element={<Finance />} />
            </Route>
            <Route path="/cai-dat" element={<Settings />}>
              <Route path="chinh-sach" element={<SettingsPolicy />} />
            </Route>
          </Routes>
        </Frame>,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      await page.screenshot({ path: `../../../docs/screens/2026-10-04/94-tab-${tab.name}-${w}.png` });
    });
  }
}

// AVORA-106 · K4 · 1 (105 A–B): the thread never scrolls sideways, whatever is in it.
for (const width of [360, 390, 430]) {
  test(`105 · thread ${width}: scrollWidth ≤ clientWidth, scrollLeft stays 0`, async () => {
    db.tables.messages = [
      message("w1", "lan", "https://example.com/" + "a".repeat(180) + "?q=" + "b".repeat(60), 30),
      message("w2", "lan", "Chuỗiliềnkhôngdấucáchrấtdài".repeat(12), 29),
      message("w3", "me", "ok", 28),
      message("w4", "me", "Mã đơn: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 27),
    ];
    await page.viewport(width, 844);
    await expect.poll(() => window.innerWidth).toBe(width);
    await render(
      <Frame at="/tin-nhan/c-lan">
        <Routes>
          <Route path="/tin-nhan/:conversationId" element={<Messages />} />
        </Routes>
      </Frame>,
    );
    await expect.poll(() => document.querySelector("[data-thread-scroll]") !== null, { timeout: 4000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const scroller = document.querySelector("[data-thread-scroll]") as HTMLElement;
    // Not vacuous: the long lines are really on screen.
    await expect.poll(() => scroller.textContent?.includes("Mã đơn") ?? false, { timeout: 4000 }).toBe(true);
    expect(scroller.scrollWidth - scroller.clientWidth).toBeLessThanOrEqual(1);
    scroller.scrollLeft = 40;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(scroller.scrollLeft).toBe(0);
    expect(getComputedStyle(scroller).overflowX).toBe("hidden");
    expect(getComputedStyle(scroller).touchAction).toBe("pan-y");
  });
}
