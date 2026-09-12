import { Bell, Briefcase, Paperclip, Pencil, RotateCcw, Repeat, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { TransactionForm } from "@/components/finance/TransactionForm";
import { CategoryDialog } from "@/components/finance/dialogs";
import {
  EmptyNote,
  FieldLabel,
  FinanceHeader,
  FinancePage,
  Money,
  Panel,
  inputClass,
  selectChevron,
  selectClass,
} from "@/components/finance/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  RECURRING_FREQUENCY_LABELS,
  activeAccounts,
  activeCategories,
  endOfMonth,
  entriesInRange,
  formatDayVi,
  formatMonthLong,
  groupByDay,
  monthKey,
  recurringSuggestions,
  searchEntries,
  startOfMonth,
  todayIso,
  type CategoryScope,
  type LedgerEntry,
} from "@/lib/finance";
import { receiptUrl } from "@/lib/finance-api";
import { useDismissedRecurring, useFinanceActions, useLedger } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

/** One row of the ledger: direction, what it was, and what it did to the balance. */
function EntryRow({
  entry,
  currency,
  onEdit,
  onVoid,
  onOpen,
}: {
  entry: LedgerEntry;
  currency: string;
  onEdit: (entry: LedgerEntry) => void;
  onVoid: (entry: LedgerEntry) => void;
  onOpen: (entry: LedgerEntry) => void;
}) {
  const voided = entry.deletedAt !== null;

  return (
    <li className={cn("group border-b border-border last:border-b-0", voided && "bg-background/50")}>
      <div className="flex items-center gap-3 px-5 py-3">
        <span
          aria-hidden="true"
          className="h-8 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: voided ? "#CCCCCC" : entry.category.color }}
        />

        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="min-w-0 flex-1 text-left"
          aria-label={`Xem chi tiết ${entry.description ?? entry.category.name}`}
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "truncate text-[14.5px] font-medium text-foreground",
                voided && "text-muted-foreground line-through",
              )}
            >
              {entry.description ?? entry.category.name}
            </span>
            {entry.businessRelated ? (
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-label="Kinh doanh" />
            ) : null}
            {entry.isRecurring ? (
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-label="Lặp lại" />
            ) : null}
            {entry.receiptPath !== null ? (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-label="Có chứng từ" />
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {entry.category.name} · {entry.account.name}
            {voided ? " · đã đánh dấu nhầm" : ""}
          </span>
        </button>

        <Money
          cents={entry.type === "income" ? entry.amountCents : -entry.amountCents}
          currency={currency}
          tone={voided ? "muted" : entry.type === "income" ? "in" : "ink"}
          signed={entry.type === "income" && !voided}
          className={cn("shrink-0 text-[14.5px] font-semibold", voided && "line-through")}
        />

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!voided ? (
            <button
              type="button"
              onClick={() => onEdit(entry)}
              aria-label="Sửa giao dịch"
              className="press rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onVoid(entry)}
            aria-label={voided ? "Khôi phục giao dịch" : "Đánh dấu nhầm"}
            className="press rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            {voided ? <RotateCcw className="h-4 w-4" strokeWidth={1.7} /> : <Trash2 className="h-4 w-4" strokeWidth={1.7} />}
          </button>
        </div>
      </div>
    </li>
  );
}

const FinanceTransactions = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { accounts, categories, allEntries, entries, currency, isLoading } = useLedger();
  const { voidTransaction, addTransaction } = useFinanceActions();
  const { dismissed, dismiss } = useDismissedRecurring();

  const [query, setQuery] = useState<string>("");
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [viewing, setViewing] = useState<LedgerEntry | null>(null);
  const [receiptHref, setReceiptHref] = useState<string | null>(null);
  const [categoryScope, setCategoryScope] = useState<CategoryScope | null>(null);
  const [showVoided, setShowVoided] = useState<boolean>(false);

  const monthFilter = searchParams.get("thang");
  const categoryFilter = searchParams.get("hang_muc");
  const accountFilter = searchParams.get("tai_khoan");

  const open = useMemo(() => activeAccounts(accounts), [accounts]);
  const usable = useMemo(() => activeCategories(categories), [categories]);

  const visible = useMemo<LedgerEntry[]>(() => {
    let list = showVoided ? allEntries : entries;
    if (monthFilter !== null) list = entriesInRange(list, startOfMonth(monthFilter), endOfMonth(monthFilter));
    if (categoryFilter !== null) list = list.filter((entry) => entry.categoryId === categoryFilter);
    if (accountFilter !== null) list = list.filter((entry) => entry.accountId === accountFilter);
    return searchEntries(list, query);
  }, [accountFilter, allEntries, categoryFilter, entries, monthFilter, query, showVoided]);

  const days = useMemo(() => groupByDay(visible), [visible]);

  const suggestions = useMemo(
    () => recurringSuggestions(entries, todayIso(), dismissed),
    [dismissed, entries],
  );

  const clearFilter = useCallback(
    (key: string): void => {
      const next = new URLSearchParams(searchParams);
      next.delete(key);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleVoid = useCallback(
    async (entry: LedgerEntry): Promise<void> => {
      const voided = entry.deletedAt !== null;
      try {
        await voidTransaction.mutateAsync({ transactionId: entry.id, voided: !voided });
        toast.success(voided ? "Đã khôi phục giao dịch." : "Đã đánh dấu nhầm. Số dư được tính lại.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không cập nhật được giao dịch.");
      }
    },
    [voidTransaction],
  );

  const acceptSuggestion = useCallback(
    async (key: string): Promise<void> => {
      const suggestion = suggestions.find((item) => item.key === key);
      if (!suggestion) return;
      try {
        await addTransaction.mutateAsync({
          type: suggestion.type,
          accountId: suggestion.accountId,
          categoryId: suggestion.categoryId,
          amountCents: suggestion.amountCents,
          date: suggestion.dueDate,
          description: suggestion.label,
          businessRelated: suggestion.businessRelated,
          businessPurpose: suggestion.businessPurpose,
          receiptPath: null,
          isRecurring: true,
          recurringFrequency: suggestion.frequency,
          recurringLabel: suggestion.label,
        });
        toast.success(`Đã ghi “${suggestion.label}”.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không ghi được khoản lặp lại.");
      }
    },
    [addTransaction, suggestions],
  );

  // A receipt link is short-lived and minted on demand, never stored in the row.
  useEffect(() => {
    let cancelled = false;
    setReceiptHref(null);
    const path = viewing?.receiptPath ?? null;
    if (path === null) return;
    void receiptUrl(path).then((url) => {
      if (!cancelled) setReceiptHref(url);
    });
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  const filterChips: { key: string; label: string }[] = [];
  if (monthFilter !== null) filterChips.push({ key: "thang", label: formatMonthLong(monthFilter) });
  if (categoryFilter !== null) {
    filterChips.push({
      key: "hang_muc",
      label: categories.find((category) => category.id === categoryFilter)?.name ?? "Hạng mục",
    });
  }
  if (accountFilter !== null) {
    filterChips.push({
      key: "tai_khoan",
      label: accounts.find((account) => account.id === accountFilter)?.name ?? "Tài khoản",
    });
  }

  return (
    <FinancePage>
      <FinanceHeader subtitle="Ghi thu chi và xem lại toàn bộ sổ." />

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
        <div className="order-2 lg:order-1">
          <Panel
            title="Giao dịch gần đây"
            action={
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showVoided}
                  onChange={(event) => setShowVoided(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-[hsl(var(--primary))]"
                />
                Hiện cả khoản đã đánh dấu nhầm
              </label>
            }
          >
            <div className="border-b border-border px-5 py-3">
              <label className="relative block">
                <span className="sr-only">Tìm giao dịch</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.7}
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm theo diễn giải, hạng mục hoặc tài khoản"
                  className={cn(inputClass, "pl-9")}
                />
              </label>

              {filterChips.length > 0 ? (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {filterChips.map((chip) => (
                    <li key={chip.key}>
                      <button
                        type="button"
                        onClick={() => clearFilter(chip.key)}
                        className="press inline-flex items-center gap-1.5 rounded-full bg-accent/70 px-3 py-1 text-[12.5px] font-medium text-accent-foreground transition-colors hover:bg-accent"
                      >
                        {chip.label}
                        <X className="h-3 w-3" strokeWidth={2.2} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {isLoading ? (
              <ul aria-hidden="true">
                {[0, 1, 2, 3].map((row) => (
                  <li key={row} className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                    <span className="h-8 w-1.5 shrink-0 animate-pulse rounded-full bg-secondary" />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-3.5 w-1/3 animate-pulse rounded bg-secondary" />
                      <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary/70" />
                    </span>
                    <span className="h-4 w-16 animate-pulse rounded bg-secondary" />
                  </li>
                ))}
              </ul>
            ) : days.length === 0 ? (
              <EmptyNote>
                {entries.length === 0
                  ? "Chưa có giao dịch nào. Dùng biểu mẫu bên cạnh để ghi khoản đầu tiên."
                  : "Không tìm thấy giao dịch nào khớp."}
              </EmptyNote>
            ) : (
              <div>
                {days.map((day) => (
                  <section key={day.date}>
                    <header className="flex items-baseline justify-between gap-3 bg-background/70 px-5 py-1.5">
                      <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {day.date === todayIso() ? "Hôm nay" : formatDayVi(day.date)}
                      </h3>
                      <Money cents={day.netCents} currency={currency} signed className="text-[12.5px] font-medium" />
                    </header>
                    <ul>
                      {day.entries.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          currency={currency}
                          onEdit={setEditing}
                          onVoid={(item) => void handleVoid(item)}
                          onOpen={setViewing}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="order-1 space-y-3 lg:order-2">
          {suggestions.length > 0 ? (
            <Panel title="Đến kỳ khoản lặp lại">
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={suggestion.key} className="border-b border-border px-5 py-3.5 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-foreground">
                          Thêm “{suggestion.label}”?{" "}
                          <Money
                            cents={suggestion.amountCents}
                            currency={currency}
                            tone="ink"
                            className="font-semibold"
                          />
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                          {RECURRING_FREQUENCY_LABELS[suggestion.frequency]} · đến hạn {formatDayVi(suggestion.dueDate)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void acceptSuggestion(suggestion.key)}
                            className="press rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
                          >
                            Thêm
                          </button>
                          <button
                            type="button"
                            onClick={() => dismiss(suggestion.key)}
                            className="press rounded-md border border-border px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground"
                          >
                            Bỏ qua
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title={editing ? "Sửa giao dịch" : "Ghi giao dịch"}>
            <TransactionForm
              accounts={accounts}
              categories={usable}
              editing={editing}
              onDone={() => setEditing(null)}
              onCancel={editing ? () => setEditing(null) : undefined}
              onRequestCategory={(scope) => setCategoryScope(scope)}
            />
          </Panel>

          {open.length > 1 ? (
            <Panel title="Lọc theo tài khoản">
              <div className="px-5 py-4">
                <FieldLabel htmlFor="filter-account">Tài khoản</FieldLabel>
                <select
                  id="filter-account"
                  value={accountFilter ?? ""}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams);
                    if (event.target.value === "") next.delete("tai_khoan");
                    else next.set("tai_khoan", event.target.value);
                    setSearchParams(next, { replace: true });
                  }}
                  className={cn(selectClass, "mt-1.5")}
                  style={{ backgroundImage: selectChevron }}
                >
                  <option value="">Tất cả tài khoản</option>
                  {open.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      {/* Detail sheet */}
      <Dialog
        open={viewing !== null}
        onOpenChange={(next) => {
          if (!next) setViewing(null);
        }}
      >
        <DialogContent className="max-w-[520px]">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">
            {viewing?.description ?? viewing?.category.name ?? "Giao dịch"}
          </DialogTitle>
          <DialogDescription className="text-[14px] text-muted-foreground">
            {viewing ? `${formatDayVi(viewing.date)} · ${viewing.account.name}` : ""}
          </DialogDescription>

          {viewing ? (
            <dl className="mt-4 space-y-2.5 text-[14px]">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Số tiền</dt>
                <dd>
                  <Money
                    cents={viewing.type === "income" ? viewing.amountCents : -viewing.amountCents}
                    currency={currency}
                    tone={viewing.type === "income" ? "in" : "ink"}
                    className="font-semibold"
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Hạng mục</dt>
                <dd className="flex items-center gap-2 text-foreground">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: viewing.category.color }}
                  />
                  {viewing.category.name}
                </dd>
              </div>
              {viewing.businessRelated ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Mục đích kinh doanh</dt>
                  <dd className="max-w-[60%] text-right text-foreground">
                    {viewing.businessPurpose ?? "— chưa ghi —"}
                  </dd>
                </div>
              ) : null}
              {viewing.isRecurring ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Lặp lại</dt>
                  <dd className="text-foreground">
                    {viewing.recurringFrequency ? RECURRING_FREQUENCY_LABELS[viewing.recurringFrequency] : "—"}
                    {viewing.recurringLabel !== null ? ` · ${viewing.recurringLabel}` : ""}
                  </dd>
                </div>
              ) : null}
              {viewing.receiptPath !== null ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Chứng từ</dt>
                  <dd>
                    {receiptHref !== null ? (
                      <a
                        href={receiptHref}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        Mở chứng từ
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Đang mở…</span>
                    )}
                  </dd>
                </div>
              ) : null}
              {viewing.deletedAt !== null ? (
                <p className="rounded-md border border-border bg-background px-3 py-2 text-[13px] text-muted-foreground">
                  Khoản này đã được đánh dấu nhầm. Nó vẫn nằm trong sổ để đối chiếu nhưng không tính vào bất kỳ tổng nào.
                </p>
              ) : null}
            </dl>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            {viewing !== null && viewing.deletedAt === null ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(viewing);
                  setViewing(null);
                }}
                className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
              >
                Sửa
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (viewing) void handleVoid(viewing);
                setViewing(null);
              }}
              className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
            >
              {viewing?.deletedAt !== null && viewing !== null ? "Khôi phục" : "Đánh dấu nhầm"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <CategoryDialog
        open={categoryScope !== null}
        onOpenChange={(next) => {
          if (!next) setCategoryScope(null);
        }}
        categories={categories}
        editing={null}
        defaultScope={categoryScope ?? "expense"}
      />
    </FinancePage>
  );
};

export default FinanceTransactions;
