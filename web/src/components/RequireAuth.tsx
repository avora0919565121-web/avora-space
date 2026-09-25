import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/AppSidebar";
import { QuickActionBubble } from "@/components/QuickActionBubble";
import { MobileTopBar } from "@/components/nav/MobileTopBar";
import { ToolBelt } from "@/components/nav/ToolBelt";
import { hidesToolBelt } from "@/lib/navigation";
import { useAuth } from "@/lib/auth";
import { useNewDayLanding } from "@/lib/use-new-day-landing";

/** Gate for every signed-in screen; renders the shared site navigation around the page. */
export function RequireAuth() {
  const { session, isLoading, isRecovering } = useAuth();
  const location = useLocation();
  // Before any early return, so the hook order never changes between renders.
  useNewDayLanding(session !== null && !isRecovering ? session?.user.id : undefined);

  if (isLoading) {
    return (
      <div className="paper flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang tải</span>
      </div>
    );
  }

  if (!session) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />;

  // A reset link opens a real session. Until the new password is saved it may only reach
  // the reset screen — otherwise a stale link would double as a way into the account.
  if (isRecovering) return <Navigate to="/dat-lai-mat-khau" replace />;

  return (
    // One fixed frame, like a native app: bars stay put and only the page between them scrolls.
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-card md:h-screen md:flex-row">
      <MobileTopBar />
      <AppSidebar />
      {/* min-w-0: a wide table scrolls inside its own frame instead of pushing the page wider. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      {hidesToolBelt(location.pathname) ? null : <ToolBelt />}
      {/* Floats at the top right on every screen; takes no row of its own. */}
      <QuickActionBubble />
    </div>
  );
}
