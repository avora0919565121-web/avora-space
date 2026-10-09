import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { LegacyRedirect, ShelfRedirect } from "@/components/LegacyRedirect";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";
import { LookSync } from "@/components/LookSync";
import { KeyboardSync } from "@/components/KeyboardSync";
import { NotchSync } from "@/components/NotchSync";
import { MilestoneBurstLayer } from "@/components/MilestoneBurstLayer";
import { RequireAuth } from "@/components/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { HOME_ROUTE } from "@/lib/navigation";
import { ChatRealtimeProvider } from "@/lib/realtime";

const AcceptContactInvite = lazy(() => import("./pages/AcceptContactInvite"));
const ArgonBench = lazy(() => import("./pages/ArgonBench"));
const PublicPolicy = lazy(() => import("./pages/PublicPolicy"));
const SettingsPolicy = lazy(() => import("./pages/SettingsPolicy"));
const DeviceConfirm = lazy(() => import("./pages/DeviceConfirm"));
import Auth from "./pages/Auth";
const ThinkHub = lazy(() => import("./pages/ThinkHub"));
const ConnectByPin = lazy(() => import("./pages/ConnectByPin"));
const ContactNameRepair = lazy(() => import("./pages/ContactNameRepair"));
const ContactChannelReview = lazy(() => import("./pages/ContactChannelReview"));
const ContactDetail = lazy(() => import("./pages/ContactDetail"));
const Contacts = lazy(() => import("./pages/Contacts"));
import Dashboard from "./pages/Dashboard";
const Finance = lazy(() => import("./pages/Finance"));
const FinanceAccounts = lazy(() => import("./pages/FinanceAccounts"));
const FinanceReports = lazy(() => import("./pages/FinanceReports"));
const FinanceTransactions = lazy(() => import("./pages/FinanceTransactions"));
const JoinGroup = lazy(() => import("./pages/JoinGroup"));
const loadMessages = () => import("./pages/Messages");
const Messages = lazy(loadMessages);

/**
 * K3 · 1: Kết nối + the chat thread are one bundle, fetched as soon as the first screen is up
 * and the device is idle — so opening Kết nối (or a conversation from a notification) is instant.
 */
if (typeof window !== "undefined") {
  const warm = (): void => void loadMessages().catch(() => undefined);
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle !== undefined) idle(warm, { timeout: 3000 });
  else window.setTimeout(warm, 1500);
}
const BookReader = lazy(() => import("./pages/BookReader"));
import NotFound from "./pages/NotFound";
const Profile = lazy(() => import("./pages/Profile"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Settings = lazy(() => import("./pages/Settings"));
const SettingsAssistant = lazy(() => import("./pages/SettingsAssistant"));
const SettingsGuide = lazy(() => import("./pages/SettingsGuide"));
const SettingsNotifications = lazy(() => import("./pages/SettingsNotifications"));
const SettingsStorage = lazy(() => import("./pages/SettingsStorage"));
const SettingsPreferences = lazy(() => import("./pages/SettingsPreferences"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Vault = lazy(() => import("./pages/Vault"));
const VaultAssets = lazy(() => import("./pages/VaultAssets"));
const VaultCertificates = lazy(() => import("./pages/VaultCertificates"));
const VaultDocuments = lazy(() => import("./pages/VaultDocuments"));
const VaultPasswords = lazy(() => import("./pages/VaultPasswords"));

// K3 · N8: lists stay fresh for 30 s and heavy reads do not refetch on every tab focus.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

/**
 * K3 · 1: the first bundle is the app frame + Avora Space + Kết nối (eager above). Every other tab
 * loads when opened; the chat thread is part of Kết nối. While a tab's code arrives, the same calm
 * loader as everywhere (never a blank screen, never a spinner forever).
 */
function RouteLoading() {
  return (
    <div className="paper flex min-h-[100dvh] flex-col">
      <LoadingOrRetry />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ChatRealtimeProvider>
        <TooltipProvider>
          <Toaster />
          <MilestoneBurstLayer />
          <LookSync />
          <KeyboardSync />
          <NotchSync />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to={HOME_ROUTE} replace />} />
              <Route path="/dang-nhap" element={<Auth />} />
              <Route path="/dang-ky" element={<Navigate to="/dang-nhap?mode=dang-ky" replace />} />
              {/* Public on purpose: the recovery session is not allowed past RequireAuth yet. */}
              <Route path="/dat-lai-mat-khau" element={<ResetPassword />} />
              {/* AVORA-67: email links work without signing in; opening the page changes nothing. */}
              <Route path="/xac-nhan-thiet-bi" element={<DeviceConfirm />} />
              {/* AVORA-66: the policy is readable before signing up. */}
              <Route path="/chinh-sach" element={<PublicPolicy />} />
              <Route element={<RequireAuth />}>
                <Route path="/tong-quan" element={<Dashboard />} />
                <Route path="/thu-argon" element={<ArgonBench />} />
                <Route path="/tin-nhan" element={<Messages />} />
                <Route path="/tin-nhan/:conversationId" element={<Messages />} />
                <Route path="/loi-moi/:token" element={<JoinGroup />} />
                <Route path="/ket-noi/:pin" element={<ConnectByPin />} />
                <Route path="/nhiem-vu" element={<Tasks />} />
                <Route path="/du-an/:projectId" element={<ProjectDetail />} />
                <Route path="/ke-hoach" element={<ThinkHub />} />
                {/* AVORA-77 · C: one screen — Kệ sách is kệ 04 of Kế hoạch; the old address still opens it. */}
                <Route path="/ke-hoach/ke-sach" element={<ShelfRedirect />} />
                <Route path="/ke-hoach/ke-sach/doc/:recordId" element={<BookReader />} />

                <Route path="/ket-sat" element={<Vault />}>
                  <Route index element={<Finance />} />
                  <Route path="giao-dich" element={<FinanceTransactions />} />
                  <Route path="tai-khoan" element={<FinanceAccounts />} />
                  <Route path="bao-cao" element={<FinanceReports />} />
                  <Route path="mat-khau" element={<VaultPasswords />} />
                  <Route path="chung-chi" element={<VaultCertificates />} />
                  <Route path="tai-lieu" element={<VaultDocuments />} />
                  <Route path="tai-san" element={<VaultAssets />} />
                </Route>

                <Route path="/cai-dat" element={<Settings />}>
                  <Route index element={<Profile />} />
                  <Route path="chinh-sach" element={<SettingsPolicy />} />
                  <Route path="thiet-lap" element={<SettingsPreferences />} />
                  <Route path="thong-bao" element={<SettingsNotifications />} />
                  <Route path="dung-luong" element={<SettingsStorage />} />
                  <Route path="avora-ai" element={<SettingsAssistant />} />
                  <Route path="huong-dan" element={<SettingsGuide />} />
                </Route>

                <Route path="/lien-he" element={<Contacts />} />
                {/* Above the :contactId route on purpose — otherwise it reads as a contact id. */}
                <Route path="/lien-he/can-xem-lai" element={<ContactChannelReview />} />
                <Route path="/lien-he/sua-ten" element={<ContactNameRepair />} />
                <Route path="/lien-he/:contactId" element={<ContactDetail />} />
                {/* Signed-in on purpose: accepting links two accounts, so there must be a second one. */}
                <Route path="/loi-moi-lien-he/:token" element={<AcceptContactInvite />} />

                {/* Routes that were published under their old names keep working. */}
                <Route path="/tai-chinh" element={<LegacyRedirect />} />
                <Route path="/tai-chinh/giao-dich" element={<LegacyRedirect />} />
                <Route path="/tai-chinh/tai-khoan" element={<LegacyRedirect />} />
                <Route path="/tai-chinh/bao-cao" element={<LegacyRedirect />} />
                <Route path="/ho-so" element={<LegacyRedirect />} />
                <Route path="/business-hub" element={<LegacyRedirect />} />
              </Route>
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </ChatRealtimeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
