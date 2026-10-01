import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/AppSidebar";
import { GuestMachineBanner } from "@/components/GuestMachineBanner";
import { PinGate, PinReminderBanner } from "@/components/PinGate";
import { QuickActionBubble } from "@/components/QuickActionBubble";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { InAppAlerts } from "@/components/InAppAlerts";
import { ConfirmHost } from "@/components/ConfirmHost";
import { PersonCardHost } from "@/components/PersonCard";
import { FocusHost } from "@/components/chat/FocusHost";
import { RecordingBar } from "@/components/RecordingBar";
import { AvoraSearchHost } from "@/components/search/AvoraSearch";
import { PushOfferCard } from "@/components/PushOfferCard";
import { PushClickBridge } from "@/components/PushClickBridge";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { LandscapeRail } from "@/components/nav/LandscapeRail";
import { hidesToolBelt } from "@/lib/navigation";
import { useAuth } from "@/lib/auth";
import { useNewDayLanding } from "@/lib/use-new-day-landing";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import { useTrackHistory } from "@/lib/nav-history";

/** Gate for every signed-in screen; renders the shared site navigation around the page. */
export function RequireAuth() {
  const { session, isLoading, isRecovering } = useAuth();
  const location = useLocation();
  // Before any early return, so the hook order never changes between renders.
  useNewDayLanding(session !== null && !isRecovering ? session?.user.id : undefined);
  useTrackHistory();

  if (isLoading) {
    return (
      <div className="paper flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang tải</span>
      </div>
    );
  }

  const inThread = hidesToolBelt(location.pathname);
  if (!session) return <Navigate to="/dang-nhap" replace state={{ from: `${location.pathname}${location.search}` }} />;

  // A reset link opens a real session. Until the new password is saved it may only reach
  // the reset screen — otherwise a stale link would double as a way into the account.
  if (isRecovering) return <Navigate to="/dat-lai-mat-khau" replace />;

  return (
    // AVORA 33: the PIN blocks only after its 30-day window; until then a quiet banner reminds.
    <PinGate>
    {/* AVORA-51: the Két sắt lock is known to every screen (badge, quick transaction), not only Két sắt. */}
    <VaultLockProvider>
    {/* One fixed frame, like a native app: bars stay put and only the page between them scrolls. */}
    {/* AVORA-59 · E: iOS slides the keyboard over a full-height layout; the frame stops above it. */}
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-card pb-[var(--keyboard-inset,0px)] md:flex-row short:flex-row">
      {/* AVORA-49 · 2.1a: inside a thread on a phone the thread's own header (with ‹) is the top bar. */}
      {inThread ? <div className="hidden md:contents"><MobileTopBar /></div> : <MobileTopBar />}
      <AppSidebar />
      {/* AVORA-57 · I: a phone on its side gets a narrow icon strip instead of the full column. */}
      <LandscapeRail />
      {/* min-w-0: a wide table scrolls inside its own frame instead of pushing the page wider. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col short:pr-[var(--inset-r)]">
        {/* AVORA-54 · A: on a borrowed machine the reminder rides on top until closed. */}
        <GuestMachineBanner />
        <RecordingBar />
        <PinReminderBanner />
        {/* A fault in one screen stays in that screen; bars and bubble live outside (A6). */}
        <RouteErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </main>
      {inThread ? null : <ToolBelt />}
      {/* Floats at the top right on every screen; takes no row of its own. A phone's thread header
          needs that corner for 🔍 and ⋯, so there it steps aside (AVORA-49 · 2.6). */}
      {inThread ? <div className="hidden md:contents"><QuickActionBubble /></div> : <QuickActionBubble />}
      <InAppAlerts />
      <AvoraSearchHost />
      <PushOfferCard />
      <PushClickBridge />
      <ConfirmHost />
      <PersonCardHost />
      <FocusHost />
    </div>
    </VaultLockProvider>
    </PinGate>
  );
}
