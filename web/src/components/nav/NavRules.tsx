import { useState } from "react";

import { NAV_RULES } from "@/lib/nav-rules";

import { useAuth } from "@/lib/auth";


/** Cài đặt › Hướng dẫn · `Cách đi trong AVORA` — the first card. */
export function NavRulesCard() {
  return (
    <section aria-labelledby="guide-nav" data-nav-rules="" className="rounded-xl border border-border bg-card p-5">
      <h2 id="guide-nav" className="text-[17px] font-semibold tracking-tight text-foreground">Cách đi trong AVORA</h2>
      <ul className="mt-3 space-y-3">
        {NAV_RULES.map((rule) => (
          <li key={rule.title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <rule.icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-foreground">{rule.title}</span>
              <span className="block text-[13.5px] leading-snug text-muted-foreground">{rule.line}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SEEN_KEY = "avora.nav.rules-seen";

/** AVORA-94B · E2: the first visit to Avora Space — three lines and `Đã hiểu`, never again. */
export function NavRulesIntro() {
  const { user } = useAuth();
  const key = `${SEEN_KEY}:${user?.id ?? ""}`;
  const [isSeen, setIsSeen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return true;
    }
  });
  if (isSeen || user?.id === undefined) return null;
  return (
    <section aria-label="Cách đi trong AVORA" data-nav-rules-intro="" className="mt-2 rounded-[14px] border border-primary/25 bg-card p-4">
      <p className="text-[14.5px] leading-relaxed text-foreground">
        Chạm <b>‹</b> lùi một bước · Giữ <b>‹</b> về đầu tab · Giữ <b>A</b> xem toàn bộ AVORA
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            // Seen for this sitting at least.
          }
          setIsSeen(true);
        }}
        className="press mt-3 min-h-11 rounded-md bg-primary px-5 text-[14px] font-semibold text-primary-foreground"
      >
        Đã hiểu
      </button>
    </section>
  );
}
