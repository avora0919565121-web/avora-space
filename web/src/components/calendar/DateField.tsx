import { CalendarDays, X } from "lucide-react";
import { useRef, useState } from "react";

import { CalendarPeekSheet } from "@/components/tasks/CalendarPeekSheet";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { dateFieldLabel, type DateAllow } from "@/lib/date-field";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

export type DateFieldProps = {
  id?: string;
  /** `YYYY-MM-DD`, or null / "" for no date — the exact string the forms already store. */
  value: string | null;
  onChange: (next: string) => void;
  /** Announced to screen readers; also the sheet's title when `title` is not given. */
  label?: string;
  /** "Chọn ngày hạn", "Chọn ngày sinh"… */
  title?: string;
  required?: boolean;
  allow?: DateAllow;
  min?: string | null;
  max?: string | null;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

/**
 * One button that opens Lịch Avora (AVORA-39 / Phần 2 · A1).
 *
 * Replaces the browser's own date control everywhere: no English calendar, no iOS wheel, no
 * zoom on focus. On a phone it opens the bottom sheet; on a computer a popover anchored here.
 * Focus returns to this button when the calendar closes.
 */
export function DateField({
  id,
  value,
  onChange,
  label,
  title,
  required = false,
  allow = "future",
  min,
  max,
  disabled = false,
  className,
  placeholder = "Chọn ngày",
}: DateFieldProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const today = todayIso();
  const hasValue = typeof value === "string" && value !== "";
  const text = hasValue ? dateFieldLabel(value, today) : "";

  const setOpen = (next: boolean): void => {
    setIsOpen(next);
    if (!next) window.setTimeout(() => buttonRef.current?.focus(), 0);
  };

  const sheetProps = {
    open: isOpen,
    onOpenChange: setOpen,
    onPickDay: onChange,
    initialDay: hasValue ? value : null,
    title: title ?? (label !== undefined ? `Chọn ${label.toLowerCase()}` : "Chọn ngày"),
    allow,
    min,
    max,
  };

  const trigger = (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      disabled={disabled}
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-required={required || undefined}
      aria-label={label !== undefined ? `${label}: ${hasValue ? text : placeholder}` : undefined}
      className={cn(
        "press flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-left text-[15px] transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:text-[14px]",
        hasValue ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{hasValue ? text : placeholder}</span>
    </button>
  );

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {isDesktop ? (
        <Popover open={isOpen} onOpenChange={setOpen}>
          <PopoverAnchor asChild>{trigger}</PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-[min(440px,calc(100vw-2rem))] rounded-xl border-border bg-background p-0 pb-2"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const node = event.currentTarget as HTMLElement | null;
              window.setTimeout(() => node?.querySelector<HTMLButtonElement>("[data-day][tabindex='0']")?.focus(), 60);
            }}
          >
            <CalendarPeekSheet {...sheetProps} inline />
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {trigger}
          <CalendarPeekSheet {...sheetProps} />
        </>
      )}
      {hasValue && !required && !disabled ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Xoá ${label?.toLowerCase() ?? "ngày"}`}
          title="Xoá ngày"
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
