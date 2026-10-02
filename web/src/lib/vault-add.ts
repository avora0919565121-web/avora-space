/**
 * Két sắt's single `+` beside the title (AVORA-57 · E).
 *
 * The label follows the sub-tab. A sub-tab still showing its "Sắp có" screen has `enabled: false`
 * and no `+` at all — when it is built, flipping that flag and registering a handler is all it
 * takes.
 */
export type VaultAddEntry = { path: string; label: string; enabled: boolean };

export const VAULT_ADD_ENTRIES: readonly VaultAddEntry[] = [
  { path: "/ket-sat", label: "Giao dịch", enabled: true },
  { path: "/ket-sat/mat-khau", label: "Mật khẩu", enabled: false },
  { path: "/ket-sat/chung-chi", label: "Chứng chỉ", enabled: true },
  { path: "/ket-sat/tai-lieu", label: "Tài liệu", enabled: true },
  { path: "/ket-sat/tai-san", label: "Tài sản", enabled: true },
];

/** The entry for the sub-tab that is open (finance sub-routes belong to Tài chính). */
export function vaultAddFor(activeTab: string): VaultAddEntry | null {
  const entry = VAULT_ADD_ENTRIES.find((item) => item.path === activeTab) ?? null;
  return entry !== null && entry.enabled ? entry : null;
}

const EVENT = "avora:vault-add";
let listeners = 0;

/** A finance screen that can open its own "add" form listens while it is on screen. */
export function onVaultAdd(handler: () => void): () => void {
  listeners += 1;
  window.addEventListener(EVENT, handler);
  return () => {
    listeners -= 1;
    window.removeEventListener(EVENT, handler);
  };
}

/** True when a mounted screen took the request; false means the caller should navigate. */
export function requestVaultAdd(): boolean {
  if (listeners === 0) return false;
  window.dispatchEvent(new Event(EVENT));
  return true;
}

/** Query flag a finance screen reads on arrival when it was not mounted yet. */
export const VAULT_ADD_PARAM = "them";
