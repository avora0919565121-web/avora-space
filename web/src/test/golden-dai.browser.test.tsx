import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";
import { LONG_MESSAGES, LONG_NAMES, LONG_TITLES } from "@/test/fixtures/long-data";
import { recordMeasure } from "@/test/reliability/record";

/*
 * 112-A · 7 — the 2F overflow check again, now with REAL-LIFE LONG DATA (very long names, long
 * unbroken words, links, many scripts, many rows). Only measures: offenders are written to
 * docs/reliability/do-112a/L-dai-*.json and listed in LOI.md; the test itself passes.
 */
const ME = "me";
const today = new Date().toISOString().slice(0, 10);

const CONTACTS = Array.from({ length: 120 }, (_, index) => ({
  id: `c${index}`,
  owner_user_id: ME,
  contact_type: index % 5 === 0 ? "business" : "individual",
  name: `${LONG_NAMES[index % LONG_NAMES.length]}${index > 15 ? ` ${index}` : ""}`,
  phone: index % 2 === 0 ? "0912345678901234" : null,
  email: index % 3 === 0 ? "mot.dia.chi.email.rat.dai.de.thu.tran@congtythuongmaidichvu.com.vn" : null,
  note: LONG_MESSAGES[index % LONG_MESSAGES.length],
  linked_user_id: null,
  employer_contact_id: null,
  date_of_birth: null,
  relationship_tag: null,
  tax_code: index % 5 === 0 ? "0312345678-001" : null,
  business_address: index % 5 === 0 ? "Tầng 18, Toà nhà Bitexco Financial Tower, 2 Hải Triều, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh" : null,
  representative_name: null,
  representative_phone: null,
  representative_email: null,
  industry: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  needs_details: false,
}));

const TASKS = Array.from({ length: 60 }, (_, index) => ({
  id: `t${index}`,
  type: "personal",
  creator_id: ME,
  assignee_id: null,
  context_snapshot: null,
  conversation_id: null,
  title: `${LONG_TITLES[index % LONG_TITLES.length]}${index % 7 === 0 ? ` ${LONG_MESSAGES[2]}` : ""}`,
  description: LONG_MESSAGES[index % LONG_MESSAGES.length],
  status: "confirmed",
  confirmed_at: null,
  done_at: null,
  completed_confirmed_at: null,
  skipped_at: null,
  skipped_silently: false,
  deadline_date: today,
  deadline_time: index % 2 === 0 ? "17:00:00" : null,
  deadline_tz: "Asia/Ho_Chi_Minh",
  task_category_id: null,
  is_important: index % 4 === 0,
  is_milestone: false,
  progress_percent: null,
  output_value: null,
  recurrence: null,
  recurrence_pattern: null,
  recurrence_spawned_at: null,
  deleted_by_creator: false,
  deleted_by_peer: false,
  created_at: `2026-10-0${(index % 9) + 1}T0${index % 9}:00:00Z`,
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
}));

const TABLES: Record<string, unknown[]> = { contact: CONTACTS, tasks: TASKS };

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
      from: (table: string) => builder(TABLES[table] ?? []),
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
  useAuth: () => ({
    user: { id: "me", email: "mot.dia.chi.email.rat.dai.de.thu.tran@congtythuongmaidichvu.com.vn" },
    session: {},
    profile: { id: "me", display_name: "Tôn Nữ Thị Hoàng Oanh Phương Thảo Bảo Trâm Ngọc Diệp", avatar_url: null, created_at: "" },
    isLoading: false,
    signOut: async () => undefined,
    signOutOthers: async () => ({ ok: true }),
  }),
  useDisplayName: () => "Tôn Nữ Thị Hoàng Oanh Phương Thảo Bảo Trâm Ngọc Diệp",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { VaultLockProvider } from "@/lib/use-vault-lock";
import Contacts from "@/pages/Contacts";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import Tasks from "@/pages/Tasks";

const SCREENS: readonly { name: string; at: string; slug: string }[] = [
  { name: "Liên hệ · 120 người tên dài", at: "/lien-he", slug: "lien-he" },
  { name: "Nhiệm vụ · Hôm nay · 60 việc tiêu đề dài", at: "/nhiem-vu", slug: "nhiem-vu-hom-nay" },
  { name: "Nhiệm vụ · Tất cả", at: "/nhiem-vu?muc=tat-ca", slug: "nhiem-vu-tat-ca" },
  { name: "Hồ sơ · tên + email rất dài", at: "/ho-so", slug: "ho-so" },
  { name: "Avora Space", at: "/tong-quan", slug: "tong-quan" },
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
      <Route path="/lien-he" element={<Contacts />} />
      <Route path="/ho-so" element={<Profile />} />
    </Routes>
  );
}

function describeEl(el: Element): string {
  return `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(" ").slice(0, 5).join(".")}`;
}

/** Anything sticking out past the viewport's right edge (outside intentional sideways regions). */
function overflowing(width: number): { offenders: string[]; documentWidth: number } {
  const offenders: string[] = [];
  const wide = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => {
    if (el.closest("[data-h-scroll]") !== null) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Clipped by an ancestor that hides overflow → not visible to the person.
    let parent = el.parentElement;
    while (parent !== null && parent.tagName !== "MAIN") {
      const style = getComputedStyle(parent);
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && parent.getBoundingClientRect().right <= width + 1) return false;
      parent = parent.parentElement;
    }
    return rect.right > width + 1;
  });
  const sources = wide.filter((el) => el.parentElement === null || !wide.includes(el.parentElement)).slice(0, 6);
  for (const el of sources) offenders.push(`${describeEl(el)} right=${Math.round(el.getBoundingClientRect().right)} «${(el.textContent ?? "").slice(0, 40)}»`);
  const scrollers = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => el.closest("[data-h-scroll]") === null && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
  for (const el of scrollers) offenders.push(`${describeEl(el)} kéo ngang được ${el.scrollWidth - el.clientWidth}px`);
  return { offenders, documentWidth: document.documentElement.scrollWidth };
}

const OUT = "../../../docs/screens/2026-10-13";

for (const [w, h] of [[390, 844], [360, 740]] as const) {
  for (const screen of SCREENS) {
    test(`112-A · dữ liệu dài · ${screen.name} · ${w}×${h}`, async () => {
      await page.viewport(w, h);
      await render(
        <Frame at={screen.at}>
          <Screens />
        </Frame>,
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      const result = overflowing(w);
      await page.screenshot({ path: `${OUT}/112A-dai-${screen.slug}-${w}x${h}.png` });
      await recordMeasure(`L-dai-${screen.slug}-${w}x${h}`, {
        threshold: "không phần tử nào tràn ra ngoài màn hình; không kéo ngang được",
        screen: screen.name,
        viewport: `${w}×${h}`,
        offenders: result.offenders,
        documentWidth: result.documentWidth,
        pass: result.offenders.length === 0 && result.documentWidth <= w,
      });
      expect(result.documentWidth).toBeGreaterThan(0);
    });
  }
}
