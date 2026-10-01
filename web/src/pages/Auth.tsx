import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { AUTH_TAGLINE, BRAND_MOTTO, BRAND_PRODUCT } from "@/lib/brand";
import { dismissGuestNotice, isGuestMachine, setGuestMachine } from "@/lib/guest-machine";
import { returnPathFrom } from "@/lib/navigation";

type Mode = "signin" | "signup" | "forgot" | "otp";

function readMode(value: string | null): Mode {
  if (value === "dang-ky") return "signup";
  if (value === "quen-mat-khau") return "forgot";
  if (value === "ma-email") return "otp";
  return "signin";
}

function cleanCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

/**
 * Sign in / sign up / request a reset link / sign in with an emailed code — all wired to real
 * Supabase Auth.
 *
 * AVORA-54 · A — `Đây là máy của người khác`: the session is then kept in this tab only
 * (sessionStorage), and the screen tells the person what to answer if the browser offers to save
 * the password. AVORA-54 · B — the email-code path never creates an account and answers the same
 * whether or not the address has one.
 */
const Auth = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo: string = returnPathFrom(location.state);
  const { signIn, signUp, resendConfirmation, requestPasswordReset, sendEmailOtp, verifyEmailOtp, session, isLoading, isRecovering } =
    useAuth();

  const mode: Mode = readMode(searchParams.get("mode"));

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState<boolean>(false);

  // AVORA-54 · A — default unchecked. On the email-code path it is checked on arrival (B).
  const [guestMachine, setGuestMachineChecked] = useState<boolean>(() => isGuestMachine());
  // AVORA-54 · B — the code flow: typing the email, then the 6-digit code.
  const [otpPhase, setOtpPhase] = useState<"email" | "code">("email");
  const [otpCode, setOtpCode] = useState<string>("");
  const [resendLeft, setResendLeft] = useState<number>(0);
  const verifiedCodeRef = useRef<string>("");
  const codeFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setCanResendConfirmation(false);
    setOtpPhase("email");
    setOtpCode("");
    setResendLeft(0);
    verifiedCodeRef.current = "";
  }, [mode]);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = window.setInterval(() => setResendLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendLeft]);

  // A recovery session must finish setting its new password before it can browse the app.
  if (!isLoading && session && isRecovering) return <Navigate to="/dat-lai-mat-khau" replace />;
  if (!isLoading && session) return <Navigate to={returnTo} replace />;

  // The return path rides along when switching between sign in / sign up / forgot / code.
  const switchMode = (next: Mode): void => {
    const options = { replace: true, state: location.state as unknown };
    if (next === "signup") setSearchParams({ mode: "dang-ky" }, options);
    else if (next === "forgot") setSearchParams({ mode: "quen-mat-khau" }, options);
    else if (next === "otp") {
      // AVORA-54 · B: the machine checkbox arrives checked on this path; the person can uncheck it.
      setGuestMachineChecked(true);
      setSearchParams({ mode: "ma-email" }, options);
    } else setSearchParams({}, options);
  };

  const toggleGuestMachine = (checked: boolean): void => {
    setGuestMachineChecked(checked);
    // Unchecking on this screen immediately restores the ordinary behaviour.
    if (!checked) setGuestMachine(false);
  };

  const handleResendConfirmation = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    const result = await resendConfirmation(email, returnTo);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? null);
      return;
    }
    setCanResendConfirmation(false);
    setNotice("Đã gửi lại email xác nhận. Kiểm tra hộp thư, kể cả mục spam.");
  };

  const sendCode = async (): Promise<void> => {
    if (email.trim().length === 0) {
      setError("Vui lòng nhập email của bạn.");
      return;
    }
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    const result = await sendEmailOtp(email);
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.message ?? null);
      return;
    }
    // Deliberately the same answer whether or not the address has an account.
    setNotice(
      resendLeft > 0
        ? "Nếu email này có tài khoản AVORA, mã đã được gửi. Mã dùng một lần, hết hạn sau 10 phút."
        : "Nếu email này có tài khoản AVORA, mã đã được gửi. Mã dùng một lần, hết hạn sau 10 phút.",
    );
    setOtpPhase("code");
    setOtpCode("");
    verifiedCodeRef.current = "";
    setResendLeft(60);
    window.setTimeout(() => codeFieldRef.current?.focus(), 50);
  };

  const verifyCode = async (code: string): Promise<void> => {
    if (code.length !== 6 || verifiedCodeRef.current === code) return;
    verifiedCodeRef.current = code;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    // The flag decides where the session is kept, so it must be set before the sign-in lands.
    setGuestMachine(guestMachine);
    if (guestMachine) dismissGuestNotice(); // the banner shows once inside, not for the tab's whole life
    const result = await verifyEmailOtp(email, code);
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.message ?? null);
      verifiedCodeRef.current = "";
      return;
    }
    navigate(returnTo, { replace: true });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setCanResendConfirmation(false);

    if (mode === "otp") {
      if (otpPhase === "email") {
        await sendCode();
        return;
      }
      await verifyCode(otpCode);
      return;
    }

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
    // AVORA-54 · A — the flag routes the new session into sessionStorage when checked.
    setGuestMachine(guestMachine);
    if (guestMachine) dismissGuestNotice();
    const result =
      mode === "signup" ? await signUp(email, password, displayName, returnTo) : await signIn(email, password);
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
  const isOtp = mode === "otp";
  const title: string = isForgot ? "Quên mật khẩu" : isSignUp ? "Đăng ký" : "Đăng nhập";
  const submitLabel: string = isForgot
    ? "Gửi liên kết đặt lại"
    : isSignUp
      ? "Tạo tài khoản"
      : isOtp
        ? otpPhase === "email"
          ? "Gửi mã"
          : "Đăng nhập"
        : "Đăng nhập";
  const showGuestCheckbox = mode === "signin" || isOtp;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* AVORA-53 · 6.15: on a phone the brand block stays within ~40% of the screen so Email is in view. */}
      <section className="paper flex flex-col justify-center border-b border-border px-6 py-6 md:w-1/2 md:border-b-0 md:border-r md:px-16 md:py-12 lg:px-24">
        <div className="animate-rise-in">
          {/* Full lockup: intrinsic size given so the column never reflows as it loads. */}
          <img
            src="/avora-logo-full-v2.png"
            alt="AVORA"
            width={1425}
            height={1052}
            className="h-auto w-[104px] max-w-full md:w-[240px]"
          />
          {/* AVORA-50 · A: the two brand lines stay in English in every language (translate="no");
              only the explaining sentence below is translated. */}
          <p translate="no" className="notranslate mt-3 text-[15px] font-semibold tracking-tight text-foreground/80 md:mt-9 md:text-[18px]">
            {BRAND_PRODUCT}
          </p>
          <h1
            translate="no"
            lang="en"
            aria-label={BRAND_MOTTO}
            className="notranslate mt-1 max-w-md text-[22px] font-semibold leading-[1.2] tracking-tight text-foreground md:mt-2 md:text-[40px] md:leading-[1.15]"
          >
            {/* Each cluster stays whole; a line may only break at the dash. */}
            {BRAND_MOTTO.split(" - ").map((cluster, index) => (
              <span key={cluster} aria-hidden="true">
                {index > 0 ? " - " : null}
                <span className="whitespace-nowrap">{cluster}</span>
              </span>
            ))}
          </h1>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted-foreground md:mt-4 md:text-[16px]">{AUTH_TAGLINE}</p>
        </div>
        <p className="mt-3 hidden text-[13px] text-muted-foreground md:mt-auto md:block md:pt-16">© 2026 AVORA</p>
      </section>

      <section className="flex flex-1 items-start justify-center bg-card px-6 pb-10 pt-6 md:items-center md:px-12 md:py-14">
        <div className="w-full max-w-[420px] animate-rise-in">
          <h2 className="text-[24px] font-semibold tracking-tight text-foreground md:text-[28px]">{title}</h2>
          {isForgot ? (
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              Nhập email của bạn, chúng tôi sẽ gửi liên kết để đặt mật khẩu mới.
            </p>
          ) : isOtp ? (
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              {otpPhase === "email"
                ? "Nhập email của bạn — chúng tôi gửi một mã 6 số để đăng nhập, không cần mật khẩu."
                : `Nhập 6 số vừa gửi tới email của bạn.`}
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

          <form onSubmit={handleSubmit} className="mt-5 space-y-5 md:mt-9" noValidate>
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
                spellCheck={false}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="minhanh@avora.vn"
                className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
              />
            </div>

            {isOtp && otpPhase === "code" ? (
              <div className="space-y-2">
                <label htmlFor="otp-code" className="block text-[14px] font-medium text-foreground">
                  Mã 6 số
                </label>
                <input
                  id="otp-code"
                  ref={codeFieldRef}
                  name="otp-code"
                  type="text"
                  inputMode="numeric"
                  spellCheck={false}
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChange={(event) => {
                    const next = cleanCode(event.target.value);
                    setOtpCode(next);
                    if (next.length === 6 && !isSubmitting) void verifyCode(next);
                  }}
                  placeholder="••••••"
                  className="tabular h-12 w-full rounded-md border border-border bg-card px-4 text-center text-[22px] font-semibold tracking-[0.35em] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                />
                <p className="text-[13px] text-muted-foreground">Mã dùng một lần, hết hạn sau 10 phút.</p>
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={isSubmitting || resendLeft > 0}
                  className="rounded-sm text-[13px] font-medium text-primary underline-offset-4 transition-colors hover:underline disabled:opacity-50"
                >
                  {resendLeft > 0 ? `Gửi lại mã sau ${resendLeft}s` : "Gửi lại mã"}
                </button>
              </div>
            ) : null}

            {isForgot || (isOtp && otpPhase === "code") ? null : (
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
                  spellCheck={false}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
                />
              </div>
            )}

            {showGuestCheckbox ? (
              <div className="space-y-1.5">
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] text-foreground">
                  <input
                    type="checkbox"
                    checked={guestMachine}
                    onChange={(event) => toggleGuestMachine(event.target.checked)}
                    className="h-[18px] w-[18px] shrink-0 accent-primary"
                  />
                  Đây là máy của người khác
                </label>
                {guestMachine ? (
                  <p className="pl-[28px] text-[13px] leading-relaxed text-muted-foreground">
                    Phiên chỉ còn trong tab này — đóng tab là hết. Nếu trình duyệt hỏi lưu mật khẩu, chọn
                    &ldquo;Không bao giờ&rdquo;.
                  </p>
                ) : null}
              </div>
            ) : null}

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
              disabled={isSubmitting || (isOtp && otpPhase === "code" && otpCode.length < 6)}
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
            {isOtp ? (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="block w-full rounded-sm text-center text-[14px] font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                Đăng nhập bằng mật khẩu
              </button>
            ) : null}
            {mode === "signin" ? (
              <button
                type="button"
                onClick={() => switchMode("otp")}
                className="block w-full rounded-sm text-center text-[14px] font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                Đăng nhập bằng mã gửi qua email
              </button>
            ) : null}
          </form>

          {isForgot ? null : (
            <>
              {/* AVORA-54 · B: the email-code choice sits where the "hoặc" divider used to be. */}
              <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
                Bằng việc tiếp tục, bạn đồng ý với Điều khoản của AVORA
              </p>
              <p className="mt-2 text-center text-[12px] text-muted-foreground md:hidden">© 2026 AVORA</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default Auth;
