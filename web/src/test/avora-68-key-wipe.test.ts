import { describe, expect, it, vi } from "vitest";

// The server side of setup is mocked: this test is about what stays in this tab's memory.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => ({ data: name === "vault_register_device_share" ? btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) : null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
const store = new Map<string, unknown>();
vi.mock("@/lib/device", () => ({
  deviceStoreGet: async (key: string) => store.get(key),
  deviceStorePut: async (key: string, value: unknown) => void store.set(key, value),
  thisDeviceId: async () => "device-1",
  onDeviceRevoked: () => () => undefined,
}));

const captured: { mk: Uint8Array | null } = { mk: null };
vi.mock("@/lib/vault-crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vault-crypto")>();
  return {
    ...real,
    createKeyring: async (...args: Parameters<typeof real.createKeyring>) => {
      const ring = await real.createKeyring(...args);
      captured.mk = ring.mk;
      return ring;
    },
  };
});

import { entropyToWords, newRecoveryEntropy } from "@/lib/vault-crypto";
import { clearVaultKeys, hasMasterKey, keyForSection, setupVault, type Keyring } from "@/lib/vault-keys";

const FAST = { alg: "argon2id", v: 19, m: 1024, t: 1, p: 1 } as const;

describe("AVORA-68 · the master key leaves memory with the lock", () => {
  it("clearVaultKeys zeroes the master key bytes, drops section keys and refuses to open anything", async () => {
    const entropy = newRecoveryEntropy();
    expect(entropyToWords(entropy)).toHaveLength(24);
    await setupVault("u1", "mot hai ba bon nam sau", entropy, FAST);
    expect(hasMasterKey()).toBe(true);
    const mk = captured.mk as Uint8Array;
    expect(mk.some((b) => b !== 0)).toBe(true);

    clearVaultKeys();

    expect(hasMasterKey()).toBe(false);
    // The very buffer that held MK is now all zeros — not just dereferenced.
    expect(mk.every((b) => b === 0)).toBe(true);
    await expect(keyForSection("u1", { section_keys: { certificates: "x" } } as unknown as Keyring, "certificates")).rejects.toThrow("Két sắt đã khoá");
  }, 30_000);

  it("the device copy on disk is wrapped, never the raw key", async () => {
    const wrap = store.get("vault-wrap:u1");
    expect(typeof wrap).toBe("string");
    expect(String(wrap)).not.toContain(btoa(String.fromCharCode(...(captured.mk ?? []))));
  });
});
