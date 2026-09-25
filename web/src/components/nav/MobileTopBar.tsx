import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { StatusPill } from "@/components/StatusPill";
import { navIconFor } from "@/components/nav/nav-icons";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useLongPress } from "@/hooks/use-long-press";
import { formatUnreadBadge } from "@/lib/chat";
import { activeNavEntry, APP_MAP_UPCOMING, HOME_ROUTE, LOGO_HOLD_MS, NAV_ITEMS } from "@/lib/navigation";
import { useNavBadges } from "@/lib/use-nav-badges";
import { cn } from "@/lib/utils";

/**
 * The phone's top bar: the AVORA mark on the left, the quick-action bubble floating on the right.
 *
 * Tapping the mark goes home to Avora Space. Holding it opens the whole map of AVORA — Avora Space,
 * the five Hubs and Donation — so the shape of the app can be seen in one look.
 */
export function MobileTopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMapOpen, setIsMapOpen] = useState<boolean>(false);
  const badges = useNavBadges();
  const current = activeNavEntry(location.pathname);

  const press = useLongPress({
    onTap: () => navigate(HOME_ROUTE),
    onHold: () => setIsMapOpen(true),
    holdMs: LOGO_HOLD_MS,
    isEnabled: () => true,
  });

  return (
    <>
      <header className="paper relative z-30 shrink-0 border-b border-border pt-[env(safe-area-inset-top)] md:hidden">
        <div className="flex h-[60px] items-center pl-2 pr-16">
          <button
            type="button"
            {...press}
            aria-label="Về Avora Space. Giữ để xem toàn bộ AVORA"
            aria-haspopup="dialog"
            className="press flex h-11 select-none items-center gap-2 rounded-lg px-2 [-webkit-touch-callout:none]"
          >
            <img src="/icon.png" alt="" aria-hidden="true" width={28} height={28} draggable={false} className="h-7 w-7 rounded-md" />
            <span className="wordmark text-[16px] text-foreground">AVORA</span>
          </button>
        </div>
      </header>

      <Sheet open={isMapOpen} onOpenChange={setIsMapOpen}>
        <SheetContent side="top" className="rounded-b-[22px] border-border bg-background px-3 pb-5 pt-[calc(env(safe-area-inset-top)+18px)]">
          <SheetTitle className="px-3 text-[20px] font-semibold tracking-tight">Toàn bộ AVORA</SheetTitle>
          <SheetDescription className="px-3 text-[13px] text-muted-foreground">
            Một không gian, năm Hub — chạm để đến nơi bạn cần.
          </SheetDescription>
          <nav aria-label="Toàn bộ AVORA" className="mt-3">
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item, index) => {
                const Icon = navIconFor(item.to);
                const isActive = current?.to === item.to;
                const badge = badges[item.to];
                const isHome = item.to === HOME_ROUTE;
                return (
                  <li
                    key={item.to}
                    style={{ animationDelay: `${index * 35}ms` }}
                    className={cn("animate-rise-in", isHome && "mb-1.5 border-b border-border pb-1.5")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsMapOpen(false);
                        navigate(item.to);
                      }}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "press flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors",
                        isActive ? "bg-accent/70 text-primary" : "text-foreground hover:bg-accent/40",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          isActive ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 text-[15.5px] font-medium">{item.label}</span>
                      {badge !== undefined && badge.count > 0 ? (
                        <span
                          aria-label={badge.label}
                          className="tabular inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                        >
                          {formatUnreadBadge(badge.count)}
                        </span>
                      ) : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
              {APP_MAP_UPCOMING.map((entry) => (
                <li
                  key={entry.label}
                  aria-disabled="true"
                  className="mt-1.5 flex min-h-12 items-center gap-3 border-t border-border px-3 pt-1.5 text-muted-foreground"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[15px]">
                    ♥
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] font-medium">{entry.label}</span>
                    <span className="block text-[12px]">{entry.note}</span>
                  </span>
                  <StatusPill className="px-3 py-1 text-[10px]">Sắp ra mắt</StatusPill>
                </li>
              ))}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
