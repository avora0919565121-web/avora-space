import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/**
 * KT-06 · A (QA01-08): Két sắt asks the server ONCE on entry (vault_enter: lock + status + "device proven?"),
 * signs only when the server says the proof is missing, and fetches Tài chính alongside — but never shows it
 * before the server said Tài chính is open.
 * KT-06 · B (QA03-04): offline with nothing read, Tài khoản never says "0 ₫" — it shows the last totals seen
 * on this device with "Đang ngoại tuyến · cập nhật lúc …", or "Chưa tải được".
 * The server half: supabase/tests/kt06_vault_enter.sql.
 */

type Reply = { data: unknown; error: { message: string; code?: string } | null };
const db: {
  rpc: Record<string, (args: Record<string, unknown>) => Reply>;
  tables: Record<string, unknown[]>;
  calls: string[];
  session: unknown;
} = { rpc: {}, tables: {}, calls: [], session: null };

vi.mock("@/integrations/supabase/client", () => {
  const thenable = (result: () => unknown, name: string): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            db.calls.push(name);
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
      from: (table: string) => thenable(() => ({ data: db.tables[table] ?? [], error: null }), `from:${table}`),
      rpc: (name: string, args: Record<string, unknown> = {}) =>
        thenable(() => (db.rpc[name] === undefined ? { data: null, error: null } : db.rpc[name](args)), `rpc:${name}`),
      storage: { from: () => thenable(() => ({ data: [], error: null }), "storage") },
      channel: () => thenable(() => ({ data: [], error: null }), "channel"),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: db.session } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", email: "me@example.vn" }, session: null, signOut: async () => undefined, isLoading: false }),
  useDisplayName: () => "Thiện",
}));

import { lastKnown } from "@/lib/last-known";
import { VaultLockProvider, useVaultLock } from "@/lib/use-vault-lock";
import { financeKeys } from "@/lib/finance-api";
import { vaultKeys } from "@/lib/vault-api";
import FinanceAccounts from "@/pages/FinanceAccounts";

const STATUS = {
  has_code: false,
  has_data: true,
  unlocked: false,
  expires_at: null,
  locked_until: null,
  remaining: 5,
  has_keyring: false,
  device_share: false,
  device_bound: true,
  has_main_device: true,
  device_allowed: true,
};

function Frame({ children, path, client }: { children: ReactNode; path: string; client?: QueryClient }) {
  const [own] = useState(() => client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={own}>
      <MemoryRouter initialEntries={[path]}>
        <VaultLockProvider>
          <div className="paper flex min-h-[100dvh] flex-col">{children}</div>
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Probe() {
  const vault = useVaultLock();
  return <p data-testid="probe">{vault.isLoading ? "loading" : `open=${vault.isFinanceOpen} code=${vault.hasCode}`}</p>;
}

async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const fakeToken = `x.${btoa(JSON.stringify({ session_id: "11111111-2222-3333-4444-555555555555" }))}.y`;

beforeEach(async () => {
  db.rpc = {};
  db.tables = {};
  db.calls = [];
  db.session = null;
  onlineManager.setOnline(true);
  await lastKnown.clearAll();
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

test("KT06-A1 · máy đã chứng minh: vào Két sắt chỉ MỘT lời gọi khoá + trạng thái, không ký lại", async () => {
  db.rpc.vault_enter = () => ({ data: { ...STATUS, device_proven: true }, error: null });
  const screen = await render(
    <Frame path="/ket-sat/mat-khau">
      <Probe />
    </Frame>,
  );
  await expect.element(screen.getByTestId("probe")).toHaveTextContent("open=true code=false");
  const vaultCalls = db.calls.filter((c) => /rpc:(vault_|device_)/.test(c));
  expect(vaultCalls).toEqual(["rpc:vault_enter"]);
});

test("KT06-A2 · máy chủ nói chưa chứng minh: xin nonce một lần, ký (device-prove), rồi hỏi lại không khoá", async () => {
  db.session = { access_token: fakeToken, user: { id: "me" } };
  const enters: Record<string, unknown>[] = [];
  let proven = false;
  db.rpc.vault_enter = (args) => {
    enters.push(args);
    return { data: { ...STATUS, device_proven: proven }, error: null };
  };
  db.rpc.device_session = () => ({ data: { proven: false, nonce: "bm9uY2U=" }, error: null });
  const fetchMock = vi.fn(async () => {
    proven = true;
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const screen = await render(
    <Frame path="/ket-sat/mat-khau">
      <Probe />
    </Frame>,
  );
  await expect.element(screen.getByTestId("probe")).toHaveTextContent("open=true");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/functions/v1/device-prove");
  expect(enters.map((a) => a.p_lock)).toEqual([true, false]);
  expect(db.calls).not.toContain("rpc:device_challenge");
  expect(db.calls).not.toContain("rpc:vault_status");
});

test("KT06-A3 · mở thẳng Tài chính: sổ được hỏi cùng lúc, và chỉ vào bộ nhớ khi máy chủ nói Tài chính mở", async () => {
  db.rpc.vault_enter = () => ({ data: { ...STATUS, device_proven: true }, error: null });
  db.tables.accounts = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <Frame path="/ket-sat/tai-khoan" client={client}>
      <Probe />
    </Frame>,
  );
  await expect.element(screen.getByTestId("probe")).toHaveTextContent("open=true");
  expect(db.calls).toContain("from:accounts");
  expect(db.calls).toContain("from:transactions");
  expect(client.getQueryData(financeKeys.accounts)).toBeDefined();
});

test("KT06-A4 · có mã và đang khoá: sổ hỏi trước bị bỏ, không nằm lại trong bộ nhớ", async () => {
  db.rpc.vault_enter = () => ({ data: { ...STATUS, has_code: true, device_proven: true }, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <Frame path="/ket-sat" client={client}>
      <Probe />
    </Frame>,
  );
  await expect.element(screen.getByTestId("probe")).toHaveTextContent("open=false code=true");
  await settle(200);
  expect(client.getQueryData(financeKeys.accounts)).toBeUndefined();
  expect(client.getQueryData(financeKeys.transactions)).toBeUndefined();
});

/** Vault status already known (no code → Tài chính open), then the network goes away before the ledger is read. */
function offlineClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(vaultKeys.status("me"), {
    hasCode: false, hasData: true, unlocked: false, expiresAt: null, lockedUntil: null, remaining: 5,
    hasKeyring: false, deviceShare: false, deviceAllowed: true, deviceBound: true, hasMainDevice: true,
  });
  return client;
}

test("KT06-B1 · mất mạng, chưa từng đọc: Tài khoản ghi 'Chưa tải được', không có '0 ₫', không mời 'Chưa có tài khoản'", async () => {
  await page.viewport(390, 844);
  onlineManager.setOnline(false);
  const screen = await render(
    <Frame path="/ket-sat/tai-khoan" client={offlineClient()}>
      <FinanceAccounts />
    </Frame>,
  );
  await expect.element(screen.getByText("Chưa tải được số dư tài khoản")).toBeVisible();
  await settle(300);
  const text = document.body.innerText;
  expect(text).not.toMatch(/0\s?₫/);
  expect(text).not.toContain("Chưa có tài khoản nào");
});

test("KT06-B2 · mất mạng, đã từng thấy: hiện tổng gần nhất kèm 'Đang ngoại tuyến · cập nhật lúc …'", async () => {
  await page.viewport(390, 844);
  await lastKnown.set("me", "finance.accounts.totals", { assetsCents: 45_500_000, liabilitiesCents: 0, netCents: 45_500_000, currency: "VND" });
  onlineManager.setOnline(false);
  const screen = await render(
    <Frame path="/ket-sat/tai-khoan" client={offlineClient()}>
      <FinanceAccounts />
    </Frame>,
  );
  await expect.element(screen.getByText(/Đang ngoại tuyến · cập nhật lúc \d\d:\d\d/)).toBeVisible();
  expect(document.body.innerText).toMatch(/455\.000/);
  expect(document.body.innerText).not.toContain("Chưa có tài khoản nào");
});

test("KT06-B3 · có mạng: số đọc được được ghi nhớ (chỉ các tổng), gắn với người dùng", async () => {
  db.tables.accounts = [];
  const screen = await render(
    <Frame path="/ket-sat/tai-khoan" client={offlineClient()}>
      <FinanceAccounts />
    </Frame>,
  );
  await expect.element(screen.getByText("Giá trị ròng")).toBeVisible();
  await settle(300);
  const saved = await lastKnown.get<Record<string, unknown>>("me", "finance.accounts.totals");
  expect(saved).not.toBeNull();
  expect(Object.keys(saved?.value ?? {}).sort()).toEqual(["assetsCents", "currency", "liabilitiesCents", "netCents"]);
});
