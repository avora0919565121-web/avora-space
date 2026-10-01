import { ArrowUpRight, BookOpen, Briefcase, LayoutGrid, ListTodo, MessageSquareText, Settings, Vault, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { GUIDE_CARDS } from "@/lib/guide-content";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  space: LayoutGrid,
  connect: MessageSquareText,
  tasks: ListTodo,
  plan: Briefcase,
  vault: Vault,
  settings: Settings,
};

/** Cài đặt › Hướng dẫn (AVORA-57 · A): one card per area, words from `lib/guide-content.ts`. */
const SettingsGuide = () => (
  <div className="paper min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-2xl animate-rise-in space-y-4 px-6 py-12 md:px-10">
      <header className="mb-2 flex items-center gap-2.5">
        <BookOpen className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
        <p className="text-[14px] leading-6 text-muted-foreground">Mỗi khu vài dòng, chỉ những gì đang dùng được.</p>
      </header>
      {GUIDE_CARDS.map((card) => {
        const Icon = ICONS[card.id] ?? BookOpen;
        return (
          <section key={card.id} aria-labelledby={`guide-${card.id}`} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <h2 id={`guide-${card.id}`} className="min-w-0 flex-1 text-[17px] font-semibold tracking-tight text-foreground">
                {card.title}
              </h2>
              <Link
                to={card.to}
                aria-label={`Mở ${card.title}`}
                className="icon-btn h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </div>
            <ul className="mt-3 space-y-2 pl-1">
              {card.lines.map((line) => (
                <li key={line} className="flex gap-2.5 text-[14.5px] leading-6 text-foreground/90">
                  <span aria-hidden="true" className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  </div>
);

export default SettingsGuide;
