import type { Database } from "@/integrations/supabase/types";
import { convertCents, minorUnitsOf, type RateTable } from "@/lib/currency";

/**
 * Phase 4A finance domain. Everything here is pure: no Supabase, no React.
 *
 * Money is carried as integer cents, never as a float. `0.1 + 0.2` is not `0.3`, and a
 * ledger that cannot add up its own rows is worthless — so amounts are converted once on
 * the way in and formatted once on the way out.
 */

export type AccountType = Database["public"]["Enums"]["account_type"];
export type CategoryOrigin = Database["public"]["Enums"]["category_origin"];
export type CategoryScope = Database["public"]["Enums"]["category_scope"];
export type TransactionType = Database["public"]["Enums"]["transaction_type"];
export type RecurringFrequency = Database["public"]["Enums"]["recurring_frequency"];

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  /** What the account held before the ledger began. */
  openingBalanceCents: number;
  /** Derived by the database from the ledger; never written by the client. */
  balanceCents: number;
  currency: string;
  otherPersonName: string | null;
  accountNumber: string | null;
  tags: string[];
  createdAt: string;
  deletedAt: string | null;
};

export type Category = {
  id: string;
  name: string;
  origin: CategoryOrigin;
  appliesTo: CategoryScope;
  color: string;
  /** Stable English key on the seeded set; null on anything the user made. */
  slug: string | null;
  sortOrder: number;
  deletedAt: string | null;
};

/** The two types that record money that has already moved. */
export type MovementType = "income" | "expense";

/** The four types that record an obligation rather than a completed movement of money. */
export type ObligationType = "vay" | "cho_vay" | "thue_ca_nhan" | "thue_kinh_doanh";

export type ObligationStatus =
  | "ke_hoach"
  | "den_han"
  | "hoan_thanh_mot_phan"
  | "hoan_thanh"
  | "qua_han";

export const OBLIGATION_TYPES: readonly ObligationType[] = [
  "vay",
  "cho_vay",
  "thue_ca_nhan",
  "thue_kinh_doanh",
] as const;

export function isObligationType(type: TransactionType): type is ObligationType {
  return type !== "income" && type !== "expense";
}

const OBLIGATION_STATUSES: readonly string[] = [
  "ke_hoach",
  "den_han",
  "hoan_thanh_mot_phan",
  "hoan_thanh",
  "qua_han",
] as const;

/** `status` is plain text in the database, so it is checked rather than trusted. */
export function isObligationStatus(value: string): value is ObligationStatus {
  return OBLIGATION_STATUSES.includes(value);
}

export type Transaction = {
  id: string;
  accountId: string;
  /** Null on the four obligation types: an obligation is not a spending category. */
  categoryId: string | null;
  type: TransactionType;
  amountCents: number;
  /** The currency the entry was recorded in, taken from its account and never editable. */
  currency: string;
  /**
   * The same amount in the owner's base currency, and the base it was computed against.
   * The base is carried alongside on purpose: a cached conversion without its key is
   * undetectably stale the moment someone changes base currency.
   */
  amountInBaseCents: number | null;
  baseCurrency: string | null;
  conversionRate: number | null;
  description: string | null;
  date: string;
  businessRelated: boolean;
  businessPurpose: string | null;
  receiptPath: string | null;
  isRecurring: boolean;
  recurringFrequency: RecurringFrequency | null;
  recurringLabel: string | null;
  /** Who the obligation is with. Null on income, expense and tax. */
  contactId: string | null;
  /** When it must be settled. Null on income and expense, which have already happened. */
  dueDate: string | null;
  status: ObligationStatus;
  /** Paid so far. The original `amountCents` is never rewritten by a payment. */
  settledCents: number;
  taxPeriodStart: string | null;
  taxPeriodEnd: string | null;
  createdAt: string;
  deletedAt: string | null;
};

/**
 * A transaction with its account and category resolved — what every report reads.
 *
 * `category` is null on the four obligation types. An obligation is a balance-sheet item,
 * not a line of spending: filing a loan under "Ăn uống" would make it read as money eaten.
 */
export type LedgerEntry = Transaction & {
  account: Account;
  category: Category | null;
};

/** What to call an entry that may have no category — obligations answer with their type. */
export function entryCategoryName(entry: LedgerEntry): string {
  return entry.category?.name ?? TRANSACTION_TYPE_LABELS[entry.type];
}

/** Colour for an entry's spine; obligations borrow the neutral ink of the theme. */
export function entryColor(entry: LedgerEntry): string {
  return entry.category?.color ?? OBLIGATION_COLOR;
}

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "checking",
  "savings",
  "credit_card",
  "cash",
  "loan",
  "crypto",
  "investment",
  "other",
  "other_person_holding",
] as const;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Tài khoản thanh toán",
  savings: "Tiết kiệm",
  credit_card: "Thẻ tín dụng",
  cash: "Tiền mặt",
  loan: "Khoản vay",
  crypto: "Tiền mã hoá",
  investment: "Đầu tư",
  other: "Khác",
  other_person_holding: "Người khác giữ",
};

/**
 * Accounts that represent money owed rather than money held. Their balance runs negative,
 * so net worth is simply the sum of every balance and never needs a special case.
 */
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["credit_card", "loan"]);

export function isLiabilityAccount(type: AccountType): boolean {
  return LIABILITY_TYPES.has(type);
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Thu",
  expense: "Chi",
  vay: "Vay",
  cho_vay: "Cho vay",
  thue_ca_nhan: "Thuế cá nhân",
  thue_kinh_doanh: "Thuế kinh doanh",
};

/** One muted brass note for every obligation, so they read as a family, not as a category. */
export const OBLIGATION_COLOR = "#8A6D3B";

export const OBLIGATION_STATUS_LABELS: Record<ObligationStatus, string> = {
  ke_hoach: "Kế hoạch",
  den_han: "Đến hạn",
  hoan_thanh_mot_phan: "Trả một phần",
  hoan_thanh: "Xong",
  qua_han: "Quá hạn",
};

/** Which way each type moves an account: borrowing brings money in, the rest send it out. */
export const TRANSACTION_DIRECTION: Record<TransactionType, 1 | -1> = {
  income: 1,
  vay: 1,
  expense: -1,
  cho_vay: -1,
  thue_ca_nhan: -1,
  thue_kinh_doanh: -1,
};

export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Hằng tuần",
  monthly: "Hằng tháng",
  yearly: "Hằng năm",
};

/** Category slugs that count as generosity in the Giving report and the gauge. */
export const GIVING_SLUGS: readonly string[] = ["tithe", "giving"] as const;

export const DESCRIPTION_MAX_LEN = 500;
export const BUSINESS_PURPOSE_MAX_LEN = 300;
export const ACCOUNT_NAME_MAX_LEN = 120;
export const CATEGORY_NAME_MAX_LEN = 80;

// ---------------------------------------------------------------- money

/** Largest amount the `numeric(14,2)` columns can hold, in cents. */
export const MAX_AMOUNT_CENTS = 999_999_999_999_99;

/** Postgres hands numerics back as JS numbers or strings; both become exact cents here. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Cents back to the decimal string Postgres expects — never a float. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Signed contribution of one entry to its account. Mirrors `private.transaction_signed_amount`
 * in the database exactly — if the two ever disagree, the balance on screen stops matching the
 * balance in the ledger.
 */
export function signedCents(entry: Pick<Transaction, "type" | "amountCents">): number {
  return TRANSACTION_DIRECTION[entry.type] * entry.amountCents;
}

export type MoneyFormatOptions = {
  /** Show `+` in front of a positive amount. Off by default. */
  signed?: boolean;
};

/**
 * Currencies with no minor unit (VND, JPY, KRW) read in Vietnamese grouping and carry no
 * decimals; everything else follows the en-US convention the amounts were entered in. The
 * subunit count comes from the catalogue rather than being guessed here.
 */
export function formatMoney(cents: number, currency: string = "USD", options: MoneyFormatOptions = {}): string {
  const code = currency.toUpperCase();
  const zeroDecimal = minorUnitsOf(code) === 0;
  const value = zeroDecimal ? Math.round(cents / 100) : cents / 100;
  const formatter = new Intl.NumberFormat(zeroDecimal ? "vi-VN" : "en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  });
  const text = formatter.format(Math.abs(value));
  if (cents < 0) return `−${text}`;
  if (options.signed && cents > 0) return `+${text}`;
  return text;
}

/** Bare number for spreadsheets: no symbol, no grouping, always two decimals. */
export function centsToExportNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatPercent(ratio: number, digits: number = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

// ---------------------------------------------------------------- dates

/** Local calendar day as `YYYY-MM-DD`. A ledger day must read the same at 08:00 and 23:00. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM` bucket of a calendar day. */
export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function startOfMonth(monthIso: string): string {
  return `${monthIso}-01`;
}

export function endOfMonth(monthIso: string): string {
  const [year, month] = monthIso.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${monthIso}-${String(last).padStart(2, "0")}`;
}

export function addMonths(monthIso: string, delta: number): string {
  const [year, month] = monthIso.split("-").map(Number);
  const base = new Date(year, month - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

/** The `count` months ending at `endMonth`, oldest first. */
export function monthRange(endMonth: string, count: number): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) months.push(addMonths(endMonth, -i));
  return months;
}

const MONTH_LABELS = ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"];

export function formatMonthShort(monthIso: string): string {
  const month = Number(monthIso.slice(5, 7));
  return MONTH_LABELS[month - 1] ?? monthIso;
}

export function formatMonthLong(monthIso: string): string {
  return `Tháng ${Number(monthIso.slice(5, 7))}/${monthIso.slice(0, 4)}`;
}

/** `2026-09-07` → `07/09/2026`, the way a Vietnamese ledger is read. */
export function formatDayVi(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  return `${day}/${month}/${year}`;
}

export function isWithinRange(dateIso: string, from: string, to: string): boolean {
  return dateIso >= from && dateIso <= to;
}

export function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const base = new Date(year, month - 1, day + days);
  return todayIso(base);
}

/** When a recurring pattern is next expected after `dateIso`. */
export function nextRecurrence(dateIso: string, frequency: RecurringFrequency): string {
  if (frequency === "weekly") return addDaysIso(dateIso, 7);
  const [year, month, day] = dateIso.split("-").map(Number);
  const target = frequency === "monthly" ? new Date(year, month, day) : new Date(year + 1, month - 1, day);
  // A 31st that lands in a short month rolls forward; clamp it back to that month's last day.
  if (frequency === "monthly" && target.getDate() !== day) target.setDate(0);
  return todayIso(target);
}

// ---------------------------------------------------------------- validation

export type AmountValidation = { cents: number | null; error: string | null };

/**
 * Accepts what people actually type: `1,234.56`, `1234`, ` 12.5 `. Rejects anything that
 * is not a positive number with at most two decimals, because a third decimal would be
 * silently rounded by the database and the row would not say what the person entered.
 */
export function validateAmount(raw: string): AmountValidation {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed.length === 0) return { cents: null, error: "Số tiền là bắt buộc." };
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") {
    return { cents: null, error: "Số tiền chỉ gồm chữ số, ví dụ 1250.50." };
  }
  const decimals = trimmed.split(".")[1] ?? "";
  if (decimals.length > 2) return { cents: null, error: "Số tiền tối đa 2 chữ số thập phân." };
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return { cents: null, error: "Số tiền không hợp lệ." };
  const cents = Math.round(value * 100);
  if (cents <= 0) return { cents: null, error: "Số tiền phải lớn hơn 0." };
  if (cents > MAX_AMOUNT_CENTS) return { cents: null, error: "Số tiền quá lớn." };
  return { cents, error: null };
}

/** Signed amount for an opening balance: a credit card or loan legitimately starts negative. */
export function validateOpeningBalance(raw: string): AmountValidation {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed.length === 0) return { cents: 0, error: null };
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const parsed = validateAmount(body === "" ? "0" : body);
  if (body === "0" || body === "0.00") return { cents: 0, error: null };
  if (parsed.error !== null || parsed.cents === null) {
    return { cents: null, error: parsed.error ?? "Số dư không hợp lệ." };
  }
  return { cents: negative ? -parsed.cents : parsed.cents, error: null };
}

export function validateTransactionDate(raw: string, today: string = todayIso()): { date: string | null; error: string | null } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: null, error: "Ngày giao dịch là bắt buộc." };
  if (raw > today) return { date: null, error: "Ngày giao dịch không thể ở tương lai." };
  return { date: raw, error: null };
}

export function validateAccountName(raw: string, existing: readonly Account[], editingId?: string): { name: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { name: null, error: "Tên tài khoản là bắt buộc." };
  if (trimmed.length > ACCOUNT_NAME_MAX_LEN) {
    return { name: null, error: `Tên tài khoản quá dài (tối đa ${ACCOUNT_NAME_MAX_LEN} ký tự).` };
  }
  const clash = existing.some(
    (account) =>
      account.id !== editingId &&
      account.deletedAt === null &&
      account.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return { name: null, error: "Bạn đã có một tài khoản trùng tên." };
  return { name: trimmed, error: null };
}

export function validateCategoryName(raw: string, existing: readonly Category[], editingId?: string): { name: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { name: null, error: "Tên danh mục là bắt buộc." };
  if (trimmed.length > CATEGORY_NAME_MAX_LEN) {
    return { name: null, error: `Tên danh mục quá dài (tối đa ${CATEGORY_NAME_MAX_LEN} ký tự).` };
  }
  const clash = existing.some(
    (category) =>
      category.id !== editingId &&
      category.deletedAt === null &&
      category.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return { name: null, error: "Danh mục này đã có rồi." };
  return { name: trimmed, error: null };
}

export type TransactionDraft = {
  /** Thu/chi only — obligations are written through their own form. */
  type: MovementType;
  accountId: string;
  categoryId: string;
  date: string;
  amount: string;
  description: string;
  businessRelated: boolean;
  businessPurpose: string;
  isRecurring: boolean;
  recurringFrequency: RecurringFrequency;
  recurringLabel: string;
  receiptPath: string | null;
};

export function emptyTransactionDraft(today: string = todayIso()): TransactionDraft {
  return {
    type: "expense",
    accountId: "",
    categoryId: "",
    date: today,
    amount: "",
    description: "",
    businessRelated: false,
    businessPurpose: "",
    isRecurring: false,
    recurringFrequency: "monthly",
    recurringLabel: "",
    receiptPath: null,
  };
}

/** True once every required field carries something — what un-dims the submit button. */
export function isTransactionDraftComplete(draft: TransactionDraft): boolean {
  return (
    draft.accountId !== "" &&
    draft.categoryId !== "" &&
    draft.date !== "" &&
    validateAmount(draft.amount).error === null
  );
}

export type DraftValidation = { field: keyof TransactionDraft | null; error: string | null };

export function validateTransactionDraft(draft: TransactionDraft, today: string = todayIso()): DraftValidation {
  if (draft.accountId === "") return { field: "accountId", error: "Hãy chọn tài khoản." };
  if (draft.categoryId === "") return { field: "categoryId", error: "Hãy chọn danh mục." };
  const date = validateTransactionDate(draft.date, today);
  if (date.error !== null) return { field: "date", error: date.error };
  const amount = validateAmount(draft.amount);
  if (amount.error !== null) return { field: "amount", error: amount.error };
  if (draft.description.trim().length > DESCRIPTION_MAX_LEN) {
    return { field: "description", error: `Diễn giải quá dài (tối đa ${DESCRIPTION_MAX_LEN} ký tự).` };
  }
  if (draft.businessRelated && draft.businessPurpose.trim().length > BUSINESS_PURPOSE_MAX_LEN) {
    return { field: "businessPurpose", error: `Mục đích quá dài (tối đa ${BUSINESS_PURPOSE_MAX_LEN} ký tự).` };
  }
  return { field: null, error: null };
}

// ---------------------------------------------------------------- selectors

export function activeAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.deletedAt === null);
}

export function activeCategories(categories: readonly Category[]): Category[] {
  return categories.filter((category) => category.deletedAt === null);
}

/** The list the form shows once a type is picked — seeded and custom mixed, in one order. */
export function categoriesFor(categories: readonly Category[], scope: CategoryScope): Category[] {
  return activeCategories(categories)
    .filter((category) => category.appliesTo === scope)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

/** Joins transactions to their account and category, dropping any row whose refs are missing. */
export function buildLedger(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  categories: readonly Category[],
): LedgerEntry[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const entries: LedgerEntry[] = [];
  for (const transaction of transactions) {
    const account = accountById.get(transaction.accountId);
    if (!account) continue;
    // An obligation carries no category by design, so a missing one is only a broken
    // reference for income and expense — those are still dropped rather than half-shown.
    if (transaction.categoryId === null) {
      if (!isObligationType(transaction.type)) continue;
      entries.push({ ...transaction, account, category: null });
      continue;
    }
    const category = categoryById.get(transaction.categoryId);
    if (!category) continue;
    entries.push({ ...transaction, account, category });
  }
  return entries;
}

/** The obligations — what the Vay/Cho vay/Thuế views read. */
export function obligationEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.filter((entry) => isObligationType(entry.type));
}

/**
 * Income and expense only. Every report and every total reads through this: an obligation
 * is money promised, not money earned or spent, and letting one into a P&L would overstate
 * both sides of it.
 */
export function movementEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.filter((entry) => !isObligationType(entry.type));
}

/** Still owed on an obligation, in cents. */
export function outstandingCents(entry: Pick<Transaction, "amountCents" | "settledCents">): number {
  return Math.max(0, entry.amountCents - entry.settledCents);
}

/**
 * The status an obligation actually has today. Mirrors `private.obligation_status`: the
 * database recomputes on write, but a row that simply sat there overnight becomes overdue
 * without anybody writing to it, so the screen derives it again on read.
 */
export function obligationStatusOf(
  entry: Pick<Transaction, "amountCents" | "settledCents" | "dueDate">,
  today: string = todayIso(),
): ObligationStatus {
  if (entry.settledCents >= entry.amountCents) return "hoan_thanh";
  if (entry.dueDate !== null && entry.dueDate < today) return "qua_han";
  if (entry.settledCents > 0) return "hoan_thanh_mot_phan";
  if (entry.dueDate !== null && entry.dueDate === today) return "den_han";
  return "ke_hoach";
}

/** Live rows only: a transaction marked as an error must not move a single total. */
export function postedEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.filter((entry) => entry.deletedAt === null);
}

export function entriesInRange(entries: readonly LedgerEntry[], from: string, to: string): LedgerEntry[] {
  return entries.filter((entry) => isWithinRange(entry.date, from, to));
}

/** Newest first, and within one day the most recently entered first. */
export function sortEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

export type DayGroup = { date: string; entries: LedgerEntry[]; netCents: number };

export function groupByDay(entries: readonly LedgerEntry[]): DayGroup[] {
  const byDay = new Map<string, LedgerEntry[]>();
  for (const entry of sortEntries(entries)) {
    const bucket = byDay.get(entry.date);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.date, [entry]);
  }
  return [...byDay.entries()].map(([date, group]) => ({
    date,
    entries: group,
    netCents: sumCents(group.map(signedCents)),
  }));
}

/** Matches description, category name, business purpose and recurring label. */
export function searchEntries(entries: readonly LedgerEntry[], query: string): LedgerEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter((entry) => {
    const haystack = [
      entry.description ?? "",
      entryCategoryName(entry),
      entry.businessPurpose ?? "",
      entry.recurringLabel ?? "",
      entry.account.name,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

// ---------------------------------------------------------------- balances

/**
 * What an account held at the close of `dateIso`, rebuilt from the ledger.
 * Used by the balance chart and by net worth, which both need a balance "as of" a past day.
 */
export function balanceAt(account: Account, entries: readonly LedgerEntry[], dateIso: string): number {
  const delta = sumCents(
    entries.filter((entry) => entry.accountId === account.id && entry.date <= dateIso).map(signedCents),
  );
  return account.openingBalanceCents + delta;
}

export type NetWorth = {
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
};

/** Liabilities are reported as a positive amount owed; net worth is assets minus that. */
export function netWorthAt(accounts: readonly Account[], entries: readonly LedgerEntry[], dateIso: string): NetWorth {
  let assets = 0;
  let liabilities = 0;
  for (const account of activeAccounts(accounts)) {
    const balance = balanceAt(account, entries, dateIso);
    if (isLiabilityAccount(account.type)) liabilities += -balance;
    else assets += balance;
  }
  return { assetsCents: assets, liabilitiesCents: liabilities, netCents: assets - liabilities };
}

// ---------------------------------------------------------------- currency

/**
 * Restates one account's balance in the base currency, or null when no rate bridges the pair.
 * Null rather than 0: a balance that cannot be valued must read as unknown, never as empty —
 * a missing rate should not quietly shrink someone's net worth.
 */
export function balanceInBase(
  account: Account,
  entries: readonly LedgerEntry[],
  dateIso: string,
  base: string,
  rates: RateTable,
): number | null {
  const native = balanceAt(account, entries, dateIso);
  return convertCents(native, account.currency, base, rates);
}

/**
 * Net worth across accounts in several currencies, everything restated in the base.
 *
 * `unvalued` names the accounts that could not be converted, so the screen can say so rather
 * than present a total that silently omits them.
 */
export function netWorthInBase(
  accounts: readonly Account[],
  entries: readonly LedgerEntry[],
  dateIso: string,
  base: string,
  rates: RateTable,
): NetWorth & { unvalued: Account[] } {
  let assets = 0;
  let liabilities = 0;
  const unvalued: Account[] = [];
  for (const account of activeAccounts(accounts)) {
    const balance = balanceInBase(account, entries, dateIso, base, rates);
    if (balance === null) {
      unvalued.push(account);
      continue;
    }
    if (isLiabilityAccount(account.type)) liabilities += -balance;
    else assets += balance;
  }
  return { assetsCents: assets, liabilitiesCents: liabilities, netCents: assets - liabilities, unvalued };
}

/**
 * Restates a whole ledger in the base currency, so every downstream report — all eight of
 * them, plus every chart — keeps working on plain comparable numbers instead of each one
 * having to learn about exchange rates.
 *
 * The database's own `amount_in_base_currency` is preferred when it was computed against this
 * same base; otherwise the rate table is used. That is exactly why the base is stored beside
 * the cached figure: it makes a stale cache detectable rather than silently wrong.
 */
export function toBaseLedger(
  entries: readonly LedgerEntry[],
  base: string,
  rates: RateTable,
): LedgerEntry[] {
  const code = base.trim().toUpperCase();
  const converted: LedgerEntry[] = [];
  for (const entry of entries) {
    if (entry.currency.toUpperCase() === code) {
      converted.push(entry);
      continue;
    }
    const cached =
      entry.baseCurrency !== null && entry.baseCurrency.toUpperCase() === code
        ? entry.amountInBaseCents
        : null;
    const amount = cached ?? convertCents(entry.amountCents, entry.currency, code, rates);
    if (amount === null) continue;
    converted.push({ ...entry, amountCents: amount, currency: code });
  }
  return converted;
}

/** Entries whose currency cannot be expressed in the base, so a report can disclose them. */
export function unconvertibleEntries(
  entries: readonly LedgerEntry[],
  base: string,
  rates: RateTable,
): LedgerEntry[] {
  const code = base.trim().toUpperCase();
  return entries.filter((entry) => {
    if (entry.currency.toUpperCase() === code) return false;
    if (
      entry.baseCurrency !== null &&
      entry.baseCurrency.toUpperCase() === code &&
      entry.amountInBaseCents !== null
    )
      return false;
    return convertCents(entry.amountCents, entry.currency, code, rates) === null;
  });
}

/** The distinct currencies actually in use, base first — what the multi-currency view lists. */
export function currenciesInUse(accounts: readonly Account[], base: string): string[] {
  const code = base.trim().toUpperCase();
  const seen = new Set<string>();
  for (const account of activeAccounts(accounts)) seen.add(account.currency.toUpperCase());
  return [code, ...[...seen].filter((entry) => entry !== code).sort()];
}

export type PeriodTotals = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  businessIncomeCents: number;
  businessExpenseCents: number;
  personalExpenseCents: number;
  grossProfitCents: number;
  givingCents: number;
};

/**
 * Income and expense totals for a period.
 *
 * Obligations are excluded on purpose. Borrowing is not income and repaying is not an
 * expense — counting either would inflate a P&L with money that was only promised. They
 * still move account balances; they just never appear in what was earned or spent.
 */
export function totalsFor(entries: readonly LedgerEntry[]): PeriodTotals {
  let income = 0;
  let expense = 0;
  let businessIncome = 0;
  let businessExpense = 0;
  let giving = 0;

  for (const entry of entries) {
    if (isObligationType(entry.type)) continue;
    if (entry.type === "income") {
      income += entry.amountCents;
      if (entry.businessRelated) businessIncome += entry.amountCents;
    } else {
      expense += entry.amountCents;
      if (entry.businessRelated) businessExpense += entry.amountCents;
      if (entry.category !== null && entry.category.slug !== null && GIVING_SLUGS.includes(entry.category.slug)) {
        giving += entry.amountCents;
      }
    }
  }

  return {
    incomeCents: income,
    expenseCents: expense,
    netCents: income - expense,
    businessIncomeCents: businessIncome,
    businessExpenseCents: businessExpense,
    personalExpenseCents: expense - businessExpense,
    grossProfitCents: businessIncome - businessExpense,
    givingCents: giving,
  };
}

/** A ledger counts as a household business the moment one row is flagged. */
export function hasBusinessActivity(entries: readonly LedgerEntry[]): boolean {
  return entries.some((entry) => entry.businessRelated);
}

export type ObligationTotals = {
  /** Still owed to other people — borrowings and taxes not yet settled. */
  owedCents: number;
  /** Still owed to this person by others. */
  dueToYouCents: number;
  overdueCount: number;
  dueSoonCount: number;
};

/** The obligation picture as of `today`, for the summary strip above the list. */
export function obligationTotals(
  entries: readonly LedgerEntry[],
  today: string = todayIso(),
): ObligationTotals {
  let owed = 0;
  let dueToYou = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const entry of entries) {
    if (!isObligationType(entry.type)) continue;
    const status = obligationStatusOf(entry, today);
    if (status === "hoan_thanh") continue;
    const left = outstandingCents(entry);
    if (entry.type === "cho_vay") dueToYou += left;
    else owed += left;
    if (status === "qua_han") overdue += 1;
    else if (status === "den_han") dueSoon += 1;
  }

  return { owedCents: owed, dueToYouCents: dueToYou, overdueCount: overdue, dueSoonCount: dueSoon };
}

// ---------------------------------------------------------------- what is due

/**
 * The least an obligation must expose to be placed on a calendar.
 *
 * Structural on purpose: the sidebar badge reads raw transactions while the finance screens
 * read a built ledger, and both must count the same thing. `deletedAt` is part of the shape
 * rather than the caller's job, so no screen can forget to drop a row marked as an error.
 */
export type DatedObligation = Pick<
  Transaction,
  "type" | "amountCents" | "settledCents" | "dueDate" | "deletedAt"
>;

/**
 * The three buckets of pressing money, as a partition rather than three statistics.
 *
 * Overdue stands apart from due-today for the same reason it does in Nhiệm vụ: a thing that
 * is already late is a different kind of fact from a thing that is due, and folding them into
 * one number lets the late one hide inside it. The buckets never overlap, so the three always
 * add up to `total` and no obligation can be counted twice.
 */
export type ObligationWindow = "qua_han" | "hom_nay" | "tuan_nay";

export const OBLIGATION_WINDOWS: readonly ObligationWindow[] = ["qua_han", "hom_nay", "tuan_nay"] as const;

export const OBLIGATION_WINDOW_LABELS: Record<ObligationWindow, string> = {
  qua_han: "Quá hạn",
  hom_nay: "Hôm nay",
  tuan_nay: "7 ngày tới",
};

export function isObligationWindow(value: string): value is ObligationWindow {
  return (OBLIGATION_WINDOWS as readonly string[]).includes(value);
}

/** How far ahead "sắp tới" looks. A week is what a person can still act on. */
export const DUE_SOON_DAYS = 7;

/**
 * Which bucket an obligation falls in today, or null when it is not pressing.
 *
 * A part-paid obligation still counts: the remainder has the same due date as the whole did.
 * An obligation with no due date is never pressing — nothing was promised about when.
 */
export function obligationWindowOf(entry: DatedObligation, today: string = todayIso()): ObligationWindow | null {
  if (entry.deletedAt !== null) return null;
  if (!isObligationType(entry.type)) return null;
  if (entry.dueDate === null) return null;
  if (outstandingCents(entry) === 0) return null;
  if (entry.dueDate < today) return "qua_han";
  if (entry.dueDate === today) return "hom_nay";
  if (entry.dueDate <= addDaysIso(today, DUE_SOON_DAYS)) return "tuan_nay";
  return null;
}

/** The obligations behind one number, for the list the number links to. */
export function obligationsDueIn<T extends DatedObligation>(
  entries: readonly T[],
  window: ObligationWindow,
  today: string = todayIso(),
): T[] {
  return entries.filter((entry) => obligationWindowOf(entry, today) === window);
}

export type ObligationAttention = {
  overdue: number;
  today: number;
  week: number;
  /** The three above, added up — what a badge carries. */
  total: number;
};

/** How much is asking to be paid or collected right now. */
export function obligationAttention(
  entries: readonly DatedObligation[],
  today: string = todayIso(),
): ObligationAttention {
  const attention: ObligationAttention = { overdue: 0, today: 0, week: 0, total: 0 };
  for (const entry of entries) {
    const window = obligationWindowOf(entry, today);
    if (window === null) continue;
    if (window === "qua_han") attention.overdue += 1;
    else if (window === "hom_nay") attention.today += 1;
    else attention.week += 1;
    attention.total += 1;
  }
  return attention;
}

/** Whether this ledger uses obligations at all — what decides if the due strip belongs on screen. */
export function hasOpenObligations(entries: readonly DatedObligation[]): boolean {
  return entries.some(
    (entry) => entry.deletedAt === null && isObligationType(entry.type) && outstandingCents(entry) > 0,
  );
}

/**
 * What borrowing and lending add to a balance sheet, beyond what the accounts already say.
 *
 * Only the two that leave something outstanding after the cash has moved:
 *
 * - `cho_vay` took money out of an account and put it in someone else's hands. The account
 *   is already lighter, so the amount still to come back is an asset nothing else records.
 * - `vay` put money into an account. The account is already heavier, so the amount still to
 *   repay is a debt nothing else records.
 *
 * Tax is deliberately absent. A tax bill lowers the account balance the day it is written —
 * the money is treated as gone — so counting the unsettled remainder again would subtract the
 * same money twice and quietly understate someone's worth.
 *
 * Obligations booked against a liability account are skipped for the same reason: that
 * account's own balance already carries the debt, and net worth must not count it twice.
 */
export type ObligationPosition = {
  receivableCents: number;
  payableCents: number;
};

export function obligationPosition(entries: readonly LedgerEntry[]): ObligationPosition {
  let receivable = 0;
  let payable = 0;
  for (const entry of entries) {
    if (entry.deletedAt !== null) continue;
    if (entry.type !== "vay" && entry.type !== "cho_vay") continue;
    if (isLiabilityAccount(entry.account.type)) continue;
    const left = outstandingCents(entry);
    if (left === 0) continue;
    if (entry.type === "cho_vay") receivable += left;
    else payable += left;
  }
  return { receivableCents: receivable, payableCents: payable };
}

/**
 * Net worth with what is owed each way folded in. Left as a separate step so the
 * account-based figure stays exactly what it was and can still be read on its own.
 */
export function withObligationPosition<T extends NetWorth>(net: T, position: ObligationPosition): T {
  const assets = net.assetsCents + position.receivableCents;
  const liabilities = net.liabilitiesCents + position.payableCents;
  return { ...net, assetsCents: assets, liabilitiesCents: liabilities, netCents: assets - liabilities };
}

export type GivingBand = "low" | "fair" | "generous" | "none";

/** Red under 5%, yellow through 10%, green above it. */
export function givingBand(ratio: number | null): GivingBand {
  if (ratio === null || !Number.isFinite(ratio)) return "none";
  if (ratio < 0.05) return "low";
  if (ratio <= 0.1) return "fair";
  return "generous";
}

export const GIVING_BAND_COLORS: Record<GivingBand, string> = {
  low: "#C0492A",
  fair: "#C98A3E",
  generous: "#3F8F6B",
  none: "#CCCCCC",
};

export const GIVING_BAND_LABELS: Record<GivingBand, string> = {
  low: "Dưới 5% thu nhập",
  fair: "5–10% thu nhập",
  generous: "Trên 10% thu nhập",
  none: "Chưa có thu nhập để so sánh",
};

/** Giving over income. Null when there is no income, because 0/0 is not "0%". */
export function givingRatio(totals: PeriodTotals): number | null {
  if (totals.incomeCents <= 0) return null;
  return totals.givingCents / totals.incomeCents;
}

// ---------------------------------------------------------------- recurring

export type RecurringSuggestion = {
  key: string;
  sourceId: string;
  label: string;
  amountCents: number;
  type: TransactionType;
  accountId: string;
  categoryId: string;
  businessRelated: boolean;
  businessPurpose: string | null;
  frequency: RecurringFrequency;
  dueDate: string;
};

/**
 * Recurring entries are a memory aid, never an auto-charge: AVORA notices the day has come
 * and offers to add it. Nothing is written until the person says so.
 */
export function recurringSuggestions(
  entries: readonly LedgerEntry[],
  today: string = todayIso(),
  dismissed: ReadonlySet<string> = new Set(),
): RecurringSuggestion[] {
  const latestByPattern = new Map<string, LedgerEntry>();

  for (const entry of entries) {
    if (!entry.isRecurring || entry.recurringFrequency === null) continue;
    const patternKey = `${entry.accountId}|${entry.categoryId}|${entry.type}|${entry.recurringLabel ?? entry.description ?? ""}`;
    const known = latestByPattern.get(patternKey);
    if (!known || entry.date > known.date) latestByPattern.set(patternKey, entry);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const [patternKey, entry] of latestByPattern) {
    const frequency = entry.recurringFrequency;
    if (frequency === null) continue;
    const dueDate = nextRecurrence(entry.date, frequency);
    if (dueDate > today) continue;
    const key = `${patternKey}|${dueDate}`;
    if (dismissed.has(key)) continue;
    suggestions.push({
      key,
      sourceId: entry.id,
      label: entry.recurringLabel ?? entry.description ?? entryCategoryName(entry),
      amountCents: entry.amountCents,
      type: entry.type,
      accountId: entry.accountId,
      categoryId: entry.categoryId,
      businessRelated: entry.businessRelated,
      businessPurpose: entry.businessPurpose,
      frequency,
      dueDate,
    });
  }

  return suggestions.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label, "vi"));
}
