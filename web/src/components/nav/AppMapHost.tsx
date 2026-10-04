import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { StatusPill } from "@/components/StatusPill";
import { navIconFor } from "@/components/nav/nav-icons";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { formatUnreadBadge } from "@/lib/chat";
import { activeNavEntry, APP_MAP_UPCOMING, HOME_ROUTE, NAV_ITEMS } from "@/lib/navigation";
import { tabTarget } from "@/lib/tab-memory";
import { hereFrom, withReturn } from "@/lib/return-to";
import { placeLabel } from "@/lib/go-back";
import { useNavBadges } from "@/lib/use-nav-badges";
import { cn } from "@/lib/utils";
import { OPEN_APP_MAP_EVENT } from "@/components/nav/app-map-event";

/** One Toàn bộ AVORA sheet for the whole app (mounted once in the signed-in shell). */
export function AppMapHost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const badges = useNavBadges();
  const current = activeNavEntry(location.pathname);

  useEffect(() => {
    const open = (): void => setIsOpen(true);
    window.addEventListener(OPEN_APP_MAP_EVENT, open);
    return () => window.removeEventListener(OPEN_APP_MAP_EVENT, open);
  }, []);

  return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
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
                      setIsOpen(false);
                      // Luật 3 → 4: a tab chosen here lands where that tab was left (push, so `‹` comes back).
                      // N.9: the tab carries where you were (`tu`), so its `‹` comes back here.
                      const target = item.to === HOME_ROUTE ? HOME_ROUTE : tabTarget(item.to, location.pathname, user?.id).path;
                      navigate(current?.to === item.to ? target : withReturn(target, hereFrom(location, placeLabel(location.pathname))));
                    }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "press flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors",
                      isActive ? "bg-personal-soft text-personal-soft-foreground" : "text-foreground hover:bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        isActive ? "bg-personal text-personal-foreground" : "bg-card text-foreground",
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
                <StatusPill className="px-3 py-1 text-[10px]">Sắp có</StatusPill>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
