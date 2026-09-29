import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { logError } from "@/lib/log";
import { HOME_ROUTE } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type BoundaryProps = {
  /** Where the failure is logged from ("route", "space-block", …). */
  scope: string;
  /** Changing this resets the boundary (the route path: moving away clears the fault). */
  resetKey?: string;
  /** Replaces the whole-area fallback — used by the small blocks of Avora Space. */
  fallback?: (retry: () => void) => ReactNode;
  onRetry?: () => void;
  children: ReactNode;
};

type BoundaryState = { hasError: boolean; resetKey: string | undefined };

/**
 * One broken part never takes the whole app down (Đợt gộp 2 · A6).
 *
 * Navigation and the quick-action bubble sit outside every boundary, so they keep working. The
 * fault is logged through `lib/log.ts` (scope + class name only — never what the screen held).
 */
class ErrorBoundaryCore extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { hasError: false, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    logError(this.props.scope, error);
  }

  retry = (): void => {
    this.props.onRetry?.();
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback(this.retry);
    return <RouteFault onRetry={this.retry} />;
  }
}

function RouteFault({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="paper flex min-h-0 flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-[18px] font-semibold tracking-tight text-foreground">Phần này đang gặp sự cố</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">Các phần khác của AVORA vẫn dùng bình thường.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="press inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/92"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Thử lại
          </button>
          <Link
            to={HOME_ROUTE}
            className="press inline-flex h-11 items-center rounded-md border border-border px-4 text-[14px] font-medium text-foreground hover:bg-secondary"
          >
            Về Avora Space
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Wraps one screen of the app frame. "Thử lại" also refetches what that screen had loaded. */
export function RouteErrorBoundary({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  return (
    <ErrorBoundaryCore
      scope="route"
      resetKey={resetKey}
      onRetry={() => void queryClient.refetchQueries({ type: "active" })}
    >
      {children}
    </ErrorBoundaryCore>
  );
}

/** "Chưa tải được {tên khối}." with a retry — never an empty block that hides a failure. */
export function BlockLoadError({ name, onRetry, className }: { name: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-[12px] border border-border bg-card px-4 py-3 text-[13.5px] text-muted-foreground", className)}>
      <span>Chưa tải được {name}.</span>
      <button type="button" onClick={onRetry} className="press font-medium text-foreground underline underline-offset-2">
        Thử lại
      </button>
    </div>
  );
}

/** One block of Avora Space in its own boundary: a fault there stays there. */
export function BlockErrorBoundary({ name, children }: { name: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  return (
    <ErrorBoundaryCore
      scope="space-block"
      onRetry={() => void queryClient.refetchQueries({ type: "active" })}
      fallback={(retry) => <BlockLoadError name={name} onRetry={retry} />}
    >
      {children}
    </ErrorBoundaryCore>
  );
}
