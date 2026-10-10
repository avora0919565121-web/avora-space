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
 * AVORA-101A · VMT 10/10 19:39 — the ONE strip of sub-sections under a tab's title line (Kết nối,
 * Nhiệm vụ, Kế hoạch, Két sắt, Cài đặt). Every tab draws it the same way and none adds its own CSS:
 *
 * - it sits flush under the title line and runs the full width of its column (no outer margin);
 * - words start 20 px in and follow each other with an even 20 px gap — never shared-out cells;
 *   when they do not fit the row scrolls sideways (labels are never shortened);
 * - 40 px tall, 13 px words (chosen: semibold, ink · others: medium, muted), a 1 px line below and a
 *   2 px underline in the person's tone exactly as wide as the chosen word, sliding 180 ms (fades
 *   with reduced motion); every item still answers a 44 px touch through a pseudo-element.
 *
 * `overflow` puts the rest behind "⋯" at the same height; `leading` / `trailing` hold fixed controls
 * (Kế hoạch's `Kệ | Bàn` and map button). Never carries a status label: status belongs in content.
 */
export function SubTabs({
  items,
  value,
  onChange,
  overflow,
  ariaLabel,
  leading,
  trailing,
}: {
  items: readonly SubTabItem[];
  value: string;
  onChange: (id: string) => void;
  overflow?: SubTabsOverflow;
  ariaLabel: string;
  /** Something fixed at the left of the strip (Kế hoạch's `Kệ | Bàn`). */
  leading?: ReactNode;
  /** Something fixed at the right of the strip (Kế hoạch's map button). */
  trailing?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const [scrolls, setScrolls] = useState<boolean>(false);
  const overflowActive = overflow?.items.find((item) => item.id === value) ?? null;

  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current.get(value);
    if (list === null) return;
    const measure = (): void => {
      setScrolls(list.scrollWidth > list.clientWidth + 1);
      const word = tab?.querySelector<HTMLElement>("[data-sub-tab-label]");
      if (tab === undefined || word === null || word === undefined) {
        setBar(null);
        return;
      }
      setBar({ left: tab.offsetLeft + word.offsetLeft, width: word.offsetWidth });
    };
    measure();
    if (tab !== undefined && list.scrollWidth > list.clientWidth + 1) {
      tab.scrollIntoView?.({ inline: "center", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, items]);

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
    <div data-sub-tabs="" className="relative flex h-10 w-full shrink-0 items-stretch border-b border-border bg-background">
      {leading !== undefined ? (
        <div data-sub-tabs-leading="" className="flex shrink-0 items-stretch pl-5">
          {leading}
        </div>
      ) : null}
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        data-h-scroll={scrolls ? "" : undefined}
        className={cn(
          "no-scrollbar relative flex min-w-0 flex-1 items-stretch gap-5 overflow-x-auto pr-5 [scroll-padding-inline:20px]",
          leading !== undefined ? "pl-4" : "pl-5",
          scrolls && "[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]",
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
                "press relative flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] transition-colors",
                "before:absolute before:-inset-x-2.5 before:-inset-y-[3px] before:content-['']",
                isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {item.icon}
              <span data-sub-tab-label="">{item.label}</span>
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
            className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-personal transition-[transform,width] duration-[180ms] ease-out motion-reduce:transition-opacity"
            style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
          />
        ) : null}
      </div>
      {overflow !== undefined && overflow.items.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={overflow.label}
            data-sub-tabs-more=""
            className={cn(
              "press relative flex min-w-11 shrink-0 items-center justify-center gap-1 pl-2 pr-4 text-[13px]",
              "before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-['']",
              overflowActive !== null ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {overflowActive !== null ? (
              <span className="relative flex items-center self-stretch">
                <span data-sub-tab-label="">{overflowActive.label}</span>
                <span aria-hidden="true" data-sub-tab-bar="" className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-personal" />
              </span>
            ) : null}
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {overflow.items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onChange(item.id)} className="min-h-11" data-sub-tabs-more-item={item.id}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {trailing !== undefined ? <div className="flex shrink-0 items-stretch pr-3">{trailing}</div> : null}
    </div>
  );
}
