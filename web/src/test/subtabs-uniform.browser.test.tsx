import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * VMT 10/10 19:39 — one SubTabs strip, drawn the same on every tab. Real pages (Kết nối, Nhiệm vụ,
 * Kế hoạch, Két sắt, Cài đặt) at 360 / 390 / 430 wide; every measurement must match the others.
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
import SettingsGuide from "@/pages/SettingsGuide";
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
  db.rpcs = {
    list_my_conversations: [
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
  { name: "ket-noi", at: "/tin-nhan?tab=1-1", strip: "[data-sub-tabs]" },
  { name: "nhiem-vu", at: "/nhiem-vu", strip: "[data-sub-tabs]" },
  { name: "ke-hoach", at: "/ke-hoach?ke=2", strip: "[data-room-bar] [data-sub-tabs]" },
  { name: "ket-sat", at: "/ket-sat", strip: "[data-sub-tabs]" },
  { name: "cai-dat", at: "/cai-dat/huong-dan", strip: "[data-sub-tabs]" },
] as const;

type Measure = {
  top: number;
  header: number;
  left: number;
  width: number;
  height: number;
  firstLeft: number;
  gaps: number[];
  font: string;
  activeWeight: string;
  idleWeight: string;
  activeColor: string;
  idleColor: string;
  bar: string;
  barHeight: number;
  barMatchesWord: boolean;
  touch: number;
};

function measure(selector: string): Measure {
  const strip = document.querySelector(selector) as HTMLElement;
  const rect = strip.getBoundingClientRect();
  const header = (document.querySelector("header.paper") as HTMLElement).getBoundingClientRect().bottom;
  const tabs = [...strip.querySelectorAll<HTMLElement>("[data-sub-tab]")];
  const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") as HTMLElement;
  const idle = tabs.find((tab) => tab.getAttribute("aria-selected") !== "true") as HTMLElement;
  const leading = strip.querySelector<HTMLElement>("[data-sub-tabs-leading] > *");
  const first = leading ?? (tabs[0] as HTMLElement);
  const gaps: number[] = [];
  for (let i = 1; i < tabs.length; i += 1) gaps.push(Math.round(tabs[i].getBoundingClientRect().left - tabs[i - 1].getBoundingClientRect().right));
  const bar = strip.querySelector<HTMLElement>("[data-sub-tab-bar]") as HTMLElement;
  const word = active.querySelector<HTMLElement>("[data-sub-tab-label]") as HTMLElement;
  const touch = Number.parseFloat(getComputedStyle(active, "::before").height) || active.getBoundingClientRect().height;
  return {
    top: Math.round(rect.top),
    header: Math.round(header),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    firstLeft: Math.round(first.getBoundingClientRect().left - rect.left),
    gaps,
    font: getComputedStyle(active).fontSize,
    activeWeight: getComputedStyle(active).fontWeight,
    idleWeight: getComputedStyle(idle).fontWeight,
    activeColor: getComputedStyle(active).color,
    idleColor: getComputedStyle(idle).color,
    bar: getComputedStyle(bar).backgroundColor,
    barHeight: Math.round(bar.getBoundingClientRect().height),
    barMatchesWord: Math.abs(bar.getBoundingClientRect().width - word.getBoundingClientRect().width) <= 1 && Math.abs(bar.getBoundingClientRect().left - word.getBoundingClientRect().left) <= 1,
    touch: Math.round(touch),
  };
}

beforeEach(() => {
  seed();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

for (const width of [360, 390, 430] as const) {
  test(`một dải SubTabs cho 5 tab · ${width}px — cùng vị trí, cỡ, lề, khoảng cách, màu; không tràn ngang`, async () => {
    await page.viewport(width, 844);
    await expect.poll(() => window.innerWidth).toBe(width);
    const all: Record<string, Measure> = {};
    for (const tab of TABS) {
      const screen = await render(<App at={tab.at} />);
      await settle(900);
      // The chosen item may have been brought to the middle; read the strip from its start.
      const list = document.querySelector<HTMLElement>(`${tab.strip} [role="tablist"]`) as HTMLElement;
      list.scrollLeft = 0;
      await settle(50);
      const m = measure(tab.strip);
      all[tab.name] = m;
      // 1. Flush under the title line, full width, no outer margin.
      expect(m.top, `${tab.name} top`).toBe(m.header);
      expect(m.left, `${tab.name} left`).toBe(0);
      expect(m.width, `${tab.name} width`).toBe(width);
      // 2. Words start 20 px in, an even 20 px apart (never shared-out cells).
      expect(m.firstLeft, `${tab.name} first`).toBe(20);
      for (const gap of m.gaps) expect(gap, `${tab.name} gap`).toBe(20);
      // 3. Same height and word, underline as wide as the chosen word.
      expect(m.height).toBe(40);
      expect(m.font).toBe("13px");
      expect(m.barHeight).toBe(2);
      expect(m.barMatchesWord, `${tab.name} underline`).toBe(true);
      // 4. ≥ 44 px to touch.
      expect(m.touch).toBeGreaterThanOrEqual(44);
      // No sideways overflow of the page (the strip may scroll inside itself).
      expect(document.documentElement.scrollWidth, `${tab.name} page`).toBeLessThanOrEqual(width);
      expect((document.querySelector("main") as HTMLElement).scrollWidth, `${tab.name} main`).toBeLessThanOrEqual(width);
      // 7. The same distance to what lies below: 16 px — the page's own column starts there, and on
      // Kết nối's list the first row's words / avatar begin there. (Két sắt locked = a centred gate.)
      if (tab.name === "ket-noi") expect(firstBelow(tab.strip), "ket-noi below").toBe(16);
      else if (tab.name !== "ket-sat") {
        const under = document.querySelector<HTMLElement>("[data-under-tabs]") as HTMLElement;
        expect(Math.round(under.getBoundingClientRect().top - (document.querySelector(tab.strip) as HTMLElement).getBoundingClientRect().bottom), `${tab.name} under`).toBe(0);
        expect(getComputedStyle(under).paddingTop, `${tab.name} under pad`).toBe("16px");
      }
      if (width === 390) await page.screenshot({ path: `${OUT}/subtabs-${tab.name}-390.png` });
      await screen.unmount();
    }
    const base = all["nhiem-vu"] as Measure;
    for (const [name, m] of Object.entries(all)) {
      expect({ name, ...pick(m) }).toEqual({ name, ...pick(base) });
    }
    console.log(`subtabs ${width}`, JSON.stringify(all));
  });
}

/** How far under the strip the first thing you can see begins (a box with a background / border, or text). */
function firstBelow(selector: string): number {
  const strip = document.querySelector(selector) as HTMLElement;
  const bottom = strip.getBoundingClientRect().bottom;
  const main = document.querySelector("main") as HTMLElement;
  let best = Number.POSITIVE_INFINITY;
  const full = strip.getBoundingClientRect().width - 1;
  for (const node of main.querySelectorAll<HTMLElement>("*")) {
    if (strip.contains(node) || node.contains(strip)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0 || rect.top < bottom - 0.5) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    // A full-bleed background is the page itself, not its first thing.
    const box = rect.width < full && (style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderTopWidth !== "0px" || node.tagName === "svg");
    if (box) best = Math.min(best, rect.top - bottom);
    for (const child of node.childNodes) {
      if (child.nodeType !== 3 || (child.textContent ?? "").trim() === "") continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      const text = range.getBoundingClientRect();
      if (text.height > 0 && text.top >= bottom) best = Math.min(best, text.top - bottom);
    }
  }
  return Math.round(best);
}

function pick(m: Measure) {
  return { top: m.top, height: m.height, firstLeft: m.firstLeft, font: m.font, activeWeight: m.activeWeight, idleWeight: m.idleWeight, activeColor: m.activeColor, idleColor: m.idleColor, bar: m.bar, barHeight: m.barHeight };
}

test("Nhiệm vụ: Thói quen · Hôm nay · Sắp tới · Tất cả · ⋯ — mở mặc định ở Hôm nay, ⋯ không còn Thói quen", async () => {
  for (const width of [360, 390, 430] as const) {
    await page.viewport(width, 844);
    await expect.poll(() => window.innerWidth).toBe(width);
    const screen = await render(<App at="/nhiem-vu" />);
    await settle(800);
    const strip = document.querySelector("[data-sub-tabs]") as HTMLElement;
    expect([...strip.querySelectorAll("[data-sub-tab-label]")].map((node) => node.textContent)).toEqual(["Thói quen", "Hôm nay", "Sắp tới", "Tất cả"]);
    expect(strip.querySelector('[aria-selected="true"]')?.getAttribute("data-sub-tab")).toBe("my_day");
    expect(strip.querySelector("[data-sub-tabs-more]")?.getAttribute("aria-label")).not.toContain("Thói quen");
    // Labels are never shortened; the page never spills sideways.
    for (const label of strip.querySelectorAll<HTMLElement>("[data-sub-tab-label]")) expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await screen.unmount();
  }
  await page.viewport(390, 844);
  await render(<App at="/nhiem-vu" />);
  await settle(800);
  await userEvent.click(page.getByRole("button", { name: /Thêm mục/ }));
  await settle(300);
  const menu = [...document.querySelectorAll("[data-sub-tabs-more-item]")].map((node) => node.textContent);
  expect(menu).toEqual(["Lịch", "Đã xong", "Thùng rác"]);
});

test("link cũ ?muc=thoi-quen vẫn mở Thói quen; ?muc=lich mở Lịch qua ⋯", async () => {
  await page.viewport(390, 844);
  const a = await render(<App at="/nhiem-vu?muc=thoi-quen" />);
  await settle(800);
  expect(document.querySelector('[data-sub-tab="habits"]')?.getAttribute("aria-selected")).toBe("true");
  await a.unmount();
  await render(<App at="/nhiem-vu?muc=lich" />);
  await settle(800);
  expect(document.querySelector("[data-sub-tabs-more]")?.textContent).toContain("Lịch");
});
