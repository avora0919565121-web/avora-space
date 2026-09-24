import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { LegacyRedirect } from "@/components/LegacyRedirect";
import { MilestoneBurstLayer } from "@/components/MilestoneBurstLayer";
import { RequireAuth } from "@/components/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { HOME_ROUTE } from "@/lib/navigation";
import { ChatRealtimeProvider } from "@/lib/realtime";

import AcceptContactInvite from "./pages/AcceptContactInvite";
import Auth from "./pages/Auth";
import ThinkHub from "./pages/ThinkHub";
import ContactChannelReview from "./pages/ContactChannelReview";
import ContactDetail from "./pages/ContactDetail";
import Contacts from "./pages/Contacts";
import Dashboard from "./pages/Dashboard";
import Finance from "./pages/Finance";
import FinanceAccounts from "./pages/FinanceAccounts";
import FinanceReports from "./pages/FinanceReports";
import FinanceTransactions from "./pages/FinanceTransactions";
import JoinGroup from "./pages/JoinGroup";
import Messages from "./pages/Messages";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import ProjectDetail from "./pages/ProjectDetail";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import SettingsAssistant from "./pages/SettingsAssistant";
import SettingsNotifications from "./pages/SettingsNotifications";
import SettingsPreferences from "./pages/SettingsPreferences";
import Tasks from "./pages/Tasks";
import Vault from "./pages/Vault";
import VaultPasswords from "./pages/VaultPasswords";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ChatRealtimeProvider>
        <TooltipProvider>
          <Toaster />
          <MilestoneBurstLayer />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/" element={<Navigate to={HOME_ROUTE} replace />} />
              <Route path="/dang-nhap" element={<Auth />} />
              <Route path="/dang-ky" element={<Navigate to="/dang-nhap?mode=dang-ky" replace />} />
              {/* Public on purpose: the recovery session is not allowed past RequireAuth yet. */}
              <Route path="/dat-lai-mat-khau" element={<ResetPassword />} />
              <Route element={<RequireAuth />}>
                <Route path="/tong-quan" element={<Dashboard />} />
                <Route path="/tin-nhan" element={<Messages />} />
                <Route path="/tin-nhan/:conversationId" element={<Messages />} />
                <Route path="/loi-moi/:token" element={<JoinGroup />} />
                <Route path="/nhiem-vu" element={<Tasks />} />
                <Route path="/du-an/:projectId" element={<ProjectDetail />} />
                <Route path="/ke-hoach" element={<ThinkHub />} />

                <Route path="/ket-sat" element={<Vault />}>
                  <Route index element={<Finance />} />
                  <Route path="giao-dich" element={<FinanceTransactions />} />
                  <Route path="tai-khoan" element={<FinanceAccounts />} />
                  <Route path="bao-cao" element={<FinanceReports />} />
                  <Route path="mat-khau" element={<VaultPasswords />} />
                </Route>

                <Route path="/cai-dat" element={<Settings />}>
                  <Route index element={<Profile />} />
                  <Route path="thiet-lap" element={<SettingsPreferences />} />
                  <Route path="thong-bao" element={<SettingsNotifications />} />
                  <Route path="avora-ai" element={<SettingsAssistant />} />
                </Route>

                <Route path="/lien-he" element={<Contacts />} />
                {/* Above the :contactId route on purpose — otherwise it reads as a contact id. */}
                <Route path="/lien-he/can-xem-lai" element={<ContactChannelReview />} />
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
          </BrowserRouter>
        </TooltipProvider>
      </ChatRealtimeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
