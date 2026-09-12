import { Clock, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  composeTime,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  padTwo,
  splitTime,
} from "@/lib/task-schedule";
import { cn } from "@/lib/utils";

type TimeFieldProps = {
  id: string;
  /** `HH:MM`, or empty for "no particular time that day". */
  value: string;
  onChange: (next: string) => void;
  /** Announced to screen readers in place of a visible label. */
  ariaLabel?: string;
};

/**
 * A clock you tap rather than type.
 *
 * The browser's own time control asks for a deadline to the minute — sixty choices an hour,
 * entered digit by digit, with a spinner most people fight on a phone. A deadline is an
 * intention: five-minute marks say everything anyone means by "về chiều" and fit on one
 * screen. The field stays optional, so the resting state is an empty clock, not a time.
 */
export function TimeField({ id, value, onChange, ariaLabel }: TimeFieldProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const chosen = splitTime(value === "" ? null : value);
  // Which hour the minute grid belongs to while the popover is open, before a full time exists.
  const [pendingHour, setPendingHour] = useState<number | null>(chosen?.hour ?? null);

  useEffect(() => {
    if (isOpen) setPendingHour(splitTime(value === "" ? null : value)?.hour ?? null);
  }, [isOpen, value]);

  const activeHour: number | null = pendingHour ?? chosen?.hour ?? null;

  const pickHour = (hour: number): void => {
    setPendingHour(hour);
    // An hour on its own is already a usable answer: the minute defaults to the o'clock mark.
    const next = composeTime(hour, chosen?.minute ?? 0);
    if (next !== null) onChange(next);
  };

  const pickMinute = (minute: number): void => {
    const next = composeTime(activeHour ?? 0, minute);
    if (next !== null) onChange(next);
    setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={ariaLabel ?? (value === "" ? "Chọn giờ" : `Giờ đã chọn ${value}`)}
            className={cn(
              "press flex h-12 items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-[14px] transition-colors hover:bg-accent/40 sm:h-11",
              value === "" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <Clock className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
            {value === "" ? (
              <span className="text-[13px]">Chọn giờ</span>
            ) : (
              <span className="tabular font-medium">{value}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[268px] rounded-xl border-border bg-card p-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Giờ</p>
          <div className="grid grid-cols-6 gap-1">
            {HOUR_OPTIONS.map((hour) => (
              <button
                key={hour}
                type="button"
                aria-label={`${padTwo(hour)} giờ`}
                aria-pressed={activeHour === hour}
                onClick={() => pickHour(hour)}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] transition-colors",
                  activeHour === hour
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                {padTwo(hour)}
              </button>
            ))}
          </div>

          <p className="mb-1.5 mt-3 text-[12px] font-medium text-muted-foreground">Phút</p>
          <div className="grid grid-cols-6 gap-1">
            {MINUTE_OPTIONS.map((minute) => (
              <button
                key={minute}
                type="button"
                aria-label={`${padTwo(minute)} phút`}
                aria-pressed={chosen?.minute === minute && value !== ""}
                onClick={() => pickMinute(minute)}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] transition-colors",
                  chosen?.minute === minute && value !== ""
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                {padTwo(minute)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {value !== "" ? (
        <button
          type="button"
          aria-label="Bỏ giờ"
          title="Bỏ giờ"
          onClick={() => onChange("")}
          className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:h-11 sm:w-11"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
