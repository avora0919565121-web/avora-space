import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarDays, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CalendarView } from "@/components/tasks/CalendarView";
import { MOTION_EASING, currentRhythm, motionFor } from "@/lib/motion";
import { parseIsoDay, type CalendarMode } from "@/lib/calendar-view";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/**
 * A quick look at the calendar without leaving what you were doing.
 *
 * A pure view: nothing here edits, deletes or creates. Opened from a task form it doubles as a
 * date helper — tapping a day fills the deadline field and closes — but it is never a way to
 * create a task. Closing returns focus to the button that opened it, so a half-typed message
 * stays exactly where it was.
 *
 * It fades rather than slides: the motion tokens allow opacity and nothing else.
 */
export function CalendarPeekSheet({
  open,
  onOpenChange,
  onPickDay,
  initialDay,
  showFullLink = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when opened from a task form: the chosen day goes back into the deadline field. */
  onPickDay?: (day: string) => void;
  /** The day to start on — the form's current deadline, when it has one. */
  initialDay?: string | null;
  /** Offers a way into the full Lịch screen (the global button only). */
  showFullLink?: boolean;
}) {
  const today = todayIso();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<string>(() => parseIsoDay(initialDay ?? null) ?? today);
  const motion = motionFor(currentRhythm());
  const animation = { animationDuration: `${motion.durationMs}ms`, animationTimingFunction: MOTION_EASING };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Every opening starts on the current month (or the form's date), not where it was left.
        if (next) {
          setMode("month");
          setAnchor(parseIsoDay(initialDay ?? null) ?? today);
        }
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={animation}
          className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          style={animation}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88vh] w-full max-w-[560px] flex-col rounded-t-[20px] border border-b-0 border-border bg-background shadow-lg outline-none",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
          <div className="flex items-start gap-3 px-4 pb-1 pt-3">
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[16px] font-semibold text-foreground">
                {onPickDay !== undefined ? "Chọn ngày hạn" : "Xem nhanh lịch"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
                {onPickDay !== undefined
                  ? "Xem lịch trước khi chọn — chạm một ngày để điền vào ô hạn."
                  : "Chỉ để xem, không sửa được gì ở đây. Đóng lại là quay về đúng chỗ bạn đang gõ."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Đóng lịch"
              className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {open ? (
              <CalendarView
                mode={mode}
                anchor={anchor}
                today={today}
                onModeChange={setMode}
                onAnchorChange={setAnchor}
                modes={["day", "week", "month"]}
                onPickDay={
                  onPickDay === undefined
                    ? undefined
                    : (day) => {
                        onPickDay(day);
                        onOpenChange(false);
                      }
                }
              />
            ) : null}
            {showFullLink ? (
              <Link
                to={`/nhiem-vu?muc=lich&xem=ngay&ngay=${anchor}`}
                onClick={() => onOpenChange(false)}
                className="press mt-3 flex min-h-11 items-center justify-center rounded-[10px] border border-border text-[13.5px] font-medium text-foreground hover:bg-secondary"
              >
                Mở Lịch đầy đủ trong Nhiệm vụ
              </Link>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The small calendar button that opens the peek. Same shape wherever it appears. */
export function CalendarPeekButton({
  onPickDay,
  initialDay,
  label = "Xem nhanh lịch",
  className,
  showFullLink = false,
}: {
  onPickDay?: (day: string) => void;
  initialDay?: string | null;
  label?: string;
  className?: string;
  showFullLink?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          "press flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <CalendarDays className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
      </button>
      <CalendarPeekSheet
        open={open}
        onOpenChange={setOpen}
        onPickDay={onPickDay}
        initialDay={initialDay}
        showFullLink={showFullLink}
      />
    </>
  );
}
