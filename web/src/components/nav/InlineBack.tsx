import { useSearchParams } from "react-router-dom";

import { BackButton } from "@/components/nav/BackButton";
import { readReturn } from "@/lib/return-to";
import { cn } from "@/lib/utils";

/**
 * AVORA-94B (ADR-062, thay ReturnChip 39 / 53): on a computer, a tab root opened from elsewhere (`tu`)
 * shows one `‹ {nơi trước}` above its content. On a phone the same `‹` sits in the top row instead.
 */
export function InlineBack({ className }: { className?: string }) {
  const [searchParams] = useSearchParams();
  if (readReturn(searchParams) === null) return null;
  return (
    <div className={cn("hidden md:flex short:flex", className)}>
      <BackButton showLabel className="-ml-2" />
    </div>
  );
}
