import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { MemoryRouter, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * AVORA-94 — tabs were pulled back to Avora Space after AVORA-93. `useNavigate()` changes identity
 * on every pathname change, and the resume effect listed it in its deps, so every tab tap re-ran the
 * reopen rule. These run the real hook (and, in the smoke pass, the real signed-in shell) in three
 * modes: phone 390×844, AVORA installed on a computer (standalone, 1440), a computer browser.
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
      from: () => builder([]),
      rpc: () => builder([]),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    session: { user: { id: "me" }, access_token: "x" },
    profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" },
    isLoading: false,
    isRecovering: false,
    signOut: async () => undefined,
  }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));
vi.mock("@/lib/use-device", () => ({
  useDeviceStatus: () => ({ status: undefined, isPending: false, refetch: () => undefined }),
  useMyDevices: () => ({ devices: [], isPending: false }),
  useInvalidateDevices: () => () => undefined,
}));
vi.mock("@/components/PinGate", () => ({
  PinGate: ({ children }: { children: ReactNode }) => <>{children}</>,
  PinReminderBanner: () => null,
}));
// Same day as today: the new-day hook stays put (it is covered in its own tests).
vi.mock("@/lib/day-open-api", () => ({
  fetchLastOpenedDate: async () => {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
  },
  recordOpenedDate: async () => undefined,
}));

import { RequireAuth } from "@/components/RequireAuth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTrackHistory, hasInAppPrevious } from "@/lib/nav-history";
import { chatBackTarget, writeLeftPlace } from "@/lib/resume-place";
import { readReturn } from "@/lib/return-to";
import { useResumePlace } from "@/lib/use-resume-place";

type Mode = "phone" | "installed-computer" | "computer";
const MODES: readonly Mode[] = ["phone", "installed-computer", "computer"];
const TABS: readonly { to: string; label: string }[] = [
  { to: "/tin-nhan", label: "Kết nối" },
  { to: "/nhiem-vu", label: "Nhiệm vụ" },
  { to: "/ke-hoach", label: "Kế hoạch" },
  { to: "/ket-sat", label: "Két sắt" },
  { to: "/cai-dat", label: "Cài đặt" },
];
// Noon, so "2 hours ago" is the same resume day and "yesterday evening" is not.
const NOON = new Date(2026, 9, 4, 12, 0, 0).getTime();
const MINUTE = 60_000;

let restoreMatchMedia: (() => void) | null = null;
let visibility: DocumentVisibilityState = "visible";

async function setMode(mode: Mode): Promise<void> {
  if (mode === "phone") await page.viewport(390, 844);
  else await page.viewport(1440, 900);
  await expect.poll(() => window.innerWidth).toBe(mode === "phone" ? 390 : 1440);
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => {
    if (!query.includes("display-mode")) return original(query);
    const matches = mode === "installed-computer" && query.includes("standalone");
    return { matches, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false } as MediaQueryList;
  }) as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = original;
  };
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Where the router stands, readable from the test. */
function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function where(): string {
  return document.querySelector('[data-testid="where"]')?.textContent ?? "";
}

/** A minimal signed-in shell: the real resume hook, real NavLinks, nothing else. */
function Shell({ entry }: { entry: string }) {
  useResumePlace("me", entry);
  useTrackHistory();
  return (
    <div>
      <nav aria-label="Tabs thử">
        <NavLink to="/tong-quan">Avora Space</NavLink>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Where />
      <Outlet />
    </div>
  );
}

function List() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/tin-nhan/d1")}>
      mở d1
    </button>
  );
}

function Thread() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return (
    <button
      type="button"
      aria-label="Quay lại Kết nối"
      onClick={() => {
        const back = chatBackTarget({ returnPath: readReturn(searchParams)?.path ?? null, hasPrevious: hasInAppPrevious(), kind: conversationId === "d1" ? "direct" : "group" });
        if (back.kind === "history") navigate(-1);
        else navigate(back.path, { replace: true });
      }}
    >
      ‹
    </button>
  );
}

function renderShell(start: string, entry: string = start) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[start]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Shell entry={entry} />}>
            {["/tong-quan", "/nhiem-vu", "/ke-hoach", "/ket-sat", "/cai-dat"].map((path) => (
              <Route key={path} path={path} element={<p>{path}</p>} />
            ))}
            <Route path="/tin-nhan" element={<List />} />
            <Route path="/tin-nhan/:conversationId" element={<Thread />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

async function tapTab(label: string): Promise<void> {
  await userEvent.click(page.getByRole("navigation", { name: "Tabs thử" }).getByRole("link", { name: label, exact: true }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  // Back to the browser's own getter.
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe.each(MODES)("AVORA-94 · %s", (mode) => {
  beforeEach(async () => {
    await setMode(mode);
  });

  it("94.1 · nothing remembered: every tab tap stays on that tab", async () => {
    renderShell("/tong-quan", "/");
    await settle();
    expect(where()).toBe("/tong-quan");
    for (const tab of TABS) {
      await tapTab(tab.label);
      await settle();
      expect(where()).toBe(tab.to);
    }
  });

  it("94.2 · remembered yesterday, opened at /tin-nhan, tap Nhiệm vụ → stays", async () => {
    writeLeftPlace("me", { at: NOON - 20 * 60 * MINUTE, path: "/ke-hoach", scroll: 0 });
    renderShell("/tin-nhan");
    await settle();
    expect(where()).toBe("/tin-nhan");
    await tapTab("Nhiệm vụ");
    await settle();
    expect(where()).toBe("/nhiem-vu");
  });

  it("94.3 · left at /ke-hoach 10 minutes ago, cold open → back there once (phone only), then tabs stay", async () => {
    writeLeftPlace("me", { at: NOON - 10 * MINUTE, path: "/ke-hoach", scroll: 0 });
    renderShell("/tong-quan", "/");
    await settle();
    // A computer, installed or not, keeps the old behaviour: no reopen rule.
    expect(where()).toBe(mode === "phone" ? "/ke-hoach" : "/tong-quan");
    await tapTab("Nhiệm vụ");
    await settle();
    expect(where()).toBe("/nhiem-vu");
    await tapTab("Két sắt");
    await settle();
    expect(where()).toBe("/ket-sat");
  });

  it("94.4 · hidden at Nhiệm vụ, back after 2 hours → Kết nối › 1-1 once (phone only), then tabs stay", async () => {
    renderShell("/tong-quan", "/");
    await settle();
    await tapTab("Nhiệm vụ");
    await settle();
    setVisibility("hidden");
    vi.setSystemTime(NOON + 2 * 60 * MINUTE);
    setVisibility("visible");
    await settle();
    expect(where()).toBe(mode === "phone" ? "/tin-nhan?tab=1-1" : "/nhiem-vu");
    await tapTab("Kế hoạch");
    await settle();
    expect(where()).toBe("/ke-hoach");
  });

  it("94.5 · hidden, back on a new day (after 04:00) → Avora Space once (phone only), then tabs stay", async () => {
    renderShell("/tong-quan", "/");
    await settle();
    await tapTab("Kế hoạch");
    await settle();
    setVisibility("hidden");
    // 05:00 the next morning.
    vi.setSystemTime(NOON + 17 * 60 * MINUTE);
    setVisibility("visible");
    await settle();
    expect(where()).toBe(mode === "phone" ? "/tong-quan" : "/ke-hoach");
    await tapTab("Két sắt");
    await settle();
    expect(where()).toBe("/ket-sat");
  });

  it("94.6 · open a 1-1 chat from the list, ‹ → Kết nối › 1-1, never /", async () => {
    // Left at the list 5 minutes ago: a cold open lands there on every mode.
    writeLeftPlace("me", { at: NOON - 5 * MINUTE, path: "/tin-nhan?tab=1-1", scroll: 0 });
    renderShell("/tin-nhan?tab=1-1", "/");
    await settle();
    expect(where()).toBe("/tin-nhan?tab=1-1");
    await settle();
    await userEvent.click(page.getByRole("button", { name: "mở d1" }));
    await settle();
    expect(where()).toBe("/tin-nhan/d1");
    await userEvent.click(page.getByRole("button", { name: "Quay lại Kết nối" }));
    await settle();
    expect(where()).toBe("/tin-nhan?tab=1-1");
  });

  it("94.6b · reopened straight into a chat (nothing behind), ‹ → Kết nối › 1-1", async () => {
    renderShell("/tin-nhan/d1", "/tin-nhan/d1");
    await settle();
    await userEvent.click(page.getByRole("button", { name: "Quay lại Kết nối" }));
    await settle();
    expect(where()).toBe("/tin-nhan?tab=1-1");
  });
});

/*
 * Smoke (AVORA-94 · 4): the real signed-in shell (RequireAuth with its bars and hooks), five tabs,
 * one second on each, the path must not move. Every navigation change from now on passes this.
 */
function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/tong-quan"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<RequireAuth />}>
              {["/tong-quan", "/tin-nhan", "/nhiem-vu", "/ke-hoach", "/ket-sat", "/cai-dat"].map((path) => (
                <Route key={path} path={path} element={<p data-testid="page">{path}</p>} />
              ))}
            </Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe.each(["phone", "installed-computer"] as const)("AVORA-94 · smoke · %s", (mode) => {
  beforeEach(async () => {
    await setMode(mode);
  });

  it("five tabs, one second each, the path stays", async () => {
    renderApp();
    await settle(500);
    const navName = mode === "phone" ? "Các Hub" : "Điều hướng chính";
    for (const tab of TABS) {
      await userEvent.click(page.getByRole("navigation", { name: navName }).getByRole("link", { name: new RegExp(`^${tab.label}`) }));
      await expect.poll(() => new URL(where(), "http://x").pathname).toBe(tab.to);
      await settle(1000);
      expect(new URL(where(), "http://x").pathname).toBe(tab.to);
    }
  });
});
