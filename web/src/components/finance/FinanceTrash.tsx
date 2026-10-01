import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Money, Panel } from "@/components/finance/primitives";
import { transactionConfirmWord } from "@/lib/finance-api";
import { formatDayVi, type Account } from "@/lib/finance";
import { useFinanceActions, useFinanceTrash } from "@/lib/use-finance";

/**
 * "Xoá" an account (Đợt gộp 2 · D2). With transactions still in it the person chooses: take them
 * along to the bin, or keep them and only close the account.
 */
export function RemoveAccountDialog({
  account,
  transactionCount,
  onOpenChange,
}: {
  account: Account | null;
  transactionCount: number;
  onOpenChange: (open: boolean) => void;
}) {
  const { binAccount } = useFinanceActions();
  const run = async (withTransactions: boolean): Promise<void> => {
    if (account === null) return;
    try {
      await binAccount.mutateAsync({ accountId: account.id, withTransactions });
      toast.success(
        withTransactions || transactionCount === 0
          ? "Đã chuyển vào Thùng rác Tài chính. Tổng tài sản đã tính lại."
          : "Đã đóng tài khoản. Giao dịch cũ vẫn còn trong báo cáo.",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không xoá được tài khoản.");
    }
  };

  return (
    <AlertDialog open={account !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá tài khoản "{account?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {transactionCount > 0
              ? `Tài khoản còn ${transactionCount} giao dịch. Chọn cách xử lý.`
              : "Tài khoản chưa có giao dịch. Nó sẽ vào Thùng rác, khôi phục được."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {transactionCount > 0 ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={binAccount.isPending}
              onClick={() => void run(false)}
              className="press rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
            >
              <span className="block text-[14.5px] font-semibold text-foreground">Giữ lại giao dịch, chỉ đóng tài khoản</span>
              <span className="block text-[12.5px] text-muted-foreground">Giao dịch cũ hiện "(Tài khoản đã đóng)", không tính vào Tổng tài sản.</span>
            </button>
            <button
              type="button"
              disabled={binAccount.isPending}
              onClick={() => void run(true)}
              className="press rounded-lg border border-destructive/40 px-4 py-3 text-left transition-colors hover:bg-destructive/5"
            >
              <span className="block text-[14.5px] font-semibold text-destructive">Xoá luôn {transactionCount} giao dịch</span>
              <span className="block text-[12.5px] text-muted-foreground">Cả tài khoản và giao dịch vào Thùng rác, biến khỏi mọi báo cáo.</span>
            </button>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          {transactionCount === 0 ? (
            <AlertDialogAction onClick={() => void run(true)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Xoá
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PurgeTarget = { kind: "account" | "transaction"; id: string; label: string; confirm: string };

/** Thùng rác Tài chính: restore anything, purge only what is not Kinh doanh, with the name typed back. */
export function FinanceTrashPanel() {
  const trash = useFinanceTrash();
  const actions = useFinanceActions();
  const [purging, setPurging] = useState<PurgeTarget | null>(null);
  const [typed, setTyped] = useState<string>("");

  const loose = useMemo(
    () => (trash.data?.transactions ?? []).filter((entry) => !entry.removedWithAccount),
    [trash.data],
  );
  const accounts = trash.data?.accounts ?? [];
  const businessAccounts = useMemo(
    () => new Set((trash.data?.transactions ?? []).filter((entry) => entry.businessRelated).map((entry) => entry.accountId)),
    [trash.data],
  );

  if (trash.isPending) {
    return (
      <Panel title="Thùng rác">
        <p className="flex items-center gap-2 px-5 py-4 text-[13.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
        </p>
      </Panel>
    );
  }
  if (trash.isError) {
    return (
      <Panel title="Thùng rác">
        <p role="alert" className="px-5 py-4 text-[13.5px] text-destructive">Chưa tải được Thùng rác.</p>
      </Panel>
    );
  }
  if (accounts.length === 0 && loose.length === 0) return null;

  const restore = async (kind: "account" | "transaction", id: string): Promise<void> => {
    try {
      if (kind === "account") await actions.unbinAccount.mutateAsync(id);
      else await actions.unbinTransaction.mutateAsync(id);
      toast.success("Đã khôi phục.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không khôi phục được.");
    }
  };

  const purge = async (): Promise<void> => {
    if (purging === null) return;
    try {
      if (purging.kind === "account") await actions.purgeAccount.mutateAsync({ accountId: purging.id, confirm: typed });
      else await actions.purgeTransaction.mutateAsync({ transactionId: purging.id, confirm: typed });
      toast.success("Đã xoá vĩnh viễn.");
      setPurging(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không xoá được.");
    }
  };

  const row = "flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0";
  const iconButton = "press inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground";

  return (
    <Panel title="Thùng rác">
      <ul>
        {accounts.map((account) => (
          <li key={account.id} className={row}>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium text-foreground">{account.name}</span>
              <span className="block text-[12.5px] text-muted-foreground">Tài khoản · xoá {formatDayVi(account.removedAt.slice(0, 10))}</span>
            </span>
            <button type="button" className={iconButton} onClick={() => void restore("account", account.id)}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.7} /> Khôi phục
            </button>
            {businessAccounts.has(account.id) ? (
              <span className="text-[12px] text-muted-foreground">Có dòng Kinh doanh · không xoá vĩnh viễn</span>
            ) : (
              <button
                type="button"
                className={iconButton}
                onClick={() => {
                  setTyped("");
                  setPurging({ kind: "account", id: account.id, label: account.name, confirm: account.name });
                }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.7} /> Xoá vĩnh viễn
              </button>
            )}
          </li>
        ))}
        {loose.map((entry) => (
          <li key={entry.id} className={row}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium text-foreground">{entry.description ?? "Giao dịch không diễn giải"}</span>
              <span className="block text-[12.5px] text-muted-foreground">
                {formatDayVi(entry.date)}
                {entry.businessRelated ? " · Kinh doanh" : ""}
              </span>
            </span>
            <Money cents={entry.amountCents} currency={entry.currency} tone="muted" className="text-[14px]" />
            <button type="button" className={iconButton} onClick={() => void restore("transaction", entry.id)}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.7} /> Khôi phục
            </button>
            {entry.businessRelated ? null : (
              <button
                type="button"
                className={iconButton}
                onClick={() => {
                  setTyped("");
                  const word = transactionConfirmWord(entry.description);
                  setPurging({ kind: "transaction", id: entry.id, label: entry.description ?? "giao dịch này", confirm: word });
                }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.7} /> Xoá vĩnh viễn
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground">
        Mục trong Thùng rác không tính vào số dư hay báo cáo. Dòng Kinh doanh chỉ khôi phục được, không xoá vĩnh viễn.
      </p>

      <AlertDialog open={purging !== null} onOpenChange={(open) => !open && setPurging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá vĩnh viễn "{purging?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Không khôi phục lại được. Gõ <strong className="text-foreground">{purging?.confirm}</strong> để xác nhận.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Gõ lại để xác nhận"
            className="h-11 rounded-md border border-border bg-background px-3 text-[16px] md:text-[15px] outline-none focus:border-primary"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <button
              type="button"
              disabled={purging === null || typed.trim() !== purging.confirm.trim()}
              onClick={() => void purge()}
              className="press rounded-md bg-destructive px-4 py-2 text-[14px] font-semibold text-destructive-foreground disabled:opacity-40"
            >
              Xoá vĩnh viễn
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
