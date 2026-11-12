import { Info, KeyRound, Lock, MoreHorizontal, Plus, X } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { InlineBack } from "@/components/nav/InlineBack";
import { SectionNav } from "@/components/nav/SectionNav";
import { PlusMenuButton } from "@/components/PlusMenuButton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChangeCodeDialog } from "@/components/vault/ChangeCodeDialog";
import { VaultAboutText } from "@/components/vault/VaultAbout";
import { VaultGate } from "@/components/vault/VaultGate";
import { compartmentOf } from "@/lib/vault-compartments";
import { VAULT_TABS } from "@/lib/navigation";
import { useVisibleNav } from "@/lib/use-feature";
import { isFinancePath, useVaultLock } from "@/lib/use-vault-lock";
import { requestVaultAdd, VAULT_ADD_PARAM, vaultAddFor } from "@/lib/vault-add";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";

/** `🔒 Khoá ngay` and `⋯` (Đổi mã Két sắt · Về khoá Két sắt), at the head of an open Két sắt. */
function VaultBar() {
  const vault = useVaultLock();
  const [isChanging, setIsChanging] = useState<boolean>(false);
  const [isAbout, setIsAbout] = useState<boolean>(false);

  return (
    // KT-06 · E: beside the title (phone: the top row), never a row of its own between the two tab strips.
    <div data-vault-bar="" className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void vault.lock()}
        aria-label="Khoá ngay"
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Lock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        <span className="hidden sm:inline">Khoá ngay</span>
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


/**
 * Nhà mới (VMT 12/11): "nhắc đặt mã thì được, ép đặt mã là sai". One small chip beside the title while the
 * Két sắt has no code (VMT 12/11 16:57: lên ngang chữ Két sắt, không chiếm chỗ bên dưới). Computer: the full
 * line + ✕ (hides it 30 days on this device). Phone: just `🔑 Đặt mã` in the top row.
 */
function SetCodeChip() {
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);
  const [isHidden, setIsHidden] = useState<boolean>(() => {
    try {
      return Number(window.localStorage.getItem("avora.vault.remind-later") ?? "0") > Date.now();
    } catch {
      return false;
    }
  });
  if (isHidden) return null;
  return (
    <>
      <span data-vault-remind="" className="inline-flex min-w-0 items-center gap-0.5 rounded-full border border-border bg-card pl-1 text-[13px] text-muted-foreground">
        <button type="button" onClick={() => setIsSettingUp(true)} className="press inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full px-2.5" title="Két sắt chưa có mã. Đặt mã khi bạn muốn khoá lại.">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
          <span className="hidden truncate md:inline">Chưa có mã ·</span>
          <span className="font-semibold text-foreground">Đặt mã</span>
        </button>
        <button
          type="button"
          aria-label="Để sau"
          title="Để sau (ẩn 30 ngày)"
          onClick={() => {
            try {
              window.localStorage.setItem("avora.vault.remind-later", String(Date.now() + 30 * 86_400_000));
            } catch {
              // Shown again next time; harmless.
            }
            setIsHidden(true);
          }}
          className="press hidden h-9 w-8 items-center justify-center rounded-full hover:text-foreground md:inline-flex"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
      <Dialog open={isSettingUp} onOpenChange={setIsSettingUp}>
        <DialogContent className="max-h-[92dvh] scroll-y p-0 sm:max-w-[460px]">
          <DialogTitle className="sr-only">Đặt mã Két sắt</DialogTitle>
          <VaultGate key="no-code" />
        </DialogContent>
      </Dialog>
    </>
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
  // KT-06 · A: no waterfall — the Tài chính screens download while the lock is still being asked.
  useEffect(() => {
    if (!onFinance) return;
    void import("./Finance").catch(() => undefined);
    void import("./FinanceAccounts").catch(() => undefined);
  }, [onFinance]);

  let body;
  if (vault.isLoading) {
    body = (
      // KT-06 · D (SP-04 B1): the words are for the eye too, with the shape of the page underneath.
      <LoadingOrRetry label="Đang mở Két sắt" showLabel onRetry={() => void vault.refresh()} className="justify-start">
        <div aria-hidden="true" data-vault-skeleton="" className="mt-6 grid w-full max-w-3xl gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="h-[88px] animate-pulse rounded-card border border-border bg-card" />
          ))}
        </div>
      </LoadingOrRetry>
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
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </>
    );
  } else if (!vault.isUnlocked) {
    // Giấy tờ · Mật khẩu · Chứng chỉ · Tài sản are encrypted with the code: it is asked here, at the first one.
    // KT-06 · D: no code yet → the compartment says what it keeps and invites the first one in.
    const compartment = vault.status?.hasCode === true ? null : compartmentOf(location.pathname);
    body = <VaultGate key={vault.status?.hasCode === true ? "has-code" : `no-code-${compartment ?? ""}`} compartment={compartment} />;
  } else {
    body = (
      <>
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
        notice={
          vault.isUnlocked ? <VaultBar /> : vault.status !== null && !vault.status.hasCode ? <SetCodeChip /> : undefined
        }
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
