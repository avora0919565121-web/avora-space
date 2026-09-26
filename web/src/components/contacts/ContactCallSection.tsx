import { MessageCircle, Phone, type LucideIcon } from "lucide-react";
import { useMemo } from "react";

import { handOffCall } from "@/lib/call-handoff";
import { CALL_APPS, contactPhones, type CallApp } from "@/lib/calls";
import type { ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

const APP_ICONS: Readonly<Record<CallApp, LucideIcon>> = {
  phone: Phone,
  zalo: MessageCircle,
  whatsapp: MessageCircle,
};

/**
 * Gọi: one row per number this contact has, each with Điện thoại / Zalo / WhatsApp.
 *
 * Only shown when there is a number at all — a contact with only an email has no channel here, so
 * nothing is offered that would fail. Messenger is not offered (it needs a username, which Liên hệ
 * does not store). The same hand-off as the 1-1 call icon: nothing is dialled by AVORA.
 */
export function ContactCallSection({
  contact,
  channels,
}: {
  contact: Contact;
  channels: readonly ContactChannel[];
}) {
  const phones = useMemo(() => contactPhones(contact, channels), [contact, channels]);
  if (phones.length === 0) return null;

  return (
    <section aria-label="Gọi" className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Gọi</h2>
      </header>
      <ul>
        {phones.map((entry) => (
          <li key={entry.phone} className="border-b border-border px-5 py-3.5 last:border-b-0">
            <p className="text-[14.5px] text-foreground">
              <span className="tabular">{entry.phone}</span>
              <span className="ml-2 text-[12px] text-muted-foreground">{entry.label}</span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {CALL_APPS.map((app) => {
                const Icon = APP_ICONS[app.id];
                return (
                  <button
                    key={app.id}
                    type="button"
                    title={app.note}
                    aria-label={`${app.label} — ${entry.phone}`}
                    onClick={() => void handOffCall(app.id, entry.phone)}
                    className={
                      app.id === "phone"
                        ? "press inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                        : "press inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                    }
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    {app.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
