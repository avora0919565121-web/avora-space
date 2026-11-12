import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The nearest ancestor that scrolls vertically (the room's own scroller), or null for the page. */
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current !== null && current !== document.body) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * KT-06 · C/E (CEO 12/11 23:29): a room's inner navigation never scrolls away. The bar sticks to the top of
 * the room's scroller on a solid background; once it is stuck it gets a hairline + soft shadow, and its
 * render function is told so (to fold the head into one line). The navigation stays where it is in the
 * reading order — nothing is duplicated for screen readers.
 */
export function StickyBar({
  children,
  className,
  name,
}: {
  children: (stuck: boolean) => ReactNode;
  className?: string;
  /** `data-sticky-bar` value, for tests and for the audit script. */
  name: string;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState<boolean>(false);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + 1), {
      root: scrollParentOf(node),
      threshold: 0,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <div
        data-sticky-bar={name}
        data-stuck={stuck ? "true" : "false"}
        className={cn(
          "sticky top-0 z-20 -mt-px bg-background transition-shadow",
          stuck && "shadow-[0_1px_0_hsl(var(--border)),0_8px_14px_-12px_hsl(30_20%_20%/0.35)]",
          className,
        )}
      >
        {children(stuck)}
      </div>
    </>
  );
}
