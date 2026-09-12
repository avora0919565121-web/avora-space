import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { isActionableResendError, isEmailNotConfirmed, toVietnameseError } from "@/lib/auth-errors";

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
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** Sends the confirmation email again for an address that signed up but never confirmed. */
  resendConfirmation: (email: string) => Promise<AuthResult>;
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
      console.error(`[auth] load profile failed (${error.code ?? "unknown"}):`, error.message);
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
    async (email: string, password: string, displayName: string): Promise<AuthResult> => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: window.location.origin,
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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      // Flagged so the screen can offer to send the confirmation email again instead of
      // leaving the person stuck on a message they cannot act on.
      const needsEmailConfirmation = isEmailNotConfirmed(error.message);
      return { ok: false, message: toVietnameseError(error.message), needsEmailConfirmation };
    }
    return { ok: true };
  }, []);

  const resendConfirmation = useCallback(async (email: string): Promise<AuthResult> => {
    const trimmed = email.trim();
    if (trimmed.length === 0) return { ok: false, message: "Vui lòng nhập email của bạn." };

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });

    // Rate limits and network failures are real and actionable. Anything else (unknown
    // address, already confirmed) stays silent so this cannot be used to probe accounts.
    if (error && isActionableResendError(error.message)) {
      return { ok: false, message: toVietnameseError(error.message) };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    writeRecoveryFlag(false);
    setIsRecovering(false);
    setProfile(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/dat-lai-mat-khau`,
    });

    // Supabase answers the same way whether or not the address exists, and so do we:
    // the screen must never become a way to check who has an AVORA account.
    if (error) {
      console.error(`[auth] password reset request failed: ${error.message}`);
      return { ok: false, message: toVietnameseError(error.message) };
    }
    return { ok: true };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      console.error(`[auth] password update failed: ${error.message}`);
      return { ok: false, message: toVietnameseError(error.message) };
    }

    // Whoever had the old password may still hold a session elsewhere; a reset must end it.
    // The current tab keeps its session, so a failure here is not worth blocking the user.
    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch (signOutError) {
      console.error("[auth] could not revoke other sessions:", signOutError);
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
        console.error(`[auth] update profile failed (${error.code ?? "unknown"}):`, error.message);
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

/** Display name with a graceful fallback to the email handle. */
export function useDisplayName(): string {
  const { profile, user } = useAuth();
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile && fromProfile.length > 0) return fromProfile;
  return user?.email ?? "Bạn";
}
