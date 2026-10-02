import type { ReactNode } from "react";

import { nameCaseSuggestion } from "@/lib/contact-clean";
import { suspectSyllables } from "@/lib/contact-name-repair";

/** A required field is marked once, visibly and for screen readers alike. */
export function FieldLabel({
  children,
  required = false,
  htmlFor,
}: {
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-0.5 text-primary">
            *
          </span>
          <span className="sr-only"> (bắt buộc)</span>
        </>
      ) : null}
    </label>
  );
}

export const contactInputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-personal/60 disabled:opacity-60";

/** One labelled text field — the shape every line of both contact forms takes. */
export function TextField({
  id,
  label,
  value,
  onChange,
  required = false,
  placeholder,
  type = "text",
  inputMode,
  list,
  autoFocus = false,
  maxLength = 200,
  suggestCase = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "date" | "email" | "tel";
  inputMode?: "text" | "email" | "tel" | "numeric";
  list?: string;
  autoFocus?: boolean;
  maxLength?: number;
  /** AVORA-56 · B: offer `Viết thành "Nguyễn Văn A"?` for an all-lower / all-upper name. */
  suggestCase?: boolean;
}) {
  const suggestion = suggestCase ? nameCaseSuggestion(value) : null;
  // AVORA-63 · C: a name field also flags syllables that do not look Vietnamese — a quiet dotted
  // line under the word, never a block on saving.
  const suspects = suggestCase ? suspectSyllables(value) : [];
  // AVORA-56 · C: no red underline under an email or a phone number.
  const isMachineValue = type === "email" || type === "tel";
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type={type}
        list={list}
        value={value}
        autoFocus={autoFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={isMachineValue ? false : suggestCase ? true : undefined}
        lang={suggestCase ? "vi" : undefined}
        autoCapitalize={isMachineValue ? "off" : undefined}
        autoCorrect={isMachineValue ? "off" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 ${contactInputClass}`}
      />
      {suspects.length > 0 ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground" data-name-suspects="">
          Kiểm tra lại:{" "}
          {suspects.map((word, index) => (
            <span key={`${word}-${index}`} className="underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-4">
              {index > 0 ? ", " : ""}
              {word}
            </span>
          ))}
        </p>
      ) : null}
      {suggestion !== null ? (
        <button
          type="button"
          onClick={() => onChange(suggestion)}
          className="press mt-1.5 inline-flex min-h-8 items-center rounded-full bg-primary/[0.08] px-3 text-[12.5px] font-medium text-primary hover:bg-primary/15"
        >
          Viết thành “{suggestion}”?
        </button>
      ) : null}
    </div>
  );
}

/** A short free-text note. Two rows: enough for a reminder, not enough for a diary. */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>Ghi chú</FieldLabel>
      <textarea
        id={id}
        rows={2}
        value={value}
        maxLength={500}
        lang="vi"
        spellCheck
        placeholder="Điều bạn muốn nhớ về người này"
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[16px] md:text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-personal/60"
      />
    </div>
  );
}
