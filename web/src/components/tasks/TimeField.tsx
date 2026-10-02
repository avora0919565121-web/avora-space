import { Clock, X } from "lucide-react";
import { useEffect, useState } from "react";

import { FloatingPanel } from "@/components/ui/floating-panel";
import {
  composeTime,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  padTwo,
  splitTime,
} from "@/lib/task-schedule";
import { parseMinute } from "@/lib/date-field";
import { cn } from "@/lib/utils";

type TimeFieldProps = {
  id: string;
  /** `HH:MM`, or empty for "no particular time that day". */
  value: string;
  onChange: (next: string) => void;
  /** Announced to screen readers in place of a visible label. */
  ariaLabel?: string;
  /** `HH:MM`: only marks strictly after this can be picked (an Event's end, Đợt gộp 2 · A12). */
  after?: string | null;
};

/**
 * A clock you tap rather than type.
 *
 * The browser's own time control asks for a deadline to the minute — sixty choices an hour,
 * entered digit by digit, with a spinner most people fight on a phone. A deadline is an
 * intention: five-minute marks say everything anyone means by "về chiều" and fit on one
 * screen. The field stays optional, so the resting state is an empty clock, not a time.
 */
export function TimeField({ id, value, onChange, ariaLabel, after = null }: TimeFieldProps) {
  const floor = after === null || after === "" ? null : splitTime(after);
  const floorMinutes = floor === null ? -1 : floor.hour * 60 + floor.minute;
  const isAllowed = (hour: number, minute: number): boolean => hour * 60 + minute > floorMinutes;
  const hourAllowed = (hour: number): boolean => isAllowed(hour, 59);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const chosen = splitTime(value === "" ? null : value);
  // Which hour the minute grid belongs to while the popover is open, before a full time exists.
  const [pendingHour, setPendingHour] = useState<number | null>(chosen?.hour ?? null);

  useEffect(() => {
    if (isOpen) setPendingHour(splitTime(value === "" ? null : value)?.hour ?? null);
  }, [isOpen, value]);

  const activeHour: number | null = pendingHour ?? chosen?.hour ?? null;

  const pickHour = (hour: number): void => {
    if (!hourAllowed(hour)) return;
    setPendingHour(hour);
    // An hour on its own is already a usable answer: the minute defaults to the first allowed mark.
    const wanted = chosen?.minute ?? 0;
    const minute = isAllowed(hour, wanted) ? wanted : (MINUTE_OPTIONS.find((option) => isAllowed(hour, option)) ?? null);
    if (minute === null) return;
    const next = composeTime(hour, minute);
    if (next !== null) onChange(next);
  };

  const pickMinute = (minute: number): void => {
    if (!isAllowed(activeHour ?? 0, minute)) return;
    const next = composeTime(activeHour ?? 0, minute);
    if (next !== null) onChange(next);
    setIsOpen(false);
  };

  const [isCustomOpen, setIsCustomOpen] = useState<boolean>(false);
  const [customMinute, setCustomMinute] = useState<string>("");
  useEffect(() => {
    if (!isOpen) setIsCustomOpen(false);
  }, [isOpen]);
  const submitCustom = (): void => {
    const minute = parseMinute(customMinute);
    if (minute !== null) pickMinute(minute);
    else setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <FloatingPanel
        open={isOpen}
        onOpenChange={setIsOpen}
        label="Chọn giờ"
        width={280}
        height={360}
        anchor={
          <button
            id={id}
            type="button"
            onClick={() => setIsOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
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
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto bg-card p-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Giờ</p>
          <div className="grid grid-cols-6 gap-1">
            {HOUR_OPTIONS.map((hour) => (
              <button
                key={hour}
                type="button"
                aria-label={`${padTwo(hour)} giờ`}
                aria-pressed={activeHour === hour}
                disabled={!hourAllowed(hour)}
                onClick={() => pickHour(hour)}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-30",
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
                disabled={!isAllowed(activeHour ?? 0, minute)}
                onClick={() => pickMinute(minute)}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                  chosen?.minute === minute && value !== ""
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                {padTwo(minute)}
              </button>
            ))}
          </div>

          {/* An odd minute for whoever needs it (AVORA-39 / Phần 2 · A2). Invalid input keeps the old value. */}
          {isCustomOpen ? (
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                submitCustom();
              }}
            >
              <input
                autoFocus
                inputMode="numeric"
                spellCheck={false}
                pattern="[0-9]*"
                maxLength={2}
                value={customMinute}
                onChange={(event) => setCustomMinute(event.target.value.replace(/\D/g, ""))}
                aria-label="Phút (0–59)"
                placeholder="0–59"
                className="tabular h-10 w-20 rounded-md border border-input bg-background px-2.5 text-[16px] text-foreground outline-none focus:border-personal sm:text-[14px]"
              />
              <button
                type="submit"
                className="press h-10 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground"
              >
                Xong
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCustomMinute("");
                setIsCustomOpen(true);
              }}
              className="press mt-2 flex min-h-9 w-full items-center justify-center rounded-md text-[12.5px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              Phút khác
            </button>
          )}
        </div>
      </FloatingPanel>

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
