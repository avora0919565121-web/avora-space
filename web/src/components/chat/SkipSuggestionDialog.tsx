import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  canSubmitSkipFor,
  skipMessageFor,
  skipMessageTemplate,
  skipReplyModesFor,
  type SkipReplyMode,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

type SkipSuggestionDialogProps = {
  /** What is being declined, quoted so a group decline can name it. Null closes the dialog. */
  title: string | null;
  /**
   * Whether saying nothing at all is one of the answers. True in a 1-1, false in a group --
   * and the server refuses a silent group decline independently, so this is not a UI-only rule.
   */
  allowSilent: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who asked, named so the offered sentence can address them. */
  creatorName: string;
  /**
   * Declines the task and, unless silent, sends `message` into the same conversation.
   * A plain message, not a system notice: the thread has one kind of line in it.
   */
  onSkip: (input: { silent: boolean; message: string | null }) => void;
  isWorking: boolean;
};

const MODE_LABEL: Record<SkipReplyMode, string> = {
  template: "Gửi lời nhắn có sẵn",
  custom: "Tự viết lời nhắn",
  silent: "Bỏ qua, không cần nhắn gì",
};

/**
 * Declining a suggestion, with a way to say so kindly.
 *
 * The three answers are not decoration. Declining in silence reads as being ignored, and the
 * usual reason people go silent is that they cannot find the words — so the words are offered,
 * already addressed to the person who asked, sendable without a single keystroke. Writing your
 * own is there for when the offered sentence is not true.
 *
 * Saying nothing at all is offered ONLY in a 1-1, where the other person still sees the decline
 * on the task itself. In a group that same silence would leave a room of people watching a
 * request go unanswered, so the option is absent rather than present-and-refused — and the
 * server refuses it independently, so this is not a UI-only rule.
 */
export function SkipSuggestionDialog({
  title,
  allowSilent,
  open,
  onOpenChange,
  creatorName,
  onSkip,
  isWorking,
}: SkipSuggestionDialogProps) {
  const [mode, setMode] = useState<SkipReplyMode>("template");
  const [custom, setCustom] = useState<string>("");

  // Every opening starts from the offered sentence, so a half-typed reply from last time
  // cannot be sent to a different person by accident.
  useEffect(() => {
    if (!open) return;
    setMode("template");
    setCustom("");
  }, [open]);

  if (title === null) return null;

  const modes = skipReplyModesFor(allowSilent);
  const template = skipMessageTemplate(creatorName);
  const canSubmit = canSubmitSkipFor(allowSilent, mode, custom) && !isWorking;

  const submit = (): void => {
    if (!canSubmit) return;
    onSkip({ silent: mode === "silent", message: skipMessageFor(mode, creatorName, custom) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] gap-0 rounded-xl border-border bg-card p-0">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            Bỏ qua việc này
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {allowSilent
              ? "Bạn không cần giải thích. Nhưng một dòng ngắn giúp người kia biết bạn đã đọc."
              : `Trong nhóm, hãy để lại một dòng — cả nhóm đang chờ phản hồi cho “${title}”.`}
          </DialogDescription>
        </div>

        <div className="space-y-2 px-5">
          {modes.map((option) => {
            const active = mode === option;
            return (
              <div key={option}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMode(option)}
                  className={cn(
                    "press flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                    active ? "border-primary/60 bg-primary/5" : "border-border bg-background/50 hover:bg-accent/30",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      active ? "border-primary" : "border-muted-foreground",
                    )}
                  >
                    {active ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-foreground">
                      {MODE_LABEL[option]}
                    </span>
                    {option === "template" ? (
                      <span className="mt-0.5 block text-[13px] italic leading-5 text-muted-foreground">
                        “{template}”
                      </span>
                    ) : null}
                    {option === "silent" ? (
                      <span className="mt-0.5 block text-[12.5px] leading-5 text-muted-foreground">
                        Không tạo tin nhắn nào. Chỉ một dòng chú thích trong cuộc trò chuyện.
                      </span>
                    ) : null}
                  </span>
                </button>

                {option === "custom" && active ? (
                  <textarea
                    value={custom}
                    autoFocus
                    rows={3}
                    maxLength={2000}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder="Viết điều bạn muốn nói…"
                    aria-label="Lời nhắn của bạn"
                    className="mt-2 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
                  />
                ) : null}
              </div>
            );
          })}
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
            disabled={!canSubmit}
            onClick={submit}
            title={
              canSubmit ? undefined : mode === "custom" ? "Hãy viết một dòng trước khi gửi" : undefined
            }
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {mode === "silent" ? "Bỏ qua" : "Gửi & bỏ qua"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
