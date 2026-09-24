import { Archive, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AccountDialog, CategoryDialog } from "@/components/finance/dialogs";
import { EmptyNote, FinanceHeader, FinancePage, Money, Panel } from "@/components/finance/primitives";
import {
  ACCOUNT_TYPE_LABELS,
  activeAccounts,
  categoriesFor,
  formatDayVi,
  isLiabilityAccount,
  netWorthInBase,
  todayIso,
  type Account,
  type Category,
  type CategoryScope,
  type LedgerEntry,
} from "@/lib/finance";
import { convertCents, type RateTable } from "@/lib/currency";
import { useFinanceActions, useLedger } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

function AccountCard({
  account,
  entries,
  currency,
  rates,
  onEdit,
  onToggleClosed,
  onOpenLedger,
}: {
  account: Account;
  entries: readonly LedgerEntry[];
  /** The base currency, used only for the converted second line. */
  currency: string;
  rates: RateTable;
  onEdit: (account: Account) => void;
  onToggleClosed: (account: Account) => void;
  onOpenLedger: (account: Account) => void;
}) {
  const closed = account.deletedAt !== null;
  const mine = entries.filter((entry) => entry.accountId === account.id);
  const last = mine.reduce<string | null>((latest, entry) => (latest === null || entry.date > latest ? entry.date : latest), null);
  const liability = isLiabilityAccount(account.type);
  // An account holds what it holds: the balance reads in its OWN currency, and the base is
  // shown underneath only when the two differ. Converting the headline figure would hide
  // what is actually in the account.
  const foreign = account.currency.toUpperCase() !== currency.toUpperCase();
  const inBase = foreign ? convertCents(account.balanceCents, account.currency, currency, rates) : null;

  return (
    <li className={cn("border-b border-border last:border-b-0", closed && "bg-background/50")}>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <button type="button" onClick={() => onOpenLedger(account)} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-[15px] font-semibold text-foreground", closed && "text-muted-foreground")}>
              {account.name}
            </span>
            {account.accountNumber !== null ? (
              <span className="tabular text-[12.5px] text-muted-foreground">•••• {account.accountNumber}</span>
            ) : null}
            {closed ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                Đã đóng
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[account.type]}
            {account.otherPersonName !== null ? ` · ${account.otherPersonName} đang giữ` : ""}
            {last !== null ? ` · giao dịch gần nhất ${formatDayVi(last)}` : " · chưa có giao dịch"}
          </span>
          {account.tags.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {account.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </button>

        <div className="text-right">
          <Money
            cents={account.balanceCents}
            currency={account.currency}
            tone={closed ? "muted" : liability ? "out" : "ink"}
            className="block text-[17px] font-semibold"
          />
          {foreign ? (
            inBase === null ? (
              <span className="text-[12px] text-task-overdue">chưa có tỷ giá</span>
            ) : (
              <Money
                cents={inBase}
                currency={currency}
                tone="muted"
                className="tabular block text-[12.5px]"
              />
            )
          ) : null}
          <span className="text-[12px] text-muted-foreground">{liability ? "đang nợ" : "số dư"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEdit(account)}
            aria-label={`Sửa ${account.name}`}
            className="press rounded p-2 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            onClick={() => onToggleClosed(account)}
            aria-label={closed ? `Mở lại ${account.name}` : `Đóng ${account.name}`}
            className="press rounded p-2 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            {closed ? <RotateCcw className="h-4 w-4" strokeWidth={1.7} /> : <Archive className="h-4 w-4" strokeWidth={1.7} />}
          </button>
        </div>
      </div>
    </li>
  );
}

const FinanceAccounts = () => {
  const navigate = useNavigate();
  const { accounts, categories, entries, currency, rates, isLoading } = useLedger();
  const { closeAccount, removeCategory } = useFinanceActions();

  const [accountDialog, setAccountDialog] = useState<{ open: boolean; editing: Account | null }>({
    open: false,
    editing: null,
  });
  const [categoryDialog, setCategoryDialog] = useState<{ open: boolean; editing: Category | null; scope: CategoryScope }>({
    open: false,
    editing: null,
    scope: "expense",
  });

  const today = todayIso();
  const open = useMemo(() => activeAccounts(accounts), [accounts]);
  const closed = useMemo(() => accounts.filter((account) => account.deletedAt !== null), [accounts]);
  // Assets, debts and net worth are sums across accounts, so they are restated in the base
  // currency; `unvalued` names anything no rate could bridge, rather than dropping it.
  const worth = useMemo(
    () => netWorthInBase(accounts, entries, today, currency, rates),
    [accounts, entries, today, currency, rates],
  );

  const incomeCategories = useMemo(() => categoriesFor(categories, "income"), [categories]);
  const expenseCategories = useMemo(() => categoriesFor(categories, "expense"), [categories]);

  const handleToggleClosed = useCallback(
    async (account: Account): Promise<void> => {
      const closing = account.deletedAt === null;
      try {
        await closeAccount.mutateAsync({ accountId: account.id, closed: closing });
        toast.success(
          closing
            ? "Đã đóng tài khoản. Giao dịch cũ vẫn còn nguyên trong các báo cáo."
            : "Đã mở lại tài khoản.",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không cập nhật được tài khoản.");
      }
    },
    [closeAccount],
  );

  const handleRemoveCategory = useCallback(
    async (category: Category): Promise<void> => {
      try {
        const result = await removeCategory.mutateAsync(category.id);
        toast.success(
          result.retired
            ? "Danh mục đã có giao dịch nên được ẩn đi, lịch sử giữ nguyên."
            : "Đã xoá danh mục.",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không xoá được danh mục.");
      }
    },
    [removeCategory],
  );

  const renderCategoryList = (list: readonly Category[], scope: CategoryScope) => (
    <ul className="px-5 py-4">
      <li className="flex flex-wrap gap-1.5">
        {list.map((category) => (
          <span
            key={category.id}
            className="group inline-flex items-center gap-1.5 rounded-full border border-border py-1 pl-2.5 pr-2 text-[13px] text-foreground"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: category.color }} />
            {category.name}
            {category.origin === "custom" ? (
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setCategoryDialog({ open: true, editing: category, scope })}
                  aria-label={`Sửa ${category.name}`}
                  className="press rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveCategory(category)}
                  aria-label={`Xoá ${category.name}`}
                  className="press rounded p-0.5 text-muted-foreground transition-colors hover:text-money-out"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.9} />
                </button>
              </span>
            ) : null}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setCategoryDialog({ open: true, editing: null, scope })}
          className="press inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Plus className="h-3 w-3" strokeWidth={2.2} />
          Thêm
        </button>
      </li>
    </ul>
  );

  return (
    <FinancePage>
      <FinanceHeader
        subtitle="Nơi tiền của bạn đang nằm, và cách bạn phân loại nó."
        action={
          <button
            type="button"
            onClick={() => setAccountDialog({ open: true, editing: null })}
            className="press inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Thêm tài khoản
          </button>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-[13px] font-medium text-muted-foreground">Tài sản</p>
          <Money cents={worth.assetsCents} currency={currency} tone="ink" className="mt-1.5 block text-[22px] font-semibold" />
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-[13px] font-medium text-muted-foreground">Nợ</p>
          <Money
            cents={worth.liabilitiesCents}
            currency={currency}
            tone={worth.liabilitiesCents > 0 ? "out" : "muted"}
            className="mt-1.5 block text-[22px] font-semibold"
          />
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-[13px] font-medium text-muted-foreground">Giá trị ròng</p>
          <Money cents={worth.netCents} currency={currency} tone="ink" className="mt-1.5 block text-[22px] font-semibold" />
        </div>
      </div>

      <div className="mt-3">
        <Panel title="Tài khoản">
          {isLoading ? (
            <ul aria-hidden="true">
              {[0, 1].map((row) => (
                <li key={row} className="flex items-center gap-4 border-b border-border px-5 py-5 last:border-b-0">
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-4 w-1/3 animate-pulse rounded bg-secondary" />
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary/70" />
                  </span>
                  <span className="h-5 w-20 animate-pulse rounded bg-secondary" />
                </li>
              ))}
            </ul>
          ) : open.length === 0 ? (
            <EmptyNote>Chưa có tài khoản nào. Tạo một cái để bắt đầu ghi sổ.</EmptyNote>
          ) : (
            <ul>
              {open.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  entries={entries}
                  currency={currency}
                  rates={rates}
                  onEdit={(item) => setAccountDialog({ open: true, editing: item })}
                  onToggleClosed={(item) => void handleToggleClosed(item)}
                  onOpenLedger={(item) => navigate(`/ket-sat/giao-dich?tai_khoan=${item.id}`)}
                />
              ))}
            </ul>
          )}
          {worth.unvalued.length > 0 ? (
            <p className="border-t border-border px-5 py-3 text-[12.5px] text-task-overdue">
              {worth.unvalued.length} tài khoản chưa có tỷ giá nên không được cộng vào tổng.
            </p>
          ) : null}
        </Panel>
      </div>

      {closed.length > 0 ? (
        <div className="mt-3">
          <Panel title="Tài khoản đã đóng">
            <ul>
              {closed.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  entries={entries}
                  currency={currency}
                  rates={rates}
                  onEdit={(item) => setAccountDialog({ open: true, editing: item })}
                  onToggleClosed={(item) => void handleToggleClosed(item)}
                  onOpenLedger={(item) => navigate(`/ket-sat/giao-dich?tai_khoan=${item.id}`)}
                />
              ))}
            </ul>
            <p className="border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground">
              Tài khoản đã đóng không tính vào số dư, nhưng mọi giao dịch của nó vẫn nằm trong sổ và trong báo cáo.
            </p>
          </Panel>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Danh mục thu">{renderCategoryList(incomeCategories, "income")}</Panel>
        <Panel title="Danh mục chi">{renderCategoryList(expenseCategories, "expense")}</Panel>
      </div>

      <AccountDialog
        open={accountDialog.open}
        onOpenChange={(next) => setAccountDialog((current) => ({ ...current, open: next }))}
        accounts={accounts}
        editing={accountDialog.editing}
      />

      <CategoryDialog
        open={categoryDialog.open}
        onOpenChange={(next) => setCategoryDialog((current) => ({ ...current, open: next }))}
        categories={categories}
        editing={categoryDialog.editing}
        defaultScope={categoryDialog.scope}
      />
    </FinancePage>
  );
};

export default FinanceAccounts;
