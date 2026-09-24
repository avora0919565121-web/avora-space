import { Loader2, Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import {
  FieldLabel,
  inputClass,
  selectChevron,
  selectClass,
} from "@/components/finance/primitives";
import { useAuth } from "@/lib/auth";
import {
  BUSINESS_PURPOSE_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  RECURRING_FREQUENCY_LABELS,
  activeAccounts,
  categoriesFor,
  emptyTransactionDraft,
  isTransactionDraftComplete,
  todayIso,
  validateAmount,
  validateTransactionDraft,
  type Account,
  type Category,
  type LedgerEntry,
  type MovementType,
  type RecurringFrequency,
  type TransactionDraft,
} from "@/lib/finance";
import { removeReceipt, uploadReceipt, type TransactionInput } from "@/lib/finance-api";
import { useFinanceActions } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

/** Income categories that almost always mean the household business. */
const BUSINESS_LEANING_SLUGS: readonly string[] = ["farming", "rental"] as const;

function draftFromEntry(entry: LedgerEntry): TransactionDraft {
  return {
    // This form only ever edits thu/chi; obligations open their own form instead.
    type: entry.type === "income" ? "income" : "expense",
    accountId: entry.accountId,
    categoryId: entry.categoryId ?? "",
    date: entry.date,
    amount: (entry.amountCents / 100).toFixed(2),
    description: entry.description ?? "",
    businessRelated: entry.businessRelated,
    businessPurpose: entry.businessPurpose ?? "",
    isRecurring: entry.isRecurring,
    recurringFrequency: entry.recurringFrequency ?? "monthly",
    recurringLabel: entry.recurringLabel ?? "",
    receiptPath: entry.receiptPath,
  };
}

export type TransactionFormProps = {
  accounts: readonly Account[];
  categories: readonly Category[];
  /** Editing an existing row instead of writing a new one. */
  editing?: LedgerEntry | null;
  /** Pre-filled values, used by the recurring reminders. */
  seed?: Partial<TransactionDraft> | null;
  onDone?: () => void;
  onCancel?: () => void;
  onRequestCategory?: (scope: MovementType) => void;
};

/**
 * One form for both directions of money. The type toggle swaps the category list and
 * nothing else, so entering income and entering an expense are the same seven gestures.
 */
export function TransactionForm({
  accounts,
  categories,
  editing = null,
  seed = null,
  onDone,
  onCancel,
  onRequestCategory,
}: TransactionFormProps) {
  const { user } = useAuth();
  const { addTransaction, editTransaction, isWorking } = useFinanceActions();

  const open = useMemo(() => activeAccounts(accounts), [accounts]);
  const today = todayIso();

  const [draft, setDraft] = useState<TransactionDraft>(() => {
    if (editing) return draftFromEntry(editing);
    return { ...emptyTransactionDraft(today), ...(seed ?? {}) };
  });
  const [touched, setTouched] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // A fresh seed (a recurring reminder, say) refills the form without losing focus behaviour.
  useEffect(() => {
    if (editing) setDraft(draftFromEntry(editing));
    else if (seed) setDraft((current) => ({ ...current, ...seed }));
  }, [editing, seed]);

  const options = useMemo(() => categoriesFor(categories, draft.type), [categories, draft.type]);

  // The only account is the obvious account; nobody should have to pick it.
  useEffect(() => {
    if (draft.accountId === "" && open.length === 1) {
      setDraft((current) => (current.accountId === "" ? { ...current, accountId: open[0].id } : current));
    }
  }, [draft.accountId, open]);

  // Flipping the type invalidates the chosen category — it belongs to the other side of the ledger.
  useEffect(() => {
    setDraft((current) => {
      if (current.categoryId === "") return current;
      const stillValid = options.some((category) => category.id === current.categoryId);
      return stillValid ? current : { ...current, categoryId: "" };
    });
  }, [options]);

  const update = useCallback(<K extends keyof TransactionDraft>(key: K, value: TransactionDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const chooseCategory = useCallback(
    (categoryId: string): void => {
      const picked = categories.find((category) => category.id === categoryId);
      setDraft((current) => {
        const next: TransactionDraft = { ...current, categoryId };
        // Farm and rental income is business income; offer the flag already ticked, still untickable.
        if (
          !current.businessRelated &&
          current.type === "income" &&
          picked?.slug !== null &&
          picked?.slug !== undefined &&
          BUSINESS_LEANING_SLUGS.includes(picked.slug)
        ) {
          next.businessRelated = true;
        }
        return next;
      });
    },
    [categories],
  );

  const complete = isTransactionDraftComplete(draft);
  const validation = validateTransactionDraft(draft, today);
  const amountError = touched ? validateAmount(draft.amount).error : null;

  const handleFile = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file || !user?.id) return;
      setIsUploading(true);
      try {
        const path = await uploadReceipt(user.id, file);
        setDraft((current) => ({ ...current, receiptPath: path }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không tải được ảnh chứng từ.");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [user?.id],
  );

  const dropReceipt = useCallback((): void => {
    const path = draft.receiptPath;
    setDraft((current) => ({ ...current, receiptPath: null }));
    // Only orphan uploads are cleaned up; a saved row keeps its file until the row changes.
    if (path !== null && editing?.receiptPath !== path) void removeReceipt(path);
  }, [draft.receiptPath, editing?.receiptPath]);

  /**
   * Enter is for writing, not for sending. Only the button submits, so a half-finished
   * entry can never be committed by a stray keystroke in the amount field.
   */
  const blockEnterSubmit = useCallback((event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setTouched(true);
      if (!user?.id) return;

      const problem = validateTransactionDraft(draft, todayIso());
      if (problem.error !== null) {
        toast.error(problem.error);
        return;
      }

      const amount = validateAmount(draft.amount);
      if (amount.cents === null) return;

      const input: TransactionInput = {
        type: draft.type,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        amountCents: amount.cents,
        date: draft.date,
        description: draft.description.trim() === "" ? null : draft.description.trim(),
        businessRelated: draft.businessRelated,
        businessPurpose:
          draft.businessRelated && draft.businessPurpose.trim() !== "" ? draft.businessPurpose.trim() : null,
        receiptPath: draft.receiptPath,
        isRecurring: draft.isRecurring,
        recurringFrequency: draft.isRecurring ? draft.recurringFrequency : null,
        recurringLabel: draft.isRecurring && draft.recurringLabel.trim() !== "" ? draft.recurringLabel.trim() : null,
      };

      try {
        if (editing) {
          await editTransaction.mutateAsync({ transactionId: editing.id, input });
          toast.success("Đã cập nhật giao dịch.");
        } else {
          await addTransaction.mutateAsync(input);
          toast.success(draft.type === "income" ? "Đã ghi khoản thu." : "Đã ghi khoản chi.");
          // Clearing keeps the account and the date: the next entry is usually the same day.
          setDraft((current) => ({
            ...emptyTransactionDraft(todayIso()),
            type: current.type,
            accountId: current.accountId,
            date: current.date,
          }));
          setTouched(false);
        }
        onDone?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không lưu được giao dịch.");
      }
    },
    [addTransaction, draft, editTransaction, editing, onDone, user?.id],
  );

  if (open.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[14px] text-muted-foreground">
        Hãy tạo một tài khoản trước — mọi giao dịch đều phải thuộc về một tài khoản.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} onKeyDown={blockEnterSubmit} className="px-5 py-5">
      {/* Type: a two-way switch rather than a dropdown — both options stay visible. */}
      <fieldset>
        <legend className="sr-only">Loại giao dịch</legend>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(["expense", "income"] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.type === type}
              onClick={() => update("type", type)}
              className={cn(
                "press rounded-[7px] px-4 py-1.5 text-[13.5px] font-semibold transition-colors",
                draft.type === type
                  ? type === "income"
                    ? "bg-money-in text-white"
                    : "bg-money-out text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {type === "income" ? "Khoản thu" : "Khoản chi"}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="txn-account" required>
            Tài khoản
          </FieldLabel>
          <select
            id="txn-account"
            value={draft.accountId}
            onChange={(event) => update("accountId", event.target.value)}
            className={cn(selectClass, "mt-1.5")}
            style={{ backgroundImage: selectChevron }}
          >
            <option value="">Chọn tài khoản</option>
            {open.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="txn-date" required>
            Ngày
          </FieldLabel>
          <input
            id="txn-date"
            type="date"
            value={draft.date}
            max={today}
            onChange={(event) => update("date", event.target.value)}
            className={cn(inputClass, "mt-1.5")}
          />
          {touched && draft.date > today ? (
            <p className="mt-1 text-[12.5px] text-money-out">Ngày giao dịch không thể ở tương lai.</p>
          ) : null}
        </div>

        <div>
          <FieldLabel htmlFor="txn-amount" required>
            Số tiền
          </FieldLabel>
          <input
            id="txn-amount"
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => update("amount", event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0.00"
            className={cn(inputClass, "tabular mt-1.5", amountError !== null && "border-money-out")}
          />
          {amountError !== null ? <p className="mt-1 text-[12.5px] text-money-out">{amountError}</p> : null}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel htmlFor="txn-category" required>
              Danh mục
            </FieldLabel>
            {onRequestCategory ? (
              <button
                type="button"
                onClick={() => onRequestCategory(draft.type)}
                className="press text-[12.5px] font-medium text-primary hover:underline"
              >
                + Danh mục mới
              </button>
            ) : null}
          </div>
          <select
            id="txn-category"
            value={draft.categoryId}
            onChange={(event) => chooseCategory(event.target.value)}
            className={cn(selectClass, "mt-1.5")}
            style={{ backgroundImage: selectChevron }}
          >
            <option value="">{draft.type === "income" ? "Chọn nguồn thu" : "Chọn khoản chi"}</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.origin === "custom" ? " ·" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <FieldLabel htmlFor="txn-description">Diễn giải</FieldLabel>
        <textarea
          id="txn-description"
          value={draft.description}
          onChange={(event) => update("description", event.target.value)}
          rows={2}
          maxLength={DESCRIPTION_MAX_LEN}
          placeholder="Không bắt buộc — ví dụ: mua phân bón ở chợ Bến Thành"
          className="mt-1.5 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[14px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
        />
      </div>

      {/* Business context. Off by default: most households are not a business. */}
      <div className="mt-4 rounded-md border border-border bg-background/60 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.businessRelated}
            onChange={(event) => update("businessRelated", event.target.checked)}
            className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
          />
          <span className="text-[14px] font-medium text-foreground">Giao dịch này thuộc việc kinh doanh</span>
        </label>

        {draft.businessRelated ? (
          <div className="mt-3">
            <FieldLabel htmlFor="txn-purpose">Mục đích kinh doanh</FieldLabel>
            <input
              id="txn-purpose"
              value={draft.businessPurpose}
              onChange={(event) => update("businessPurpose", event.target.value)}
              maxLength={BUSINESS_PURPOSE_MAX_LEN}
              placeholder="ví dụ: phân bón cho vụ lúa, sửa nhà cho thuê"
              className={cn(inputClass, "mt-1.5")}
            />
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Dòng này xuất hiện trong báo cáo Chi phí được trừ — ghi rõ sẽ đỡ việc khi quyết toán.
            </p>
          </div>
        ) : null}
      </div>

      {/* Recurring is a reminder, never an automatic charge. */}
      <div className="mt-3 rounded-md border border-border bg-background/60 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.isRecurring}
            onChange={(event) => update("isRecurring", event.target.checked)}
            className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
          />
          <span className="text-[14px] font-medium text-foreground">Khoản này lặp lại</span>
        </label>

        {draft.isRecurring ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="txn-frequency">Tần suất</FieldLabel>
              <select
                id="txn-frequency"
                value={draft.recurringFrequency}
                onChange={(event) => update("recurringFrequency", event.target.value as RecurringFrequency)}
                className={cn(selectClass, "mt-1.5")}
                style={{ backgroundImage: selectChevron }}
              >
                {(Object.keys(RECURRING_FREQUENCY_LABELS) as RecurringFrequency[]).map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {RECURRING_FREQUENCY_LABELS[frequency]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="txn-label">Tên gọi</FieldLabel>
              <input
                id="txn-label"
                value={draft.recurringLabel}
                onChange={(event) => update("recurringLabel", event.target.value)}
                placeholder="ví dụ: Thẻ tập gym"
                className={cn(inputClass, "mt-1.5")}
              />
            </div>
            <p className="text-[12.5px] text-muted-foreground sm:col-span-2">
              AVORA sẽ nhắc khi tới kỳ. Không tự động ghi sổ — bạn vẫn là người bấm thêm.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            id="txn-receipt"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
          {draft.receiptPath === null ? (
            <label
              htmlFor="txn-receipt"
              className="press inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" strokeWidth={1.7} />
              )}
              {isUploading ? "Đang tải…" : "Đính kèm chứng từ"}
            </label>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3.5 py-2 text-[13px] text-foreground">
              <Paperclip className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
              Đã đính kèm chứng từ
              <button
                type="button"
                onClick={dropReceipt}
                aria-label="Bỏ chứng từ"
                className="press text-muted-foreground transition-colors hover:text-money-out"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
            >
              Huỷ
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!complete || isWorking || isUploading}
            title={complete ? undefined : "Điền tài khoản, ngày, số tiền và danh mục trước"}
            className={cn(
              "press inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[14px] font-semibold transition-colors",
              complete && !isWorking
                ? "bg-primary text-primary-foreground hover:bg-primary/92"
                : "cursor-not-allowed bg-primary/35 text-primary-foreground",
            )}
          >
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editing ? "Lưu thay đổi" : "Thêm giao dịch"}
          </button>
        </div>
      </div>

      {touched && validation.error !== null ? (
        <p className="mt-2 text-right text-[12.5px] text-money-out">{validation.error}</p>
      ) : null}
    </form>
  );
}
