import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Dices, Loader2, PenLine, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  checkPin,
  claimPin,
  fetchMyPin,
  generatePinBody,
  PIN_BODY_LENGTH,
  PIN_PREFIX,
  PIN_RULES,
  pinBody,
  pinProblem,
  pinProblemMessage,
  toPin,
  userPinKeys,
  type PinAvailability,
} from "@/lib/user-pin";
import { cn } from "@/lib/utils";

type Mode = "generated" | "chosen";

/**
 * Every account needs a PIN before it goes anywhere else in AVORA. A new account meets this as the
 * last step of signing up (the first time it opens the app); an older account meets it once, on its
 * next visit. There is no skip: the screen stays until a PIN is saved, and never appears again after.
 */
export function PinGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const pinQuery = useQuery({
    queryKey: userPinKeys.mine(userId),
    queryFn: fetchMyPin,
    enabled: userId !== "",
    staleTime: Infinity,
  });

  if (pinQuery.isPending) {
    return (
      <div className="paper flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang tải</span>
      </div>
    );
  }

  if (pinQuery.isError) {
    return (
      <div className="paper flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] text-muted-foreground">{pinQuery.error.message}</p>
        <button
          type="button"
          onClick={() => void pinQuery.refetch()}
          className="press h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium text-foreground"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (pinQuery.data === null) return <PinSetup userId={userId} isNewAccount={isRecent(user?.created_at)} />;
  return <>{children}</>;
}

/** An account made in the last day meets the PIN as part of signing up, not as a change. */
function isRecent(createdAt: string | undefined): boolean {
  if (createdAt === undefined) return false;
  return Date.now() - new Date(createdAt).getTime() < 86_400_000;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

function PinSetup({ userId, isNewAccount }: { userId: string; isNewAccount: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("generated");
  const [generated, setGenerated] = useState<string>(() => generatePinBody());
  const [typed, setTyped] = useState<string>("");
  const [understood, setUnderstood] = useState<boolean>(false);

  const body = mode === "generated" ? generated : typed;
  const localProblem = pinProblem(body);
  const debouncedBody = useDebounced<string>(body, 350);

  // Live availability: asked only for a body that already passes the local rules.
  const availabilityQuery = useQuery<PinAvailability, Error>({
    queryKey: ["user-pin-check", debouncedBody],
    queryFn: () => checkPin(toPin(debouncedBody)),
    enabled: pinProblem(debouncedBody) === null,
    staleTime: 10_000,
    retry: false,
  });

  const settled = debouncedBody === body;
  const availability: PinAvailability | null =
    localProblem !== null
      ? typed.length === 0 && mode === "chosen"
        ? null
        : localProblem
      : settled && availabilityQuery.data !== undefined
        ? availabilityQuery.data
        : null;

  // A generated PIN that happens to be taken is simply drawn again.
  useEffect(() => {
    if (mode === "generated" && availability === "taken") setGenerated(generatePinBody());
  }, [mode, availability]);

  const claimMutation = useMutation({
    mutationFn: () => claimPin(toPin(body), mode),
    onSuccess: (pin) => {
      queryClient.setQueryData(userPinKeys.mine(userId), pin);
      toast.success(`PIN của bạn là ${pin}.`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      if (mode === "generated") setGenerated(generatePinBody());
      void availabilityQuery.refetch();
    },
  });

  const canSave = localProblem === null && availability === "ok" && understood && !claimMutation.isPending;
  const hasPhone = Boolean(user?.phone);

  return (
    <div className="paper flex min-h-[100dvh] items-start justify-center overflow-y-auto px-5 py-10 md:items-center">
      <div className="animate-rise-in w-full max-w-[460px]">
        <img src="/avora-logo-full-v2.png" alt="AVORA" width={1425} height={1052} className="h-auto w-[120px]" />
        <p className="mt-8 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">
          {isNewAccount ? "Bước cuối của đăng ký" : "Một việc trước khi tiếp tục"}
        </p>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-tight text-foreground">
          Chọn PIN AVORA của bạn
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
          PIN là mã định danh riêng của bạn trên AVORA, dùng để người khác mời bạn. PIN không phải mật khẩu,
          ai biết cũng không sao — nhưng đã chọn thì dùng mãi, không đổi được.
        </p>

        <div role="radiogroup" aria-label="Cách có PIN" className="mt-6 grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === "generated"}
            icon={<Dices className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            label="Để hệ thống tự sinh"
            onClick={() => setMode("generated")}
          />
          <ModeButton
            active={mode === "chosen"}
            icon={<PenLine className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            label="Tự chọn PIN đẹp"
            onClick={() => setMode("chosen")}
          />
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-card p-4">
          {mode === "generated" ? (
            <div className="flex items-center gap-3">
              <PinCells body={generated} />
              <button
                type="button"
                onClick={() => setGenerated(generatePinBody())}
                aria-label="Sinh PIN khác"
                title="Sinh PIN khác"
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <label className="block">
              <span className="sr-only">PIN tự chọn</span>
              <span className="flex h-14 items-center rounded-xl border border-border bg-background px-4 focus-within:border-primary/70">
                <span className="tabular select-none text-[22px] font-semibold tracking-[0.12em] text-muted-foreground">
                  {PIN_PREFIX}
                </span>
                <input
                  value={typed}
                  onChange={(event) => setTyped(pinBody(event.target.value))}
                  maxLength={PIN_BODY_LENGTH + 2}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="MINHNAM8"
                  aria-describedby="pin-rules"
                  className="tabular min-w-0 flex-1 bg-transparent text-[22px] font-semibold uppercase tracking-[0.12em] text-foreground outline-none placeholder:text-muted-foreground/35"
                />
                <span className="tabular text-[12px] text-muted-foreground">
                  {typed.length}/{PIN_BODY_LENGTH}
                </span>
              </span>
            </label>
          )}

          <AvailabilityLine
            availability={availability}
            isChecking={localProblem === null && (!settled || availabilityQuery.isFetching)}
          />

          <ul id="pin-rules" className="mt-3 space-y-1 border-t border-border pt-3">
            {PIN_RULES.map((rule) => (
              <li key={rule} className="text-[12.5px] leading-relaxed text-muted-foreground">
                · {rule}
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          />
          <span className="text-[13.5px] leading-relaxed text-foreground">
            Tôi hiểu <strong className="font-semibold">PIN là vĩnh viễn, không đổi được</strong> sau khi lưu.
          </span>
        </label>

        <button
          type="button"
          disabled={!canSave}
          onClick={() => claimMutation.mutate()}
          className="press mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          {claimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Lưu PIN {localProblem === null ? toPin(body) : ""}
        </button>

        {!hasPhone ? (
          <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
            Chưa có số điện thoại cũng không sao — bạn có thể bổ sung sau.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "press flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-[13.5px] font-medium transition-colors",
        active
          ? "border-primary/60 bg-primary/[0.08] text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent/40",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** The PIN drawn as its 10 characters, so a generated one reads like something to keep. */
function PinCells({ body }: { body: string }) {
  const chars = useMemo(() => [...toPin(body)], [body]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" aria-label={`PIN ${toPin(body)}`}>
      {chars.map((char, index) => (
        <span
          key={`${index}-${char}`}
          aria-hidden="true"
          className={cn(
            "tabular animate-rise-in flex h-11 min-w-0 flex-1 items-center justify-center rounded-md text-[19px] font-semibold",
            index < 2 ? "bg-transparent text-muted-foreground" : "border border-border bg-background text-foreground",
          )}
          style={{ animationDelay: `${index * 18}ms` }}
        >
          {char}
        </span>
      ))}
    </div>
  );
}

function AvailabilityLine({
  availability,
  isChecking,
}: {
  availability: PinAvailability | null;
  isChecking: boolean;
}) {
  if (isChecking) {
    return (
      <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Đang kiểm tra…
      </p>
    );
  }
  if (availability === null) return <p className="mt-2.5 h-[18px]" aria-hidden="true" />;
  const ok = availability === "ok";
  return (
    <p
      aria-live="polite"
      className={cn("mt-2.5 flex items-center gap-1.5 text-[12.5px]", ok ? "text-money-in" : "text-destructive")}
    >
      {ok ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      )}
      {pinProblemMessage(availability)}
    </p>
  );
}
