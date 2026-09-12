import { Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { HOME_ROUTE } from "@/lib/navigation";
import { readRecoveryLinkError, validateNewPassword } from "@/lib/password";

/** Where the reset link lands: choose a new password using the recovery session. */
const ResetPassword = () => {
  const navigate = useNavigate();
  const { session, isLoading, isRecovering, updatePassword } = useAuth();

  // Captured on first render: supabase-js strips the tokens from the URL as soon as it reads them.
  const initialUrl = useRef<{ hash: string; search: string }>({
    hash: window.location.hash,
    search: window.location.search,
  });

  const [password, setPassword] = useState<string>("");
  const [confirmation, setConfirmation] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);

  const linkError: string | null = useMemo(
    () => readRecoveryLinkError(initialUrl.current.hash, initialUrl.current.search),
    [],
  );

  useEffect(() => {
    if (!isDone) return;
    const timer = window.setTimeout(() => navigate(HOME_ROUTE, { replace: true }), 1600);
    return () => window.clearTimeout(timer);
  }, [isDone, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const validationError: string | null = validateNewPassword(password, confirmation);
    if (validationError !== null) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    const result = await updatePassword(password);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "Không đổi được mật khẩu. Thử lại nhé.");
      return;
    }
    setPassword("");
    setConfirmation("");
    setIsDone(true);
  };

  const canSetPassword: boolean = linkError === null && session !== null && isRecovering;
  const isChecking: boolean = isLoading && linkError === null;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <section className="paper flex flex-col justify-center border-b border-border px-8 py-12 md:w-1/2 md:border-b-0 md:border-r md:px-16 lg:px-24">
        <div className="animate-rise-in">
          <span className="wordmark text-[22px] text-foreground">AVORA</span>
          <h1 className="mt-10 max-w-md text-[34px] font-semibold leading-[1.15] tracking-tight text-foreground md:text-[40px]">
            Đặt lại mật khẩu.
          </h1>
          <p className="mt-4 max-w-sm text-[16px] leading-relaxed text-muted-foreground">
            Chọn một mật khẩu mới để tiếp tục trò chuyện.
          </p>
        </div>
        <p className="mt-14 text-[13px] text-muted-foreground md:mt-auto md:pt-16">© 2026 AVORA</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-card px-6 py-14 md:px-12">
        <div className="w-full max-w-[420px] animate-rise-in">
          {isChecking ? (
            <div className="flex items-center gap-3 text-[15px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang kiểm tra liên kết…
            </div>
          ) : isDone ? (
            <>
              <h2 className="text-[28px] font-semibold tracking-tight text-foreground">Đã đổi mật khẩu</h2>
              <p role="status" className="mt-3 flex items-center gap-2 text-[15px] text-online">
                <Check className="h-[18px] w-[18px]" strokeWidth={2} />
                Mật khẩu mới đã được lưu. Đang đưa bạn vào AVORA…
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
                Các thiết bị khác đang đăng nhập bằng mật khẩu cũ đã bị đăng xuất.
              </p>
            </>
          ) : canSetPassword ? (
            <>
              <h2 className="text-[28px] font-semibold tracking-tight text-foreground">Mật khẩu mới</h2>
              <p className="mt-1.5 text-[15px] text-muted-foreground">
                Nhập mật khẩu mới cho {session?.user.email ?? "tài khoản của bạn"}.
              </p>

              <form onSubmit={handleSubmit} className="mt-9 space-y-5" noValidate>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="newPassword" className="block text-[14px] font-medium text-foreground">
                      Mật khẩu mới
                    </label>
                    <span className="text-[13px] text-muted-foreground">Ít nhất 6 ký tự</span>
                  </div>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirmPassword" className="block text-[14px] font-medium text-foreground">
                    Nhập lại mật khẩu
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder="••••••••"
                    className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                  />
                </div>

                {error ? (
                  <p role="alert" className="rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Lưu mật khẩu mới
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-[28px] font-semibold tracking-tight text-foreground">Liên kết không dùng được</h2>
              <p role="alert" className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {linkError ??
                  "Liên kết đặt lại mật khẩu đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email mới."}
              </p>
              <Link
                to="/dang-nhap?mode=quen-mat-khau"
                className="press mt-8 flex h-12 w-full items-center justify-center rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
              >
                Gửi lại email đặt lại
              </Link>
              <Link
                to="/dang-nhap"
                className="mt-4 block text-center text-[14px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Quay lại đăng nhập
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default ResetPassword;
