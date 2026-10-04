import { ChevronLeft } from "lucide-react";

import { openAppMap } from "@/components/nav/app-map-event";
import { useLongPress } from "@/hooks/use-long-press";
import { useBack, type BackPlace } from "@/lib/go-back";
import { LOGO_HOLD_MS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Tap = luật 1 (lùi một bước); hold 450 ms = luật 3 (Toàn bộ AVORA). For a `‹` that has its own look. */
export function useBackPress(onBack: () => void) {
  return useLongPress({ onTap: onBack, onHold: openAppMap, holdMs: LOGO_HOLD_MS });
}

/**
 * AVORA-94B (ADR-062) — the one `‹` in AVORA: tap steps back one screen, hold opens Toàn bộ AVORA.
 * `showLabel` puts the name of the place behind beside it (`‹ Kế hoạch`).
 */
export function BackButton({
  parent,
  onBack,
  showLabel = false,
  className,
}: {
  /** The parent screen when nothing is behind and no `tu` (a chat names its own section). */
  parent?: BackPlace;
  /** Overrides the step: a screen-internal step (close an editor) goes here instead. */
  onBack?: () => void;
  showLabel?: boolean;
  className?: string;
}) {
  const { back, label } = useBack(parent);
  const press = useBackPress(onBack ?? back);
  return (
    <button
      type="button"
      {...press}
      aria-label={`Quay lại ${label}. Giữ để mở các tab`}
      data-back=""
      className={cn(
        "press no-callout flex min-h-11 min-w-11 shrink-0 select-none items-center gap-0.5 rounded-md text-muted-foreground transition-colors [touch-action:manipulation] hover:bg-accent/50 hover:text-foreground",
        showLabel ? "pl-1 pr-2" : "justify-center",
        className,
      )}
    >
      <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      {showLabel ? <span className="max-w-[40vw] truncate text-[13.5px] font-medium">{label}</span> : null}
    </button>
  );
}
