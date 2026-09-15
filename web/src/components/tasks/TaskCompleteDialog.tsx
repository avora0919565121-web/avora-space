import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GUIDANCE_TEXT } from "@/lib/guidance";
import { useGuidance } from "@/lib/use-task-flags";
import { isTaskOutputTooLong, TASK_OUTPUT_MAX_LEN, type TaskItem } from "@/lib/tasks";

type TaskCompleteDialogProps = {
  /** The task being completed. Null renders nothing. */
  task: TaskItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Hoàn thành" closes a personal task; "Báo đã xong" files a shared claim. */
  confirmLabel: string;
  /**
   * Completes the task with the (possibly null) output. The caller owns the mutation and
   * its success side effects — the dialog only collects the answer.
   */
  onComplete: (output: string | null) => void;
  isWorking: boolean;
};

/**
 * The question asked at the moment work closes: what did this bring?
 *
 * Always asked, never required — an empty box completes the task exactly the same as a full
 * one, because demanding an essay before letting someone tick a checkbox would teach people
 * to tick without opening the dialog at all. The one-time guidance explains what belongs in
 * the box; after it has been read once, only the question remains.
 */
export function TaskCompleteDialog({
  task,
  open,
  onOpenChange,
  confirmLabel,
  onComplete,
  isWorking,
}: TaskCompleteDialogProps) {
  const [output, setOutput] = useState<string>("");
  const { shouldShow, dismiss } = useGuidance();

  // Every opening starts from the task's current answer — a re-completion revises what was
  // written before rather than pretending the box is empty.
  useEffect(() => {
    if (open) setOutput(task?.outputValue ?? "");
  }, [open, task]);

  if (task === null) return null;

  const tooLong = isTaskOutputTooLong(output);
  const guidance = shouldShow("task_output_value");

  const submit = (): void => {
    if (tooLong || isWorking) return;
    onComplete(output.trim() === "" ? null : output.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-0 rounded-xl border-border bg-card p-0">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            Việc này mang lại điều gì?
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Kết quả cụ thể của “{task.title}” — không bắt buộc, bỏ trống vẫn hoàn thành được.
          </DialogDescription>
        </div>

        <div className="space-y-2 px-5">
          {guidance ? (
            <div className="rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5">
              <p className="text-[12.5px] leading-5 text-muted-foreground">{GUIDANCE_TEXT.task_output_value}</p>
              <button
                type="button"
                onClick={() => dismiss("task_output_value")}
                className="press mt-1.5 text-[12.5px] font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              >
                Đã hiểu
              </button>
            </div>
          ) : null}

          <textarea
            value={output}
            autoFocus
            rows={3}
            maxLength={TASK_OUTPUT_MAX_LEN + 100}
            onChange={(event) => setOutput(event.target.value)}
            placeholder="Ví dụ: Báo cáo đã gửi, được 12 trang — số liệu tháng 8 đã rà soát…"
            aria-label="Kết quả của việc này"
            className="w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
          {tooLong ? (
            <p className="text-[12px] text-destructive">
              Kết quả quá dài (tối đa {TASK_OUTPUT_MAX_LEN} ký tự).
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="press h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
          >
            Quay lại
          </button>
          <button
            type="button"
            disabled={tooLong || isWorking}
            onClick={submit}
            title={tooLong ? `Tối đa ${TASK_OUTPUT_MAX_LEN} ký tự` : undefined}
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
