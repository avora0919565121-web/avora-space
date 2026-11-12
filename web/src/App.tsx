import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { LegacyRedirect, ShelfRedirect, SignUpRedirect } from "@/components/LegacyRedirect";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";
import { lazyRetry } from "@/lib/lazy-retry";
import { LookSync } from "@/components/LookSync";
import { KeyboardSync } from "@/components/KeyboardSync";
import { NotchSync } from "@/components/NotchSync";
import { MilestoneBurstLayer } from "@/components/MilestoneBurstLayer";
import { RequireAuth } from "@/components/RequireAuth";
import { ChatLockGate } from "@/components/chat-lock/ChatLockGate";
import { SpikeGate } from "./spikes/e2ee/SpikeGate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { HOME_ROUTE } from "@/lib/navigation";
import { ChatRealtimeProvider } from "@/lib/realtime";

const AcceptContactInvite = lazyRetry(() => import("./pages/AcceptContactInvite"));
const ArgonBench = lazyRetry(() => import("./pages/ArgonBench"));
const PublicPolicy = lazyRetry(() => import("./pages/PublicPolicy"));
const SettingsPolicy = lazyRetry(() => import("./pages/SettingsPolicy"));
const DeviceConfirm = lazyRetry(() => import("./pages/DeviceConfirm"));
import Auth from "./pages/Auth";
const ThinkHub = lazyRetry(() => import("./pages/ThinkHub"));
const ConnectByPin = lazyRetry(() => import("./pages/ConnectByPin"));
const ContactNameRepair = lazyRetry(() => import("./pages/ContactNameRepair"));
const ContactChannelReview = lazyRetry(() => import("./pages/ContactChannelReview"));
const ContactDetail = lazyRetry(() => import("./pages/ContactDetail"));
const Contacts = lazyRetry(() => import("./pages/Contacts"));
import Dashboard from "./pages/Dashboard";
const Finance = lazyRetry(() => import("./pages/Finance"));
const FinanceAccounts = lazyRetry(() => import("./pages/FinanceAccounts"));
const FinanceReports = lazyRetry(() => import("./pages/FinanceReports"));
const FinanceTransactions = lazyRetry(() => import("./pages/FinanceTransactions"));
const JoinGroup = lazyRetry(() => import("./pages/JoinGroup"));
const loadMessages = () => import("./pages/Messages");
const Messages = lazyRetry(loadMessages);

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
const BookReader = lazyRetry(() => import("./pages/BookReader"));
import NotFound from "./pages/NotFound";
const Profile = lazyRetry(() => import("./pages/Profile"));
const ProjectDetail = lazyRetry(() => import("./pages/ProjectDetail"));
const ResetPassword = lazyRetry(() => import("./pages/ResetPassword"));
const Settings = lazyRetry(() => import("./pages/Settings"));
const SettingsAssistant = lazyRetry(() => import("./pages/SettingsAssistant"));
const SettingsGuide = lazyRetry(() => import("./pages/SettingsGuide"));
const SettingsNotifications = lazyRetry(() => import("./pages/SettingsNotifications"));
const SettingsStorage = lazyRetry(() => import("./pages/SettingsStorage"));
const SettingsFeedback = lazyRetry(() => import("./pages/SettingsFeedback"));
const OpsFeatures = lazyRetry(() => import("./pages/OpsFeatures"));
const OpsHealth = lazyRetry(() => import("./pages/OpsHealth"));
const OpsReports = lazyRetry(() => import("./pages/OpsReports"));
const PublicFeedback = lazyRetry(() => import("./pages/PublicFeedback"));
const SettingsPreferences = lazyRetry(() => import("./pages/SettingsPreferences"));
const Tasks = lazyRetry(() => import("./pages/Tasks"));
const Vault = lazyRetry(() => import("./pages/Vault"));
const VaultAssets = lazyRetry(() => import("./pages/VaultAssets"));
const VaultCertificates = lazyRetry(() => import("./pages/VaultCertificates"));
const VaultDocuments = lazyRetry(() => import("./pages/VaultDocuments"));
const VaultPasswords = lazyRetry(() => import("./pages/VaultPasswords"));

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
              {/* AVORA-100 · G.3: `/dang-ky?moi=AVR-US-01` keeps its code on the way to the form. */}
              <Route path="/dang-ky" element={<SignUpRedirect />} />
              {/* Public on purpose: the recovery session is not allowed past RequireAuth yet. */}
              <Route path="/dat-lai-mat-khau" element={<ResetPassword />} />
              {/* AVORA-67: email links work without signing in; opening the page changes nothing. */}
              <Route path="/xac-nhan-thiet-bi" element={<DeviceConfirm />} />
              {/* AVORA-66: the policy is readable before signing up. */}
              <Route path="/chinh-sach" element={<PublicPolicy />} />
              {/* AVORA-100 · G.2: feedback without an account. */}
              <Route path="/gop-y" element={<PublicFeedback />} />
              {/* KT-07a: an invitation link opens without an account — read, sign up, or say "Không, cảm ơn". */}
              <Route path="/moi/:token" element={<AcceptContactInvite />} />
              <Route path="/loi-moi-lien-he/:token" element={<AcceptContactInvite />} />
              {/* AVORA-E0: hidden test page — off unless VITE_E2EE_SPIKE=1 or signed in + ?spike=e2ee; lazy chunk. */}
              <Route path="/spike/e2ee" element={<SpikeGate fallback={<NotFound />} />} />
              <Route element={<RequireAuth />}>
                <Route path="/tong-quan" element={<Dashboard />} />
                <Route path="/thu-argon" element={<ArgonBench />} />
                <Route path="/tin-nhan" element={<ChatLockGate><Messages /></ChatLockGate>} />
                <Route path="/tin-nhan/:conversationId" element={<ChatLockGate><Messages /></ChatLockGate>} />
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
                  <Route path="gop-y" element={<SettingsFeedback />} />
                </Route>

                <Route path="/quan-tri/tinh-nang" element={<OpsFeatures />} />
                <Route path="/quan-tri/suc-khoe" element={<OpsHealth />} />
                <Route path="/quan-tri/bao-cao" element={<OpsReports />} />
                <Route path="/lien-he" element={<Contacts />} />
                {/* Above the :contactId route on purpose — otherwise it reads as a contact id. */}
                <Route path="/lien-he/can-xem-lai" element={<ContactChannelReview />} />
                <Route path="/lien-he/sua-ten" element={<ContactNameRepair />} />
                <Route path="/lien-he/:contactId" element={<ContactDetail />} />

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
