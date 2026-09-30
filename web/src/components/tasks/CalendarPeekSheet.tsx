import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarDays, ChevronLeft, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { CalendarView } from "@/components/tasks/CalendarView";
import { MOTION_EASING, currentRhythm, motionFor } from "@/lib/motion";
import { parseIsoDay, type CalendarMode } from "@/lib/calendar-view";
import { isDayAllowed, orderRange, pickHint, yearChoices, type DateAllow } from "@/lib/date-field";
import { hereFrom, withReturn } from "@/lib/return-to";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const MONTH_SHORT: readonly string[] = Array.from({ length: 12 }, (_, index) => `Thg ${index + 1}`);

/** The compact Lịch offers only these two (Đợt gộp 2 · A3); the full Lịch keeps all four. */
const COMPACT_MODES: readonly CalendarMode[] = ["month", "week"];

export type CalendarPickRange = { from: string; to: string };

export type CalendarPeekSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when opened from a field: the chosen day goes back into it. */
  onPickDay?: (day: string) => void;
  /** Range mode (AVORA-39 / Phần 2 · A3): two taps, earliest first whatever the order. */
  onPickRange?: (range: CalendarPickRange) => void;
  /** The day to start on — the field's current value, when it has one. */
  initialDay?: string | null;
  initialRange?: CalendarPickRange | null;
  /** Offers a way into the full Lịch screen (the global button only). */
  showFullLink?: boolean;
  /** "Chọn ngày hạn", "Chọn ngày sinh"… */
  title?: string;
  allow?: DateAllow;
  min?: string | null;
  max?: string | null;
  /** Desktop only: render as a popover body instead of a floating panel. */
  inline?: boolean;
  /**
   * Where the floating panel sits (Đợt gộp 2 · A3). "top-end": under the top-right bubble;
   * "top": across the top of a phone screen, 8px from each edge. Never a bottom sheet.
   */
  placement?: "top-end" | "top";
};

/**
 * Lịch Avora — the one calendar in AVORA, for looking and for choosing a day.
 *
 * A pure view: nothing here edits, deletes or creates. Opened from a field it doubles as the
 * date picker — the person still sees what already sits on each day before choosing. Tapping the
 * month title jumps by year then month (a birthday in 1965 is five taps, not seven hundred).
 * It fades rather than slides: the motion tokens allow opacity and nothing else.
 *
 * One compact size everywhere (Đợt gộp 2 · A3): Tháng · Tuần only, at most ~440px tall in
 * Tháng, opened just under where it was asked for and never covering the whole screen.
 */
export function CalendarPeekSheet(props: CalendarPeekSheetProps) {
  const { open, onOpenChange, inline = false, placement = "top-end" } = props;
  const motion = motionFor(currentRhythm());
  const animation = { animationDuration: `${motion.durationMs}ms`, animationTimingFunction: MOTION_EASING };

  if (inline) return open ? <CalendarPickerBody {...props} /> : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={animation}
          className="fixed inset-0 z-50 bg-black/15 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          style={animation}
          className={cn(
            "fixed top-[calc(env(safe-area-inset-top)+56px)] z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-72px)] flex-col rounded-[16px] border border-border bg-background shadow-lg outline-none md:top-14",
            placement === "top-end"
              ? "right-2 w-[min(360px,calc(100vw-16px))]"
              : "inset-x-2 mx-auto w-auto max-w-[360px]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        >
          {open ? <CalendarPickerBody {...props} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CalendarPickerBody({
  onOpenChange,
  onPickDay,
  onPickRange,
  initialDay,
  initialRange,
  showFullLink = false,
  title,
  allow,
  min,
  max,
  inline = false,
}: CalendarPeekSheetProps) {
  const today = todayIso();
  const location = useLocation();
  const isRange = onPickRange !== undefined;
  const isPicking = onPickDay !== undefined || isRange;
  // Before this change the peek only ever picked deadlines, so "future" stays the default there.
  const rule: DateAllow = allow ?? "future";
  const startDay = parseIsoDay(initialRange?.from ?? initialDay ?? null) ?? today;

  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<string>(startDay);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [chooser, setChooser] = useState<"none" | "year" | "month">("none");

  const canPick = (day: string): boolean => isDayAllowed(day, { allow: rule, today, min, max });
  const highlight = useMemo<CalendarPickRange | null>(() => {
    if (!isRange) return null;
    if (rangeStart !== null) return orderRange(rangeStart, anchor);
    return initialRange ?? null;
  }, [isRange, rangeStart, anchor, initialRange]);

  const heading = title ?? (isRange ? "Chọn khoảng thời gian" : isPicking ? "Chọn ngày" : "Xem nhanh lịch");
  const description = isPicking
    ? (pickHint(rule, isRange ? (rangeStart === null ? "start" : "end") : null) ?? "Việc đã có vẫn hiện trên từng ngày.")
    : "Chỉ để xem.";

  const handlePick = (day: string): void => {
    if (isRange) {
      if (rangeStart === null) {
        setRangeStart(day);
        return;
      }
      onPickRange?.(orderRange(rangeStart, day));
      setRangeStart(null);
      onOpenChange(false);
      return;
    }
    onPickDay?.(day);
    onOpenChange(false);
  };

  const pickYear = (year: number): void => {
    setAnchor(`${year}-${anchor.slice(5, 7)}-01`);
    setChooser("month");
  };
  const pickMonth = (monthIndex: number): void => {
    setAnchor(`${anchor.slice(0, 4)}-${`${monthIndex + 1}`.padStart(2, "0")}-01`);
    setMode("month");
    setChooser("none");
  };

  const TitleTag = inline ? "p" : DialogPrimitive.Title;
  const DescTag = inline ? "p" : DialogPrimitive.Description;

  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-0.5 pt-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <TitleTag className="truncate text-[14px] font-semibold text-foreground">{heading}</TitleTag>
          <DescTag className="truncate text-[11.5px] leading-4 text-muted-foreground">{description}</DescTag>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Đóng lịch"
          className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {chooser !== "none" ? (
          <div className="pt-2">
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setChooser(chooser === "month" ? "year" : "none")}
                aria-label="Quay lại"
                className="press flex h-10 w-10 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <p className="text-[15px] font-semibold text-foreground">
                {chooser === "year" ? "Chọn năm" : `Chọn tháng · ${anchor.slice(0, 4)}`}
              </p>
            </div>
            {chooser === "year" ? (
              <YearGrid years={yearChoices(rule, today, anchor)} current={Number.parseInt(anchor.slice(0, 4), 10)} onPick={pickYear} />
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_SHORT.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => pickMonth(index)}
                    className={cn(
                      "press min-h-12 rounded-[10px] border text-[14px] transition-colors",
                      Number.parseInt(anchor.slice(5, 7), 10) === index + 1
                        ? "border-foreground/30 bg-foreground/[0.07] font-semibold text-foreground"
                        : "border-border bg-card text-foreground hover:bg-accent/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <CalendarView
            mode={mode}
            anchor={anchor}
            today={today}
            onModeChange={setMode}
            onAnchorChange={setAnchor}
            modes={COMPACT_MODES}
            density="compact"
            dayHref={(day) => withReturn(`/nhiem-vu?muc=lich&xem=ngay&ngay=${day}`, hereFrom(location, "Quay lại"))}
            onPickDay={isPicking ? handlePick : undefined}
            canPickDay={isPicking ? canPick : undefined}
            pickHint={isPicking ? pickHint(rule, isRange ? (rangeStart === null ? "start" : "end") : null) : undefined}
            highlightRange={highlight}
            onTitleClick={() => setChooser("year")}
          />
        )}
        {showFullLink ? (
          <Link
            to={withReturn(`/nhiem-vu?muc=lich&xem=ngay&ngay=${anchor}`, hereFrom(location, "Quay lại"))}
            onClick={() => onOpenChange(false)}
            className="press mt-2 flex min-h-10 items-center justify-center rounded-[10px] border border-border text-[13px] font-medium text-foreground hover:bg-secondary"
          >
            Mở Lịch đầy đủ trong Nhiệm vụ
          </Link>
        ) : null}
      </div>
    </>
  );
}

function YearGrid({ years, current, onPick }: { years: readonly number[]; current: number; onPick: (year: number) => void }) {
  return (
    <div
      className="grid max-h-[320px] grid-cols-4 gap-1.5 overflow-y-auto"
      ref={(node) => {
        node?.querySelector<HTMLButtonElement>(`[data-year="${current}"]`)?.scrollIntoView({ block: "center" });
      }}
    >
      {years.map((year) => (
        <button
          key={year}
          type="button"
          data-year={year}
          onClick={() => onPick(year)}
          className={cn(
            "press tabular min-h-11 rounded-[10px] border text-[14px] transition-colors",
            year === current
              ? "border-foreground/30 bg-foreground/[0.07] font-semibold text-foreground"
              : "border-border bg-card text-foreground hover:bg-accent/40",
          )}
        >
          {year}
        </button>
      ))}
    </div>
  );
}

/** The small calendar button that opens the peek (global quick look). */
export function CalendarPeekButton({
  label = "Xem nhanh lịch",
  className,
  showFullLink = false,
}: {
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
      <CalendarPeekSheet open={open} onOpenChange={setOpen} showFullLink={showFullLink} />
    </>
  );
}
