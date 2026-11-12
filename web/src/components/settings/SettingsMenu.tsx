import {
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  MessageSquareHeart,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { activeSectionTab, SETTINGS_ROUTE, type NavEntry } from "@/lib/navigation";
import { PROFILE_ROUTE, settingsGroups } from "@/lib/settings-groups";
import { carryReturn } from "@/lib/return-to";
import { TYPE } from "@/lib/type-scale";
import { cn } from "@/lib/utils";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  "/cai-dat": UserRound,
  "/cai-dat/thiet-lap": SlidersHorizontal,
  "/cai-dat/thong-bao": Bell,
  "/cai-dat/dung-luong": HardDrive,
  "/cai-dat/avora-ai": Sparkles,
  "/cai-dat/huong-dan": BookOpen,
  "/cai-dat/gop-y": MessageSquareHeart,
  "/cai-dat/chinh-sach": ScrollText,
};

/**
 * The grouped list. On a computer it is the left column, the open row marked; on a phone it is the
 * whole `/cai-dat` page, and each row opens its page (with `‹ Cài đặt` to come back).
 */
export function SettingsMenu({ tabs, variant }: { tabs: readonly NavEntry[]; variant: "side" | "page" }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const current = variant === "side" ? activeSectionTab(location.pathname, tabs) : null;
  const query = carryReturn(searchParams, new URLSearchParams()).toString();
  const href = (to: string): string => {
    const path = variant === "page" && to === SETTINGS_ROUTE ? PROFILE_ROUTE : to;
    return query === "" ? path : `${path}?${query}`;
  };

  return (
    <nav aria-label="Mục Cài đặt" data-settings-menu={variant} className={cn("flex flex-col gap-5", variant === "page" && "px-4 pb-8 pt-3")}>
      {settingsGroups(tabs).map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h2 className={cn(TYPE.groupLabel, "mb-1.5 px-3")}>{group.title}</h2>
          <ul className="overflow-hidden rounded-card border border-border bg-card">
            {group.items.map((tab, index) => {
              const Icon = ICONS[tab.to] ?? ChevronRight;
              const isActive = current === tab.to;
              return (
                <li key={tab.to} className={cn(index > 0 && "border-t border-border")}>
                  <Link
                    to={href(tab.to)}
                    aria-current={isActive ? "page" : undefined}
                    data-settings-row={tab.to}
                    className={cn(
                      "press flex min-h-12 items-center gap-3 px-3 py-2.5 text-[15px] text-foreground transition-colors",
                      isActive ? "bg-personal-soft font-semibold text-personal-soft-foreground" : "hover:bg-accent/40",
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/80">
                      <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** On a phone, every page under Cài đặt starts with the way back to the list. */
export function BackToSettings() {
  const [searchParams] = useSearchParams();
  const query = carryReturn(searchParams, new URLSearchParams()).toString();
  return (
    <div className="px-4 pt-1 md:hidden short:hidden">
      <Link
        to={query === "" ? SETTINGS_ROUTE : `${SETTINGS_ROUTE}?${query}`}
        data-settings-back=""
        className="press inline-flex min-h-11 items-center gap-0.5 rounded-md text-[15px] font-medium text-primary"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        Cài đặt
      </Link>
    </div>
  );
}
