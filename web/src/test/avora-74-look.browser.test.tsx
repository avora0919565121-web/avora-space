import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import INDEX_HTML from "../../index.html?raw";

/** One account's profile row on the "server", shared by every device the test opens. */
const server = vi.hoisted(() => ({ row: { color_scheme: "device", accent_tone: "avora" } as Record<string, unknown>, writes: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (): unknown => {
    let patch: Record<string, unknown> | null = null;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "update") return (p: Record<string, unknown>) => ((patch = p), proxy);
          if (key === "then") {
            if (patch !== null) {
              server.row = { ...server.row, ...patch };
              server.writes += 1;
            }
            const done = Promise.resolve({ data: { ...server.row }, error: null });
            return done.then.bind(done);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return { supabase: { from: chain, rpc: chain, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
const AUTH = { user: { id: "me" }, session: null, isLoading: false };
vi.mock("@/lib/auth", () => ({ useAuth: () => AUTH }));

import { AppearanceCard } from "@/components/AppearanceCard";
import { LookSync } from "@/components/LookSync";
import { Toaster } from "@/components/ui/sonner";
import { LOOK_CACHE_KEY, TONES, toneVars } from "@/lib/theme";

const OUT = "../../../docs/screens/2026-10-02";

/** A fresh "device": its own query cache, its own LookSync. */
function Device({ children }: { children?: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LookSync />
        <div className="paper min-h-[100dvh] p-4">{children}</div>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const root = (): HTMLElement => document.documentElement;
const personal = (): string => root().style.getPropertyValue("--personal").trim();
const css = (t: { h: number; s: number; l: number }): string => `${t.h} ${t.s}% ${t.l}%`;

/** A controllable `prefers-color-scheme: dark`. */
function fakeDarkQuery(initial: boolean): { set: (dark: boolean) => void; restore: () => void } {
  const original = window.matchMedia.bind(window);
  let dark = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  window.matchMedia = ((query: string) => {
    if (!query.includes("prefers-color-scheme")) return original(query);
    return {
      get matches() {
        return dark;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.delete(fn),
      addListener: (fn: (event: { matches: boolean }) => void) => listeners.add(fn),
      removeListener: (fn: (event: { matches: boolean }) => void) => listeners.delete(fn),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    set: (next) => {
      dark = next;
      listeners.forEach((fn) => fn({ matches: dark }));
    },
    restore: () => {
      window.matchMedia = original;
    },
  };
}

beforeEach(() => {
  server.row = { color_scheme: "light", accent_tone: "avora" };
  server.writes = 0;
  window.localStorage.removeItem(LOOK_CACHE_KEY);
});

test("74.1 · chọn Biển → xem trước toàn app → Quay lại: về Avora, không lưu", async () => {
  await page.viewport(390, 844);
  const screen = await render(<Device><AppearanceCard /></Device>);
  await expect.poll(() => personal()).toBe(css(TONES.avora.light.personal));
  await userEvent.click(screen.getByRole("radio", { name: "Biển" }));
  // The whole app changes in place, on this device only.
  await expect.poll(() => personal()).toBe(css(TONES.bien.light.personal));
  await expect.element(screen.getByText("Đang xem tông")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/74-xem-truoc-bien-390.png` });
  // A preview is never what the next start paints.
  expect(JSON.parse(window.localStorage.getItem(LOOK_CACHE_KEY) ?? "{}").tone).toBe("avora");
  await userEvent.click(screen.getByRole("button", { name: "Quay lại" }));
  await expect.poll(() => personal()).toBe(css(TONES.avora.light.personal));
  expect(server.writes).toBe(0);
  expect(server.row.accent_tone).toBe("avora");
});

test("74.1b · rời màn khi đang xem trước: trở về tông cũ", async () => {
  const screen = await render(<Device><AppearanceCard /></Device>);
  await userEvent.click(screen.getByRole("radio", { name: "Tím" }));
  await expect.poll(() => personal()).toBe(css(TONES.tim.light.personal));
  await screen.unmount();
  await expect.poll(() => personal()).toBe(css(TONES.avora.light.personal));
  expect(server.writes).toBe(0);
});

test("74.2 · Ngọc → Giữ tông này; máy thứ hai ra Ngọc khi mở lại", async () => {
  const first = await render(<Device><AppearanceCard /></Device>);
  await userEvent.click(first.getByRole("radio", { name: "Ngọc" }));
  await userEvent.click(first.getByRole("button", { name: "Giữ tông này" }));
  await expect.element(first.getByText("Đã đổi tông màu")).toBeInTheDocument();
  expect(server.row.accent_tone).toBe("ngoc");
  await first.unmount();

  // Second device: nothing cached locally, reads the account on start.
  window.localStorage.removeItem(LOOK_CACHE_KEY);
  root().style.removeProperty("--personal");
  await render(<Device />);
  await expect.poll(() => root().dataset.tone).toBe("ngoc");
  expect(personal()).toBe(css(TONES.ngoc.light.personal));
});

test("Sắc màu: chạm Tối là đổi ngay và lưu vào tài khoản", async () => {
  const screen = await render(<Device><AppearanceCard /></Device>);
  await userEvent.click(screen.getByRole("radio", { name: "Tối" }));
  await expect.poll(() => root().classList.contains("dark")).toBe(true);
  expect(server.row.color_scheme).toBe("dark");
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "#191715").toBe("#191715");
  expect(personal()).toBe(css(TONES.avora.dark.personal));
});

test("74.8 · Theo thiết bị: máy chuyển sang tối khi app đang mở → app đổi theo ngay", async () => {
  server.row = { color_scheme: "device", accent_tone: "bien" };
  const media = fakeDarkQuery(false);
  try {
    await render(<Device />);
    await expect.poll(() => root().dataset.tone).toBe("bien");
    expect(root().classList.contains("dark")).toBe(false);
    media.set(true);
    await expect.poll(() => root().classList.contains("dark")).toBe(true);
    expect(personal()).toBe(css(TONES.bien.dark.personal));
    media.set(false);
    await expect.poll(() => root().classList.contains("dark")).toBe(false);
  } finally {
    media.restore();
  }
});

test("74.5 · Theo thiết bị trên trình duyệt không cho biết màu máy: ra Avora + dòng giải thích", async () => {
  const supports = CSS.supports;
  CSS.supports = ((...args: [string, string?]) => (args[1] === "AccentColor" ? false : supports.apply(CSS, args as [string, string]))) as typeof CSS.supports;
  try {
    await page.viewport(390, 844);
    server.row = { color_scheme: "light", accent_tone: "device" };
    const screen = await render(<Device><AppearanceCard /></Device>);
    await expect.element(screen.getByText("Trình duyệt này không cho biết màu của máy — đang dùng Avora.")).toBeInTheDocument();
    expect(root().dataset.tone).toBe("avora");
    expect(personal()).toBe(css(TONES.avora.light.personal));
    await page.screenshot({ path: `${OUT}/74-theo-thiet-bi-khong-ho-tro-390.png` });
  } finally {
    CSS.supports = supports;
  }
});

test("74.6 · mở app với Tím đã lưu: script đầu trang tô tím trước khi React chạy", () => {
  const script = /<script>\s*([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1];
  expect(script).toBeTruthy();
  window.localStorage.setItem(LOOK_CACHE_KEY, JSON.stringify({ scheme: "light", tone: "tim", light: toneVars(TONES.tim.light), dark: toneVars(TONES.tim.dark) }));
  root().classList.remove("dark");
  root().style.removeProperty("--personal");
  // Exactly what the browser runs before the bundle loads.
  new Function(script as string)();
  expect(root().dataset.tone).toBe("tim");
  expect(personal()).toBe(css(TONES.tim.light.personal));
  // The CSS default (Avora) never shows in between: the variable is on <html> before first paint.
  expect(getComputedStyle(root()).getPropertyValue("--personal").trim()).toBe(css(TONES.tim.light.personal));
});

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Giao diện · ${scheme} ${w}x${h}`, async () => {
      server.row = { color_scheme: scheme, accent_tone: "bien" };
      await page.viewport(w, h);
      const screen = await render(<Device><div className="mx-auto max-w-2xl"><AppearanceCard /></div></Device>);
      await expect.poll(() => root().dataset.tone).toBe("bien");
      await expect.element(screen.getByRole("radio", { name: "Biển" })).toHaveAttribute("aria-checked", "true");
      await new Promise((r) => setTimeout(r, 300));
      await page.screenshot({ path: `${OUT}/74-cai-dat-giao-dien-${scheme === "light" ? "sang" : "toi"}-${w}.png` });
    });
  }
}
