import { Info, KeyRound, Loader2, Lock, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router-dom";

import { ReturnChip } from "@/components/nav/ReturnChip";
import { SectionTabs } from "@/components/SectionTabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChangeCodeDialog } from "@/components/vault/ChangeCodeDialog";
import { VaultAboutText } from "@/components/vault/VaultAbout";
import { VaultGate } from "@/components/vault/VaultGate";
import { VAULT_TABS } from "@/lib/navigation";
import { useVaultLock } from "@/lib/use-vault-lock";

/** `🔒 Khoá ngay` and `⋯` (Đổi mã Két sắt · Về khoá Két sắt), at the head of an open Két sắt. */
function VaultBar() {
  const vault = useVaultLock();
  const [isChanging, setIsChanging] = useState<boolean>(false);
  const [isAbout, setIsAbout] = useState<boolean>(false);

  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-1 px-4 pt-2 sm:px-6 md:px-10">
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

/**
 * Két sắt — the place where what is yours is kept. Locked by its own code (AVORA-51, ADR-034):
 * until the server says this session is unlocked, every sub-tab shows the lock screen instead.
 */
const Vault = () => {
  const vault = useVaultLock();

  let body;
  if (vault.isLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center" role="status" aria-label="Đang mở Két sắt">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
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
  } else if (!vault.isUnlocked) {
    body = <VaultGate key={vault.status?.hasCode === true ? "has-code" : "no-code"} />;
  } else {
    body = (
      <>
        <VaultBar />
        <Outlet />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionTabs section="Két sắt" tabs={VAULT_TABS} />
      <ReturnChip className="mx-auto w-full max-w-5xl px-6 md:px-10" />
      {body}
    </div>
  );
};

export default Vault;
