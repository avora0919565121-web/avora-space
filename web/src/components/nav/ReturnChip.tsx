import { ArrowLeft } from "lucide-react";
import { memo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { isPreviousEntry } from "@/lib/nav-history";
import { readReturn } from "@/lib/return-to";
import { cn } from "@/lib/utils";

/**
 * `← {nơi xuất phát}` — the way back to wherever this screen was opened from.
 *
 * Shown only when the address carries a safe `tu`; the Hub links in the navigation never do,
 * so switching Hubs on purpose makes it disappear on its own.
 *
 * AVORA-53 · 2.2: when the place it names is the history entry just behind, it goes back one
 * step (the browser keeps that page as it was); otherwise it replaces this entry, so Back never
 * bounces between the two.
 */
export const ReturnChip = memo(function ReturnChip({ className }: { className?: string }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const target = readReturn(searchParams);

  const goBack = useCallback((): void => {
    if (target === null) return;
    if (isPreviousEntry(target.path)) navigate(-1);
    else navigate(target.path, { replace: true });
  }, [navigate, target]);

  if (target === null) return null;
  return (
    <button
      type="button"
      onClick={goBack}
      className={cn(
        "press inline-flex min-h-11 max-w-full items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span className="truncate">{target.label}</span>
    </button>
  );
});
