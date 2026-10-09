import { logError } from "@/lib/log";
import { disablePushHere } from "@/lib/push";
import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { clearAllDrafts } from "@/lib/chat-drafts";
import { APP_ORIGIN } from "@/lib/app-origin";
import { outboxStore } from "@/lib/outbox";
import { clearThreadCache } from "@/lib/thread-cache";
import { isActionableResendError, isEmailNotConfirmed, toVietnameseError } from "@/lib/auth-errors";
import { getCaptchaToken } from "@/lib/turnstile";
import { isSafeReturnPath } from "@/lib/return-to";
import { clearTabMemory } from "@/lib/tab-memory";

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type AuthResult = {
  ok: boolean;
  /** Present only when ok is false. */
  message?: string;
  /** True when Supabase requires the user to confirm their email before signing in. */
  needsEmailConfirmation?: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Vietnamese message when the profile could not be read (e.g. backend privileges). */
  profileError: string | null;
  isLoading: boolean;
  /** True while the session came from a password-recovery link and no new password is set yet. */
  isRecovering: boolean;
  /** `redirectPath`: where the confirmation link should land (an invite link that is waiting). */
  signUp: (email: string, password: string, displayName: string, redirectPath?: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** Sends the confirmation email again for an address that signed up but never confirmed. */
  resendConfirmation: (email: string, redirectPath?: string) => Promise<AuthResult>;
  /** AVORA-54 · B — sends a one-time 6-digit code to the email, never creating an account. */
  sendEmailOtp: (email: string) => Promise<AuthResult>;
  /** AVORA-54 · B — checks the 6-digit code and signs in. */
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult>;
  /** AVORA-54 · C — signs every other device out; this tab keeps its session. */
  signOutOthers: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
};

/**
 * A recovery session is an ordinary session, so the only way to know the user arrived from a
 * reset link is the PASSWORD_RECOVERY event — which fires once. Keeping the flag in
 * sessionStorage means reloading the reset page does not strand the user, while a new tab or
 * a normal sign-in never inherits it.
 */
const RECOVERY_FLAG_KEY = "avora.password-recovery";

/**
 * AVORA-53 · 1.2 — the confirmation email lands back on the page that was waiting (an invite
 * link), not on the bare origin. Only a safe in-app path is ever appended.
 */
export function confirmationRedirect(redirectPath: string | undefined, origin: string = APP_ORIGIN): string {
  if (redirectPath === undefined || !isSafeReturnPath(redirectPath) || redirectPath.startsWith("/dang-nhap")) return origin;
  return `${origin}${redirectPath}`;
}

function readRecoveryFlag(): boolean {
  try {
    return window.sessionStorage.getItem(RECOVERY_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRecoveryFlag(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");
    else window.sessionStorage.removeItem(RECOVERY_FLAG_KEY);
  } catch {
    // Private browsing can block sessionStorage; the in-memory flag still carries the flow.
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Maps Postgres/PostgREST errors on the profiles table to short Vietnamese messages. */
function toVietnameseDbError(code: string | undefined, message: string): string {
  // 42501 = missing table privilege, 42P01 = missing table: both are backend setup problems.
  if (code === "42501" || code === "42P01") return "Máy chủ chưa cho phép ghi hồ sơ. Vui lòng báo lại cho chúng tôi.";
  // RLS row check failed: the row does not belong to this account.
  if (code === "PGRST301" || message.toLowerCase().includes("row-level security"))
    return "Bạn chỉ có thể sửa hồ sơ của chính mình.";
  if (message.toLowerCase().includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Không lưu được tên hiển thị. Thử lại nhé.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRecovering, setIsRecovering] = useState<boolean>(() => readRecoveryFlag());

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        writeRecoveryFlag(true);
        setIsRecovering(true);
      }
      if (event === "SIGNED_OUT") {
        writeRecoveryFlag(false);
        setIsRecovering(false);
      }
      setSession(nextSession);
      setIsLoading(false);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const userId: string | undefined = session?.user.id;

  const loadProfile = useCallback(async (id: string): Promise<void> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      logError("auth", error);
      setProfileError(toVietnameseDbError(error.code, error.message));
      return;
    }
    setProfileError(null);
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    void loadProfile(userId);
  }, [userId, loadProfile]);

  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!userId) return;
    await loadProfile(userId);
  }, [userId, loadProfile]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string, redirectPath?: string): Promise<AuthResult> => {
      let captchaToken: string | undefined;
      try {
        captchaToken = await getCaptchaToken("sign_up");
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: confirmationRedirect(redirectPath),
          captchaToken,
        },
      });

      if (error) return { ok: false, message: toVietnameseError(error.message) };

      // No session means Supabase requires email confirmation before sign-in.
      if (!data.session) return { ok: true, needsEmailConfirmation: true };

      // Trigger creates the row; make sure a display name typed here always lands.
      if (data.user && displayName.trim().length > 0) {
        await supabase
          .from("profiles")
          .upsert({ id: data.user.id, display_name: displayName.trim() }, { onConflict: "id" });
        await loadProfile(data.user.id);
      }
      return { ok: true };
    },
    [loadProfile],
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    let captchaToken: string | undefined;
    try {
      captchaToken = await getCaptchaToken("sign_in");
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } });
    if (error) {
      // Flagged so the screen can offer to send the confirmation email again instead of
      // leaving the person stuck on a message they cannot act on.
      const needsEmailConfirmation = isEmailNotConfirmed(error.message);
      return { ok: false, message: toVietnameseError(error.message), needsEmailConfirmation };
    }
    return { ok: true };
  }, []);

  const resendConfirmation = useCallback(async (email: string, redirectPath?: string): Promise<AuthResult> => {
    const trimmed = email.trim();
    if (trimmed.length === 0) return { ok: false, message: "Vui lòng nhập email của bạn." };

    let captchaToken: string | undefined;
    try {
      captchaToken = await getCaptchaToken("resend");
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: trimmed,
      options: { emailRedirectTo: confirmationRedirect(redirectPath), captchaToken },
    });

    // Rate limits and network failures are real and actionable. Anything else (unknown
    // address, already confirmed) stays silent so this cannot be used to probe accounts.
    if (error && isActionableResendError(error.message)) {
      return { ok: false, message: toVietnameseError(error.message) };
    }
    return { ok: true };
  }, []);

  /**
   * AVORA-54 · B — the email-code path. `shouldCreateUser: false` keeps this from being a way to
   * make an account: only an existing address receives a code. Supabase answers the same whether
   * or not the address exists, and rate limiting is the only error worth surfacing — everything
   * else keeps the screen's one generic sentence, so this cannot be used to probe accounts.
   */
  const sendEmailOtp = useCallback(async (email: string): Promise<AuthResult> => {
    let captchaToken: string | undefined;
    try {
      captchaToken = await getCaptchaToken("email_code");
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, captchaToken },
    });
    if (error) {
      logError("auth", { code: error.code, message: error.message });
      const m = error.message.toLowerCase();
      if (m.includes("rate") || m.includes("too many") || m.includes("request_timeout")) {
        return { ok: false, message: "Bạn vừa xin mã rồi. Thử lại sau ít phút nhé." };
      }
      if (m.includes("failed to fetch") || m.includes("network")) {
        return { ok: false, message: "Không kết nối được máy chủ. Kiểm tra mạng và thử lại." };
      }
      // Unknown address, signups disabled, anything else: the same calm answer.
    }
    return { ok: true };
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
    if (error) {
      logError("auth", { code: error.code, message: error.message });
      return { ok: false, message: "Mã chưa đúng hoặc đã hết hạn." };
    }
    return { ok: true };
  }, []);

  /**
   * AVORA-54 · C — ends every other session of this account; this tab stays signed in. The
   * devices that lose their session see it at their next action, and Két sắt locks with it.
   */
  const signOutOthers = useCallback(async (): Promise<AuthResult> => {
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      logError("auth", error);
      return { ok: false, message: "Không đăng xuất được các thiết bị khác. Thử lại nhé." };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    // AVORA-46: this device stops receiving this account's notifications.
    await disablePushHere().catch(() => undefined);
    // AVORA-51: signing out locks Két sắt for this session at once (not 5 minutes later).
    await supabase.rpc("vault_lock").then(() => undefined, () => undefined);
    await supabase.auth.signOut();
    // Half-typed messages stay on this device only while signed in (Đợt gộp 2 · A8).
    clearAllDrafts();
    // AVORA-106 · K2/K3: the outbox and the thread copies belong to this account only.
    await Promise.all([outboxStore.clear(), clearThreadCache()]).catch(() => undefined);
    // AVORA-77 · G: where each tab stood is forgotten on sign-out.
    clearTabMemory();
    writeRecoveryFlag(false);
    setIsRecovering(false);
    setProfile(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    let captchaToken: string | undefined;
    try {
      captchaToken = await getCaptchaToken("reset_password");
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${APP_ORIGIN}/dat-lai-mat-khau`,
      captchaToken,
    });

    // Supabase answers the same way whether or not the address exists, and so do we:
    // the screen must never become a way to check who has an AVORA account.
    if (error) {
      logError("auth", error);
      return { ok: false, message: toVietnameseError(error.message) };
    }
    return { ok: true };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      logError("auth", error);
      return { ok: false, message: toVietnameseError(error.message) };
    }

    // Whoever had the old password may still hold a session elsewhere; a reset must end it.
    // The current tab keeps its session, so a failure here is not worth blocking the user.
    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch (signOutError) {
      logError("auth", signOutError);
    }

    writeRecoveryFlag(false);
    setIsRecovering(false);
    return { ok: true };
  }, []);

  const updateDisplayName = useCallback(
    async (displayName: string): Promise<AuthResult> => {
      if (!userId) return { ok: false, message: "Bạn chưa đăng nhập." };
      // Always scope the write to the signed-in id so it matches the RLS policy (auth.uid() = id).
      const { data, error } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() })
        .eq("id", userId)
        .select("id")
        .maybeSingle();

      if (error) {
        logError("auth", error);
        return { ok: false, message: toVietnameseDbError(error.code, error.message) };
      }
      if (!data) return { ok: false, message: "Không tìm thấy hồ sơ của bạn. Hãy đăng nhập lại." };
      await loadProfile(userId);
      return { ok: true };
    },
    [userId, loadProfile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      isLoading,
      isRecovering,
      signUp,
      signIn,
      resendConfirmation,
      sendEmailOtp,
      verifyEmailOtp,
      signOutOthers,
      signOut,
      refreshProfile,
      updateDisplayName,
      requestPasswordReset,
      updatePassword,
    }),
    [
      session,
      profile,
      profileError,
      isLoading,
      isRecovering,
      signUp,
      signIn,
      resendConfirmation,
      sendEmailOtp,
      verifyEmailOtp,
      signOutOthers,
      signOut,
      refreshProfile,
      updateDisplayName,
      requestPasswordReset,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return context;
}

/** Display name, or "Bạn" — never the email (AVORA-51 · B3: an address is not a name, and it is private). */
export function useDisplayName(): string {
  const { profile } = useAuth();
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile && fromProfile.length > 0) return fromProfile;
  return "Bạn";
}
