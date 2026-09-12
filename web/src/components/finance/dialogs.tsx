import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldLabel, inputClass, selectChevron, selectClass } from "@/components/finance/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { currenciesByRegion, REGION_LABELS } from "@/lib/currency";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  activeAccounts,
  centsToDecimalString,
  validateAccountName,
  validateCategoryName,
  validateOpeningBalance,
  type Account,
  type AccountType,
  type Category,
  type CategoryScope,
} from "@/lib/finance";
import type { AccountDraft, CategoryDraft } from "@/lib/finance-api";
import { useFinanceActions } from "@/lib/use-finance";
import { useBaseCurrency } from "@/lib/use-settings";
import { cn } from "@/lib/utils";

// The three hardcoded options are gone: the twenty supported currencies now come from the
// shared catalogue, grouped by region so a long list stays scannable.

// ---------------------------------------------------------------- account

export function AccountDialog({
  open,
  onOpenChange,
  accounts,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: readonly Account[];
  editing: Account | null;
}) {
  const { addAccount, editAccount, isWorking } = useFinanceActions();
  const baseCurrency = useBaseCurrency();
  const others = useMemo(() => activeAccounts(accounts).filter((a) => a.id !== editing?.id), [accounts, editing?.id]);

  const [name, setName] = useState<string>("");
  const [type, setType] = useState<AccountType>("checking");
  const [opening, setOpening] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [personName, setPersonName] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [tags, setTags] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setOpening(centsToDecimalString(editing.openingBalanceCents));
      setCurrency(editing.currency);
      setPersonName(editing.otherPersonName ?? "");
      setAccountNumber(editing.accountNumber ?? "");
      setTags(editing.tags.join(", "));
    } else {
      setName("");
      setType("checking");
      setOpening("");
      // A new account starts in the currency the person reports in, but is free to differ:
      // holding money in several currencies is the whole point of this phase.
      setCurrency(baseCurrency);
      setPersonName("");
      setAccountNumber("");
      setTags("");
    }
  }, [editing, open, baseCurrency]);

  const nameCheck = validateAccountName(name, accounts, editing?.id);
  const openingCheck = validateOpeningBalance(opening);
  const needsPerson = type === "other_person_holding";
  const complete =
    nameCheck.name !== null && openingCheck.error === null && (!needsPerson || personName.trim() !== "");

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (nameCheck.name === null) {
        toast.error(nameCheck.error ?? "Tên tài khoản không hợp lệ.");
        return;
      }
      if (openingCheck.cents === null) {
        toast.error(openingCheck.error ?? "Số dư ban đầu không hợp lệ.");
        return;
      }

      const draft: AccountDraft = {
        name: nameCheck.name,
        type,
        openingBalanceCents: openingCheck.cents,
        currency,
        otherPersonName: needsPerson ? personName.trim() : null,
        accountNumber: accountNumber.trim() === "" ? null : accountNumber.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== "")
          .slice(0, 8),
      };

      try {
        if (editing) {
          await editAccount.mutateAsync({ accountId: editing.id, draft });
          toast.success("Đã cập nhật tài khoản.");
        } else {
          await addAccount.mutateAsync(draft);
          toast.success("Đã tạo tài khoản.");
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không lưu được tài khoản.");
      }
    },
    [
      accountNumber,
      addAccount,
      currency,
      editAccount,
      editing,
      nameCheck.error,
      nameCheck.name,
      needsPerson,
      onOpenChange,
      openingCheck.cents,
      openingCheck.error,
      personName,
      tags,
      type,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px]">
        <DialogTitle className="text-[20px] font-semibold tracking-tight">
          {editing ? "Sửa tài khoản" : "Tài khoản mới"}
        </DialogTitle>
        <DialogDescription className="text-[14px] text-muted-foreground">
          {editing
            ? "Sửa số dư ban đầu là một bút toán điều chỉnh — số dư hiện tại sẽ được tính lại."
            : "Mọi giao dịch đều thuộc về một tài khoản."}
        </DialogDescription>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-4">
          <div>
            <FieldLabel htmlFor="acc-name" required>
              Tên tài khoản
            </FieldLabel>
            <input
              id="acc-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ví dụ: Vietcombank, Tiền mặt trong nhà"
              className={cn(inputClass, "mt-1.5")}
            />
            {name.trim() !== "" && nameCheck.error !== null ? (
              <p className="mt-1 text-[12.5px] text-money-out">{nameCheck.error}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="acc-type" required>
                Loại
              </FieldLabel>
              <select
                id="acc-type"
                value={type}
                onChange={(event) => setType(event.target.value as AccountType)}
                className={cn(selectClass, "mt-1.5")}
                style={{ backgroundImage: selectChevron }}
              >
                {ACCOUNT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {ACCOUNT_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="acc-opening">Số dư ban đầu</FieldLabel>
              <input
                id="acc-opening"
                inputMode="decimal"
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
                placeholder="0.00"
                className={cn(inputClass, "tabular mt-1.5", openingCheck.error !== null && "border-money-out")}
              />
              {openingCheck.error !== null ? (
                <p className="mt-1 text-[12.5px] text-money-out">{openingCheck.error}</p>
              ) : (
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {type === "credit_card" || type === "loan"
                    ? "Khoản nợ ghi số âm, ví dụ -1500."
                    : "Số tiền đang có trước khi bắt đầu ghi sổ."}
                </p>
              )}
            </div>
          </div>

          {needsPerson ? (
            <div>
              <FieldLabel htmlFor="acc-person" required>
                Người đang giữ
              </FieldLabel>
              <input
                id="acc-person"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                placeholder="ví dụ: Mẹ, chú Ba"
                className={cn(inputClass, "mt-1.5")}
              />
            </div>
          ) : null}

          {type === "credit_card" ? (
            <div>
              <FieldLabel htmlFor="acc-number">4 số cuối thẻ</FieldLabel>
              <input
                id="acc-number"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="1234"
                className={cn(inputClass, "tabular mt-1.5")}
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="acc-currency">Tiền tệ</FieldLabel>
              <select
                id="acc-currency"
                value={currency}
                disabled={editing !== null}
                onChange={(event) => setCurrency(event.target.value)}
                className={cn(selectClass, "mt-1.5")}
                style={{ backgroundImage: selectChevron }}
              >
                {currenciesByRegion().map((group) => (
                  <optgroup key={group.region} label={REGION_LABELS[group.region]}>
                    {group.currencies.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.code} — {option.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {editing !== null
                  ? "Loại tiền của tài khoản không đổi được: mọi giao dịch trong đó đã ghi theo loại tiền này."
                  : `Tổng cộng sẽ được quy đổi sang ${baseCurrency}.`}
              </p>
            </div>

            <div>
              <FieldLabel htmlFor="acc-tags">Nhãn</FieldLabel>
              <input
                id="acc-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="chi tiêu hằng ngày, khẩn cấp"
                className={cn(inputClass, "mt-1.5")}
              />
              <p className="mt-1 text-[12.5px] text-muted-foreground">Cách nhau bằng dấu phẩy.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={!complete || isWorking}
              className={cn(
                "press inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[14px] font-semibold transition-colors",
                complete && !isWorking
                  ? "bg-primary text-primary-foreground hover:bg-primary/92"
                  : "cursor-not-allowed bg-primary/35 text-primary-foreground",
              )}
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? "Lưu" : "Tạo tài khoản"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- category

const CATEGORY_COLORS: readonly string[] = [
  "#E0603C",
  "#C98A3E",
  "#3F8F6B",
  "#5B7B8A",
  "#8C6A4A",
  "#7D8A4F",
  "#D68A6F",
  "#4E6E7D",
  "#A8926F",
  "#6B635A",
] as const;

export function CategoryDialog({
  open,
  onOpenChange,
  categories,
  editing,
  defaultScope = "expense",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly Category[];
  editing: Category | null;
  defaultScope?: CategoryScope;
}) {
  const { addCategory, editCategory, isWorking } = useFinanceActions();

  const [name, setName] = useState<string>("");
  const [scope, setScope] = useState<CategoryScope>(defaultScope);
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setScope(editing.appliesTo);
      setColor(editing.color);
    } else {
      setName("");
      setScope(defaultScope);
      setColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
    }
  }, [defaultScope, editing, open]);

  const check = validateCategoryName(name, categories, editing?.id);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (check.name === null) {
        toast.error(check.error ?? "Tên hạng mục không hợp lệ.");
        return;
      }
      const draft: CategoryDraft = { name: check.name, appliesTo: scope, color };
      try {
        if (editing) {
          await editCategory.mutateAsync({ categoryId: editing.id, draft });
          toast.success("Đã cập nhật hạng mục.");
        } else {
          await addCategory.mutateAsync(draft);
          toast.success("Đã thêm hạng mục.");
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không lưu được hạng mục.");
      }
    },
    [addCategory, check.error, check.name, color, editCategory, editing, onOpenChange, scope],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="text-[20px] font-semibold tracking-tight">
          {editing ? "Sửa hạng mục" : "Hạng mục mới"}
        </DialogTitle>
        <DialogDescription className="text-[14px] text-muted-foreground">
          Hạng mục riêng của bạn xuất hiện cùng danh sách có sẵn trong mọi biểu mẫu.
        </DialogDescription>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-4">
          <div>
            <FieldLabel htmlFor="cat-name" required>
              Tên hạng mục
            </FieldLabel>
            <input
              id="cat-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ví dụ: Vật tư nông nghiệp"
              className={cn(inputClass, "mt-1.5")}
            />
            {name.trim() !== "" && check.error !== null ? (
              <p className="mt-1 text-[12.5px] text-money-out">{check.error}</p>
            ) : null}
          </div>

          <div>
            <FieldLabel required>Dùng cho</FieldLabel>
            <div className="mt-1.5 inline-flex rounded-md border border-border bg-background p-0.5">
              {(["expense", "income"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={scope === option}
                  disabled={editing !== null}
                  onClick={() => setScope(option)}
                  className={cn(
                    "press rounded-[7px] px-4 py-1.5 text-[13.5px] font-semibold transition-colors disabled:opacity-60",
                    scope === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option === "income" ? "Khoản thu" : "Khoản chi"}
                </button>
              ))}
            </div>
            {editing !== null ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Không đổi được bên của một hạng mục đã có giao dịch.
              </p>
            ) : null}
          </div>

          <div>
            <FieldLabel>Màu trong biểu đồ</FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Màu ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                  className={cn(
                    "press h-7 w-7 rounded-full transition-transform",
                    color === option ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "",
                  )}
                  style={{ backgroundColor: option }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={check.name === null || isWorking}
              className={cn(
                "press inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[14px] font-semibold transition-colors",
                check.name !== null && !isWorking
                  ? "bg-primary text-primary-foreground hover:bg-primary/92"
                  : "cursor-not-allowed bg-primary/35 text-primary-foreground",
              )}
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? "Lưu" : "Thêm hạng mục"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
