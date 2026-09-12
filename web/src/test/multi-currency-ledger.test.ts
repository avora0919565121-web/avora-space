import { buildRateTable, rateKey, type RateTable } from "@/lib/currency";
import {
  balanceInBase,
  currenciesInUse,
  netWorthInBase,
  toBaseLedger,
  totalsFor,
  unconvertibleEntries,
  type Account,
  type Category,
  type LedgerEntry,
} from "@/lib/finance";

const RATES: RateTable = buildRateTable([
  { from: "USD", to: "VND", rate: 23984.96 },
  { from: "VND", to: "USD", rate: 1 / 23984.96 },
  { from: "USD", to: "EUR", rate: 0.9231 },
  { from: "EUR", to: "USD", rate: 1 / 0.9231 },
]);

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-vnd",
    name: "Vietcombank",
    type: "checking",
    openingBalanceCents: 0,
    balanceCents: 0,
    currency: "VND",
    otherPersonName: null,
    accountNumber: null,
    tags: [],
    createdAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const CATEGORY: Category = {
  id: "cat-salary",
  name: "Lương",
  origin: "predefined",
  appliesTo: "income",
  color: "#3F8F6B",
  slug: "salary",
  sortOrder: 1,
  deletedAt: null,
};

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const acc = overrides.account ?? account();
  return {
    id: "t1",
    accountId: acc.id,
    categoryId: CATEGORY.id,
    type: "income",
    amountCents: 100_000,
    currency: acc.currency,
    amountInBaseCents: null,
    baseCurrency: null,
    conversionRate: null,
    description: null,
    date: "2026-09-05",
    businessRelated: false,
    businessPurpose: null,
    receiptPath: null,
    isRecurring: false,
    recurringFrequency: null,
    recurringLabel: null,
    createdAt: "2026-09-05T10:00:00Z",
    deletedAt: null,
    account: acc,
    category: CATEGORY,
    ...overrides,
  };
}

const VND = account({ id: "acc-vnd", currency: "VND", name: "Vietcombank" });
const USD = account({ id: "acc-usd", currency: "USD", name: "Wise" });
const EUR = account({ id: "acc-eur", currency: "EUR", name: "Revolut" });

describe("toBaseLedger", () => {
  it("leaves entries already in the base currency exactly as they are", () => {
    const rows = [entry({ id: "a", account: VND, amountCents: 50_000_000 })];
    const converted = toBaseLedger(rows, "VND", RATES);
    expect(converted).toHaveLength(1);
    expect(converted[0]?.amountCents).toBe(50_000_000);
  });

  it("restates a foreign entry in the base currency", () => {
    // 20 USD -> 479,699 VND, matching what the database computed.
    const rows = [entry({ id: "b", account: USD, amountCents: 2_000 })];
    const converted = toBaseLedger(rows, "VND", RATES);
    expect(converted[0]?.amountCents).toBe(479_699 * 100);
    expect(converted[0]?.currency).toBe("VND");
  });

  /**
   * The cache is trusted only when it says which base it was computed against — that is the
   * whole reason base_currency is stored beside the converted amount.
   */
  it("prefers the database's own converted figure when it matches this base", () => {
    const rows = [
      entry({
        id: "c",
        account: USD,
        amountCents: 2_000,
        // A deliberately different figure, to prove the cached value is the one used.
        amountInBaseCents: 500_000 * 100,
        baseCurrency: "VND",
      }),
    ];
    expect(toBaseLedger(rows, "VND", RATES)[0]?.amountCents).toBe(500_000 * 100);
  });

  it("ignores a cached figure computed against a different base, rather than trusting it blindly", () => {
    const rows = [
      entry({
        id: "d",
        account: USD,
        amountCents: 2_000,
        // Stale: this was computed while the person reported in EUR.
        amountInBaseCents: 999_999,
        baseCurrency: "EUR",
      }),
    ];
    // Recomputed from the rate table instead of reusing the stale number.
    expect(toBaseLedger(rows, "VND", RATES)[0]?.amountCents).toBe(479_699 * 100);
  });

  it("drops an entry it cannot value rather than counting it as zero", () => {
    const exotic = account({ id: "acc-x", currency: "XYZ" });
    const rows = [
      entry({ id: "e", account: VND, amountCents: 1_000 }),
      entry({ id: "f", account: exotic, amountCents: 5_000 }),
    ];
    const converted = toBaseLedger(rows, "VND", RATES);
    expect(converted).toHaveLength(1);
    // And it is reported, so a screen can say so instead of quietly under-reporting.
    expect(unconvertibleEntries(rows, "VND", RATES).map((row) => row.id)).toEqual(["f"]);
  });

  it("makes totals across currencies add up to one meaningful number", () => {
    // The brief's Test 8: 500,000 VND + 20 USD + 45 EUR, reported in VND.
    const rows = [
      entry({ id: "vnd", account: VND, amountCents: 500_000 * 100 }),
      entry({ id: "usd", account: USD, amountCents: 20 * 100 }),
      entry({ id: "eur", account: EUR, amountCents: 45 * 100 }),
    ];
    const totals = totalsFor(toBaseLedger(rows, "VND", RATES));
    // 500,000 + 479,699 + 1,169,238 = 2,148,937 VND
    expect(totals.incomeCents).toBe(2_148_937 * 100);
  });
});

describe("balances across currencies", () => {
  it("restates one account's balance in the base currency", () => {
    const rows = [entry({ id: "g", account: USD, amountCents: 2_000 })];
    const balance = balanceInBase({ ...USD, openingBalanceCents: 0 }, rows, "2026-09-30", "VND", RATES);
    expect(balance).toBe(479_699 * 100);
  });

  it("returns null for a balance no rate can value, rather than shrinking it to zero", () => {
    const exotic = account({ id: "acc-x", currency: "XYZ" });
    expect(balanceInBase(exotic, [], "2026-09-30", "VND", RATES)).toBeNull();
  });

  it("adds assets held in different currencies into one net worth", () => {
    const rows = [
      entry({ id: "h", account: VND, amountCents: 500_000 * 100 }),
      entry({ id: "i", account: USD, amountCents: 20 * 100 }),
    ];
    const worth = netWorthInBase([VND, USD], rows, "2026-09-30", "VND", RATES);
    expect(worth.assetsCents).toBe((500_000 + 479_699) * 100);
    expect(worth.liabilitiesCents).toBe(0);
    expect(worth.netCents).toBe((500_000 + 479_699) * 100);
    expect(worth.unvalued).toEqual([]);
  });

  it("counts a foreign credit card as a debt, converted", () => {
    const card = account({ id: "acc-card", currency: "USD", type: "credit_card" });
    const rows = [entry({ id: "j", account: card, type: "expense", amountCents: 10 * 100 })];
    const worth = netWorthInBase([card], rows, "2026-09-30", "VND", RATES);
    expect(worth.liabilitiesCents).toBe(239_850 * 100);
    expect(worth.netCents).toBe(-239_850 * 100);
  });

  it("names the accounts it could not value instead of silently omitting them", () => {
    const exotic = account({ id: "acc-x", currency: "XYZ", balanceCents: 5_000 });
    const worth = netWorthInBase([VND, exotic], [], "2026-09-30", "VND", RATES);
    expect(worth.unvalued.map((item) => item.id)).toEqual(["acc-x"]);
  });

  it("lists the currencies in play with the base first", () => {
    expect(currenciesInUse([USD, EUR, VND], "VND")).toEqual(["VND", "EUR", "USD"]);
    expect(currenciesInUse([], "USD")).toEqual(["USD"]);
  });

  it("ignores closed accounts in the totals", () => {
    const closed = account({ id: "acc-closed", currency: "USD", deletedAt: "2026-09-02T00:00:00Z" });
    const worth = netWorthInBase([VND, closed], [], "2026-09-30", "VND", RATES);
    expect(worth.unvalued).toEqual([]);
    expect(worth.assetsCents).toBe(0);
  });
});

describe("rate table", () => {
  it("skips nonsense rates rather than storing them", () => {
    const table = buildRateTable([
      { from: "USD", to: "VND", rate: 0 },
      { from: "USD", to: "EUR", rate: Number.NaN },
      { from: "USD", to: "GBP", rate: 0.7862 },
    ]);
    expect(table[rateKey("USD", "VND")]).toBeUndefined();
    expect(table[rateKey("USD", "EUR")]).toBeUndefined();
    expect(table[rateKey("USD", "GBP")]).toBe(0.7862);
  });
});
