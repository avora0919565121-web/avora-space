import {
  useCallback,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// The pure module, not "@/lib/chat": the composer needs no Supabase client to decide
// whether a draft can leave, which also keeps it renderable in isolation under test.
import { canSendDraft } from "@/lib/chat-cache";

/** Beyond this the composer stops growing and scrolls, so the thread keeps most of the screen. */
const MAX_COMPOSER_HEIGHT_PX = 160;

export type MessageComposerProps = {
  value: string;
  onValueChange: (next: string) => void;
  onSend: (content: string) => void;
  placeholder: string;
  ariaLabel: string;
  isSending: boolean;
  /** Sits on the same line as the text box — where the "+ Tác vụ" button goes in a chat. */
  leadingAction?: ReactNode;
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
}: MessageComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const canSend: boolean = canSendDraft(value, isSending);

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

  return (
    <form
      className="mx-auto flex max-w-2xl items-end gap-3"
      onSubmit={handleSubmit}
      onKeyDown={blockEnterSubmit}
    >
      {leadingAction}
      <textarea
        ref={fieldRef}
        rows={1}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        maxLength={4000}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-h-12 flex-1 resize-none rounded-md border border-border bg-card px-4 py-3.5 text-[15px] leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
      />
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
