import { ChevronLeft } from "lucide-react";
import { useBackPress } from "@/hooks/use-back-press";
import { useBack, type BackPlace } from "@/lib/go-back";
import { cn } from "@/lib/utils";

/**
 * The one `‹` in AVORA. `showLabel` puts the name of the place it goes to beside it (`‹ Avora Space`);
 * the label is always the real destination.
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
  const { back, label, toRoot, rootLabel } = useBack(parent);
  const press = useBackPress(onBack ?? back, toRoot);
  return (
    <button
      type="button"
      {...press}
      aria-label={`Quay lại ${label}. Giữ để về đầu ${rootLabel}`}
      data-back=""
      data-back-label={label}
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
