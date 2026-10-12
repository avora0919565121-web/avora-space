import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import {
  checkCode,
  clearChatLock,
  idleExpired,
  readConfig,
  readLocked,
  saveCode,
  startsLocked,
  verifyDevice,
  writeConfig,
  writeLocked,
  type ChatAutoLock,
  type ChatLockConfig,
  type CodeCheck,
} from "@/lib/chat-lock";

const IDLE_CHECK_MS = 10_000;

/**
 * AVORA-109 · A — who knows whether Kết nối is covered on this device. Known to every screen so
 * the tab badge, the window title and Avora Space's unread line can hide while it is locked.
 */
export type ChatLockState = {
  config: ChatLockConfig | null;
  isEnabled: boolean;
  isLocked: boolean;
  lock: () => void;
  unlockWithDevice: () => Promise<boolean>;
  unlockWithCode: (code: string) => Promise<CodeCheck>;
  confirmOwner: (code: string | null) => Promise<CodeCheck>;
  setUp: (input: { method: "code"; code: string } | { method: "device"; credentialId: string }, closeNow?: boolean) => Promise<void>;
  setAutoLock: (autoLock: ChatAutoLock) => void;
  turnOff: () => Promise<void>;
};

/** Outside the signed-in frame (public pages, isolated tests) there is no lock. */
const NO_LOCK: ChatLockState = {
  config: null,
  isEnabled: false,
  isLocked: false,
  lock: () => undefined,
  unlockWithDevice: async () => false,
  unlockWithCode: async () => ({ ok: false, waitUntil: 0, fails: 0 }),
  confirmOwner: async () => ({ ok: true }),
  setUp: async () => undefined,
  setAutoLock: () => undefined,
  turnOff: async () => undefined,
};

export const [ChatLockProvider, useChatLock] = createContextHook((): ChatLockState => {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [config, setConfig] = useState<ChatLockConfig | null>(() => (userId === "" ? null : readConfig(userId)));
  const [isLocked, setIsLocked] = useState<boolean>(() =>
    userId === "" ? false : startsLocked(readConfig(userId), readLocked(userId)),
  );
  const lastActiveRef = useRef<number>(Date.now());

  // Another account signed in on this device: read its own lock.
  const seenUserRef = useRef<string>(userId);
  useEffect(() => {
    if (seenUserRef.current === userId) return;
    seenUserRef.current = userId;
    const next = userId === "" ? null : readConfig(userId);
    setConfig(next);
    setIsLocked(userId === "" ? false : startsLocked(next, readLocked(userId)));
  }, [userId]);

  const lock = useCallback((): void => {
    if (userId === "" || readConfig(userId) === null) return;
    writeLocked(userId, true);
    setIsLocked(true);
  }, [userId]);

  const markUnlocked = useCallback((): void => {
    if (userId !== "") writeLocked(userId, false);
    lastActiveRef.current = Date.now();
    setIsLocked(false);
  }, [userId]);

  /** Device method: asks the screen lock / biometrics. */
  const unlockWithDevice = useCallback(async (): Promise<boolean> => {
    const current = userId === "" ? null : readConfig(userId);
    if (current?.credentialId === null || current?.credentialId === undefined) return false;
    const ok = await verifyDevice(current.credentialId);
    if (ok) markUnlocked();
    return ok;
  }, [markUnlocked, userId]);

  /** Code method: checks against the hash on this device; counts failures. */
  const unlockWithCode = useCallback(
    async (code: string): Promise<CodeCheck> => {
      const result = await checkCode(userId, code);
      if (result.ok) markUnlocked();
      return result;
    },
    [markUnlocked, userId],
  );

  /** Same checks without changing the locked state — used before changing or turning off the lock. */
  const confirmOwner = useCallback(
    async (code: string | null): Promise<CodeCheck> => {
      const current = userId === "" ? null : readConfig(userId);
      if (current === null) return { ok: true };
      if (current.method === "device") {
        const ok = current.credentialId !== null && (await verifyDevice(current.credentialId));
        return ok ? { ok: true } : { ok: false, waitUntil: 0, fails: 0 };
      }
      return checkCode(userId, code ?? "");
    },
    [userId],
  );

  /** Sets the lock up (first time or a new method) and closes it straight away (A1). */
  const setUp = useCallback(
    async (input: { method: "code"; code: string } | { method: "device"; credentialId: string }, closeNow = true): Promise<void> => {
      if (userId === "") return;
      if (input.method === "code") await saveCode(userId, input.code);
      const previous = readConfig(userId);
      const next: ChatLockConfig = {
        method: input.method,
        autoLock: previous?.autoLock ?? "manual",
        credentialId: input.method === "device" ? input.credentialId : null,
      };
      writeConfig(userId, next);
      setConfig(next);
      if (closeNow) {
        writeLocked(userId, true);
        setIsLocked(true);
      }
    },
    [userId],
  );

  const setAutoLock = useCallback(
    (autoLock: ChatAutoLock): void => {
      if (userId === "") return;
      const current = readConfig(userId);
      if (current === null) return;
      const next = { ...current, autoLock };
      writeConfig(userId, next);
      setConfig(next);
      lastActiveRef.current = Date.now();
    },
    [userId],
  );

  const turnOff = useCallback(async (): Promise<void> => {
    if (userId === "") return;
    await clearChatLock(userId);
    setConfig(null);
    setIsLocked(false);
  }, [userId]);

  // A3: when to close on its own.
  useEffect(() => {
    if (config === null || config.autoLock === "manual") return;
    const touch = (): void => {
      lastActiveRef.current = Date.now();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        if (config.autoLock === "leave") lock();
        return;
      }
      if (idleExpired(config.autoLock, lastActiveRef.current, Date.now())) lock();
      else touch();
    };
    const timer = window.setInterval(() => {
      if (idleExpired(config.autoLock, lastActiveRef.current, Date.now())) lock();
    }, IDLE_CHECK_MS);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const onPageHide = (): void => {
      if (config.autoLock === "leave") lock();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [config, lock]);

  return {
    config,
    isEnabled: config !== null,
    isLocked: config !== null && isLocked,
    lock,
    unlockWithDevice,
    unlockWithCode,
    confirmOwner,
    setUp,
    setAutoLock,
    turnOff,
  };
}, NO_LOCK);
