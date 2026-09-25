import { CalendarClock, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { CalendarPeekButton } from "@/components/tasks/CalendarPeekSheet";
import { TimeField } from "@/components/tasks/TimeField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { callInviteMessage, callTimeLabel, newCallRoomLink, scheduleProblem } from "@/lib/calls";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60";

/**
 * "Lên lịch cuộc gọi" for a group or a project: a time, a room link, and one invitation posted
 * into this conversation. The person scheduling sees the exact message before it is sent; no
 * call starts and nothing is added to anyone's calendar on its own.
 */
export function ScheduleCallDialog({
  open,
  onOpenChange,
  placeName,
  onPost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The group or project name, for the description line. */
  placeName: string;
  /** Posts the invitation into the conversation; rejects if it could not be sent. */
  onPost: (content: string) => Promise<void>;
}) {
  const today = todayIso();
  const [topic, setTopic] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const { isSubmitting, guard } = useSubmitGuard();

  // Every opening starts clean, with a fresh room: an old link must never be re-sent by accident.
  useEffect(() => {
    if (!open) return;
    setTopic("");
    setDay("");
    setTime("");
    setLink(newCallRoomLink());
    setNotice(null);
  }, [open]);

  const at: Date | null = day !== "" && time !== "" ? new Date(`${day}T${time}:00`) : null;
  const preview = at !== null && !Number.isNaN(at.getTime()) ? callInviteMessage({ topic, at, link }) : null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const problem = scheduleProblem({ at, link });
    if (problem !== null || at === null) {
      setNotice(problem);
      return;
    }
    setNotice(null);
    await guard(async () => {
      try {
        await onPost(callInviteMessage({ topic, at, link }));
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chưa gửi được lời mời. Thử lại nhé.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isSubmitting ? undefined : onOpenChange(next))}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] max-w-[480px] gap-0 overflow-y-auto rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/60 text-foreground">
              <CalendarClock className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Lên lịch cuộc gọi</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
                Một lời mời kèm giờ và link sẽ được đăng vào {placeName}.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
            className="press -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-3 px-5 pb-5 pt-1 sm:px-6 sm:pb-6">
          <div>
            <label htmlFor="call-topic" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Nội dung (không bắt buộc)
            </label>
            <input
              id="call-topic"
              value={topic}
              maxLength={120}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Ví dụ: Chốt kế hoạch tuần"
              className={cn(FIELD_CLASS, "h-12")}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label htmlFor="call-day" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Ngày
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="call-day"
                  type="date"
                  value={day}
                  min={today}
                  onChange={(event) => setDay(event.target.value)}
                  className={cn(FIELD_CLASS, "h-12 min-w-0 flex-1 text-[14px]")}
                />
                <CalendarPeekButton
                  label="Xem lịch để chọn ngày gọi"
                  className="h-12 w-12"
                  initialDay={day === "" ? null : day}
                  onPickDay={setDay}
                />
              </div>
            </div>
            <div>
              <label htmlFor="call-time" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Giờ
              </label>
              <TimeField id="call-time" value={time} onChange={setTime} />
            </div>
          </div>

          <div>
            <label htmlFor="call-link" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Link cuộc gọi
            </label>
            <div className="flex items-center gap-2">
              <input
                id="call-link"
                value={link}
                inputMode="url"
                onChange={(event) => setLink(event.target.value)}
                className={cn(FIELD_CLASS, "h-12 min-w-0 flex-1 text-[14px]")}
              />
              <button
                type="button"
                onClick={() => setLink(newCallRoomLink())}
                aria-label="Tạo link phòng mới"
                title="Tạo link phòng mới"
                className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground/80">
              Phòng Jitsi mở được ngay, không cần tài khoản. Dán link Meet/Zoom của bạn vào đây nếu muốn.
            </p>
          </div>

          {preview !== null ? (
            <div className="rounded-[10px] border border-dashed border-border bg-background px-3.5 py-3">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Tin sẽ đăng</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-6 text-foreground">{preview}</p>
            </div>
          ) : null}

          {notice !== null ? (
            <p role="alert" className="text-[13px] text-destructive">
              {notice}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="press h-12 rounded-[10px] border border-border px-5 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="press h-12 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-50"
            >
              {at !== null && !Number.isNaN(at.getTime()) ? `Đăng lời mời · ${callTimeLabel(at).split(" lúc ")[1] ?? ""}` : "Đăng lời mời"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
