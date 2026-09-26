import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { returnPathFrom } from "@/lib/navigation";

type Mode = "signin" | "signup" | "forgot";

function readMode(value: string | null): Mode {
  if (value === "dang-ky") return "signup";
  if (value === "quen-mat-khau") return "forgot";
  return "signin";
}

/** Sign in / sign up / request a reset link — all wired to real Supabase Auth. */
const Auth = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo: string = returnPathFrom(location.state);
  const { signIn, signUp, resendConfirmation, requestPasswordReset, session, isLoading, isRecovering } =
    useAuth();

  const mode: Mode = readMode(searchParams.get("mode"));

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState<boolean>(false);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setCanResendConfirmation(false);
  }, [mode]);

  // A recovery session must finish setting its new password before it can browse the app.
  if (!isLoading && session && isRecovering) return <Navigate to="/dat-lai-mat-khau" replace />;
  if (!isLoading && session) return <Navigate to={returnTo} replace />;

  // The return path rides along when switching between sign in / sign up / forgot.
  const switchMode = (next: Mode): void => {
    const options = { replace: true, state: location.state as unknown };
    if (next === "signup") setSearchParams({ mode: "dang-ky" }, options);
    else if (next === "forgot") setSearchParams({ mode: "quen-mat-khau" }, options);
    else setSearchParams({}, options);
  };

  const handleResendConfirmation = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    const result = await resendConfirmation(email);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? null);
      return;
    }
    setCanResendConfirmation(false);
    setNotice("Đã gửi lại email xác nhận. Kiểm tra hộp thư, kể cả mục spam.");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setCanResendConfirmation(false);

    if (mode === "forgot") {
      if (email.trim().length === 0) {
        setError("Vui lòng nhập email của bạn.");
        return;
      }
      setIsSubmitting(true);
      const reset = await requestPasswordReset(email);
      setIsSubmitting(false);

      if (!reset.ok) {
        setError(reset.message);
        return;
      }
      // Deliberately the same answer whether or not the address has an account.
      setNotice(
        "Nếu email này đã đăng ký, chúng tôi vừa gửi liên kết đặt lại mật khẩu. Kiểm tra hộp thư, kể cả mục spam.",
      );
      return;
    }

    if (email.trim().length === 0 || password.length === 0) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Mật khẩu cần ít nhất 6 ký tự.");
      return;
    }

    setIsSubmitting(true);
    const result =
      mode === "signup" ? await signUp(email, password, displayName) : await signIn(email, password);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? null);
      // Signing in before confirming is a dead end without a way to get the email again.
      if (result.needsEmailConfirmation === true) setCanResendConfirmation(true);
      return;
    }
    if (result.needsEmailConfirmation === true) {
      // Worded to stay true for an address that already had an account: Supabase answers
      // signup the same way for both, and this screen must not reveal the difference.
      setNotice("Chúng tôi vừa gửi email xác nhận. Mở liên kết trong thư rồi quay lại đăng nhập.");
      setPassword("");
      switchMode("signin");
      return;
    }
    navigate(returnTo, { replace: true });
  };

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";
  const title: string = isForgot ? "Quên mật khẩu" : isSignUp ? "Đăng ký" : "Đăng nhập";
  const submitLabel: string = isForgot ? "Gửi liên kết đặt lại" : isSignUp ? "Tạo tài khoản" : "Đăng nhập";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <section className="paper flex flex-col justify-center border-b border-border px-8 py-12 md:w-1/2 md:border-b-0 md:border-r md:px-16 lg:px-24">
        <div className="animate-rise-in">
          {/* Full lockup: intrinsic size given so the column never reflows as it loads. */}
          <img
            src="/avora-logo-full-v2.png"
            alt="AVORA"
            width={1425}
            height={1052}
            className="h-auto w-[264px] max-w-full md:w-[240px]"
          />
          <h1 className="mt-10 max-w-md text-[34px] font-semibold leading-[1.15] tracking-tight text-foreground md:text-[40px]">
            Nhắn tin riêng tư, tức thì!
          </h1>
          <p className="mt-4 max-w-sm text-[16px] leading-relaxed text-muted-foreground">
            Chỉ bạn và người bạn đang trò chuyện.
          </p>
        </div>
        <p className="mt-14 text-[13px] text-muted-foreground md:mt-auto md:pt-16">© 2026 AVORA</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-card px-6 py-14 md:px-12">
        <div className="w-full max-w-[420px] animate-rise-in">
          <h2 className="text-[28px] font-semibold tracking-tight text-foreground">{title}</h2>
          {isForgot ? (
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              Nhập email của bạn, chúng tôi sẽ gửi liên kết để đặt mật khẩu mới.
            </p>
          ) : (
            <p className="mt-1.5 text-[15px] text-muted-foreground">
              {isSignUp ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
              <button
                type="button"
                onClick={() => switchMode(isSignUp ? "signin" : "signup")}
                className="rounded-sm font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                {isSignUp ? "Đăng nhập" : "Đăng ký"}
              </button>
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-9 space-y-5" noValidate>
            {isSignUp ? (
              <div className="space-y-2">
                <label htmlFor="displayName" className="block text-[14px] font-medium text-foreground">
                  Tên hiển thị
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Minh Anh"
                  className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="email" className="block text-[14px] font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="minhanh@avora.vn"
                className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
              />
            </div>

            {isForgot ? null : (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="password" className="block text-[14px] font-medium text-foreground">
                    Mật khẩu
                  </label>
                  {isSignUp ? (
                    <span className="text-[13px] text-muted-foreground">Ít nhất 6 ký tự</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="rounded-sm text-[13px] font-medium text-primary underline-offset-4 transition-colors hover:underline"
                    >
                      Quên mật khẩu?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                />
              </div>
            )}

            {error ? (
              <div role="alert" className="rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
                {error}
                {canResendConfirmation ? (
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={isSubmitting}
                    className="mt-2 block rounded-sm text-[13px] font-medium text-primary underline-offset-4 transition-colors hover:underline disabled:opacity-60"
                  >
                    Gửi lại email xác nhận
                  </button>
                ) : null}
              </div>
            ) : null}
            {notice ? (
              <p role="status" className="rounded-md bg-accent/70 px-4 py-3 text-[14px] text-foreground">
                {notice}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitLabel}
            </button>

            {isForgot ? (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="block w-full rounded-sm text-center text-[14px] font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                Quay lại đăng nhập
              </button>
            ) : null}
          </form>

          {isForgot ? null : (
            <>
              <div className="mt-8 flex items-center gap-4">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[13px] text-muted-foreground">hoặc</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
                Bằng việc tiếp tục, bạn đồng ý với Điều khoản của AVORA
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default Auth;
