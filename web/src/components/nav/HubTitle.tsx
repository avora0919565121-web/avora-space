import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The large title at the top of a Hub, held in place while the page scrolls beneath it.
 *
 * It sits outside the scrolling area rather than floating over it, so it never covers content
 * and costs one line of height, not a whole header block. `className` sets the inner width and
 * padding so the title lines up with the page's own column.
 */
export function HubTitle({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className="relative z-10 shrink-0 border-b border-border/70 bg-background/92 backdrop-blur-sm">
      <div
        className={cn(
          "mx-auto flex w-full items-end justify-between gap-3 px-4 pb-3 pt-4 sm:px-6 md:px-10 md:pr-[4.5rem] md:pt-6",
          className,
        )}
      >
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[30px]">
            {title}
          </h1>
          {subtitle !== undefined ? (
            <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action !== undefined ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
