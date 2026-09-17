import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// The pure module, not "@/lib/chat": the composer needs no Supabase client to decide
// whether a draft can leave, which also keeps it renderable in isolation under test.
import { canSendDraft } from "@/lib/chat-cache";
import {
  activeMentionQuery,
  applyMention,
  filterMentionCandidates,
  type MentionCandidate,
} from "@/lib/mentions";
import { cn } from "@/lib/utils";

/** Beyond this the composer stops growing and scrolls, so the thread keeps most of the screen. */
const MAX_COMPOSER_HEIGHT_PX = 160;

export type MessageComposerProps = {
  value: string;
  onValueChange: (next: string) => void;
  onSend: (content: string) => void;
  placeholder: string;
  ariaLabel: string;
  isSending: boolean;
  /** Sits on the same line as the text box — where the "+ Nhiệm vụ" button goes in a chat. */
  leadingAction?: ReactNode;
  /**
   * Who can be named here. Empty outside a group: a 1-1 has one other person, so naming them
   * says nothing the message did not already say.
   */
  mentionCandidates?: readonly MentionCandidate[];
};

/**
 * The one composer behind every thread — 1-1, group and Nhật ký all render this.
 *
 * Enter belongs to the message, not to sending: it opens a new line like any other
 * text box. A message leaves only when "Gửi" is pressed, and that button is unavailable
 * until there is something other than whitespace to send.
 */
export function MessageComposer({
  value,
  onValueChange,
  onSend,
  placeholder,
  ariaLabel,
  isSending,
  leadingAction,
  mentionCandidates = [],
}: MessageComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const canSend: boolean = canSendDraft(value, isSending);

  /**
   * The "@…" being typed, if any, and which suggestion is selected.
   *
   * Held as a range rather than just a query so the chosen name replaces exactly what was
   * typed — including when the caret is in the middle of an already-written sentence.
   */
  const [mentionRange, setMentionRange] = useState<{ start: number; caret: number } | null>(null);
  const [highlighted, setHighlighted] = useState<number>(0);

  const suggestions =
    mentionRange === null || mentionCandidates.length === 0
      ? []
      : filterMentionCandidates(
          mentionCandidates,
          value.slice(mentionRange.start + 1, mentionRange.caret),
        );

  /** Recomputed on every change of text or caret, so the picker follows the cursor. */
  const syncMentionRange = useCallback(
    (text: string, caret: number): void => {
      if (mentionCandidates.length === 0) {
        setMentionRange(null);
        return;
      }
      const found = activeMentionQuery(text, caret);
      setMentionRange(found === null ? null : { start: found.start, caret });
      setHighlighted(0);
    },
    [mentionCandidates.length],
  );

  const choose = useCallback(
    (candidate: MentionCandidate): void => {
      if (mentionRange === null) return;
      const result = applyMention(value, mentionRange, candidate);
      onValueChange(result.text);
      setMentionRange(null);
      // Put the caret after the inserted name, or the next keystroke lands in the wrong place.
      window.requestAnimationFrame(() => {
        const field = fieldRef.current;
        if (field === null) return;
        field.focus();
        field.setSelectionRange(result.caret, result.caret);
      });
    },
    [mentionRange, value, onValueChange],
  );

  // Grows with the draft instead of hiding earlier lines behind a one-line window.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, [value]);

  const submit = useCallback((): void => {
    if (!canSendDraft(value, isSending)) return;
    onSend(value.trim());
  }, [value, isSending, onSend]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  /**
   * A textarea never submits a form on its own, but the form still holds other focusable
   * controls. Enter is neutralised everywhere except inside the text itself, so no
   * keystroke can send a message.
   */
  const blockEnterSubmit = useCallback((event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
  }, []);

  /**
   * While the picker is open the arrow keys and Enter belong to it, not to the text.
   *
   * Enter is the one that matters: it is already neutral for sending, so using it to accept a
   * highlighted name costs nothing and is what every other mention picker does.
   */
  const handleFieldKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (mentionRange === null || suggestions.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = suggestions[Math.min(highlighted, suggestions.length - 1)];
        if (candidate === undefined) return;
        event.preventDefault();
        choose(candidate);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionRange(null);
      }
    },
    [mentionRange, suggestions, highlighted, choose],
  );

  return (
    <form
      className="mx-auto flex max-w-2xl items-end gap-3"
      onSubmit={handleSubmit}
      onKeyDown={blockEnterSubmit}
    >
      {leadingAction}
      <div className="relative min-w-0 flex-1">
        {/*
          The suggestion list sits above the box rather than below it: the composer is already
          at the bottom of the screen, and a list below would be off it.
        */}
        {mentionRange !== null && suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Nhắc tên thành viên"
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 max-h-[220px] w-full max-w-[280px] overflow-y-auto rounded-[10px] border border-border bg-card p-1 shadow-lg"
          >
            {suggestions.map((candidate, index) => (
              <li key={candidate.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(candidate)}
                  className={cn(
                    "press w-full truncate rounded-[7px] px-2.5 py-2 text-left text-[13.5px] transition-colors",
                    index === highlighted
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {candidate.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={fieldRef}
          rows={1}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            syncMentionRange(event.target.value, event.target.selectionStart ?? 0);
          }}
          onKeyDown={handleFieldKeyDown}
          onClick={(event) => {
            // Moving the caret by mouse can land inside or outside an "@…", so the picker has
            // to be re-decided rather than left as it was.
            const field = event.currentTarget;
            syncMentionRange(field.value, field.selectionStart ?? 0);
          }}
          onBlur={() => setMentionRange(null)}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="min-h-12 w-full resize-none rounded-md border border-border bg-card px-4 py-3.5 text-[15px] leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
        />
      </div>
      <button
        type="submit"
        disabled={!canSend}
        className="press h-12 shrink-0 rounded-md bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-45"
      >
        Gửi
      </button>
    </form>
  );
}
