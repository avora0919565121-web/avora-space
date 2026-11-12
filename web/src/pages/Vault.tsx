import { Info, KeyRound, Lock, MoreHorizontal, Plus } from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { InlineBack } from "@/components/nav/InlineBack";
import { SectionNav } from "@/components/nav/SectionNav";
import { PlusMenuButton } from "@/components/PlusMenuButton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChangeCodeDialog } from "@/components/vault/ChangeCodeDialog";
import { VaultAboutText } from "@/components/vault/VaultAbout";
import { VaultGate } from "@/components/vault/VaultGate";
import { VAULT_TABS } from "@/lib/navigation";
import { useVisibleNav } from "@/lib/use-feature";
import { useVaultLock } from "@/lib/use-vault-lock";
import { requestVaultAdd, VAULT_ADD_PARAM, vaultAddFor } from "@/lib/vault-add";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";

/** `🔒 Khoá ngay` and `⋯` (Đổi mã Két sắt · Về khoá Két sắt), at the head of an open Két sắt. */
function VaultBar() {
  const vault = useVaultLock();
  const [isChanging, setIsChanging] = useState<boolean>(false);
  const [isAbout, setIsAbout] = useState<boolean>(false);

  return (
    <div data-under-tabs="" className="mx-auto flex w-full max-w-6xl items-center justify-end gap-1 px-4 pt-4 sm:px-6 md:px-10 short:px-4">
      <button
        type="button"
        onClick={() => void vault.lock()}
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Lock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        Khoá ngay
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Thêm về khoá Két sắt"
          className="press flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setIsChanging(true)} className="gap-2 py-2.5">
            <KeyRound className="h-4 w-4" strokeWidth={1.7} />
            Đổi mã Két sắt
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIsAbout(true)} className="gap-2 py-2.5">
            <Info className="h-4 w-4" strokeWidth={1.7} />
            Về khoá Két sắt
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeCodeDialog open={isChanging} onOpenChange={setIsChanging} />
      <Dialog open={isAbout} onOpenChange={setIsAbout}>
        <DialogContent className="max-w-[440px]">
          <DialogTitle className="text-[19px] font-semibold tracking-tight">Về khoá Két sắt</DialogTitle>
          <VaultAboutText className="mt-1" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The Tài chính part of Két sắt (its own sub-routes included). */
function isFinancePath(pathname: string): boolean {
  return /^\/ket-sat(\/(giao-dich|tai-khoan|bao-cao))?\/?$/.test(pathname);
}

/**
 * Nhà mới (VMT 12/11): "nhắc đặt mã thì được, ép đặt mã là sai". One quiet card above an open Tài chính
 * while the Két sắt has no code; `Để sau` hides it on this device for 30 days.
 */
function SetCodeReminder() {
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);
  const [isHidden, setIsHidden] = useState<boolean>(() => {
    try {
      const until = Number(window.localStorage.getItem("avora.vault.remind-later") ?? "0");
      return until > Date.now();
    } catch {
      return false;
    }
  });
  if (isHidden) return null;
  return (
    <div data-under-tabs="" className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 md:px-10 short:px-4">
      <section data-vault-remind="" className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium text-foreground">Két sắt chưa có mã</p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted-foreground">
            Tài chính đang mở như các phòng khác. Đặt mã khi bạn muốn khoá lại, hoặc khi cất giấy tờ, mật khẩu đầu tiên.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setIsSettingUp(true)} className="press min-h-10 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground">
              Đặt mã
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.setItem("avora.vault.remind-later", String(Date.now() + 30 * 86_400_000));
                } catch {
                  // Shown again next time; harmless.
                }
                setIsHidden(true);
              }}
              className="press min-h-10 rounded-md px-3 text-[13.5px] font-medium text-muted-foreground"
            >
              Để sau
            </button>
          </div>
        </div>
      </section>
      <Dialog open={isSettingUp} onOpenChange={setIsSettingUp}>
        <DialogContent className="max-h-[92dvh] scroll-y p-0 sm:max-w-[460px]">
          <DialogTitle className="sr-only">Đặt mã Két sắt</DialogTitle>
          <VaultGate key="no-code" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Két sắt — the place where what is yours is kept. Locked by its own code (AVORA-51, ADR-034):
 * until the server says this session is unlocked, every sub-tab shows the lock screen instead.
 */
const Vault = () => {
  const visibleNav = useVisibleNav(VAULT_TABS);
  const vault = useVaultLock();
  const navigate = useNavigate();
  const location = useLocation();
  const onFinance = isFinancePath(location.pathname);

  let body;
  if (vault.isLoading) {
    body = (
      <LoadingOrRetry label="Đang mở Két sắt" />
    );
  } else if (vault.error !== null && vault.status === null) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[15px] text-foreground">Không kiểm tra được khoá Két sắt.</p>
        <button
          type="button"
          onClick={() => void vault.refresh()}
          className="press min-h-11 rounded-md border border-border px-4 text-[14px] font-medium hover:bg-secondary"
        >
          Thử lại
        </button>
      </div>
    );
  } else if (!vault.isUnlocked && vault.isFinanceOpen && onFinance) {
    // Nhà mới: no code yet → Tài chính opens straight away, with a reminder (never a wall).
    body = (
      <>
        <SetCodeReminder />
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </>
    );
  } else if (!vault.isUnlocked) {
    // Giấy tờ · Mật khẩu · Chứng chỉ · Tài sản are encrypted with the code: it is asked here, at the first one.
    body = <VaultGate key={vault.status?.hasCode === true ? "has-code" : "no-code"} />;
  } else {
    body = (
      <>
        <VaultBar />
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionNav
        section="Két sắt"
        tabs={visibleNav}
        action={(current) => {
          // AVORA-57 · E: one `+` beside the title; none while locked or on a "Sắp có" sub-tab.
          const entry = vault.isUnlocked || (vault.isFinanceOpen && current === "/ket-sat") ? vaultAddFor(current) : null;
          if (entry === null) return null;
          // AVORA-60 · D / 61 · A: the shared `+`. Tap = the sub-tab's own thing; no menu while each
          // sub-tab has a single kind to add (the other sub-tabs are still "Sắp có").
          return (
            <PlusMenuButton
              label={`Thêm ${entry.label.toLowerCase()}`}
              onTap={() => {
                if (!requestVaultAdd()) navigate(`${entry.path}?${VAULT_ADD_PARAM}=1`);
              }}
              entries={[]}
            />
          );
        }}
      />
      <InlineBack className="mx-auto w-full max-w-5xl px-6 md:px-10 short:px-4" />
      {body}
    </div>
  );
};

export default Vault;
