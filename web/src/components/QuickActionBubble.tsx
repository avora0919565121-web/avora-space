import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { CalendarPeekSheet } from "@/components/tasks/CalendarPeekSheet";
import { QUICK_ACTIONS, directQuickAction, type QuickActionId } from "@/lib/quick-actions";

const ICONS: Record<QuickActionId, typeof CalendarDays> = {
  calendar: CalendarDays,
};

/**
 * A small round button floating at the top right of every signed-in screen.
 *
 * It takes no row of its own: on a phone it sits beside the AVORA mark in the top bar, on a
 * computer in the corner of the page. One action today, so a tap opens it directly.
 */
export function QuickActionBubble() {
  const [openAction, setOpenAction] = useState<QuickActionId | null>(null);
  const action = directQuickAction(QUICK_ACTIONS);
  if (action === null) return null;
  const Icon = ICONS[action.id];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenAction(action.id)}
        aria-label={action.label}
        title={action.label}
        className="press fixed right-4 top-[18px] z-40 flex h-10 w-10 md:right-3 md:top-3 md:h-9 md:w-9 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-[0_2px_10px_-2px_hsl(30_20%_20%/0.18)] backdrop-blur-sm transition-colors hover:bg-secondary"
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
      </button>
      <CalendarPeekSheet
        open={openAction === "calendar"}
        onOpenChange={(next) => setOpenAction(next ? "calendar" : null)}
        showFullLink
      />
    </>
  );
}
