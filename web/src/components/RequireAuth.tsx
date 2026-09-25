import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/AppSidebar";
import { CalendarPeekButton } from "@/components/tasks/CalendarPeekSheet";
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
    <div className="flex min-h-screen flex-col bg-card md:h-screen md:flex-row md:overflow-hidden">
      <AppSidebar />
      <main className="flex min-h-0 flex-1 flex-col">
        {/* The calendar lives in one place on every screen: top right. A slim bar of its own
            rather than floating, so it never sits on top of a page's own buttons. */}
        <div className="flex h-12 shrink-0 items-center justify-end border-b border-border bg-card px-3 md:px-5">
          <CalendarPeekButton label="Xem lịch" className="h-9 w-9" showFullLink />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
