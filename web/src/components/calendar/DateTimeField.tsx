import { DateField } from "@/components/calendar/DateField";
import { TimeField } from "@/components/tasks/TimeField";
import { joinLocalDateTime, splitLocalDateTime, type DateAllow } from "@/lib/date-field";
import { cn } from "@/lib/utils";

export type DateTimeFieldProps = {
  id: string;
  /** `YYYY-MM-DDTHH:MM` (the old `datetime-local` string), or "" for none. */
  value: string;
  onChange: (next: string) => void;
  label?: string;
  title?: string;
  required?: boolean;
  allow?: DateAllow;
  min?: string | null;
  max?: string | null;
  /** Used when a day is chosen before any time. */
  defaultTime?: string;
  className?: string;
};

/**
 * Lịch Avora + Chọn giờ side by side (AVORA-39 / Phần 2 · A2). Replaces every `datetime-local`;
 * the value in and out is the same string the forms already stored, so nothing about saving changes.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  label,
  title,
  required,
  allow = "any",
  min,
  max,
  defaultTime = "09:00",
  className,
}: DateTimeFieldProps) {
  const { date, time } = splitLocalDateTime(value);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <DateField
        id={id}
        value={date}
        label={label}
        title={title}
        required={required}
        allow={allow}
        min={min}
        max={max}
        className="min-w-[180px] flex-1"
        onChange={(nextDate) => onChange(nextDate === "" ? "" : joinLocalDateTime(nextDate, time, defaultTime))}
      />
      <TimeField
        id={`${id}-time`}
        value={time}
        ariaLabel={label !== undefined ? `Giờ — ${label}` : undefined}
        onChange={(nextTime) => {
          if (date === "") return;
          onChange(joinLocalDateTime(date, nextTime, defaultTime));
        }}
      />
    </div>
  );
}
