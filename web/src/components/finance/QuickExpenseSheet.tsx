import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { amountPlaceholder, amountShown, amountTyped } from "@/lib/contact-picker";
import { CHIP_OFF, CHIP_ON } from "@/lib/chip";
import { categoriesFor, toCents, todayIso, type Account, type Category } from "@/lib/finance";
import { CASH_WALLET_NAME, quickExpenseAccount } from "@/lib/finance-quick";
import { useFinanceActions } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

/**
 * KT-07b (CEO 12/11 · 6, QA-02 CC-35): the first expense in three boxes — số tiền, danh mục,
 * ghi chú; the day is today. Before, it took ~7 steps and two long forms (an account had to be made
 * on another page first). The full form stays one tap away ("Thêm chi tiết").
 */
export function QuickExpenseSheet({
  open,
  onOpenChange,
  accounts,
  categories,
  currency,
  onMore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: readonly Account[];
  categories: readonly Category[];
  currency: string;
  onMore: () => void;
}) {
  const { addFirstExpense, addTransaction } = useFinanceActions();
  const target = quickExpenseAccount(accounts);
  const money = target?.currency ?? currency;
  const choices = useMemo(() => categoriesFor(categories, "expense").filter((category) => category.deletedAt === null).slice(0, 8), [categories]);
  const [amount, setAmount] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const chosen = categoryId ?? choices[0]?.id ?? null;
  const cents = toCents(amount);
  const canSave = cents > 0 && chosen !== null && !isSaving;

  const reset = (): void => {
    setAmount("");
    setNote("");
    setCategoryId(null);
  };

  const save = async (): Promise<void> => {
    if (!canSave || chosen === null) return;
    setIsSaving(true);
    try {
      const description = note.trim() === "" ? null : note.trim();
      // KT-08 · QA05-01: an empty book gets "Tiền mặt" in the same database transaction as the expense —
      // a refused expense no longer leaves a wallet behind.
      if (target === null) {
        await addFirstExpense.mutateAsync({ categoryId: chosen, amountCents: cents, date: todayIso(), description, currency, walletName: CASH_WALLET_NAME });
        toast.success(`Đã ghi khoản chi vào ví ${CASH_WALLET_NAME}.`);
      } else {
        await addTransaction.mutateAsync({
          type: "expense",
          accountId: target.id,
          categoryId: chosen,
          amountCents: cents,
          date: todayIso(),
          description,
          businessRelated: false,
          businessPurpose: null,
          receiptPath: null,
          isRecurring: false,
          recurringFrequency: null,
          recurringLabel: null,
        });
        toast.success(`Đã ghi khoản chi vào ${target.name}.`);
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa ghi được khoản chi.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent phoneSheet className="max-w-[460px]" data-quick-expense="">
        <div>
          <DialogTitle className="text-[19px] font-semibold tracking-tight">Ghi khoản chi</DialogTitle>
          <DialogDescription className="mt-1 text-[13.5px] text-muted-foreground">
            {target === null
              ? `Hôm nay. Avora tạo sẵn ví ${CASH_WALLET_NAME} cho khoản đầu tiên của bạn.`
              : `Hôm nay · vào ${target.name}.`}
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Số tiền</span>
            <input
              inputMode="numeric"
              autoFocus
              value={amountShown(amount, money)}
              onChange={(event) => setAmount(amountTyped(event.target.value, money))}
              placeholder={amountPlaceholder(money)}
              aria-label="Số tiền"
              className="mt-1.5 h-12 w-full rounded-md border border-border bg-card px-3 text-[20px] font-semibold tabular-nums text-foreground outline-none focus:border-primary"
            />
          </label>
          <fieldset>
            <legend className="text-[13px] font-medium text-foreground">Danh mục</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {choices.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={chosen === category.id}
                  onClick={() => setCategoryId(category.id)}
                  className={cn("press inline-flex h-9 items-center rounded-full border px-3 text-[13.5px] font-medium", chosen === category.id ? CHIP_ON : CHIP_OFF)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Ghi chú</span>
            <input
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Không bắt buộc — ví dụ: chợ sáng"
              aria-label="Ghi chú"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-card px-3 text-[16px] text-foreground outline-none focus:border-primary md:text-[15px]"
            />
          </label>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onMore();
              }}
              className="press min-h-11 px-1 text-[14px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Thêm chi tiết
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="press flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Ghi khoản chi
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
