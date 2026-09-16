import { Building2, Check, X } from "lucide-react";
import { useMemo, useState } from "react";

import { FieldLabel, contactInputClass } from "@/components/contacts/fields";
import { employerOptions, shortTaxCode, type Contact } from "@/lib/contacts";

/**
 * Who this person works for, chosen from the companies already in the book.
 *
 * Typed-with-suggestions rather than a dropdown of everything: the field is optional and usually
 * left empty, so it should cost nothing to skip. It offers only the viewer's own companies —
 * the server refuses anything else, and offering a name that would be rejected is a worse
 * answer than not offering it.
 *
 * It does not create companies. A company added mid-form would arrive with no tax code and no
 * representative, which is exactly the half-filled record the whole model refuses.
 */
export function EmployerPicker({
  contacts,
  value,
  onChange,
  excludeId = null,
}: {
  contacts: readonly Contact[];
  value: string | null;
  onChange: (next: string | null) => void;
  excludeId?: string | null;
}) {
  const [query, setQuery] = useState<string>("");
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const selected = useMemo(
    () => contacts.find((entry) => entry.id === value) ?? null,
    [contacts, value],
  );

  const options = useMemo(
    () => employerOptions(contacts, query, excludeId).slice(0, 6),
    [contacts, query, excludeId],
  );

  const hasCompanies = useMemo(
    () => contacts.some((entry) => entry.contactType === "business" && entry.id !== excludeId),
    [contacts, excludeId],
  );

  if (selected !== null) {
    return (
      <div>
        <FieldLabel>Làm việc cho</FieldLabel>
        <div className="mt-1.5 flex items-center gap-2.5 rounded-md border border-border bg-accent/30 px-3 py-2">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-foreground">{selected.name}</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {shortTaxCode(selected.taxCode)}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Bỏ ${selected.name} khỏi nơi làm việc`}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <FieldLabel htmlFor="employer-search">Làm việc cho</FieldLabel>
      <input
        id="employer-search"
        value={query}
        disabled={!hasCompanies}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        // A click on an option must land before the list closes.
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        placeholder={hasCompanies ? "Tìm doanh nghiệp trong danh bạ" : "Chưa có liên hệ doanh nghiệp nào"}
        className={`mt-1.5 ${contactInputClass}`}
      />

      {isOpen && hasCompanies && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-[220px] w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-sm">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setQuery("");
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40"
              >
                <Building2
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-foreground">{option.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {shortTaxCode(option.taxCode)}
                  </span>
                </span>
                {option.id === value ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {isOpen && hasCompanies && options.length === 0 ? (
        <p className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card px-3 py-2.5 text-[13px] text-muted-foreground shadow-sm">
          Không có doanh nghiệp nào khớp.
        </p>
      ) : null}
    </div>
  );
}
