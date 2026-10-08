import createContextHook from "@nkzw/create-context-hook";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { ensureDeviceProven } from "@/lib/device";
import { financeKeys } from "@/lib/finance-api";
import { logError } from "@/lib/log";
import { useDocumentVisible } from "@/lib/use-document-visible";
import {
  VAULT_LOCKED_EVENT,
  changeVaultCode,
  confirmVaultReset,
  fetchVaultStatus,
  lockVault,
  setVaultCode,
  touchVault,
  unlockVault,
  vaultKeys,
} from "@/lib/vault-api";
import { VAULT_TOUCH_MS, leftTooLong, type VaultAttempt, type VaultStatus } from "@/lib/vault-lock";
import { clearVaultKeys, openWithDeviceShare } from "@/lib/vault-keys";

/** Everything the Két sắt keeps in the query cache — dropped the moment it locks. */
const VAULT_QUERY_ROOTS: readonly (readonly string[])[] = [financeKeys.all, ["obligation-reminders"], ["vault-items"], ["vault-keyring"]];

export function isVaultPath(pathname: string): boolean {
  return pathname === "/ket-sat" || pathname.startsWith("/ket-sat/");
}

/**
 * AVORA-51 · the Két sắt lock as the app sees it. The server is the lock (RLS + every Két sắt
 * RPC); this only mirrors it, keeps "unlocked" in memory, and decides when to ask again:
 *  · every start of the app locks first (a reload asks for the code — 51.4);
 *  · leaving Két sắt for more than 5 minutes locks it (51.2), coming back sooner does not (51.3);
 *  · while Két sắt is open and on screen it tells the server once a minute that it is in use.
 */
export const [VaultLockProvider, useVaultLock] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const location = useLocation();
  const isVisible = useDocumentVisible();
  const startedFor = useRef<string | null>(null);

  const statusQuery = useQuery<VaultStatus, Error>({
    queryKey: vaultKeys.status(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      // AVORA-102 · A1.3: tie this session to this device before the server is asked anything.
      await ensureDeviceProven();
      // The first look in this app start locks whatever an earlier tab of this session left open.
      if (startedFor.current !== userId) {
        startedFor.current = userId ?? null;
        await lockVault().catch((error: unknown) => logError("vault", error));
      }
      return fetchVaultStatus();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const status: VaultStatus | null = statusQuery.data ?? null;
  const isUnlocked: boolean = status?.unlocked === true;

  const putStatus = useCallback(
    (patch: Partial<VaultStatus>): void => {
      queryClient.setQueryData<VaultStatus>(vaultKeys.status(userId), (old) =>
        old === undefined ? old : { ...old, ...patch },
      );
    },
    [queryClient, userId],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: vaultKeys.status(userId) });
  }, [queryClient, userId]);

  // Locked: nothing of the Két sắt stays in memory, on any screen.
  useEffect(() => {
    if (isUnlocked) return;
    for (const key of VAULT_QUERY_ROOTS) queryClient.removeQueries({ queryKey: key });
    // AVORA-68: the master key and every section key leave memory with the lock.
    clearVaultKeys();
  }, [isUnlocked, queryClient]);

  // The finance layer heard "locked" from the server: believe it.
  useEffect(() => {
    const onLocked = (): void => putStatus({ unlocked: false, expiresAt: null });
    window.addEventListener(VAULT_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(VAULT_LOCKED_EVENT, onLocked);
  }, [putStatus]);

  const lock = useCallback(async (): Promise<void> => {
    putStatus({ unlocked: false, expiresAt: null });
    await lockVault().catch((error: unknown) => logError("vault", error));
  }, [putStatus]);

  const inVault: boolean = isVaultPath(location.pathname);
  const leftAt = useRef<number | null>(null);
  useEffect(() => {
    if (inVault) {
      if (leftTooLong(leftAt.current, Date.now())) void lock();
      else if (leftAt.current !== null) void refresh();
      leftAt.current = null;
    } else if (isUnlocked && leftAt.current === null) {
      leftAt.current = Date.now();
    }
  }, [inVault, isUnlocked, lock, refresh]);

  useEffect(() => {
    if (!inVault || !isUnlocked || !isVisible) return;
    const id = window.setInterval(() => {
      void touchVault()
        .then((stillOpen) => {
          if (!stillOpen) putStatus({ unlocked: false, expiresAt: null });
        })
        .catch((error: unknown) => logError("vault", error));
    }, VAULT_TOUCH_MS);
    return () => window.clearInterval(id);
  }, [inVault, isUnlocked, isVisible, putStatus]);

  const opened = useCallback((): void => {
    putStatus({ unlocked: true, hasCode: true, lockedUntil: null, remaining: 5 });
    for (const key of VAULT_QUERY_ROOTS) void queryClient.invalidateQueries({ queryKey: key });
  }, [putStatus, queryClient]);

  const afterAttempt = useCallback(
    (attempt: VaultAttempt): VaultAttempt => {
      if (attempt.ok === true) {
        opened();
        return attempt;
      }
      if ("lockedUntil" in attempt) putStatus({ lockedUntil: attempt.lockedUntil, remaining: 0 });
      else if ("remaining" in attempt) putStatus({ remaining: attempt.remaining });
      return attempt;
    },
    [opened, putStatus],
  );

  const unlock = useCallback(
    async (code: string) => {
      const attempt = afterAttempt(await unlockVault(code));
      // AVORA-68 · 2.3: a right code on a device that holds a share opens the master key too.
      if (attempt.ok === true && userId !== undefined) await openWithDeviceShare(userId);
      return attempt;
    },
    [afterAttempt, userId],
  );
  const setCode = useCallback(
    async (code: string): Promise<void> => {
      await setVaultCode(code);
      opened();
    },
    [opened],
  );
  const changeCode = useCallback(
    async (oldCode: string, newCode: string) => afterAttempt(await changeVaultCode(oldCode, newCode)),
    [afterAttempt],
  );
  const confirmReset = useCallback(
    async (emailCode: string, newCode: string) => afterAttempt(await confirmVaultReset(emailCode, newCode)),
    [afterAttempt],
  );

  return useMemo(
    () => ({
      status,
      isLoading: statusQuery.isPending,
      error: statusQuery.error,
      isUnlocked,
      lock,
      refresh,
      unlock,
      setCode,
      changeCode,
      confirmReset,
    }),
    [status, statusQuery.isPending, statusQuery.error, isUnlocked, lock, refresh, unlock, setCode, changeCode, confirmReset],
  );
});

/** Whether the Két sắt is open in this session right now. False outside the provider. */
export function useVaultUnlocked(): boolean {
  const vault = useVaultLock() as ReturnType<typeof useVaultLock> | undefined;
  return vault?.isUnlocked === true;
}
