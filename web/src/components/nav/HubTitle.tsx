import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { MOBILE_TOP_ACTIONS_ID } from "@/components/nav/top-actions-slot";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** A phone held upright: the single top row carries the tab name and its buttons (ADR-053). */
const PHONE_UPRIGHT = "(max-width: 767px) and (min-height: 501px)";

/** On an upright phone: portals its children into the top row (left of the bubble). Elsewhere: renders in place. */
export function MobileTopActions({ children }: { children: ReactNode }) {
  const isPhone = useMediaQuery(PHONE_UPRIGHT);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(isPhone ? document.getElementById(MOBILE_TOP_ACTIONS_ID) : null);
  }, [isPhone]);
  if (isPhone && slot !== null) return createPortal(<div className="flex items-center gap-1" data-hub-actions="">{children}</div>, slot);
  return <>{children}</>;
}

/**
 * The large title at the top of a Hub, held in place while the page scrolls beneath it.
 *
 * AVORA-89 · 1.1: on an upright phone there is no second title row — the tab name already sits
 * in the top bar, and this hands its buttons to that bar (left of the bubble).
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
  const isPhone = useMediaQuery(PHONE_UPRIGHT);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(isPhone ? document.getElementById(MOBILE_TOP_ACTIONS_ID) : null);
  }, [isPhone]);

  if (isPhone && slot !== null) return action !== undefined ? createPortal(<div className="flex items-center gap-1.5" data-hub-actions="">{action}</div>, slot) : null;

  return (
    <header className="relative z-10 shrink-0 border-b border-border/70 bg-background/92 backdrop-blur-sm">
      <div
        className={cn(
          "mx-auto flex w-full items-end justify-between gap-3 pb-3 pl-tab pr-4 pt-4 md:pr-[4.5rem] md:pt-6 short:mx-0 short:max-w-none short:pb-1.5 short:pt-2 short:pr-[4.25rem]",
          className,
        )}
      >
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[30px] short:text-[24px]">
            {title}
          </h1>
          {subtitle !== undefined ? (
            <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground short:hidden">{subtitle}</p>
          ) : null}
        </div>
        {action !== undefined ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
