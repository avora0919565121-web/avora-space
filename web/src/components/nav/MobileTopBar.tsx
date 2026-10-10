import { ChevronLeft } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";

import { openAppMap } from "@/components/nav/app-map-event";
import { BackButton } from "@/components/nav/BackButton";
import { useBackPress } from "@/hooks/use-back-press";
import { readReturn } from "@/lib/return-to";
import { useLogoTap } from "@/components/nav/use-logo-tap";
import { useLongPress } from "@/hooks/use-long-press";
import { activeNavEntry, HOME_ROUTE, LOGO_HOLD_MS } from "@/lib/navigation";
import { MOBILE_TOP_ACTIONS_ID } from "@/components/nav/top-actions-slot";
import { useFocusHeaderValue } from "@/lib/focus-header";

/**
 * The phone's top bar: the AVORA mark on the left, the quick-action bubble floating on the right.
 *
 * AVORA-94B (ADR-062): tapping the mark goes home to Avora Space; tapped again there it returns to
 * the place just left (luật 2). Holding it opens Toàn bộ AVORA (luật 4). A held `‹` goes to the top of
 * its tab instead (AVORA-100 · C), where this mark is back.
 */
export function MobileTopBar() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hasReturn = readReturn(searchParams) !== null;
  const current = activeNavEntry(location.pathname);
  const isHome = location.pathname === HOME_ROUTE;
  // AVORA-89 · 2.3: a focused screen owns the row — `‹ · name`, no logo (ADR-053: ‹ and A never side by side).
  const focus = useFocusHeaderValue();

  const press = useLongPress({
    onTap: () => logoTap(),
    onHold: openAppMap,
    holdMs: LOGO_HOLD_MS,
    isEnabled: () => true,
  });
  const logoTap = useLogoTap();
  // AVORA-100 · C: the focused screen's `‹` steps back on tap, goes to the top of Kế hoạch on hold.
  const focusPress = useBackPress(focus?.onBack ?? (() => undefined));

  return (
    <>
      <header className="paper relative z-30 shrink-0 border-b border-border pt-[env(safe-area-inset-top)] md:hidden short:hidden">
        {/* VMT 10/10 21:11: the logo's edge (button px-2 = 8 px) sits on the shared tab inset, like the strip's first word. */}
        <div className="flex h-[52px] items-center gap-1 pl-[calc(var(--tab-inset)-8px)] pr-[60px]" data-mobile-top-row="">
          {focus !== null ? (
            <>
              <button type="button" {...focusPress} aria-label="Quay lại. Giữ để về đầu Kế hoạch" data-focus-back="" data-back="" className="press no-callout -ml-1 flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full text-foreground [touch-action:manipulation]">
                <ChevronLeft className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1" data-focus-title="">
                <p className="truncate text-[16px] font-semibold leading-tight text-foreground">{focus.title}</p>
                {focus.subtitle !== null ? <p className="truncate text-[12px] leading-tight text-muted-foreground">{focus.subtitle}</p> : null}
              </div>
            </>
          ) : (
          <>
          {/* AVORA-94B: opened from elsewhere (`tu`) → `‹ {nơi trước}` takes the logo's place (never side by side). */}
          {hasReturn ? <BackButton showLabel className="-ml-1" /> : (
          <button
            type="button"
            {...press}
            aria-label={
              isHome ? "Quay lại chỗ vừa rời. Giữ để xem toàn bộ AVORA" : "Về Avora Space. Giữ để xem toàn bộ AVORA"
            }
            aria-haspopup="dialog"
            data-logo=""
            className="press no-callout flex h-11 select-none items-center gap-2 rounded-lg px-2 [-webkit-touch-callout:none] [touch-action:manipulation]"
          >
            <img src="/icon.png" alt="" aria-hidden="true" width={30} height={30} draggable={false} className="pointer-events-none h-[30px] w-[30px] select-none rounded-md" />
            {/* AVORA-89 · 1.1 (ADR-053): the wordmark only on Avora Space; a tab shows its own name. */}
            {isHome || current === null ? <span className="wordmark text-[16px] text-foreground">AVORA</span> : null}
          </button>
          )}
          {!isHome && current !== null ? (
            <h1 className="min-w-0 flex-1 truncate pl-1 text-[22px] font-semibold tracking-tight text-foreground" data-top-title="">
              {current.label}
            </h1>
          ) : (
            <span className="flex-1" />
          )}
          </>
          )}
          {/* The tab's own buttons (🔍 · +) sit here, just left of the bubble. */}
          <div id={MOBILE_TOP_ACTIONS_ID} className="flex shrink-0 items-center gap-1.5" />
        </div>
      </header>

    </>
  );
}
