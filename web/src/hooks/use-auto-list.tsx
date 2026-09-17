import { useCallback, type KeyboardEvent } from "react";

import { continueList } from "@/lib/auto-list";

/**
 * Enter that keeps a list going, for any textarea that holds written-up notes.
 *
 * One behaviour shared by every such field rather than four copies of it: a task's
 * description, and the three long boxes in a meeting note. They are all places where somebody
 * is writing down several things, and re-typing "- " on every line is the kind of small
 * friction that makes people stop using the structure at all.
 *
 * Deliberately NOT a rich-text editor. What is stored stays plain text — the dashes and
 * numbers are literally the characters the person typed, so the note reads the same in the
 * database, in a summary, and anywhere it is quoted later.
 *
 * Shift+Enter is left alone so there is always a way to break a line without continuing the
 * list, and any modified Enter (⌘/Ctrl) is left for whatever the form does with it.
 */
export function useAutoList(
  onChange: (next: string) => void,
): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const field = event.currentTarget;
      // A selection is a replacement, not a continuation.
      if (field.selectionStart !== field.selectionEnd) return;

      const result = continueList(field.value, field.selectionStart);
      if (result === null) return;

      event.preventDefault();
      onChange(result.value);
      // The caret has to be placed after React has written the new value, or the browser
      // puts it back at the end of the box and the next keystroke lands in the wrong place.
      requestAnimationFrame(() => {
        field.setSelectionRange(result.caret, result.caret);
      });
    },
    [onChange],
  );
}
