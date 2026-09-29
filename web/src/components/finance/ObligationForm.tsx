import { useCallback, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { DateField } from "@/components/calendar/DateField";
import { ContactPicker } from "@/components/finance/ContactPicker";
import { amountForValidation, formatAmountTyping, isWholeCurrency, missingLine } from "@/lib/contact-picker";
import {
  FieldLabel,
  inputClass,
  selectChevron,
  selectClass,
} from "@/components/finance/primitives";
import {
  TRANSACTION_TYPE_LABELS,
  activeAccounts,
  todayIso,
  validateAmount,
  type Account,
  type ObligationType,
} from "@/lib/finance";
import type { ObligationInput } from "@/lib/finance-api";
import type { Contact } from "@/lib/contacts";
import { useFinanceActions } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

/** Borrowing and lending need a person; a tax bill needs a period instead. */
function needsContact(type: ObligationType): boolean {
  return type === "vay" || type === "cho_vay";
}

function isTax(type: ObligationType): boolean {
  return type === "thue_ca_nhan" || type === "thue_kinh_doanh";
}

const HELP: Record<ObligationType, string> = {
  vay: "Bạn nhận tiền bây giờ và sẽ trả lại sau. Số dư tăng lên ngay.",
  cho_vay: "Bạn đưa tiền đi và sẽ nhận lại sau. Số dư giảm ngay.",
  thue_ca_nhan: "Khoản thuế cá nhân phải nộp. Số dư giảm ngay.",
  thue_kinh_doanh: "Khoản thuế của hoạt động kinh doanh. Số dư giảm ngay.",
};

export type ObligationFormProps = {
  type: ObligationType;
  accounts: readonly Account[];
  contacts: readonly Contact[];
  onDone?: () => void;
  onCancel?: () => void;
};

/**
 * Writes one of the four obligations. Deliberately separate from the thu/chi form: the
 * required fields differ by type, and folding them into one form would put four sets of
 * conditional inputs in front of somebody recording a simple expense.
 */
export function ObligationForm({ type, accounts, contacts, onDone, onCancel }: ObligationFormProps) {
  const { addObligation, isWorking } = useFinanceActions();
  const open = useMemo(() => activeAccounts(accounts), [accounts]);
  const today = todayIso();

  const [accountId, setAccountId] = useState<string>(() => (open.length === 1 ? open[0].id : ""));
  const [contactId, setContactId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [touched, setTouched] = useState<boolean>(false);

  const currency = open.find((account) => account.id === accountId)?.currency ?? open[0]?.currency ?? "VND";
  const whole = isWholeCurrency(currency);
  const amountCheck = validateAmount(amountForValidation(amount, currency));
  // D5: an error only after "Ghi" or after leaving a box that was typed in.
  const amountError = touched ? amountCheck.error : null;
  const missing: string[] = [];
  if (amountCheck.error !== null) missing.push("Số tiền");
  if (needsContact(type) && contactId === "") missing.push(type === "vay" ? "Người cho vay" : "Người vay");
  if (accountId === "") missing.push("Tài khoản");
  if (dueDate === "") missing.push("Ngày đến hạn");

  const complete =
    accountId !== "" &&
    dueDate !== "" &&
    amountCheck.error === null &&
    (!needsContact(type) || contactId !== "");

  const handleSubmit = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      setTouched(true);

      const check = validateAmount(amountForValidation(amount, currency));
      if (check.cents === null) return;
      if (accountId === "") {
        toast.error("Hãy chọn tài khoản.");
        return;
      }
      if (dueDate === "") {
        toast.error("Hãy chọn ngày đến hạn.");
        return;
      }
      if (needsContact(type) && contactId === "") {
        toast.error(type === "vay" ? "Hãy chọn người cho bạn vay." : "Hãy chọn người bạn cho vay.");
        return;
      }
      if (isTax(type) && periodStart !== "" && periodEnd !== "" && periodStart > periodEnd) {
        toast.error("Kỳ thuế kết thúc trước khi bắt đầu.");
        return;
      }

      const input: ObligationInput = {
        type,
        accountId,
        amountCents: check.cents,
        dueDate,
        contactId: needsContact(type) ? contactId : null,
        description: description.trim() === "" ? null : description.trim(),
        taxPeriodStart: isTax(type) && periodStart !== "" ? periodStart : null,
        taxPeriodEnd: isTax(type) && periodEnd !== "" ? periodEnd : null,
        businessRelated: type === "thue_kinh_doanh",
      };

      try {
        await addObligation.mutateAsync(input);
        toast.success(`Đã ghi khoản ${TRANSACTION_TYPE_LABELS[type].toLowerCase()}.`);
        setAmount("");
        setDescription("");
        setDueDate("");
        setTouched(false);
        onDone?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không lưu được khoản này.");
      }
    },
    [accountId, addObligation, amount, contactId, currency, description, dueDate, onDone, periodEnd, periodStart, type],
  );

  if (open.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[14px] text-muted-foreground">
        Hãy tạo một tài khoản trước — mọi khoản đều phải thuộc về một tài khoản.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="px-5 py-5">
      <p className="rounded-md border border-border bg-background px-3.5 py-2.5 text-[13px] text-muted-foreground">
        {HELP[type]}
      </p>

      <div className="mt-4">
        <FieldLabel htmlFor="ob-amount" required>
          Số tiền
        </FieldLabel>
        <input
          id="ob-amount"
          inputMode={whole ? "numeric" : "decimal"}
          value={amount}
          onChange={(event) => setAmount(formatAmountTyping(event.target.value, currency))}
          onBlur={() => amount.trim() !== "" && setTouched(true)}
          placeholder={whole ? "0" : "0.00"}
          aria-invalid={amountError !== null}
          className={cn(inputClass, "mt-1.5 tabular text-[16px]", amountError !== null && "border-destructive")}
        />
        {amountError !== null ? (
          <p className="mt-1.5 text-[12.5px] text-destructive">{amountError}</p>
        ) : null}
      </div>

      {needsContact(type) ? (
        <div className="mt-4">
          <FieldLabel htmlFor="ob-contact" required>
            {type === "vay" ? "Vay từ ai" : "Cho ai vay"}
          </FieldLabel>
          <ContactPicker
            id="ob-contact"
            contacts={contacts}
            value={contactId}
            onChange={setContactId}
            placeholder={type === "vay" ? "Chọn người cho bạn vay" : "Chọn người bạn cho vay"}
            invalid={touched && contactId === ""}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <FieldLabel htmlFor="ob-account" required>
          Tài khoản
        </FieldLabel>
        <select
          id="ob-account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
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

      <div className="mt-4">
        <FieldLabel htmlFor="ob-due" required>
          Ngày đến hạn
        </FieldLabel>
        <DateField
          id="ob-due"
          className="mt-1.5"
          value={dueDate}
          onChange={setDueDate}
          label="Ngày đến hạn"
          title="Chọn ngày đến hạn"
          required
          allow="future"
          min={today}
        />
      </div>

      {isTax(type) ? (
        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-foreground">Kỳ thuế</legend>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Khoản thuế này nộp cho giai đoạn nào.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor="ob-period-start">Từ ngày</FieldLabel>
              <DateField
                id="ob-period-start"
                className="mt-1.5"
                value={periodStart}
                onChange={setPeriodStart}
                label="Kỳ thuế từ ngày"
                title="Chọn ngày bắt đầu kỳ thuế"
                allow="any"
                max={periodEnd === "" ? null : periodEnd}
              />
            </div>
            <div>
              <FieldLabel htmlFor="ob-period-end">Đến ngày</FieldLabel>
              <DateField
                id="ob-period-end"
                className="mt-1.5"
                value={periodEnd}
                onChange={setPeriodEnd}
                label="Kỳ thuế đến ngày"
                title="Chọn ngày kết thúc kỳ thuế"
                allow="any"
                min={periodStart === "" ? null : periodStart}
              />
            </div>
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4">
        <FieldLabel htmlFor="ob-note">Diễn giải</FieldLabel>
        <input
          id="ob-note"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ví dụ: vay sửa nhà"
          className={cn(inputClass, "mt-1.5")}
        />
      </div>

      {!complete && missingLine(missing) !== null ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{missingLine(missing)}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={!complete || isWorking}
          className="press rounded-md bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-50"
        >
          {isWorking ? "Đang lưu…" : `Ghi khoản ${TRANSACTION_TYPE_LABELS[type].toLowerCase()}`}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="press rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/35"
          >
            Huỷ
          </button>
        ) : null}
      </div>
    </form>
  );
}
