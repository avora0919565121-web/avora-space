import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { TimeField } from "@/components/tasks/TimeField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { validateTaskDraft, type TaskDraft } from "@/lib/tasks";
import { useSuggestionActions } from "@/lib/use-task-suggestions";
import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "w-full rounded-[8px] border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-muted-foreground";

type EditSuggestionDialogProps = {
  /** The suggestion being reworded. Null renders nothing. */
  suggestionId: string | null;
  /** What it says now, so every opening starts from the current words. */
  draft: {
    title: string;
    description: string;
    deadline: string;
    deadlineTime: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Rewording a suggestion that is still a question.
 *
 * The same three fields the ask was born with, checked by the same rules — an edit that would
 * be refused as a new suggestion is refused here too, before it costs a round trip. Only the
 * wording moves: who is being asked and the quoted exchange are not fields on this form,
 * because changing them would be asking a different question rather than editing this one.
 *
 * Who may open this, and until when, is decided by `canManageSuggestion` and re-checked by the
 * server. This component only collects the words.
 */
export function EditSuggestionDialog({
  suggestionId,
  draft,
  open,
  onOpenChange,
}: EditSuggestionDialogProps) {
  const { edit } = useSuggestionActions();
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
  const [deadlineTime, setDeadlineTime] = useState<string>("");

  // Every opening starts from the suggestion's current words — reopening revises them rather
  // than presenting an empty form that would tempt a full rewrite of something agreed on.
  useEffect(() => {
    if (!open || draft === null) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setDeadline(draft.deadline);
    setDeadlineTime(draft.deadlineTime ?? "");
  }, [open, draft]);

  if (suggestionId === null || draft === null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const canSubmit = title.trim() !== "" && description.trim() !== "" && deadline !== "";

  const submit = async (): Promise<void> => {
    const clean = validateTaskDraft(
      { title, description, deadline, deadlineTime: deadlineTime || undefined } satisfies TaskDraft,
      today,
    );
    if (!clean.value) {
      toast.error(clean.error ?? "Gợi ý chưa đủ thông tin.");
      return;
    }
    try {
      await edit.mutateAsync({
        suggestionId,
        draft: {
          title: clean.value.title,
          description: clean.value.description,
          deadline: clean.value.deadline,
          deadlineTime: clean.value.deadlineTime,
        },
      });
      toast.success("Đã lưu gợi ý mới.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được. Vui lòng thử lại.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-0 rounded-xl border-border bg-card p-0">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            Sửa gợi ý
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Chỉnh lời đề nghị trong khi người kia chưa trả lời. Người được gợi ý không đổi.
          </DialogDescription>
        </div>

        <div className="space-y-2 px-5">
          <div>
            <label
              htmlFor="edit-suggestion-title"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              Tiêu đề
            </label>
            <input
              id="edit-suggestion-title"
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              className={cn(FIELD_CLASS, "h-10")}
            />
          </div>

          <div>
            <label
              htmlFor="edit-suggestion-description"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              Mô tả cụ thể
            </label>
            <textarea
              id="edit-suggestion-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={2000}
              className={cn(FIELD_CLASS, "resize-y py-2 leading-5")}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[150px]">
              <label
                htmlFor="edit-suggestion-deadline"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Hạn hoàn thành
              </label>
              <input
                id="edit-suggestion-deadline"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className={cn(FIELD_CLASS, "h-10")}
              />
            </div>
            <div className="w-[130px]">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Giờ</span>
              <TimeField
                id="edit-suggestion-time"
                ariaLabel="Giờ hoàn thành"
                value={deadlineTime}
                onChange={setDeadlineTime}
              />
            </div>
          </div>
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
            disabled={!canSubmit || edit.isPending}
            onClick={() => void submit()}
            className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {edit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Lưu thay đổi
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
