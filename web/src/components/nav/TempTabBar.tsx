import { useEffect, useState } from "react";

import { navIconFor } from "@/components/nav/nav-icons";
import { useTabPress } from "@/components/nav/use-tab-press";
import { TOOL_BELT_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * AVORA-93 · 4.2 (ADR-061) — the five tabs slid up over a full-screen place (the reader, a focused
 * Bảng). Kế hoạch only hides the bar (you are already in it); another tab goes there, and Kế hoạch's
 * tab memory keeps the book page / board / open Hạng mục for the way back.
 */
export function TempTabBar({ onHide }: { onHide: () => void }) {
  const pressTab = useTabPress();
  return (
    <nav aria-label="Các tab" data-reader-tabs="" className="fixed inset-x-0 bottom-0 z-[45] border-t border-border bg-card/97 pb-[max(env(safe-area-inset-bottom),8px)] shadow-[0_-6px_20px_rgba(0,0,0,0.12)] animate-in slide-in-from-bottom-4 fade-in-0 duration-200">
      <ul className="grid grid-cols-5">
        {TOOL_BELT_ITEMS.map((item) => {
          const Icon = navIconFor(item.to);
          const isHere = item.to === "/ke-hoach";
          return (
            <li key={item.to}>
              <a
                href={item.to}
                onClick={(event) => {
                  if (isHere) {
                    event.preventDefault();
                    onHide();
                    return;
                  }
                  pressTab(event, item.to);
                }}
                aria-current={isHere ? "page" : undefined}
                className={cn("press flex h-[52px] flex-col items-center justify-center gap-1 text-[10.5px]", isHere ? "font-semibold text-personal" : "font-medium text-muted-foreground")}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={isHere ? 2 : 1.6} aria-hidden="true" />
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A 28px strip at the bottom of a focused Bảng: tap or swipe up → the tabs for 5 s. */
export function BottomTabStrip() {
  const [isShown, setIsShown] = useState<boolean>(false);
  const [startY, setStartY] = useState<number | null>(null);
  useEffect(() => {
    if (!isShown) return;
    const timer = window.setTimeout(() => setIsShown(false), 5000);
    return () => window.clearTimeout(timer);
  }, [isShown]);
  return (
    <>
      <button
        type="button"
        aria-label="Hiện các tab"
        data-bottom-tab-strip=""
        onClick={() => setIsShown(true)}
        onTouchStart={(event) => setStartY(event.touches[0]?.clientY ?? null)}
        onTouchEnd={(event) => {
          if (startY !== null && startY - (event.changedTouches[0]?.clientY ?? startY) > 12) setIsShown(true);
          setStartY(null);
        }}
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(28px+env(safe-area-inset-bottom))] items-start justify-center bg-gradient-to-t from-background to-background/60 pt-2.5 md:hidden short:hidden"
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-muted-foreground/35" />
      </button>
      {isShown ? <TempTabBar onHide={() => setIsShown(false)} /> : null}
    </>
  );
}
