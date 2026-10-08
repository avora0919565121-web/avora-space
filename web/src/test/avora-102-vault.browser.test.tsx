import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * AVORA-102 · A — Két sắt opens right after it is set, and a non-main device is told before
 * (never set-then-refused). The server half (every door checks the device, right proofs do not
 * count) is probed in supabase/tests/avora102_vault_device_gate.probe.sql.
 */

type Rpc = (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
const db: { rpc: Record<string, Rpc>; calls: { name: string; args: Record<string, unknown> }[] } = { rpc: {}, calls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const thenable = (result: unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const done = Promise.resolve(result);
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
      from: () => thenable({ data: [], error: null }),
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        db.calls.push({ name, args });
        const handler = db.rpc[name];
        return thenable(handler === undefined ? { data: null, error: null } : handler(args));
      },
      storage: { from: () => thenable({ data: [], error: null }) },
      channel: () => thenable({ data: [], error: null }),
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

import { Toaster } from "@/components/ui/sonner";
import { VaultGate } from "@/components/vault/VaultGate";
import { OPEN_HERE_FAILED, SETUP_UNBOUND_LINE, VaultOpenHere } from "@/components/vault/VaultSetup";
import { VaultLockProvider, useVaultLock } from "@/lib/use-vault-lock";
import { DEFAULT_KDF, VAULT_SECTIONS, createKeyring, newRecoveryEntropy, toB64, randomBytes } from "@/lib/vault-crypto";
import { clearVaultKeys, hasMasterKey, keyForSection, openWithPassphrase, setupVault, type Keyring } from "@/lib/vault-keys";

const OUT = "../../../docs/screens/2026-10-08";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ket-sat"]}>
        <VaultLockProvider>
          <div className="paper flex min-h-[100dvh] flex-col">{children}</div>
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Like pages/Vault.tsx: the gate mounts once the status is known. */
function Gate() {
  const vault = useVaultLock();
  if (vault.isLoading) return null;
  return <VaultGate key={vault.status?.hasCode === true ? "has-code" : "no-code"} />;
}

async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const status = (patch: Record<string, unknown>) => ({
  has_code: true,
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
  ...patch,
});

beforeEach(() => {
  db.rpc = {};
  db.calls = [];
  clearVaultKeys();
});

test("102.1 · máy bậc 3, tài khoản đã có máy chính: màn `chỉ máy chính`, không ô mã, không Quên mã", async () => {
  await page.viewport(390, 844);
  db.rpc.vault_status = () => ({ data: status({ device_allowed: false }), error: null });
  db.rpc.device_status = () => ({ data: { allowed: true, device: "d3", my_rank: 3, rank_taken: { 1: true, 2: false } }, error: null });
  const screen = await render(
    <Frame>
      <Gate />
    </Frame>,
  );
  await expect.element(screen.getByText("Két sắt chỉ mở trên điện thoại và máy tính chính của bạn.")).toBeInTheDocument();
  expect(document.querySelector("[data-vault-main-only]")).not.toBeNull();
  expect(screen.getByLabelText("Mã Két sắt").elements().length).toBe(0);
  expect(document.body.textContent).not.toContain("Quên mã");
  await expect.element(screen.getByRole("link", { name: "Cho phép mở trên máy khác" })).toHaveAttribute("href", "/cai-dat#bao-mat");
  // Nothing tried to set or open on the way.
  expect(db.calls.some((c) => c.name === "vault_set_code" || c.name === "vault_unlock" || c.name === "vault_confirm_reset")).toBe(false);
  await settle(200);
  await page.screenshot({ path: `${OUT}/102-chi-may-chinh-390.png` });
});

test("A1.3 · phiên chưa gắn máy: nói rõ `Máy này chưa được nhận ra`", async () => {
  await page.viewport(390, 844);
  db.rpc.vault_status = () => ({ data: status({ device_allowed: false, device_bound: false }), error: null });
  const screen = await render(
    <Frame>
      <Gate />
    </Frame>,
  );
  await expect.element(screen.getByText("Máy này chưa được nhận ra — đặt lại máy chính.")).toBeInTheDocument();
});

test("A1.7 · màn khoá hằng ngày ghi `Nhập mã Két sắt 6 số` và chỉ sang `Quên mã 6 số?`", async () => {
  await page.viewport(390, 844);
  db.rpc.vault_status = () => ({ data: status({}), error: null });
  const screen = await render(
    <Frame>
      <Gate />
    </Frame>,
  );
  await expect.element(screen.getByText("Nhập mã Két sắt 6 số")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Quên mã 6 số?" })).toBeInTheDocument();
});

const PASS_NFD = "Mật khẩu két sắt của tôi".normalize("NFD");

/** A keyring made with the passphrase typed in NFD, and a server mock that checks proofs. */
async function serverWithKeyring(): Promise<Keyring> {
  const made = await createKeyring("me", PASS_NFD, newRecoveryEntropy(), DEFAULT_KDF);
  db.rpc.vault_prove = (args) => ({ data: args.p_kind === "pass" && args.p_proof === made.passProof, error: null });
  db.rpc.vault_register_device_share = () => ({ data: toB64(randomBytes(32)), error: null });
  return { ...made.wire, kit_confirmed_at: new Date().toISOString() };
}

test("102.6 · đặt bằng NFD, mở bằng NFC + dấu cách cuối → vào được", async () => {
  const ring = await serverWithKeyring();
  await openWithPassphrase("me", ring, `${PASS_NFD.normalize("NFC")} `);
  expect(hasMasterKey()).toBe(true);
});

test("102.4 · sau khi mở: cả 3 ngăn giấy tờ đều có khoá", async () => {
  const ring = await serverWithKeyring();
  await openWithPassphrase("me", ring, PASS_NFD);
  for (const section of VAULT_SECTIONS) {
    await expect(keyForSection("me", ring, section)).resolves.toBeDefined();
  }
});

test("102.5 (máy) · 6 lần mở liền bằng Mật khẩu Két sắt đúng: lần nào cũng vào", async () => {
  const ring = await serverWithKeyring();
  for (let i = 0; i < 6; i += 1) {
    clearVaultKeys();
    await openWithPassphrase("me", ring, PASS_NFD);
    expect(hasMasterKey()).toBe(true);
  }
});

test("102.7 · keyring đã ghi, gắn máy lỗi → vẫn là đặt xong; lần sau mở bằng Mật khẩu được", async () => {
  db.rpc.vault_setup = () => ({ data: null, error: null });
  db.rpc.vault_register_device_share = () => ({ data: null, error: { message: "avora_device_unbound", code: "P0001" } });
  const result = await setupVault("me", PASS_NFD, newRecoveryEntropy());
  expect(result).toEqual({ deviceBound: false, code: "avora_device_unbound" });
  expect(hasMasterKey()).toBe(true);
  expect(SETUP_UNBOUND_LINE).toBe("Két sắt đã mã hoá. Máy này chưa gắn — lần sau mở bằng Mật khẩu Két sắt.");
  clearVaultKeys();
  const ring = await serverWithKeyring();
  await openWithPassphrase("me", ring, PASS_NFD);
  expect(hasMasterKey()).toBe(true);
});

test("A0.4 · lỗi máy (không phải sai mật khẩu) → một câu tiếng Việt; ô mật khẩu có 👁", async () => {
  await page.viewport(390, 844);
  const ring = await serverWithKeyring();
  // A keyring whose wrapped key is garbage: proof passes, WebCrypto then fails in English.
  const broken: Keyring = { ...ring, mk_wrapped_pass: toB64(randomBytes(60)) };
  const screen = await render(
    <Frame>
      <VaultOpenHere ring={broken} onRecovered={() => undefined} />
    </Frame>,
  );
  await expect.element(screen.getByText("Nhập Mật khẩu Két sắt (cụm dài bạn đặt khi mã hoá)")).toBeInTheDocument();
  const input = document.querySelector<HTMLInputElement>("[data-open-passphrase]") as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.getAttribute("autocapitalize")).toBe("none");
  expect(input.getAttribute("autocorrect")).toBe("off");
  expect(document.querySelector("[data-secret-toggle]")).not.toBeNull();
  await screen.getByLabelText("Mật khẩu Két sắt", { exact: true }).fill(PASS_NFD);
  await screen.getByRole("button", { name: "Mở" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(OPEN_HERE_FAILED);
  expect(document.body.textContent ?? "").not.toMatch(/OperationError|decrypt|The operation failed/i);
});

test("A0.4 · sai Mật khẩu Két sắt vẫn nói đúng là sai", async () => {
  const ring = await serverWithKeyring();
  const screen = await render(
    <Frame>
      <VaultOpenHere ring={ring} onRecovered={() => undefined} />
    </Frame>,
  );
  await screen.getByLabelText("Mật khẩu Két sắt", { exact: true }).fill("một cụm khác hẳn nhé");
  await screen.getByRole("button", { name: "Mở" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Mật khẩu Két sắt chưa đúng.");
});
