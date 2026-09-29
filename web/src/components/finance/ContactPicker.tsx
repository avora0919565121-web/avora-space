import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Search, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAuth } from "@/lib/auth";
import {
  contactHint,
  rankContacts,
  readRecentContacts,
  rememberRecentContact,
  sameNameContacts,
} from "@/lib/contact-picker";
import { contactKeys, createContactQuick, type Contact } from "@/lib/contacts";
import { cn } from "@/lib/utils";

/**
 * One person picker for every place Tài chính asks "who" (Đợt gộp 2 · D5): search without
 * accents by name, phone or email; five recent people first; a phone gets a sheet with its own
 * search box. The last row adds whoever was typed to Danh bạ and picks them, without leaving
 * the form.
 */
export function ContactPicker({
  id,
  contacts,
  value,
  onChange,
  placeholder = "Chọn người",
  invalid = false,
}: {
  id?: string;
  contacts: readonly Contact[];
  value: string;
  onChange: (contactId: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPhone = !useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [adding, setAdding] = useState<boolean>(false);
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // Contacts added here show up before the list refetches.
  const [added, setAdded] = useState<Contact[]>([]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setAdding(false);
    setPhone("");
    setEmail("");
  }, [open]);

  const all = useMemo(() => {
    const known = new Set(contacts.map((contact) => contact.id));
    return [...contacts, ...added.filter((contact) => !known.has(contact.id))];
  }, [contacts, added]);
  const recent = useMemo(() => readRecentContacts(user?.id), [user?.id, open]);
  const ranked = useMemo(() => rankContacts(all, query, recent), [all, query, recent]);
  const selected = all.find((contact) => contact.id === value) ?? null;
  const duplicates = useMemo(() => sameNameContacts(all, query), [all, query]);

  const pick = (contactId: string): void => {
    rememberRecentContact(user?.id, contactId);
    onChange(contactId);
    setOpen(false);
  };

  const addAndPick = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const created = await createContactQuick({ name: query, phone, email });
      setAdded((current) => [...current, created]);
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      toast.success(created.needsDetails ? `Đã thêm ${created.name}. Nhớ bổ sung SĐT hoặc email trong Liên hệ.` : `Đã thêm ${created.name} vào Danh bạ.`);
      pick(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thêm được liên hệ.");
    } finally {
      setIsSaving(false);
    }
  };

  const typed = query.trim();
  const body = (
    <div className="flex max-h-[70dvh] flex-col">
      <label className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setAdding(false);
          }}
          placeholder="Tìm tên, SĐT, email…"
          aria-label="Tìm người"
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
      </label>
      {adding ? (
        <div className="space-y-2 p-3">
          <p className="text-[13.5px] font-medium">Thêm "{typed}" vào Danh bạ</p>
          {duplicates.length > 0 ? (
            <div className="rounded-md bg-amber-500/10 px-3 py-2 text-[12.5px]">
              Đã có người trùng tên:
              {duplicates.map((contact) => (
                <button key={contact.id} type="button" onClick={() => pick(contact.id)} className="press ml-1 font-semibold text-primary underline-offset-2 hover:underline">
                  {contact.name}{contactHint(contact) !== "" ? ` (${contactHint(contact)})` : ""}
                </button>
              ))}
            </div>
          ) : null}
          <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="SĐT (không bắt buộc)" aria-label="Số điện thoại" className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14.5px] outline-none focus:border-primary" />
          <input value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="Email (không bắt buộc)" aria-label="Email" className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14.5px] outline-none focus:border-primary" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="press rounded-md border border-border px-3 py-1.5 text-[13.5px]">Quay lại</button>
            <button type="button" disabled={isSaving} onClick={() => void addAndPick()} className="press rounded-md bg-primary px-3 py-1.5 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-50">
              Thêm &amp; chọn
            </button>
          </div>
        </div>
      ) : (
        <ul role="listbox" aria-label="Người" className="min-h-0 flex-1 overflow-y-auto py-1">
          {ranked.map((contact, index) => (
            <li key={contact.id} role="option" aria-selected={contact.id === value}>
              {index === 0 && recent.includes(contact.id) && typed === "" ? (
                <p className="px-3 pb-0.5 pt-1.5 text-[11.5px] font-medium text-muted-foreground">Gần đây</p>
              ) : null}
              <button type="button" onClick={() => pick(contact.id)} className="press flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] text-foreground">{contact.name}</span>
                  {contactHint(contact) !== "" ? <span className="block truncate text-[12px] text-muted-foreground">{contactHint(contact)}</span> : null}
                </span>
                {contact.id === value ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
          {ranked.length === 0 ? <li className="px-3 py-2 text-[13.5px] text-muted-foreground">Không thấy ai.</li> : null}
          {typed !== "" ? (
            <li className="border-t border-border/70">
              <button type="button" onClick={() => setAdding(true)} className="press flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] font-medium text-primary">
                <UserPlus className="h-4 w-4" aria-hidden="true" /> ＋ Thêm "{typed}" vào Danh bạ
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );

  const trigger = (
    <button
      id={id}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-invalid={invalid}
      onClick={isPhone ? () => setOpen(true) : undefined}
      className={cn(
        "mt-1.5 flex h-12 w-full items-center gap-2 rounded-md border bg-card px-4 text-left text-[15px]",
        invalid ? "border-destructive" : "border-border",
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate", selected === null && "text-muted-foreground")}>
        {selected === null ? placeholder : selected.name}
        {selected !== null && contactHint(selected) !== "" ? <span className="ml-2 text-[12.5px] text-muted-foreground">{contactHint(selected)}</span> : null}
      </span>
      <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );

  if (isPhone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="p-0">
            <SheetTitle className="px-4 pt-4 text-[16px]">{placeholder}</SheetTitle>
            {body}
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        {body}
      </PopoverContent>
    </Popover>
  );
}
