import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * KT-06 · D (CEO 12/11 23:36 + SP-04 B1–B3): an encrypted compartment is never an empty room.
 *  · no code yet → it says what it keeps, invites the first one in, and leaves a slot for SP-04's samples;
 *  · while Két sắt is being asked → visible words + the shape of the page (not a lone spinner);
 *  · a failed read → "Chưa tải được Két sắt · Thử lại", never "Chưa có gì".
 */

type Reply = { data: unknown; error: { message: string; code?: string } | null };
const db: { rpc: Record<string, () => Reply>; tables: Record<string, () => Reply> } = { rpc: {}, tables: {} };

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
  return {
    supabase: {
      from: (table: string) => thenable(() => (db.tables[table] ?? (() => ({ data: [], error: null })))()),
      rpc: (name: string) => thenable(() => (db.rpc[name] ?? (() => ({ data: null, error: null })))()),
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
import { VaultCompartment, VaultLoadFailed } from "@/components/vault/VaultCompartment";
import { COMPARTMENT_INTRO } from "@/lib/vault-compartments";
import Vault from "@/pages/Vault";

const STATUS = {
  has_code: false,
  has_data: false,
  unlocked: false,
  expires_at: null,
  locked_until: null,
  remaining: 5,
  has_keyring: false,
  device_share: false,
  device_bound: true,
  has_main_device: true,
  device_allowed: true,
  device_proven: true,
};

function App({ path, children }: { path: string; children?: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <VaultLockProvider>
          <div className="paper flex h-[100dvh] flex-col">
            {children ?? (
              <Routes>
                <Route path="/ket-sat" element={<Vault />}>
                  <Route path="mat-khau" element={<div />} />
                  <Route path="chung-chi" element={<div />} />
                  <Route path="tai-lieu" element={<div />} />
                  <Route path="tai-san" element={<div />} />
                </Route>
              </Routes>
            )}
          </div>
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  db.rpc = {};
  db.tables = {};
});

for (const [path, intro] of Object.entries(COMPARTMENT_INTRO)) {
  test(`KT06-D1 · chưa có mã, mở ${path}: nói ngăn để làm gì + mời cất ${intro.noun} đầu tiên, có chỗ cho mẫu`, async () => {
    await page.viewport(1440, 900);
    db.rpc.vault_enter = () => ({ data: STATUS, error: null });
    const screen = await render(<App path={`/ket-sat/${path}`} />);
    await expect.element(screen.getByRole("heading", { name: `Đặt mã để cất ${intro.noun} đầu tiên` })).toBeVisible();
    await expect.element(screen.getByText(intro.purpose)).toBeVisible();
    expect(document.querySelector(`[data-vault-samples-slot="${path}"]`)).not.toBeNull();
    // The same set-code pad as the chip at the door: a code can be set right here.
    await expect.element(screen.getByText("Mã này khoá Két sắt trên máy này và mọi máy khác. Quên mã thì đặt lại được qua email.")).toBeVisible();
  });
}

test("KT06-D2 · đang hỏi Két sắt: có chữ nhìn thấy được và khung trang, không chỉ một vòng quay", async () => {
  await page.viewport(390, 844);
  db.rpc.vault_enter = () => new Promise<never>(() => undefined) as never;
  const screen = await render(<App path="/ket-sat/tai-san" />);
  await expect.element(screen.getByText("Đang mở Két sắt…")).toBeVisible();
  expect(document.querySelector("[data-vault-skeleton]")).not.toBeNull();
});

test("KT06-D3 · đọc lỗi: 'Chưa tải được Két sắt' + Thử lại (gọi lại), không phải 'Chưa có gì'", async () => {
  await page.viewport(390, 844);
  const retry = vi.fn();
  const screen = await render(
    <App path="/ket-sat/tai-san">
      <VaultLoadFailed onRetry={retry} />
    </App>,
  );
  await expect.element(screen.getByText("Chưa tải được Két sắt")).toBeVisible();
  await screen.getByRole("button", { name: "Thử lại" }).click();
  expect(retry).toHaveBeenCalledTimes(1);
  expect(document.body.innerText).not.toContain("Chưa có gì");
});

test("KT06-D4 · ngăn mở khoá mà tải khoá Két sắt lỗi: báo lỗi + Thử lại, không quay mãi (SP-04 B2)", async () => {
  await page.viewport(390, 844);
  db.rpc.vault_enter = () => ({ data: { ...STATUS, has_code: true, unlocked: true }, error: null });
  let calls = 0;
  db.rpc.vault_keyring_get = () => {
    calls += 1;
    return { data: null, error: { message: "network", code: "500" } };
  };
  const screen = await render(
    <App path="/ket-sat/tai-san">
      <VaultCompartment section="assets" />
    </App>,
  );
  await expect.element(screen.getByText("Chưa tải được Két sắt")).toBeVisible();
  expect(document.body.innerText).not.toContain("Chưa có gì");
  const before = calls;
  await screen.getByRole("button", { name: "Thử lại" }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test("KT06-D5 · đã có sổ Tài chính, chưa có mã: bước 'Về khoá' đầu tiên cũng nói ngăn để làm gì", async () => {
  await page.viewport(390, 844);
  window.localStorage.removeItem("avora.vault.intro.me");
  db.rpc.vault_enter = () => ({ data: { ...STATUS, has_data: true }, error: null });
  const screen = await render(<App path="/ket-sat/tai-lieu" />);
  // KT-07c (CEO 12/11 · 19): on a phone the compartment invites first; the keypad comes up in a sheet.
  await userEvent.click(screen.getByRole("button", { name: /Đặt mã để cất giấy tờ thật/ }));
  await expect.element(screen.getByRole("heading", { name: "Đặt mã để cất giấy tờ đầu tiên" })).toBeVisible();
  await expect.element(screen.getByText(COMPARTMENT_INTRO["tai-lieu"].purpose).last()).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Tôi đã hiểu" })).toBeVisible();
});
