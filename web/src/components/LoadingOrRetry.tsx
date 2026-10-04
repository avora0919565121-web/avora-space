import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { BackButton } from "@/components/nav/BackButton";
import { cn } from "@/lib/utils";

/** After this long a spinner turns into words and a way out (AVORA-94B · PHẦN C). */
export const STUCK_AFTER_MS = 10_000;

/** True once `isWaiting` has stayed true for `ms`. Resets when waiting ends. */
export function useStuck(isWaiting: boolean, ms: number = STUCK_AFTER_MS): boolean {
  const [isStuck, setIsStuck] = useState<boolean>(false);
  useEffect(() => {
    if (!isWaiting) {
      setIsStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setIsStuck(true), ms);
    return () => window.clearTimeout(timer);
  }, [isWaiting, ms]);
  return isStuck;
}

/**
 * AVORA-94B · cam kết "không bao giờ quay tròn mãi": a spinner for up to 10 s, then
 * `Chưa tải được · Thử lại` (with `Đang không có mạng` when offline). React Query pauses while
 * offline, so a plain spinner would otherwise never stop. `withBack` adds `‹` (inner screens).
 */
export function LoadingOrRetry({
  onRetry,
  label = "Đang tải",
  withBack = false,
  className,
  extra,
}: {
  onRetry?: () => void;
  label?: string;
  withBack?: boolean;
  className?: string;
  /** A second way out under `Thử lại` (e.g. `Đăng nhập lại`). */
  extra?: ReactNode;
}) {
  const isStuck = useStuck(true);
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-loading-or-retry={isStuck ? "stuck" : "waiting"}>
      {withBack ? (
        <div className="px-2 pt-[max(env(safe-area-inset-top),0.25rem)]">
          <BackButton />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center" role="status">
        {isStuck ? (
          <>
            <p className="max-w-sm text-[15px] text-muted-foreground">
              {isOffline ? "Đang không có mạng · " : ""}Chưa tải được
            </p>
            <button
              type="button"
              onClick={onRetry ?? (() => window.location.reload())}
              className="press mt-4 min-h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium text-foreground"
            >
              Thử lại
            </button>
            {extra}
          </>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </>
        )}
      </div>
    </div>
  );
}
