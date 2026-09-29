import { CalendarRange } from "lucide-react";
import { useRef, useState } from "react";

import { TimeField } from "@/components/tasks/TimeField";
import { CalendarPeekSheet } from "@/components/tasks/CalendarPeekSheet";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { dateFieldLabel, isIsoDay, quickRanges, type DateAllow } from "@/lib/date-field";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

export type DateRangeFieldProps = {
  id: string;
  /** `YYYY-MM-DD` each, "" for none. */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  label?: string;
  title?: string;
  allow?: DateAllow;
  /** Offer Tháng này · Tháng trước · Quý này · Năm nay (reports). */
  showQuickRanges?: boolean;
  /** With times: start/end clocks under the range (Sự kiện / chuẩn bị việc). */
  times?: {
    start: string;
    end: string;
    onChange: (next: { start: string; end: string }) => void;
    /** Same-day span: end marks before the start are dimmed and cannot be picked (A12). */
    endAfterStart?: boolean;
    /** "3 giờ 30 phút", shown beside the end. */
    durationLabel?: string | null;
  };
  className?: string;
};

/**
 * A start–end pair picked on one Lịch Avora (AVORA-39 / Phần 2 · A3): first tap starts, second
 * ends, a second tap earlier than the first simply swaps them. The days between are tinted.
 */
export function DateRangeField({
  id,
  from,
  to,
  onChange,
  label = "Khoảng thời gian",
  title = "Chọn khoảng thời gian",
  allow = "any",
  showQuickRanges = false,
  times,
  className,
}: DateRangeFieldProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const today = todayIso();
  const hasRange = isIsoDay(from) && isIsoDay(to);
  const text = hasRange
    ? from === to
      ? dateFieldLabel(from, today)
      : `${dateFieldLabel(from, today)} → ${dateFieldLabel(to, today)}`
    : "Chọn khoảng ngày";

  const setOpen = (next: boolean): void => {
    setIsOpen(next);
    if (!next) window.setTimeout(() => buttonRef.current?.focus(), 0);
  };

  const sheetProps = {
    open: isOpen,
    onOpenChange: setOpen,
    onPickRange: onChange,
    initialRange: hasRange ? { from, to } : null,
    title,
    allow,
  };

  const trigger = (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={`${label}: ${text}`}
      className={cn(
        "press flex h-12 w-full min-w-0 items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-left text-[15px] transition-colors hover:bg-accent/40 sm:h-11 sm:text-[14px]",
        hasRange ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </button>
  );

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {isDesktop ? (
        <Popover open={isOpen} onOpenChange={setOpen}>
          <PopoverAnchor asChild>{trigger}</PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-[min(360px,calc(100vw-16px))] rounded-xl border-border bg-background p-0 pb-2"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <CalendarPeekSheet {...sheetProps} inline />
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {trigger}
          <CalendarPeekSheet {...sheetProps} placement="top" />
        </>
      )}

      {showQuickRanges ? (
        <div role="group" aria-label="Khoảng nhanh" className="flex flex-wrap gap-1.5">
          {quickRanges(today).map((range) => {
            const active = range.from === from && range.to === to;
            return (
              <button
                key={range.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ from: range.from, to: range.to })}
                className={cn(
                  "press min-h-9 rounded-full border px-3 text-[12.5px] transition-colors",
                  active ? "border-foreground/25 bg-accent font-medium text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent/40",
                )}
              >
                {range.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {times !== undefined ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Bắt đầu
            <TimeField id={`${id}-start`} value={times.start} ariaLabel="Giờ bắt đầu" onChange={(start) => times.onChange({ start, end: times.end })} />
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Kết thúc
            <TimeField
              id={`${id}-end`}
              value={times.end}
              ariaLabel="Giờ kết thúc"
              after={times.endAfterStart === true ? times.start : null}
              onChange={(end) => times.onChange({ start: times.start, end })}
            />
          </span>
          {times.durationLabel != null ? (
            <span className="tabular text-[12px] text-muted-foreground" aria-live="polite">
              {times.durationLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
