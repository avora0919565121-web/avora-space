import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  activeAccounts,
  addDaysIso,
  addMonths,
  balanceAt,
  canSuggestReminder,
  reminderTitle,
  buildLedger,
  categoriesFor,
  centsToDecimalString,
  centsToExportNumber,
  emptyTransactionDraft,
  endOfMonth,
  entriesInRange,
  formatDayVi,
  formatMoney,
  givingBand,
  givingRatio,
  groupByDay,
  hasBusinessActivity,
  isLiabilityAccount,
  isTransactionDraftComplete,
  monthKey,
  monthRange,
  netWorthAt,
  nextRecurrence,
  postedEntries,
  recurringSuggestions,
  searchEntries,
  signedCents,
  sortEntries,
  startOfMonth,
  sumCents,
  toCents,
  todayIso,
  totalsFor,
  validateAccountName,
  validateAmount,
  validateCategoryName,
  validateOpeningBalance,
  validateTransactionDate,
  validateTransactionDraft,
  entryCategoryName,
  isObligationType,
  hasOpenObligations,
  movementEntries,
  netWorthInBase,
  obligationAttention,
  obligationEntries,
  obligationPosition,
  obligationStatusOf,
  obligationTotals,
  obligationWindowOf,
  obligationsDueIn,
  outstandingCents,
  withObligationPosition,
  type Account,
  type Category,
  type LedgerEntry,
  type Transaction,
} from "@/lib/finance";
import { buildReport, monthlyComparison, reportFileBase, spendingTrend } from "@/lib/finance-reports";
import { reportToCsv } from "@/lib/finance-export";

// ---------------------------------------------------------------- fixtures

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Checking",
    type: "checking",
    openingBalanceCents: 500_000,
    balanceCents: 500_000,
    currency: "USD",
    otherPersonName: null,
    accountNumber: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-groceries",
    name: "Tạp hoá",
    origin: "predefined",
    appliesTo: "expense",
    color: "#E0603C",
    slug: "groceries",
    sortOrder: 10,
    deletedAt: null,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    accountId: "acc-1",
    categoryId: "cat-groceries",
    type: "expense",
    amountCents: 5_000,
    currency: "USD",
    amountInBaseCents: 5_000,
    baseCurrency: "USD",
    conversionRate: 1,
    description: null,
    date: "2026-09-05",
    businessRelated: false,
    businessPurpose: null,
    receiptPath: null,
    isRecurring: false,
    recurringFrequency: null,
    recurringLabel: null,
    contactId: null,
    dueDate: null,
    status: "hoan_thanh",
    settledCents: 0,
    taxPeriodStart: null,
    taxPeriodEnd: null,
    createdAt: "2026-09-05T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

// Sort orders mirror the seeded vocabulary in the migration, so ordering assertions
// here mean the same thing they will mean on screen.
const SALARY = makeCategory({ id: "cat-salary", name: "Lương", appliesTo: "income", slug: "salary", color: "#3F8F6B", sortOrder: 10 });
const FARMING = makeCategory({ id: "cat-farming", name: "Nông nghiệp", appliesTo: "income", slug: "farming", sortOrder: 20 });
const DINING = makeCategory({ id: "cat-dining", name: "Ăn uống", appliesTo: "expense", slug: "dining", sortOrder: 20 });
const TITHE = makeCategory({ id: "cat-tithe", name: "Dâng phần mười", appliesTo: "expense", slug: "tithe", sortOrder: 60 });
const GIVING = makeCategory({ id: "cat-giving", name: "Từ thiện", appliesTo: "expense", slug: "giving", sortOrder: 70 });
const BUSINESS = makeCategory({ id: "cat-business", name: "Kinh doanh", appliesTo: "expense", slug: "business", sortOrder: 100 });

const ALL_CATEGORIES: Category[] = [makeCategory(), SALARY, FARMING, BUSINESS, TITHE, GIVING, DINING];

function ledgerOf(transactions: Transaction[], accounts: Account[] = [makeAccount()]): LedgerEntry[] {
  return buildLedger(transactions, accounts, ALL_CATEGORIES);
}

// ---------------------------------------------------------------- money

describe("money is carried in integer cents", () => {
  it("converts what Postgres returns, whether number or string", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents("12.34")).toBe(1234);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents("not a number")).toBe(0);
  });

  it("rounds the classic float artefacts to the cent a person meant", () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point; a truncating
    // conversion would quietly lose a cent on the most common price shape there is.
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(1234.56)).toBe(123_456);
  });

  it("is only ever handed two decimals, because a third never gets past validation", () => {
    // 1.005 cannot be represented exactly, so no rounding rule can recover the
    // intent. validateAmount rejects a third decimal outright rather than storing
    // a number that differs from what was typed.
    expect(validateAmount("1.005").cents).toBeNull();
  });

  it("adds without drift, which a float ledger cannot do", () => {
    const cents = [toCents(0.1), toCents(0.2)];
    expect(sumCents(cents)).toBe(30);
    // The same sum in floats is 0.30000000000000004.
    expect(centsToDecimalString(sumCents(cents))).toBe("0.30");
  });

  it("writes a decimal string Postgres accepts, negatives included", () => {
    expect(centsToDecimalString(150_000)).toBe("1500.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
    expect(centsToDecimalString(-150_050)).toBe("-1500.50");
  });

  it("exports a bare number a spreadsheet can sum", () => {
    expect(centsToExportNumber(123_456)).toBe(1234.56);
    expect(centsToExportNumber(-500)).toBe(-5);
  });
});

describe("formatMoney", () => {
  it("formats USD with two decimals", () => {
    expect(formatMoney(123_456, "USD")).toBe("$1,234.56");
  });

  it("uses a minus sign a reader will not mistake for a hyphen, and never a bracket", () => {
    expect(formatMoney(-5000, "USD")).toBe("−$50.00");
  });

  it("only signs a positive amount when asked", () => {
    expect(formatMoney(5000, "USD")).toBe("$50.00");
    expect(formatMoney(5000, "USD", { signed: true })).toBe("+$50.00");
    expect(formatMoney(0, "USD", { signed: true })).toBe("$0.00");
  });

  it("drops the minor unit for VND, which has none", () => {
    const text = formatMoney(1_500_000_00, "VND");
    expect(text).not.toContain(",00");
    expect(text).toContain("₫");
  });
});

// ---------------------------------------------------------------- validation

describe("validateAmount", () => {
  it("accepts a plain amount and one with grouping commas", () => {
    expect(validateAmount("1250.50")).toEqual({ cents: 125_050, error: null });
    expect(validateAmount("1,250.50")).toEqual({ cents: 125_050, error: null });
    expect(validateAmount(" 12 ")).toEqual({ cents: 1200, error: null });
  });

  it("rejects zero and negatives — a transaction has a direction, not a sign", () => {
    expect(validateAmount("0").cents).toBeNull();
    expect(validateAmount("0.00").cents).toBeNull();
    expect(validateAmount("-5").cents).toBeNull();
  });

  it("rejects a third decimal instead of silently rounding it away", () => {
    const result = validateAmount("10.005");
    expect(result.cents).toBeNull();
    expect(result.error).toContain("2 chữ số thập phân");
  });

  it("rejects letters, blanks and a lone separator", () => {
    expect(validateAmount("").error).not.toBeNull();
    expect(validateAmount("abc").cents).toBeNull();
    expect(validateAmount(".").cents).toBeNull();
    expect(validateAmount("1.2.3").cents).toBeNull();
  });

  it("rejects an amount the column cannot hold", () => {
    expect(validateAmount("99999999999999").cents).toBeNull();
  });
});

describe("validateOpeningBalance", () => {
  it("treats a blank as zero, because most accounts start at nothing", () => {
    expect(validateOpeningBalance("")).toEqual({ cents: 0, error: null });
  });

  it("allows a negative, which is how a card or a loan actually starts", () => {
    expect(validateOpeningBalance("-1500")).toEqual({ cents: -150_000, error: null });
  });

  it("still refuses nonsense", () => {
    expect(validateOpeningBalance("abc").cents).toBeNull();
  });
});

describe("validateTransactionDate", () => {
  const today = "2026-09-07";

  it("accepts today and any day before it", () => {
    expect(validateTransactionDate(today, today).date).toBe(today);
    expect(validateTransactionDate("2026-09-06", today).date).toBe("2026-09-06");
    expect(validateTransactionDate("2020-01-01", today).date).toBe("2020-01-01");
  });

  it("refuses tomorrow: you cannot have spent money you have not spent yet", () => {
    const result = validateTransactionDate("2026-09-08", today);
    expect(result.date).toBeNull();
    expect(result.error).toContain("tương lai");
  });

  it("refuses a malformed date", () => {
    expect(validateTransactionDate("07/09/2026", today).date).toBeNull();
    expect(validateTransactionDate("", today).date).toBeNull();
  });
});

describe("duplicate names are blocked before the database has to say no", () => {
  const accounts = [makeAccount({ id: "a", name: "Checking" }), makeAccount({ id: "b", name: "Cash" })];

  it("catches a clash regardless of case or padding", () => {
    expect(validateAccountName("  checking ", accounts).error).not.toBeNull();
    expect(validateAccountName("Savings", accounts).name).toBe("Savings");
  });

  it("does not treat an account as a clash with itself while editing", () => {
    expect(validateAccountName("Checking", accounts, "a").name).toBe("Checking");
  });

  it("ignores a closed account, whose name is free again", () => {
    const withClosed = [makeAccount({ id: "c", name: "Old wallet", deletedAt: "2026-01-01T00:00:00Z" })];
    expect(validateAccountName("Old wallet", withClosed).name).toBe("Old wallet");
  });

  it("blocks a custom category that repeats a seeded one", () => {
    const result = validateCategoryName("tạp hoá", ALL_CATEGORIES);
    expect(result.name).toBeNull();
    expect(result.error).toContain("đã có rồi");
  });

  it("rejects a blank name", () => {
    expect(validateCategoryName("   ", ALL_CATEGORIES).name).toBeNull();
  });
});

describe("the submit button stays inert until the required four are filled", () => {
  const today = "2026-09-07";

  it("starts incomplete", () => {
    expect(isTransactionDraftComplete(emptyTransactionDraft(today))).toBe(false);
  });

  it("needs account, category, date and a usable amount — description is not one of them", () => {
    const draft = {
      ...emptyTransactionDraft(today),
      accountId: "acc-1",
      categoryId: "cat-groceries",
      amount: "50",
    };
    expect(isTransactionDraftComplete(draft)).toBe(true);
    expect(isTransactionDraftComplete({ ...draft, accountId: "" })).toBe(false);
    expect(isTransactionDraftComplete({ ...draft, categoryId: "" })).toBe(false);
    expect(isTransactionDraftComplete({ ...draft, date: "" })).toBe(false);
    expect(isTransactionDraftComplete({ ...draft, amount: "0" })).toBe(false);
  });

  it("names the first thing that is wrong, in order", () => {
    const draft = emptyTransactionDraft(today);
    expect(validateTransactionDraft(draft, today).field).toBe("accountId");
    expect(validateTransactionDraft({ ...draft, accountId: "a" }, today).field).toBe("categoryId");
    expect(
      validateTransactionDraft({ ...draft, accountId: "a", categoryId: "c", date: "2026-09-08" }, today).field,
    ).toBe("date");
    expect(validateTransactionDraft({ ...draft, accountId: "a", categoryId: "c", amount: "-1" }, today).field).toBe(
      "amount",
    );
  });
});

// ---------------------------------------------------------------- dates

describe("calendar helpers", () => {
  it("reads a local day, not a UTC instant", () => {
    expect(todayIso(new Date(2026, 8, 7, 23, 45))).toBe("2026-09-07");
    expect(todayIso(new Date(2026, 8, 7, 0, 15))).toBe("2026-09-07");
  });

  it("walks months across a year boundary", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("knows the last day of a month, February included", () => {
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2024-02")).toBe("2024-02-29");
    expect(endOfMonth("2026-09")).toBe("2026-09-30");
    expect(startOfMonth("2026-09")).toBe("2026-09-01");
  });

  it("lists a run of months oldest first", () => {
    expect(monthRange("2026-03", 4)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
  });

  it("formats a day the way a Vietnamese ledger is read", () => {
    expect(formatDayVi("2026-09-07")).toBe("07/09/2026");
  });

  it("adds days across a month end", () => {
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("nextRecurrence", () => {
  it("steps a week, a month and a year", () => {
    expect(nextRecurrence("2026-09-07", "weekly")).toBe("2026-09-14");
    expect(nextRecurrence("2026-09-07", "monthly")).toBe("2026-10-07");
    expect(nextRecurrence("2026-09-07", "yearly")).toBe("2027-09-07");
  });

  it("clamps a 31st into a short month instead of skipping into the next one", () => {
    // Naive date maths turns 31 January into 3 March. A monthly bill due on the 31st
    // is due at the end of February, not in March.
    expect(nextRecurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextRecurrence("2026-08-31", "monthly")).toBe("2026-09-30");
  });
});

// ---------------------------------------------------------------- ledger

describe("buildLedger", () => {
  it("joins each transaction to its account and category", () => {
    const entries = ledgerOf([makeTransaction()]);
    expect(entries).toHaveLength(1);
    expect(entries[0].account.name).toBe("Checking");
    expect(entries[0].category.name).toBe("Tạp hoá");
  });

  it("drops a row whose account or category is missing rather than rendering a broken line", () => {
    const entries = ledgerOf([makeTransaction({ accountId: "ghost" })]);
    expect(entries).toHaveLength(0);
  });
});

describe("a transaction marked as an error stops counting but is never lost", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "a", amountCents: 5_000 }),
    makeTransaction({ id: "b", amountCents: 9_900, deletedAt: "2026-09-06T00:00:00Z" }),
  ]);

  it("keeps the row available for audit", () => {
    expect(entries).toHaveLength(2);
  });

  it("excludes it from every total", () => {
    const posted = postedEntries(entries);
    expect(posted).toHaveLength(1);
    expect(totalsFor(posted).expenseCents).toBe(5_000);
  });

  it("excludes it from the account balance", () => {
    expect(balanceAt(makeAccount(), postedEntries(entries), "2026-12-31")).toBe(495_000);
  });
});

describe("signedCents", () => {
  it("makes income add and expense subtract", () => {
    expect(signedCents({ type: "income", amountCents: 1000 })).toBe(1000);
    expect(signedCents({ type: "expense", amountCents: 1000 })).toBe(-1000);
  });
});

describe("balanceAt", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "a", type: "income", categoryId: "cat-salary", amountCents: 300_000, date: "2026-09-01" }),
    makeTransaction({ id: "b", amountCents: 5_000, date: "2026-09-03" }),
    makeTransaction({ id: "c", amountCents: 1_500, date: "2026-09-05" }),
  ]);

  it("walks the test flow: 5000 opening, +3000 income, then expenses", () => {
    expect(balanceAt(makeAccount(), entries, "2026-08-31")).toBe(500_000);
    expect(balanceAt(makeAccount(), entries, "2026-09-01")).toBe(800_000);
    expect(balanceAt(makeAccount(), entries, "2026-09-03")).toBe(795_000);
    expect(balanceAt(makeAccount(), entries, "2026-09-05")).toBe(793_500);
  });

  it("counts the whole of the closing day, not up to some instant within it", () => {
    expect(balanceAt(makeAccount(), entries, "2026-09-04")).toBe(795_000);
  });
});

describe("net worth", () => {
  const card = makeAccount({ id: "acc-card", name: "Card", type: "credit_card", openingBalanceCents: 0 });
  const accounts = [makeAccount(), card];

  it("knows which account types are money owed", () => {
    expect(isLiabilityAccount("credit_card")).toBe(true);
    expect(isLiabilityAccount("loan")).toBe(true);
    expect(isLiabilityAccount("checking")).toBe(false);
    expect(isLiabilityAccount("other_person_holding")).toBe(false);
  });

  it("reports a debt as a positive amount owed and subtracts it", () => {
    const entries = ledgerOf(
      [makeTransaction({ id: "x", accountId: "acc-card", amountCents: 20_000, date: "2026-09-02" })],
      accounts,
    );
    const worth = netWorthAt(accounts, entries, "2026-09-30");
    expect(worth.assetsCents).toBe(500_000);
    expect(worth.liabilitiesCents).toBe(20_000);
    expect(worth.netCents).toBe(480_000);
  });

  it("ignores a closed account", () => {
    const closed = [makeAccount(), makeAccount({ id: "gone", openingBalanceCents: 999_999, deletedAt: "2026-01-01T00:00:00Z" })];
    expect(netWorthAt(closed, [], "2026-09-30").assetsCents).toBe(500_000);
    expect(activeAccounts(closed)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- totals

describe("totalsFor separates personal from business", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "1", type: "income", categoryId: "cat-farming", amountCents: 30_000, businessRelated: true }),
    makeTransaction({ id: "2", type: "income", categoryId: "cat-salary", amountCents: 100_000 }),
    makeTransaction({ id: "3", categoryId: "cat-business", amountCents: 7_500, businessRelated: true }),
    makeTransaction({ id: "4", amountCents: 5_000 }),
  ]);
  const totals = totalsFor(entries);

  it("adds up both directions", () => {
    expect(totals.incomeCents).toBe(130_000);
    expect(totals.expenseCents).toBe(12_500);
    expect(totals.netCents).toBe(117_500);
  });

  it("keeps the household business apart from the household", () => {
    expect(totals.businessIncomeCents).toBe(30_000);
    expect(totals.businessExpenseCents).toBe(7_500);
    expect(totals.personalExpenseCents).toBe(5_000);
  });

  it("computes gross profit as business revenue less business cost, so salary is not farm income", () => {
    expect(totals.grossProfitCents).toBe(22_500);
  });

  it("notices the ledger belongs to a household business", () => {
    expect(hasBusinessActivity(entries)).toBe(true);
    expect(hasBusinessActivity(ledgerOf([makeTransaction()]))).toBe(false);
  });
});

describe("giving", () => {
  it("counts tithe and charity together and nothing else", () => {
    const entries = ledgerOf([
      makeTransaction({ id: "1", type: "income", categoryId: "cat-salary", amountCents: 100_000 }),
      makeTransaction({ id: "2", categoryId: "cat-tithe", amountCents: 10_000 }),
      makeTransaction({ id: "3", categoryId: "cat-giving", amountCents: 2_000 }),
      makeTransaction({ id: "4", categoryId: "cat-dining", amountCents: 3_000 }),
    ]);
    const totals = totalsFor(entries);
    expect(totals.givingCents).toBe(12_000);
    expect(givingRatio(totals)).toBeCloseTo(0.12);
  });

  it("says nothing rather than 0% when there is no income to compare against", () => {
    const totals = totalsFor(ledgerOf([makeTransaction({ categoryId: "cat-tithe", amountCents: 1_000 })]));
    expect(givingRatio(totals)).toBeNull();
    expect(givingBand(null)).toBe("none");
  });

  it("colours the gauge red under 5, yellow through 10, green above", () => {
    expect(givingBand(0.0)).toBe("low");
    expect(givingBand(0.049)).toBe("low");
    expect(givingBand(0.05)).toBe("fair");
    expect(givingBand(0.1)).toBe("fair");
    expect(givingBand(0.1001)).toBe("generous");
  });
});

// ---------------------------------------------------------------- lists

describe("browsing the ledger", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "1", date: "2026-09-05", description: "Chợ sáng", createdAt: "2026-09-05T08:00:00Z" }),
    makeTransaction({ id: "2", date: "2026-09-05", description: "Xăng xe", createdAt: "2026-09-05T18:00:00Z" }),
    makeTransaction({ id: "3", date: "2026-09-02", description: "Cà phê" }),
  ]);

  it("puts the newest day first, and the latest entry first within a day", () => {
    expect(sortEntries(entries).map((entry) => entry.id)).toEqual(["2", "1", "3"]);
  });

  it("groups by day with that day's net movement", () => {
    const days = groupByDay(entries);
    expect(days.map((day) => day.date)).toEqual(["2026-09-05", "2026-09-02"]);
    expect(days[0].netCents).toBe(-10_000);
  });

  it("searches description, category and account together, case-insensitively", () => {
    expect(searchEntries(entries, "chợ").map((entry) => entry.id)).toEqual(["1"]);
    expect(searchEntries(entries, "TẠP HOÁ")).toHaveLength(3);
    expect(searchEntries(entries, "checking")).toHaveLength(3);
    expect(searchEntries(entries, "")).toHaveLength(3);
    expect(searchEntries(entries, "không có gì")).toHaveLength(0);
  });

  it("clips a range at both ends inclusively", () => {
    expect(entriesInRange(entries, "2026-09-05", "2026-09-05")).toHaveLength(2);
    expect(entriesInRange(entries, "2026-09-02", "2026-09-05")).toHaveLength(3);
    expect(entriesInRange(entries, "2026-09-06", "2026-09-30")).toHaveLength(0);
  });
});

describe("categoriesFor", () => {
  it("shows only the side of the ledger being entered", () => {
    expect(categoriesFor(ALL_CATEGORIES, "income").map((c) => c.slug)).toEqual(["salary", "farming"]);
    expect(categoriesFor(ALL_CATEGORIES, "expense").map((c) => c.slug)).toContain("groceries");
    expect(categoriesFor(ALL_CATEGORIES, "expense").map((c) => c.slug)).not.toContain("salary");
  });

  it("mixes a user's own categories into the seeded list rather than appending a second list", () => {
    const custom = makeCategory({ id: "cat-pet", name: "Đồ cho thú cưng", origin: "custom", slug: null, sortOrder: 15 });
    const list = categoriesFor([...ALL_CATEGORIES, custom], "expense");
    expect(list.map((c) => c.id)).toContain("cat-pet");
    expect(list[0].slug).toBe("groceries");
    expect(list[1].id).toBe("cat-pet");
  });

  it("hides a retired category", () => {
    const retired = ALL_CATEGORIES.map((c) => (c.id === "cat-dining" ? { ...c, deletedAt: "2026-01-01" } : c));
    expect(categoriesFor(retired, "expense").map((c) => c.id)).not.toContain("cat-dining");
  });
});

// ---------------------------------------------------------------- recurring

describe("recurring reminders", () => {
  const gym = makeTransaction({
    id: "gym",
    categoryId: "cat-dining",
    amountCents: 3_000,
    date: "2026-08-07",
    isRecurring: true,
    recurringFrequency: "monthly",
    recurringLabel: "Thẻ tập gym",
  });

  it("offers the next one once its day has arrived", () => {
    const suggestions = recurringSuggestions(ledgerOf([gym]), "2026-09-07");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe("Thẻ tập gym");
    expect(suggestions[0].amountCents).toBe(3_000);
    expect(suggestions[0].dueDate).toBe("2026-09-07");
  });

  it("stays quiet before the day comes — it is a reminder, not a charge", () => {
    expect(recurringSuggestions(ledgerOf([gym]), "2026-09-06")).toHaveLength(0);
  });

  it("follows the latest entry of a pattern, so paying it clears the reminder", () => {
    const paid = makeTransaction({ ...gym, id: "gym-2", date: "2026-09-07" });
    expect(recurringSuggestions(ledgerOf([gym, paid]), "2026-09-07")).toHaveLength(0);
  });

  it("respects a skip", () => {
    const [suggestion] = recurringSuggestions(ledgerOf([gym]), "2026-09-07");
    expect(recurringSuggestions(ledgerOf([gym]), "2026-09-07", new Set([suggestion.key]))).toHaveLength(0);
  });

  it("ignores an ordinary transaction", () => {
    expect(recurringSuggestions(ledgerOf([makeTransaction()]), "2026-12-31")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- reports

const BUSINESS_LEDGER = ledgerOf([
  makeTransaction({
    id: "r1",
    type: "income",
    categoryId: "cat-farming",
    amountCents: 30_000,
    date: "2026-09-02",
    businessRelated: true,
    businessPurpose: "rau củ",
  }),
  makeTransaction({
    id: "r2",
    categoryId: "cat-business",
    amountCents: 7_500,
    date: "2026-09-03",
    businessRelated: true,
    businessPurpose: "phân bón",
  }),
  makeTransaction({ id: "r3", amountCents: 5_000, date: "2026-09-04" }),
]);

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

describe("P&L statement", () => {
  const report = buildReport("profit-loss", { entries: BUSINESS_LEDGER, accounts: [makeAccount()], ...RANGE });

  it("computes revenue − cost = profit, matching the household business flow", () => {
    expect(report.stats.map((stat) => stat.value)).toEqual([30_000, 7_500, 22_500]);
  });

  it("puts gross profit on its own emphasised line", () => {
    const profit = report.rows.find((row) => row.key === "profit");
    expect(profit?.cells.amount).toBe(22_500);
    expect(profit?.emphasis).toBe(true);
  });

  it("leaves the personal grocery run out of the business statement entirely", () => {
    const lines = report.rows.map((row) => String(row.cells.line));
    expect(lines).not.toContain("Tạp hoá");
  });

  it("says so plainly when nothing is flagged as business", () => {
    const personal = buildReport("profit-loss", { entries: ledgerOf([makeTransaction()]), accounts: [makeAccount()], ...RANGE });
    expect(personal.empty).toBe(true);
    expect(personal.emptyMessage).toContain("kinh doanh");
  });
});

describe("deductible summary", () => {
  const report = buildReport("deductible-summary", { entries: BUSINESS_LEDGER, accounts: [makeAccount()], ...RANGE });

  it("lists every business expense with its purpose", () => {
    const row = report.rows.find((item) => item.key === "r2");
    expect(row?.cells.purpose).toBe("phân bón");
    expect(row?.cells.amount).toBe(7_500);
  });

  it("excludes business income — a deduction is a cost, not a receipt", () => {
    expect(report.rows.some((row) => row.key === "r1")).toBe(false);
  });

  it("excludes personal spending", () => {
    expect(report.rows.some((row) => row.key === "r3")).toBe(false);
  });

  it("totals what may be deducted", () => {
    expect(report.stats[0].value).toBe(7_500);
  });

  it("flags an expense whose purpose was never written down", () => {
    const vague = ledgerOf([
      makeTransaction({ id: "v", categoryId: "cat-business", amountCents: 1_000, businessRelated: true, date: "2026-09-05" }),
    ]);
    const result = buildReport("deductible-summary", { entries: vague, accounts: [makeAccount()], ...RANGE });
    expect(String(result.rows.find((row) => row.key === "v")?.cells.purpose)).toContain("chưa ghi mục đích");
    expect(result.stats.find((stat) => stat.label === "Thiếu mục đích")?.value).toBe(1);
  });
});

describe("monthly summary", () => {
  const report = buildReport("monthly-summary", { entries: BUSINESS_LEDGER, accounts: [makeAccount()], ...RANGE });

  it("reports income, expense and the difference", () => {
    const total = report.rows.find((row) => row.key === "total");
    expect(total?.cells.income).toBe(30_000);
    expect(total?.cells.expense).toBe(12_500);
    expect(total?.cells.net).toBe(17_500);
  });

  it("splits personal from business spending once a business exists", () => {
    expect(report.columns.map((column) => column.key)).toContain("businessExpense");
    const total = report.rows.find((row) => row.key === "total");
    expect(total?.cells.personalExpense).toBe(5_000);
    expect(total?.cells.businessExpense).toBe(7_500);
  });

  it("keeps a purely personal ledger simple, with no business columns at all", () => {
    const personal = buildReport("monthly-summary", {
      entries: ledgerOf([makeTransaction()]),
      accounts: [makeAccount()],
      ...RANGE,
    });
    expect(personal.columns.map((column) => column.key)).not.toContain("businessExpense");
  });
});

describe("account statement", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "s0", amountCents: 10_000, date: "2026-08-20" }),
    makeTransaction({ id: "s1", type: "income", categoryId: "cat-salary", amountCents: 100_000, date: "2026-09-02" }),
    makeTransaction({ id: "s2", amountCents: 50_000, date: "2026-09-04" }),
  ]);
  const report = buildReport("account-statement", {
    entries,
    accounts: [makeAccount()],
    accountId: "acc-1",
    ...RANGE,
  });

  it("opens with everything that happened before the range, folded into one line", () => {
    expect(report.rows[0].cells.balance).toBe(490_000);
  });

  it("carries a running balance down the page", () => {
    expect(report.rows[1].cells.balance).toBe(590_000);
    expect(report.rows[2].cells.balance).toBe(540_000);
  });

  it("closes on the same figure the account itself would report", () => {
    const closing = report.rows[report.rows.length - 1];
    expect(closing.cells.balance).toBe(balanceAt(makeAccount(), entries, "2026-09-30"));
  });

  it("asks for an account instead of guessing when none is chosen", () => {
    const none = buildReport("account-statement", { entries, accounts: [makeAccount()], ...RANGE });
    expect(none.empty).toBe(true);
    expect(none.emptyMessage).toContain("Hãy chọn");
  });
});

describe("net worth report", () => {
  it("lists assets and debts and lands on the same net figure as the dashboard", () => {
    const card = makeAccount({ id: "acc-card", name: "Card", type: "credit_card", openingBalanceCents: -30_000 });
    const accounts = [makeAccount(), card];
    const report = buildReport("net-worth", { entries: [], accounts, ...RANGE });
    expect(report.rows.find((row) => row.key === "assets")?.cells.balance).toBe(500_000);
    expect(report.rows.find((row) => row.key === "liabilities")?.cells.balance).toBe(30_000);
    expect(report.rows.find((row) => row.key === "net")?.cells.balance).toBe(470_000);
  });
});

describe("giving report", () => {
  it("lists each gift and states the ratio against income", () => {
    const entries = ledgerOf([
      makeTransaction({ id: "g0", type: "income", categoryId: "cat-salary", amountCents: 100_000, date: "2026-09-01" }),
      makeTransaction({ id: "g1", categoryId: "cat-tithe", amountCents: 10_000, date: "2026-09-02" }),
    ]);
    const report = buildReport("giving", { entries, accounts: [makeAccount()], ...RANGE });
    expect(report.rows.some((row) => row.key === "g1")).toBe(true);
    expect(report.stats[0].value).toBe(10_000);
    expect(report.stats[2].value).toBeCloseTo(0.1);
  });

  it("reads as zero given, not as an error, when nothing was given", () => {
    const report = buildReport("giving", { entries: ledgerOf([makeTransaction()]), accounts: [makeAccount()], ...RANGE });
    expect(report.empty).toBe(true);
    expect(report.stats[0].value).toBe(0);
  });
});

describe("category breakdown", () => {
  it("gives every category its share of its own side of the ledger", () => {
    const entries = ledgerOf([
      makeTransaction({ id: "c1", amountCents: 7_500, date: "2026-09-02" }),
      makeTransaction({ id: "c2", categoryId: "cat-dining", amountCents: 2_500, date: "2026-09-03" }),
    ]);
    const report = buildReport("category-breakdown", { entries, accounts: [makeAccount()], ...RANGE });
    const groceries = report.rows.find((row) => row.key === "expense-cat-groceries");
    expect(groceries?.cells.amount).toBe(7_500);
    expect(groceries?.cells.share).toBeCloseTo(0.75);
  });
});

describe("dashboard series", () => {
  it("returns exactly twelve months of trend, oldest first, zero-filled", () => {
    const trend = spendingTrend(BUSINESS_LEDGER, "2026-09", 12);
    expect(trend).toHaveLength(12);
    expect(trend[0].month).toBe("2025-10");
    expect(trend[11].month).toBe("2026-09");
    expect(trend[11].expense).toBe(12_500);
    expect(trend[0].expense).toBe(0);
  });

  it("compares this month against last, keeping a category that only appeared in one of them", () => {
    const entries = ledgerOf([
      makeTransaction({ id: "m1", amountCents: 5_000, date: "2026-09-02" }),
      makeTransaction({ id: "m2", categoryId: "cat-dining", amountCents: 4_000, date: "2026-08-02" }),
    ]);
    const comparison = monthlyComparison(entries, "2026-09");
    const groceries = comparison.find((point) => point.category === "Tạp hoá");
    const dining = comparison.find((point) => point.category === "Ăn uống");
    expect(groceries).toEqual({ category: "Tạp hoá", color: "#E0603C", current: 5_000, previous: 0 });
    expect(dining?.current).toBe(0);
    expect(dining?.previous).toBe(4_000);
  });
});

// ---------------------------------------------------------------- export

describe("CSV export", () => {
  const report = buildReport("profit-loss", { entries: BUSINESS_LEDGER, accounts: [makeAccount()], ...RANGE });
  const csv = reportToCsv(report, "USD");

  it("leads with a byte-order mark so Excel opens Vietnamese text correctly", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("uses CRLF line endings, which every spreadsheet accepts", () => {
    expect(csv).toContain("\r\n");
  });

  it("names the report, the range and the currency before the numbers", () => {
    expect(csv).toContain("Báo cáo lãi lỗ");
    expect(csv).toContain("Từ 01/09/2026 đến 30/09/2026");
    expect(csv).toContain("Đơn vị tiền tệ: USD");
  });

  it("writes bare numbers a spreadsheet can add, not formatted currency", () => {
    expect(csv).toContain("300.00");
    expect(csv).toContain("225.00");
    expect(csv).not.toContain("$300.00");
  });

  it("quotes a field containing a comma so the columns cannot shift", () => {
    const tricky = buildReport("deductible-summary", {
      entries: ledgerOf([
        makeTransaction({
          id: "q",
          categoryId: "cat-business",
          amountCents: 1_000,
          date: "2026-09-05",
          businessRelated: true,
          businessPurpose: "phân bón, hạt giống",
        }),
      ]),
      accounts: [makeAccount()],
      ...RANGE,
    });
    expect(reportToCsv(tricky, "USD")).toContain('"phân bón, hạt giống"');
  });
});

describe("report file names", () => {
  it("folds Vietnamese down to plain ASCII a filesystem will not mangle", () => {
    expect(reportFileBase("monthly-summary", "2026-09-01", "2026-09-30")).toBe(
      "Tong_hop_theo_thang_2026-09-01_2026-09-30",
    );
    expect(reportFileBase("deductible-summary", "2026-01-01", "2026-12-31")).toBe(
      "Chi_phi_duoc_tru_2026-01-01_2026-12-31",
    );
  });
});

// ---------------------------------------------------------------- month bucketing

describe("monthKey", () => {
  it("buckets a day into its month", () => {
    expect(monthKey("2026-09-07")).toBe("2026-09");
  });
});

// ---------------------------------------------------------------- obligations

const VAY = makeTransaction({
  id: "ob-vay",
  type: "vay",
  categoryId: null,
  amountCents: 300_000,
  date: "2026-09-01",
  dueDate: "2026-12-31",
  contactId: "contact-ba",
  status: "ke_hoach",
  settledCents: 0,
});

const CHO_VAY = makeTransaction({
  id: "ob-cho-vay",
  type: "cho_vay",
  categoryId: null,
  amountCents: 100_000,
  date: "2026-09-02",
  dueDate: "2026-10-01",
  contactId: "contact-tu",
  status: "ke_hoach",
  settledCents: 0,
});

const THUE = makeTransaction({
  id: "ob-thue",
  type: "thue_ca_nhan",
  categoryId: null,
  amountCents: 50_000,
  date: "2026-09-03",
  dueDate: "2026-10-31",
  status: "ke_hoach",
  settledCents: 0,
  taxPeriodStart: "2026-07-01",
  taxPeriodEnd: "2026-09-30",
});

describe("an obligation is a promise about money, not a movement of it", () => {
  it("keeps a row that has no category, because an obligation is not a kind of spending", () => {
    const entries = ledgerOf([VAY]);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBeNull();
  });

  it("still drops an income or expense whose category is missing", () => {
    const entries = ledgerOf([makeTransaction({ categoryId: null })]);
    expect(entries).toHaveLength(0);
  });

  it("names itself by its type when there is no category to name it", () => {
    expect(entryCategoryName(ledgerOf([VAY])[0])).toBe("Vay");
    expect(entryCategoryName(ledgerOf([THUE])[0])).toBe("Thuế cá nhân");
  });

  it("knows which four types are obligations", () => {
    expect(isObligationType("vay")).toBe(true);
    expect(isObligationType("cho_vay")).toBe(true);
    expect(isObligationType("thue_ca_nhan")).toBe(true);
    expect(isObligationType("thue_kinh_doanh")).toBe(true);
    expect(isObligationType("income")).toBe(false);
    expect(isObligationType("expense")).toBe(false);
  });
});

describe("obligations move the balance the way the money actually moved", () => {
  it("adds a borrowing and subtracts a loan out or a tax", () => {
    expect(signedCents({ type: "vay", amountCents: 1000 })).toBe(1000);
    expect(signedCents({ type: "cho_vay", amountCents: 1000 })).toBe(-1000);
    expect(signedCents({ type: "thue_ca_nhan", amountCents: 1000 })).toBe(-1000);
    expect(signedCents({ type: "thue_kinh_doanh", amountCents: 1000 })).toBe(-1000);
  });

  it("carries borrowed money into the account balance", () => {
    const entries = ledgerOf([VAY, CHO_VAY, THUE]);
    // 500000 opening + 300000 borrowed - 100000 lent - 50000 tax
    expect(balanceAt(makeAccount(), entries, "2026-12-31")).toBe(650_000);
  });
});

describe("an obligation never counts as income or expense", () => {
  const entries = ledgerOf([
    makeTransaction({ id: "m1", type: "income", categoryId: "cat-salary", amountCents: 200_000 }),
    makeTransaction({ id: "m2", amountCents: 30_000 }),
    VAY,
    CHO_VAY,
    THUE,
  ]);

  it("leaves both totals untouched by borrowing, lending and tax", () => {
    const totals = totalsFor(entries);
    expect(totals.incomeCents).toBe(200_000);
    expect(totals.expenseCents).toBe(30_000);
    expect(totals.netCents).toBe(170_000);
  });

  it("separates the two families for the screens that need one or the other", () => {
    expect(movementEntries(entries).map((entry) => entry.id)).toEqual(["m1", "m2"]);
    expect(obligationEntries(entries).map((entry) => entry.id)).toEqual(["ob-vay", "ob-cho-vay", "ob-thue"]);
  });
});

describe("the state of an obligation is derived, never declared", () => {
  const base = { amountCents: 100_000, settledCents: 0, dueDate: "2026-09-10" };

  it("is planned while the due date is still ahead", () => {
    expect(obligationStatusOf(base, "2026-09-01")).toBe("ke_hoach");
  });

  it("becomes due on the day itself", () => {
    expect(obligationStatusOf(base, "2026-09-10")).toBe("den_han");
  });

  it("becomes overdue the day after, without anybody writing to the row", () => {
    expect(obligationStatusOf(base, "2026-09-11")).toBe("qua_han");
  });

  it("reads as part-paid once something has been paid against it", () => {
    expect(obligationStatusOf({ ...base, settledCents: 40_000 }, "2026-09-01")).toBe("hoan_thanh_mot_phan");
  });

  it("still reads as overdue when a part-paid one runs past its date", () => {
    expect(obligationStatusOf({ ...base, settledCents: 40_000 }, "2026-09-11")).toBe("qua_han");
  });

  it("is finished once the whole amount is covered, even past the date", () => {
    expect(obligationStatusOf({ ...base, settledCents: 100_000 }, "2026-12-01")).toBe("hoan_thanh");
  });
});

describe("paying an obligation never rewrites what was owed", () => {
  it("reports what is left without touching the original amount", () => {
    const part = { ...VAY, settledCents: 120_000 };
    expect(outstandingCents(part)).toBe(180_000);
    expect(part.amountCents).toBe(300_000);
  });

  it("never reports a negative remainder", () => {
    expect(outstandingCents({ amountCents: 100, settledCents: 500 })).toBe(0);
  });
});

describe("the obligation summary answers who owes whom", () => {
  const entries = ledgerOf([
    VAY,
    CHO_VAY,
    THUE,
    makeTransaction({ id: "m1", type: "income", categoryId: "cat-salary", amountCents: 900_000 }),
  ]);

  it("separates what you owe from what is owed to you", () => {
    const totals = obligationTotals(entries, "2026-09-05");
    expect(totals.owedCents).toBe(350_000);
    expect(totals.dueToYouCents).toBe(100_000);
  });

  it("counts what needs attention today", () => {
    const totals = obligationTotals(entries, "2026-10-02");
    expect(totals.overdueCount).toBe(1);
    expect(totals.dueSoonCount).toBe(0);
  });

  it("stops counting an obligation once it is settled in full", () => {
    const settled = ledgerOf([{ ...VAY, settledCents: 300_000 }, CHO_VAY]);
    const totals = obligationTotals(settled, "2026-09-05");
    expect(totals.owedCents).toBe(0);
    expect(totals.dueToYouCents).toBe(100_000);
  });
});

// ---------------------------------------------------------------- what is due

/** A due date relative to a fixed "today", so the windows can be stated plainly. */
const TODAY = "2026-09-15";

function due(id: string, dueDate: string, overrides: Partial<Transaction> = {}): Transaction {
  return makeTransaction({
    id,
    type: "vay",
    categoryId: null,
    amountCents: 100_000,
    settledCents: 0,
    date: "2026-09-01",
    dueDate,
    status: "ke_hoach",
    ...overrides,
  });
}

describe("which obligations are pressing today", () => {
  it("calls a date already past overdue", () => {
    expect(obligationWindowOf(due("a", "2026-09-14"), TODAY)).toBe("qua_han");
  });

  it("calls the day itself today, not part of the week ahead", () => {
    expect(obligationWindowOf(due("a", TODAY), TODAY)).toBe("hom_nay");
  });

  it("reaches a full seven days forward", () => {
    expect(obligationWindowOf(due("a", "2026-09-16"), TODAY)).toBe("tuan_nay");
    expect(obligationWindowOf(due("a", "2026-09-22"), TODAY)).toBe("tuan_nay");
  });

  it("stops at the eighth day, which nobody has to act on yet", () => {
    expect(obligationWindowOf(due("a", "2026-09-23"), TODAY)).toBeNull();
  });

  it("leaves out an obligation that is already paid off", () => {
    expect(obligationWindowOf(due("a", "2026-09-14", { settledCents: 100_000 }), TODAY)).toBeNull();
  });

  it("still counts one that is only part paid, because the rest is due the same day", () => {
    expect(obligationWindowOf(due("a", "2026-09-14", { settledCents: 60_000 }), TODAY)).toBe("qua_han");
  });

  it("ignores a row marked as an error, wherever its date falls", () => {
    expect(
      obligationWindowOf(due("a", "2026-09-14", { deletedAt: "2026-09-10T00:00:00Z" }), TODAY),
    ).toBeNull();
  });

  it("never presses about an ordinary expense, which already happened", () => {
    expect(obligationWindowOf(makeTransaction({ dueDate: "2026-09-14" }), TODAY)).toBeNull();
  });

  it("says nothing about an obligation with no date, because nothing was promised", () => {
    expect(obligationWindowOf(due("a", TODAY, { dueDate: null }), TODAY)).toBeNull();
  });

  it("counts all four kinds, not just the ones with a person attached", () => {
    for (const type of ["vay", "cho_vay", "thue_ca_nhan", "thue_kinh_doanh"] as const) {
      expect(obligationWindowOf(due("a", TODAY, { type }), TODAY)).toBe("hom_nay");
    }
  });
});

describe("the three due numbers are a partition, so overdue can never hide", () => {
  const entries: Transaction[] = [
    due("late-1", "2026-09-01"),
    due("late-2", "2026-09-14", { type: "thue_ca_nhan" }),
    due("now", TODAY, { type: "cho_vay" }),
    due("soon", "2026-09-20"),
    due("far", "2026-11-01"),
    due("paid", "2026-09-02", { settledCents: 100_000 }),
    makeTransaction({ id: "lunch" }),
  ];

  it("keeps late apart from due today rather than folding them together", () => {
    const attention = obligationAttention(entries, TODAY);
    expect(attention.overdue).toBe(2);
    expect(attention.today).toBe(1);
    expect(attention.week).toBe(1);
  });

  it("adds up to the total, so nothing is counted twice or dropped", () => {
    const attention = obligationAttention(entries, TODAY);
    expect(attention.overdue + attention.today + attention.week).toBe(attention.total);
    expect(attention.total).toBe(4);
  });

  it("is silent on a ledger with nothing pressing", () => {
    expect(obligationAttention([due("far", "2026-12-01")], TODAY)).toEqual({
      overdue: 0,
      today: 0,
      week: 0,
      total: 0,
    });
  });

  it("hands back the very rows behind one number, for the list it opens", () => {
    expect(obligationsDueIn(entries, "qua_han", TODAY).map((entry) => entry.id)).toEqual([
      "late-1",
      "late-2",
    ]);
    expect(obligationsDueIn(entries, "hom_nay", TODAY).map((entry) => entry.id)).toEqual(["now"]);
  });

  it("knows whether a ledger uses obligations at all", () => {
    expect(hasOpenObligations(entries)).toBe(true);
    expect(hasOpenObligations([makeTransaction({ id: "lunch" })])).toBe(false);
    // Everything paid off is not "uses obligations" for the strip's purposes.
    expect(hasOpenObligations([due("paid", "2026-09-02", { settledCents: 100_000 })])).toBe(false);
  });
});

describe("net worth counts what is owed each way, and counts it once", () => {
  const accounts = [makeAccount()];

  it("adds money lent out, which has left the account but is still yours", () => {
    const entries = ledgerOf([CHO_VAY]);
    const position = obligationPosition(entries);
    expect(position.receivableCents).toBe(100_000);
    expect(position.payableCents).toBe(0);
  });

  it("adds money borrowed as a debt, because the cash is already in the account", () => {
    const position = obligationPosition(ledgerOf([VAY]));
    expect(position.payableCents).toBe(300_000);
    expect(position.receivableCents).toBe(0);
  });

  it("counts only the part still outstanding", () => {
    const position = obligationPosition(ledgerOf([{ ...VAY, settledCents: 120_000 }]));
    expect(position.payableCents).toBe(180_000);
  });

  it("leaves tax alone: the balance already fell when it was written", () => {
    const position = obligationPosition(ledgerOf([THUE]));
    expect(position.payableCents).toBe(0);
    expect(position.receivableCents).toBe(0);
  });

  it("skips one booked against a liability account, whose balance already carries it", () => {
    const card = makeAccount({ id: "acc-card", type: "credit_card" });
    const entries = buildLedger([{ ...VAY, accountId: "acc-card" }], [makeAccount(), card], [makeCategory()]);
    expect(obligationPosition(entries).payableCents).toBe(0);
  });

  it("ignores a row marked as an error", () => {
    const voided = buildLedger(
      [{ ...VAY, deletedAt: "2026-09-10T00:00:00Z" }],
      [makeAccount()],
      [makeCategory()],
    );
    expect(obligationPosition(voided).payableCents).toBe(0);
  });

  it("folds the two into the account figure without disturbing it", () => {
    const entries = ledgerOf([VAY, CHO_VAY]);
    const fromAccounts = netWorthInBase(accounts, entries, "2026-12-31", "USD", {});
    const whole = withObligationPosition(fromAccounts, obligationPosition(entries));

    // 500000 opening + 300000 borrowed - 100000 lent
    expect(fromAccounts.assetsCents).toBe(700_000);
    expect(whole.assetsCents).toBe(800_000);
    expect(whole.liabilitiesCents).toBe(300_000);
    expect(whole.netCents).toBe(500_000);
  });

  it("leaves a person exactly as wealthy as before they borrowed and lent", () => {
    const plain = netWorthInBase(accounts, [], "2026-12-31", "USD", {});
    const entries = ledgerOf([VAY, CHO_VAY]);
    const whole = withObligationPosition(
      netWorthInBase(accounts, entries, "2026-12-31", "USD", {}),
      obligationPosition(entries),
    );
    expect(whole.netCents).toBe(plain.netCents);
  });

  it("keeps the accounts that could not be valued, whatever is folded on top", () => {
    const fromAccounts = netWorthInBase(
      [makeAccount({ id: "acc-eu", currency: "EUR" })],
      [],
      "2026-12-31",
      "USD",
      {},
    );
    const whole = withObligationPosition(fromAccounts, { receivableCents: 5, payableCents: 0 });
    expect(whole.unvalued.map((account) => account.id)).toEqual(["acc-eu"]);
  });
});

describe("Tạo việc nhắc is only a suggestion for an obligation still owed (AVORA 32)", () => {
  const base = { type: "vay" as const, deletedAt: null, dueDate: "2026-10-02", amountCents: 500_000_000, settledCents: 0 };

  it("is offered for a live, dated, unsettled obligation only", () => {
    expect(canSuggestReminder(base)).toBe(true);
    expect(canSuggestReminder({ ...base, dueDate: null })).toBe(false);
    expect(canSuggestReminder({ ...base, settledCents: base.amountCents })).toBe(false);
    expect(canSuggestReminder({ ...base, deletedAt: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(canSuggestReminder({ ...base, type: "expense" as const })).toBe(false);
  });

  it("names the item and what is still owed", () => {
    const title = reminderTitle("Vay anh Nam", { amountCents: 500_000_000, settledCents: 200_000_000 }, "VND");
    expect(title.startsWith("Đến hạn: Vay anh Nam — ")).toBe(true);
    expect(title).toContain("3.000.000");
  });
});
