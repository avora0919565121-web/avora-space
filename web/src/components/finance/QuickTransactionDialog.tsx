import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { TransactionForm } from "@/components/finance/TransactionForm";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { activeAccounts } from "@/lib/finance";
import { useAccounts, useCategories } from "@/lib/use-finance";

/**
 * "Tạo giao dịch nhanh" from the corner bubble (AVORA-35 / G).
 *
 * The very same form Két sắt uses, fed by the same shared queries and saved by the same actions,
 * so the ledger and Tổng tài sản refresh wherever they are open. Every live account is offered,
 * Tiền mặt included. With no account yet there is nothing to write into: the dialog invites
 * creating one instead of opening an empty form.
 */
export function QuickTransactionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const accountsQuery = useAccounts();
  const categoriesQuery = useCategories();
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const hasAccount = activeAccounts(accounts).length > 0;
  const isLoading = accountsQuery.isPending || categoriesQuery.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">Tạo giao dịch nhanh</DialogTitle>
          <DialogDescription className="text-[14px] text-muted-foreground">
            Ghi một khoản thu hoặc chi, chọn sổ ngay tại đây.
          </DialogDescription>
        </div>
        {isLoading ? (
          <div className="flex justify-center px-5 py-12" role="status" aria-label="Đang tải sổ">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAccount ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[16px] font-semibold text-foreground">Bạn chưa có sổ nào</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted-foreground">
              Tạo sổ đầu tiên — tiền mặt, tài khoản ngân hàng, hay tiền gửi ở nhà người thân — rồi ghi giao dịch.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate("/ket-sat/tai-khoan");
              }}
              className="press mt-5 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            >
              Tạo tài khoản
            </button>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <TransactionForm
              accounts={accounts}
              categories={categories}
              onDone={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
