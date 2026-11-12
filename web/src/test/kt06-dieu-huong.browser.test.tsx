import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * KT-06 · E (CEO 12/11 23:41) + C: Két sắt › Tài chính.
 *  · the four tabs sit right under the Két sắt strip — nothing in between;
 *  · the page action ("Thêm tài khoản") is in that same row, at its end, standard small size;
 *  · the description comes after the tabs;
 *  · scrolling keeps title + Két sắt strip + the four tabs on screen, on a solid bar.
 */

const db: { tables: Record<string, unknown[]> } = { tables: {} };
vi.mock("@/integrations/supabase/client", () => {
  const thenable = (result: () => unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const done = Promise.resolve(result());
            return done.then.bind(done);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const status = { has_code: false, has_data: true, unlocked: false, expires_at: null, locked_until: null, remaining: 5, device_allowed: true, device_bound: true, has_main_device: true, device_proven: true };
  return {
    supabase: {
      from: (table: string) => thenable(() => ({ data: db.tables[table] ?? [], error: null })),
      rpc: (name: string) => thenable(() => ({ data: name === "vault_enter" ? status : null, error: null })),
      storage: { from: () => thenable(() => ({ data: [], error: null })) },
      channel: () => thenable(() => ({ data: [], error: null })),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", email: "me@example.vn" }, session: null, signOut: async () => undefined, isLoading: false }),
  useDisplayName: () => "Thiện",
}));

import { VaultLockProvider } from "@/lib/use-vault-lock";
import Vault from "@/pages/Vault";
import FinanceAccounts from "@/pages/FinanceAccounts";

function App({ path }: { path: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <VaultLockProvider>
          <div className="paper flex h-[100dvh] flex-col overflow-hidden">
            <Routes>
              <Route path="/ket-sat" element={<Vault />}>
                <Route path="tai-khoan" element={<FinanceAccounts />} />
              </Route>
            </Routes>
          </div>
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  db.tables = {};
});

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`KT06-E1 · ${w}px: dải tab Tài chính sát dải Két sắt, nút hành động trong hàng tab, mô tả nằm sau`, async () => {
    await page.viewport(w, h);
    const screen = await render(<App path="/ket-sat/tai-khoan" />);
    await expect.element(screen.getByText("Giá trị ròng")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 700)); // the page's 0.45 s rise-in
    const vaultTabs = document.querySelector<HTMLElement>("[data-section-nav]")!;
    const head = document.querySelector<HTMLElement>("[data-finance-head]")!;
    const gap = head.getBoundingClientRect().top - vaultTabs.getBoundingClientRect().bottom;
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThan(4);
    // Nothing visible stands between the two strips.
    const between = [...document.querySelectorAll<HTMLElement>("main *, body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && el.innerText?.trim() && r.top >= vaultTabs.getBoundingClientRect().bottom - 0.5 && r.bottom <= head.getBoundingClientRect().top + 0.5;
    });
    expect(between.map((el) => el.innerText)).toEqual([]);
    // The action lives in the tab row, vertically within it, and is no taller than the room's `+` (≤ 44px).
    const action = screen.getByRole("button", { name: "Thêm tài khoản" }).element() as HTMLElement;
    expect(head.contains(action)).toBe(true);
    const a = action.getBoundingClientRect();
    const r = head.getBoundingClientRect();
    expect(a.top).toBeGreaterThanOrEqual(r.top);
    expect(a.bottom).toBeLessThanOrEqual(r.bottom);
    expect(a.height).toBeLessThanOrEqual(44);
    // The description comes after the tabs, not between the strips.
    const subtitle = document.querySelector<HTMLElement>("[data-finance-subtitle]")!;
    expect(subtitle.getBoundingClientRect().top).toBeGreaterThanOrEqual(r.bottom);
  });

  test(`KT06-E2 · ${w}px: cuộn xuống, tiêu đề + dải Két sắt + 4 tab Tài chính vẫn hiện, nền đặc`, async () => {
    await page.viewport(w, h);
    db.tables.accounts = [];
    const screen = await render(<App path="/ket-sat/tai-khoan" />);
    await expect.element(screen.getByText("Giá trị ròng")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 700)); // the page's 0.45 s rise-in
    const bar = document.querySelector<HTMLElement>('[data-sticky-bar="finance"]')!;
    let scroller: HTMLElement | null = bar.parentElement;
    while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const pad = document.createElement("div");
    pad.style.height = "3000px";
    bar.parentElement!.appendChild(pad);
    scroller!.scrollTop = 2000;
    await expect.poll(() => bar.dataset.stuck).toBe("true");
    const tabs = document.querySelector<HTMLElement>("[data-finance-tabs]")!.getBoundingClientRect();
    expect(tabs.top).toBeGreaterThanOrEqual(0);
    expect(tabs.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(Math.abs(bar.getBoundingClientRect().top - scroller!.getBoundingClientRect().top)).toBeLessThan(2);
    const vaultTabs = document.querySelector<HTMLElement>("[data-section-nav]")!.getBoundingClientRect();
    expect(vaultTabs.bottom).toBeGreaterThan(0);
    expect(getComputedStyle(bar).backgroundColor).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });
}
