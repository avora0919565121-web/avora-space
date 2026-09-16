import type { ReactNode } from "react";

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
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 disabled:opacity-60";

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
}) {
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
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 ${contactInputClass}`}
      />
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
        placeholder="Điều bạn muốn nhớ về người này"
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
      />
    </div>
  );
}
