/**
 * Phase 4B.1 multi-currency support. Pure: no Supabase, no React.
 *
 * Money stays integer hundredths of a currency unit everywhere (see finance.ts). A currency's
 * own subunit count decides only two things: how it is written, and how a converted figure is
 * rounded. VND, JPY and KRW have no subunit, so "479,699.20 ₫" is not a real amount.
 */

export type CurrencyRegion = "asia" | "pacific" | "americas" | "europe" | "africa";

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  minorUnits: 0 | 2;
  region: CurrencyRegion;
};

/**
 * The twenty supported currencies, in the same order and with the same subunit counts as the
 * `currencies` table. Regions are corrected from the brief, which filed USD, EUR and GBP
 * under "Asian" and ZAR and HKD under "Europe/Middle East".
 */
export const CURRENCIES: readonly Currency[] = [
  { code: "VND", name: "Việt Nam Đồng", symbol: "₫", minorUnits: 0, region: "asia" },
  { code: "USD", name: "Đô la Mỹ", symbol: "$", minorUnits: 2, region: "americas" },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2, region: "europe" },
  { code: "GBP", name: "Bảng Anh", symbol: "£", minorUnits: 2, region: "europe" },
  { code: "JPY", name: "Yên Nhật", symbol: "¥", minorUnits: 0, region: "asia" },
  { code: "CNY", name: "Nhân dân tệ", symbol: "¥", minorUnits: 2, region: "asia" },
  { code: "SGD", name: "Đô la Singapore", symbol: "S$", minorUnits: 2, region: "asia" },
  { code: "THB", name: "Baht Thái", symbol: "฿", minorUnits: 2, region: "asia" },
  { code: "MYR", name: "Ringgit Malaysia", symbol: "RM", minorUnits: 2, region: "asia" },
  { code: "INR", name: "Rupee Ấn Độ", symbol: "₹", minorUnits: 2, region: "asia" },
  { code: "KRW", name: "Won Hàn Quốc", symbol: "₩", minorUnits: 0, region: "asia" },
  { code: "HKD", name: "Đô la Hồng Kông", symbol: "HK$", minorUnits: 2, region: "asia" },
  { code: "AUD", name: "Đô la Úc", symbol: "A$", minorUnits: 2, region: "pacific" },
  { code: "NZD", name: "Đô la New Zealand", symbol: "NZ$", minorUnits: 2, region: "pacific" },
  { code: "CAD", name: "Đô la Canada", symbol: "C$", minorUnits: 2, region: "americas" },
  { code: "MXN", name: "Peso Mexico", symbol: "MX$", minorUnits: 2, region: "americas" },
  { code: "BRL", name: "Real Brazil", symbol: "R$", minorUnits: 2, region: "americas" },
  { code: "CHF", name: "Franc Thụy Sĩ", symbol: "CHF", minorUnits: 2, region: "europe" },
  { code: "SEK", name: "Krona Thụy Điển", symbol: "kr", minorUnits: 2, region: "europe" },
  { code: "ZAR", name: "Rand Nam Phi", symbol: "R", minorUnits: 2, region: "africa" },
] as const;

export const REGION_LABELS: Record<CurrencyRegion, string> = {
  asia: "Châu Á",
  pacific: "Châu Đại Dương",
  americas: "Châu Mỹ",
  europe: "Châu Âu",
  africa: "Châu Phi",
};

export const DEFAULT_BASE_CURRENCY = "VND";

const BY_CODE: Map<string, Currency> = new Map(CURRENCIES.map((entry) => [entry.code, entry]));

export function currencyByCode(code: string | null | undefined): Currency | null {
  if (code === null || code === undefined) return null;
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return currencyByCode(code) !== null;
}

/** Unknown codes are treated as two-subunit, the safer assumption for display. */
export function minorUnitsOf(code: string | null | undefined): 0 | 2 {
  return currencyByCode(code)?.minorUnits ?? 2;
}

export function currenciesByRegion(): { region: CurrencyRegion; currencies: Currency[] }[] {
  const order: CurrencyRegion[] = ["asia", "pacific", "americas", "europe", "africa"];
  return order
    .map((region) => ({ region, currencies: CURRENCIES.filter((entry) => entry.region === region) }))
    .filter((group) => group.currencies.length > 0);
}

// ---------------------------------------------------------------- rates

/** Stored rates, keyed `FROM>TO`. Only USD pairs are seeded; everything else is derived. */
export type RateTable = Readonly<Record<string, number>>;

export function rateKey(from: string, to: string): string {
  return `${from.trim().toUpperCase()}>${to.trim().toUpperCase()}`;
}

export function buildRateTable(rows: readonly { from: string; to: string; rate: number }[]): RateTable {
  const table: Record<string, number> = {};
  for (const row of rows) {
    if (!Number.isFinite(row.rate) || row.rate <= 0) continue;
    table[rateKey(row.from, row.to)] = row.rate;
  }
  return table;
}

/**
 * The rate for a pair, resolved exactly as `currency_rate_at` does in the database:
 * identity, then the stored pair, then the reverse inverted, then through USD.
 *
 * Only USD pairs are stored, so most answers are triangulated. That is deliberate: seeding
 * hand-written cross rates alongside them makes the answer depend on which row is found
 * first, and the brief's own figures disagreed by ~0.04%.
 */
export function rateFor(from: string, to: string, rates: RateTable): number | null {
  const a = from.trim().toUpperCase();
  const b = to.trim().toUpperCase();
  if (a === "" || b === "") return null;
  if (a === b) return 1;

  const direct = rates[rateKey(a, b)];
  if (direct !== undefined) return direct;

  const reverse = rates[rateKey(b, a)];
  if (reverse !== undefined && reverse > 0) return 1 / reverse;

  if (a !== "USD" && b !== "USD") {
    const legIn = rateFor(a, "USD", rates);
    const legOut = rateFor("USD", b, rates);
    if (legIn !== null && legOut !== null) return legIn * legOut;
  }
  return null;
}

/** Rounds hundredths to something the target currency can actually express. */
export function roundToMinorUnits(cents: number, currency: string): number {
  const step = minorUnitsOf(currency) === 0 ? 100 : 1;
  return Math.round(cents / step) * step;
}

/**
 * Converts an amount in hundredths from one currency to another, or null when the pair
 * cannot be bridged. Null is deliberate: a missing rate must show as "not valued", never
 * as a confident zero.
 */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  rates: RateTable,
): number | null {
  if (from.trim().toUpperCase() === to.trim().toUpperCase()) return cents;
  const rate = rateFor(from, to, rates);
  if (rate === null) return null;
  return roundToMinorUnits(cents * rate, to);
}

/** How many units of `to` one unit of `from` buys, for the "1 USD = 23,984.96 ₫" line. */
export function formatRate(from: string, to: string, rates: RateTable): string | null {
  const rate = rateFor(from, to, rates);
  if (rate === null) return null;
  const units = minorUnitsOf(to);
  const digits = rate >= 100 ? units : rate >= 1 ? 4 : 8;
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: units === 0 && rate >= 100 ? 0 : Math.min(digits, 8),
    maximumFractionDigits: Math.min(digits, 8),
  }).format(rate);
}
