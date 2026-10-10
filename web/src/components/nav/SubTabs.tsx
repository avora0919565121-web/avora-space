import { MoreHorizontal } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SubTabItem = {
  id: string;
  label: string;
  /** A quiet count beside the label (11 px, muted) — how many things are here. */
  count?: number;
  /** A badge (unread): the one place Avora orange may appear on a strip. */
  badge?: number;
  icon?: ReactNode;
};

export type SubTabsOverflow = { label: string; items: readonly SubTabItem[] };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * AVORA-101A — the ONE strip of sub-sections under a tab's top row (Kết nối, Nhiệm vụ, Kế hoạch,
 * Két sắt, Cài đặt). 40 px tall (each tab still answers a 44 px touch through a pseudo-element),
 * 13 px words, paper background, a 1 px line below and a 2 px underline in the person's tone that
 * slides to the chosen item (180 ms; fades instead with reduced motion). ≤ 4 items share the width;
 * more scroll sideways with soft edges and the chosen one is brought to the middle. `overflow`
 * puts the rest behind "⋯" at the same height. Never carries a status label: status belongs in content.
 */
export function SubTabs({
  items,
  value,
  onChange,
  overflow,
  ariaLabel,
  className,
  leading,
  trailing,
}: {
  items: readonly SubTabItem[];
  value: string;
  onChange: (id: string) => void;
  overflow?: SubTabsOverflow;
  ariaLabel: string;
  className?: string;
  /** Something fixed at the left of the strip (Kế hoạch's `Kệ | Bàn`). */
  leading?: ReactNode;
  /** Something fixed at the right of the strip (Kế hoạch's map button). */
  trailing?: ReactNode;
}) {
  const scrolls = items.length > 4;
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const overflowActive = overflow?.items.find((item) => item.id === value) ?? null;

  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current.get(value);
    if (list === null || tab === undefined) {
      setBar(null);
      return;
    }
    const measure = (): void => setBar({ left: tab.offsetLeft + 8, width: Math.max(0, tab.offsetWidth - 16) });
    measure();
    if (scrolls) tab.scrollIntoView?.({ inline: "center", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, scrolls, items]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const index = items.findIndex((item) => item.id === value);
      const next = items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
      if (next === undefined) return;
      event.preventDefault();
      onChange(next.id);
      tabRefs.current.get(next.id)?.focus();
    },
    [items, value, onChange],
  );

  return (
    <div data-sub-tabs="" className={cn("relative flex h-10 shrink-0 items-stretch border-b border-border bg-background", className)}>
      {leading}
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        data-h-scroll={scrolls ? "" : undefined}
        className={cn(
          "relative flex min-w-0 flex-1 items-stretch",
          scrolls &&
            "no-scrollbar overflow-x-auto [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-16px),transparent)] [scroll-padding-inline:12px]",
        )}
      >
        {items.map((item) => {
          const isActive = item.id === value;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node === null) tabRefs.current.delete(item.id);
                else tabRefs.current.set(item.id, node);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              data-sub-tab={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                "press relative flex items-center justify-center gap-1 whitespace-nowrap px-2 text-[13px] transition-colors",
                "before:absolute before:inset-x-0 before:-inset-y-[2px] before:content-['']",
                scrolls ? "shrink-0" : "min-w-0 flex-1",
                isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {item.count !== undefined && item.count > 0 ? (
                <span className="tabular text-[11px] font-normal text-muted-foreground">{item.count}</span>
              ) : null}
              {item.badge !== undefined && item.badge > 0 ? (
                <span
                  aria-label={`${item.badge} chưa đọc`}
                  className="tabular min-w-[18px] rounded-full bg-primary px-1.5 py-px text-center text-[10.5px] font-semibold leading-[15px] text-primary-foreground"
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
        {bar !== null ? (
          <span
            aria-hidden="true"
            data-sub-tab-bar=""
            className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] rounded-full bg-personal transition-[transform,width] duration-[180ms] ease-out motion-reduce:transition-opacity"
            style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
          />
        ) : null}
      </div>
      {overflow !== undefined && overflow.items.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={overflow.label}
            className={cn(
              "press relative flex min-w-11 shrink-0 items-center justify-center gap-1 px-2 text-[13px]",
              "before:absolute before:inset-x-0 before:-inset-y-[2px] before:content-['']",
              overflowActive !== null ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {overflowActive !== null ? <span>{overflowActive.label}</span> : null}
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            {overflowActive !== null ? <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-personal" /> : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {overflow.items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onChange(item.id)} className="min-h-11">
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {trailing}
    </div>
  );
}
