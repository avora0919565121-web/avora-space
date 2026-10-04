import { ChevronLeft, Hand, Home, LayoutGrid, X } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/lib/auth";

/** AVORA-94B · mục 0 (ADR-062): the five rules, said once, the same words everywhere. */
export const NAV_RULES: readonly { icon: typeof ChevronLeft; title: string; line: string }[] = [
  { icon: ChevronLeft, title: "Muốn lùi: ‹", line: "‹ ở góc trên bên trái lùi một bước. Nút lùi của máy và vuốt từ mép trái cũng vậy." },
  { icon: Home, title: "Về nhà: chạm A", line: "Chạm logo A về Avora Space. Chạm lần nữa: quay lại đúng chỗ vừa rời." },
  { icon: Hand, title: "Lạc: giữ góc trái trên", line: "Giữ logo A hoặc giữ ‹ để mở Toàn bộ AVORA — ở mọi màn." },
  { icon: LayoutGrid, title: "Đổi khu: thanh dưới", line: "Chạm một tab về chỗ đang dở. Chạm lại tab đang đứng về đầu tab." },
  { icon: X, title: "Đóng: ✕ hoặc lùi", line: "Tấm, lớp phủ, ảnh phóng to đóng trước, màn bên dưới giữ nguyên." },
];

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
        <b>‹</b> lùi một bước · Chạm <b>A</b> về nhà · Giữ góc trái trên khi lạc
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
