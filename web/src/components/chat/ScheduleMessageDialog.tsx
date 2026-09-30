import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DateField } from "@/components/calendar/DateField";
import { TimeField } from "@/components/tasks/TimeField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { quickScheduleTimes, sendAtLine } from "@/lib/scheduled-messages";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

function isoDay(date: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clockOf(date: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Hẹn giờ gửi (Đợt gộp 2 · B2): a short preview, three quick times, or any day + time, one line
 * saying exactly when it will go, and "Hẹn gửi". Fits without scrolling.
 */
export function ScheduleMessageDialog({
  open,
  onOpenChange,
  content,
  initialAt = null,
  title = "Gửi hẹn giờ",
  submitLabel = "Hẹn gửi",
  isWorking,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: string;
  initialAt?: Date | null;
  title?: string;
  submitLabel?: string;
  isWorking: boolean;
  onSubmit: (at: Date) => void;
}) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [chosen, setChosen] = useState<Date | null>(initialAt);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [day, setDay] = useState<string>("");
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const fresh = new Date();
    setNow(fresh);
    setChosen(initialAt);
    setIsCustom(initialAt !== null);
    setDay(initialAt !== null ? isoDay(initialAt) : isoDay(fresh));
    setTime(initialAt !== null ? clockOf(initialAt) : "");
  }, [open, initialAt]);

  const quick = useMemo(() => quickScheduleTimes(now), [now]);

  useEffect(() => {
    if (!isCustom || day === "" || time === "") return;
    const at = new Date(`${day}T${time}`);
    if (!Number.isNaN(at.getTime())) setChosen(at);
  }, [isCustom, day, time]);

  const tooSoon = chosen !== null && chosen.getTime() < Date.now() + 5 * 60_000;
  const tooFar = chosen !== null && chosen.getTime() > Date.now() + 30 * 86_400_000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(longDialogContentClass, "max-w-[420px]")}>
        <LongDialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] text-muted-foreground">
            Người nhận không thấy gì cho tới lúc gửi.
          </DialogDescription>
        </LongDialogHeader>
        <LongDialogBody className="space-y-4">
          <p className="line-clamp-3 whitespace-pre-wrap rounded-[10px] border border-border bg-secondary/40 px-3 py-2 text-[13.5px] leading-5 text-foreground">
            {content}
          </p>
          <div role="group" aria-label="Chọn nhanh" className="flex flex-wrap gap-2">
            {quick.map((option) => {
              const active = !isCustom && chosen !== null && chosen.getTime() === option.at.getTime();
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setIsCustom(false);
                    setChosen(option.at);
                  }}
                  className={cn(
                    "press min-h-10 rounded-full border px-3.5 text-[13px] transition-colors",
                    active ? "border-foreground/30 bg-accent font-medium text-foreground" : "border-border text-foreground hover:bg-accent/40",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={isCustom}
              onClick={() => {
                setIsCustom(true);
                setChosen(null);
              }}
              className={cn(
                "press min-h-10 rounded-full border px-3.5 text-[13px] transition-colors",
                isCustom ? "border-foreground/30 bg-accent font-medium text-foreground" : "border-dashed border-border text-muted-foreground hover:bg-accent/40",
              )}
            >
              Chọn ngày giờ khác
            </button>
          </div>
          {isCustom ? (
            <div className="flex flex-wrap gap-2">
              <DateField id="schedule-day" value={day} onChange={setDay} label="Ngày gửi" title="Chọn ngày gửi" required allow="future" min={todayIso()} />
              <TimeField id="schedule-time" value={time} onChange={setTime} ariaLabel="Giờ gửi" />
            </div>
          ) : null}
          <p className={cn("text-[13px]", tooSoon || tooFar ? "text-destructive" : "text-foreground")} aria-live="polite">
            {chosen === null
              ? "Chọn lúc gửi."
              : tooSoon
                ? "Hẹn giờ ít nhất 5 phút sau bây giờ."
                : tooFar
                  ? "Chỉ hẹn được trong vòng 30 ngày."
                  : `Sẽ gửi lúc ${sendAtLine(chosen, now)}`}
          </p>
        </LongDialogBody>
        <LongDialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            type="button"
            disabled={chosen === null || tooSoon || tooFar || isWorking}
            onClick={() => {
              if (chosen !== null) onSubmit(chosen);
            }}
          >
            {submitLabel}
          </Button>
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}
