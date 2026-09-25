import { CalendarDays, Sparkles } from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import { CalendarPeekSheet } from "@/components/tasks/CalendarPeekSheet";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QUICK_ACTIONS, directQuickAction, type QuickActionId } from "@/lib/quick-actions";

const ICONS: Record<QuickActionId, typeof CalendarDays> = {
  calendar: CalendarDays,
  assistant: Sparkles,
};

const BUBBLE_CLASS =
  "press fixed right-4 top-[calc(env(safe-area-inset-top)+10px)] z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-[0_2px_10px_-2px_hsl(30_20%_20%/0.18)] backdrop-blur-sm transition-colors hover:bg-secondary data-[state=open]:bg-secondary md:right-3 md:top-3 md:h-9 md:w-9";

/**
 * A small round button floating at the top right of every signed-in screen.
 *
 * It takes no row of its own: on a phone it sits in the top bar beside the logo, on a computer in
 * the corner of the page. One action opens directly; several open a short chooser in order.
 */
export function QuickActionBubble() {
  const [openAction, setOpenAction] = useState<QuickActionId | null>(null);
  const direct = directQuickAction(QUICK_ACTIONS);

  return (
    <>
      {direct !== null ? (
        <button
          type="button"
          onClick={() => setOpenAction(direct.id)}
          aria-label={direct.label}
          title={direct.label}
          className={BUBBLE_CLASS}
        >
          <CalendarDays className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Hành động nhanh: Lịch, Avora AI" title="Lịch · Avora AI" className={BUBBLE_CLASS}>
              <CalendarDays className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
              {/* A second action lives here now — a small spark says so without a label. */}
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground"
              >
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-[248px] rounded-xl p-1.5">
            {QUICK_ACTIONS.map((action) => {
              const Icon = ICONS[action.id];
              return (
                <DropdownMenuItem
                  key={action.id}
                  onSelect={() => setOpenAction(action.id)}
                  className="min-h-12 gap-3 rounded-lg px-2.5 py-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                    <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-foreground">{action.label}</span>
                    <span className="block text-[12px] text-muted-foreground">{action.note}</span>
                  </span>
                  {action.isUpcoming ? (
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Sắp có
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <CalendarPeekSheet
        open={openAction === "calendar"}
        onOpenChange={(next) => setOpenAction(next ? "calendar" : null)}
        showFullLink
      />

      {/* A door, not a conversation: nothing is read, sent or answered from here yet. */}
      <Dialog open={openAction === "assistant"} onOpenChange={(next) => setOpenAction(next ? "assistant" : null)}>
        <DialogContent className="max-w-[400px] rounded-xl border-border bg-card p-0">
          <div className="flex flex-col items-center px-6 pb-7 pt-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background text-primary">
              <Sparkles className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <DialogTitle className="mt-5 text-[22px] font-semibold tracking-tight text-foreground">Avora AI</DialogTitle>
            <DialogDescription className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              Trợ lý riêng trong không gian của bạn — chỉ gợi ý khi bạn hỏi, luôn để bạn xác nhận trước khi lưu. Đang
              được xây, chưa trò chuyện được ở đây.
            </DialogDescription>
            <StatusPill className="mt-6">Sắp ra mắt</StatusPill>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
