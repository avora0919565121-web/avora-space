import { TaskComposer } from "@/components/tasks/TaskComposer";
import type { ComposerPlace } from "@/lib/task-composer";
import type { TaskSuggestion } from "@/lib/task-suggestions";
import { eventOf } from "@/lib/use-task-composer";
import { useSuggestionActions } from "@/lib/use-task-suggestions";

type EditSuggestionDialogProps = {
  /** The suggestion being reworded. Null renders nothing. */
  suggestion: TaskSuggestion | null;
  /** Who was asked, shown locked in "Giao cho". */
  assigneeName: string;
  place?: ComposerPlace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Sửa gợi ý" — the one task form (ADR-030) in its edit-suggestion mode: Giao cho is locked,
 * the rest is the same form. The server re-checks that it is still the proposer's own, still
 * unanswered question.
 */
export function EditSuggestionDialog({ suggestion, assigneeName, place = "direct", open, onOpenChange }: EditSuggestionDialogProps) {
  const { edit } = useSuggestionActions();
  if (suggestion === null) return null;

  return (
    <TaskComposer
      open={open}
      onOpenChange={onOpenChange}
      mode="edit-suggestion"
      place={place}
      lockedRecipientLabel={assigneeName}
      allowTravel={false}
      initial={{
        title: suggestion.title,
        description: suggestion.description,
        deadline: suggestion.deadline,
        deadlineTime: suggestion.deadlineTime,
        startAt: suggestion.startAt,
        endAt: suggestion.endAt,
        location: suggestion.location,
        requiresPresence: suggestion.requiresPresence,
      }}
      onSave={async (values) => {
        await edit.mutateAsync({
          suggestionId: suggestion.id,
          draft: {
            title: values.title,
            description: values.description,
            deadline: values.deadline,
            deadlineTime: values.deadlineTime,
            event: eventOf(values),
          },
        });
      }}
    />
  );
}
