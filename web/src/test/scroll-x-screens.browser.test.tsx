import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/*
 * KHỐI 2F (AVORA-105 · D.3) — the main screens outside Kết nối at 390×844 and 360×740: every vertical
 * scroller on screen is no wider than itself and snaps back to scrollLeft 0. Regions that scroll
 * sideways on purpose say so with `data-h-scroll` and are left alone. Fixed fake data, no network.
 */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data, error: null, count: 0 });
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
      from: () => builder([]),
      rpc: (name: string) =>
        builder(
          name === "vault_status"
            ? { has_code: true, has_data: true, unlocked: true, expires_at: null, locked_until: null, remaining: 5 }
            : [],
        ),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", email: "me@probe.invalid" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false, signOut: async () => undefined, signOutOthers: async () => ({ ok: true }) }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { VaultLockProvider } from "@/lib/use-vault-lock";
import Contacts from "@/pages/Contacts";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import SettingsFeedback from "@/pages/SettingsFeedback";
import SettingsGuide from "@/pages/SettingsGuide";
import SettingsNotifications from "@/pages/SettingsNotifications";
import SettingsPreferences from "@/pages/SettingsPreferences";
import SettingsStorage from "@/pages/SettingsStorage";
import Tasks from "@/pages/Tasks";
import ThinkHub from "@/pages/ThinkHub";
import BookReader from "@/pages/BookReader";
import ProjectDetail from "@/pages/ProjectDetail";
import Vault from "@/pages/Vault";
import FinanceTransactions from "@/pages/FinanceTransactions";
import VaultAssets from "@/pages/VaultAssets";
import VaultCertificates from "@/pages/VaultCertificates";
import VaultDocuments from "@/pages/VaultDocuments";
import VaultPasswords from "@/pages/VaultPasswords";
import E2eeSpikePage from "@/spikes/e2ee/E2eeSpikePage";

const SCREENS: readonly { name: string; at: string }[] = [
  { name: "Avora Space", at: "/tong-quan" },
  { name: "Nhiệm vụ · Hôm nay", at: "/nhiem-vu" },
  { name: "Nhiệm vụ · Sắp tới", at: "/nhiem-vu?muc=sap-toi" },
  { name: "Nhiệm vụ · Tất cả", at: "/nhiem-vu?muc=tat-ca" },
  { name: "Nhiệm vụ · Thói quen", at: "/nhiem-vu?muc=thoi-quen" },
  ...[1, 2, 3, 4, 5, 6].map((ke) => ({ name: `Kế hoạch · Kệ ${ke}`, at: `/ke-hoach?ke=${ke}` })),
  { name: "Liên hệ", at: "/lien-he" },
  { name: "Hồ sơ", at: "/ho-so" },
  { name: "Cài đặt · Tuỳ chọn", at: "/cai-dat/thiet-lap" },
  { name: "Cài đặt · Thông báo", at: "/cai-dat/thong-bao" },
  { name: "Cài đặt · Dung lượng", at: "/cai-dat/dung-luong" },
  { name: "Cài đặt · Hướng dẫn", at: "/cai-dat/huong-dan" },
  { name: "Cài đặt · Góp ý", at: "/cai-dat/gop-y" },
  { name: "Két sắt · Giao dịch", at: "/ket-sat/giao-dich" },
  { name: "Két sắt · Mật khẩu", at: "/ket-sat/mat-khau" },
  { name: "Két sắt · Chứng chỉ", at: "/ket-sat/chung-chi" },
  { name: "Két sắt · Tài liệu", at: "/ket-sat/tai-lieu" },
  { name: "Két sắt · Tài sản", at: "/ket-sat/tai-san" },
  { name: "Dự án chi tiết", at: "/du-an/p1" },
  { name: "Trình đọc sách", at: "/ke-hoach/ke-sach/doc/k1" },
  { name: "Trang thử E0", at: "/spike/e2ee" },
];

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card">
            <main data-app-main="" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={null}>{children}</Suspense>
            </main>
          </div>
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Screens() {
  return (
    <Routes>
      <Route path="/tong-quan" element={<Dashboard />} />
      <Route path="/nhiem-vu" element={<Tasks />} />
      <Route path="/ke-hoach" element={<ThinkHub />} />
      <Route path="/lien-he" element={<Contacts />} />
      <Route path="/ho-so" element={<Profile />} />
      <Route path="/cai-dat/thiet-lap" element={<SettingsPreferences />} />
      <Route path="/cai-dat/thong-bao" element={<SettingsNotifications />} />
      <Route path="/cai-dat/dung-luong" element={<SettingsStorage />} />
      <Route path="/cai-dat/huong-dan" element={<SettingsGuide />} />
      <Route path="/cai-dat/gop-y" element={<SettingsFeedback />} />
      <Route path="/ket-sat" element={<Vault />}>
        <Route path="giao-dich" element={<FinanceTransactions />} />
        <Route path="mat-khau" element={<VaultPasswords />} />
        <Route path="chung-chi" element={<VaultCertificates />} />
        <Route path="tai-lieu" element={<VaultDocuments />} />
        <Route path="tai-san" element={<VaultAssets />} />
      </Route>
      <Route path="/du-an/:projectId" element={<ProjectDetail />} />
      <Route path="/ke-hoach/ke-sach/doc/:recordId" element={<BookReader />} />
      <Route path="/spike/e2ee" element={<E2eeSpikePage />} />
    </Routes>
  );
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Every visible vertical scroller outside an intentional sideways region. */
function verticalScrollers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
    if (el.closest("[data-h-scroll]") !== null) return false;
    const style = getComputedStyle(el);
    if (!/(auto|scroll)/.test(style.overflowY)) return false;
    return el.clientHeight > 0 && el.clientWidth > 0;
  });
}

function describeEl(el: HTMLElement): string {
  return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 6).join(".")}`;
}

for (const [w, h] of [[390, 844], [360, 740]] as const) {
  for (const screen of SCREENS) {
    test(`${screen.name} · ${w}×${h}: không kéo ngang được`, async () => {
      await page.viewport(w, h);
      await render(
        <Frame at={screen.at}>
          <Screens />
        </Frame>,
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      const offenders: string[] = [];
      const scrollers = verticalScrollers();
      for (const el of scrollers) {
        if (el.scrollWidth > el.clientWidth + 1) {
          offenders.push(`${describeEl(el)} tràn ${el.scrollWidth - el.clientWidth}px`);
          const edge = el.getBoundingClientRect().right;
          const wide = [...el.querySelectorAll<HTMLElement>("*")].filter((child) => child.getBoundingClientRect().right > edge + 1 && child.closest("[data-h-scroll]") === null);
          // The first element past the edge whose parent is not past it: the source of the overflow.
          const sources = wide.filter((child) => child.parentElement === null || !wide.includes(child.parentElement)).slice(0, 3);
          for (const source of sources) offenders.push(`  nguồn: ${describeEl(source)} right=${Math.round(source.getBoundingClientRect().right)}`);
        }
        el.scrollLeft = 40;
      }
      await frame();
      for (const el of scrollers) if (el.scrollLeft !== 0) offenders.push(`${describeEl(el)} scrollLeft=${el.scrollLeft}`);
      expect(offenders).toEqual([]);
    });
  }
}
