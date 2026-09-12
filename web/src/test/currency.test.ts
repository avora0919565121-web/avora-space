import {
  buildRateTable,
  convertCents,
  CURRENCIES,
  currenciesByRegion,
  currencyByCode,
  formatRate,
  isSupportedCurrency,
  minorUnitsOf,
  rateFor,
  rateKey,
  roundToMinorUnits,
  type RateTable,
} from "@/lib/currency";
import { formatMoney } from "@/lib/finance";

/**
 * The same USD anchor the migration seeds, in both directions — so these tests exercise the
 * real resolution paths (direct, inverted, triangulated) rather than a convenient fixture.
 */
const ANCHOR: readonly [string, number][] = [
  ["VND", 23984.96],
  ["EUR", 0.9231],
  ["GBP", 0.7862],
  ["JPY", 149.5],
  ["CNY", 7.285],
  ["SGD", 1.3567],
  ["THB", 35.67],
  ["MYR", 4.6835],
  ["INR", 83.12],
  ["KRW", 1306.5],
  ["HKD", 7.7854],
  ["AUD", 1.5234],
  ["NZD", 1.6543],
  ["CAD", 1.3621],
  ["MXN", 17.0523],
  ["BRL", 4.9876],
  ["CHF", 0.8901],
  ["SEK", 10.4532],
  ["ZAR", 18.5234],
];

const RATES: RateTable = buildRateTable([
  ...ANCHOR.map(([code, rate]) => ({ from: "USD", to: code, rate })),
  ...ANCHOR.map(([code, rate]) => ({ from: code, to: "USD", rate: 1 / rate })),
]);

describe("currency catalogue", () => {
  it("supports exactly the twenty currencies the brief asked for", () => {
    expect(CURRENCIES).toHaveLength(20);
    const codes = CURRENCIES.map((entry) => entry.code);
    for (const wanted of [
      "VND", "USD", "EUR", "GBP", "JPY", "CNY", "SGD", "THB", "MYR", "INR",
      "KRW", "AUD", "CAD", "NZD", "MXN", "BRL", "CHF", "SEK", "ZAR", "HKD",
    ]) {
      expect(codes).toContain(wanted);
    }
  });

  it("knows which currencies have no subunit", () => {
    expect(minorUnitsOf("VND")).toBe(0);
    expect(minorUnitsOf("JPY")).toBe(0);
    expect(minorUnitsOf("KRW")).toBe(0);
    expect(minorUnitsOf("USD")).toBe(2);
    expect(CURRENCIES.filter((entry) => entry.minorUnits === 0)).toHaveLength(3);
  });

  it("refuses a currency it cannot value", () => {
    expect(isSupportedCurrency("XYZ")).toBe(false);
    expect(isSupportedCurrency("vnd")).toBe(true);
    expect(currencyByCode("XYZ")).toBeNull();
  });

  it("files every currency under exactly one region, correcting the brief's grouping", () => {
    const groups = currenciesByRegion();
    expect(groups.flatMap((group) => group.currencies)).toHaveLength(20);
    // The brief listed USD, EUR and GBP as "Asian" and ZAR and HKD as "Europe/Middle East".
    expect(currencyByCode("USD")?.region).toBe("americas");
    expect(currencyByCode("GBP")?.region).toBe("europe");
    expect(currencyByCode("ZAR")?.region).toBe("africa");
    expect(currencyByCode("HKD")?.region).toBe("asia");
  });

  it("writes a zero-decimal currency without decimals", () => {
    expect(formatMoney(47_969_900, "VND")).not.toContain(",00");
    expect(formatMoney(47_969_900, "VND")).toContain("479.699");
    expect(formatMoney(2_000, "USD")).toBe("$20.00");
  });
});

describe("rateFor", () => {
  it("returns 1 for the same currency without consulting the table", () => {
    expect(rateFor("USD", "USD", {})).toBe(1);
    expect(rateFor("vnd", "VND", {})).toBe(1);
  });

  it("uses a stored pair directly", () => {
    expect(rateFor("USD", "VND", RATES)).toBe(23984.96);
  });

  it("inverts the reverse pair when only that direction is stored", () => {
    const onlyForward: RateTable = { [rateKey("USD", "VND")]: 23984.96 };
    expect(rateFor("VND", "USD", onlyForward)).toBeCloseTo(1 / 23984.96, 12);
  });

  /**
   * Nothing seeds a VND->JPY pair, and nothing ever will for all 380 ordered combinations,
   * so the answer has to be triangulated through the anchor.
   */
  it("triangulates a pair that is not stored in either direction", () => {
    expect(RATES[rateKey("VND", "JPY")]).toBeUndefined();
    const rate = rateFor("VND", "JPY", RATES);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(149.5 / 23984.96, 10);
  });

  it("closes the round trip, so a total cannot depend on which way it was computed", () => {
    for (const [code] of ANCHOR) {
      const there = rateFor("USD", code, RATES);
      const back = rateFor(code, "USD", RATES);
      expect(there! * back!).toBeCloseTo(1, 10);
    }
  });

  it("reaches every one of the 380 ordered pairs", () => {
    let unreachable = 0;
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        if (from.code === to.code) continue;
        if (rateFor(from.code, to.code, RATES) === null) unreachable += 1;
      }
    }
    expect(unreachable).toBe(0);
  });

  it("gives up rather than guess when a currency is unknown", () => {
    expect(rateFor("USD", "XYZ", RATES)).toBeNull();
    expect(rateFor("", "USD", RATES)).toBeNull();
  });
});

describe("convertCents", () => {
  it("matches the database to the cent on the brief's own example", () => {
    // 20 USD at 23,984.96 is 479,699.20 VND, which rounds to a whole dong.
    expect(convertCents(2_000, "USD", "VND", RATES)).toBe(479_699 * 100);
  });

  it("rounds to what the target currency can actually express", () => {
    // VND has no subunit, so the result must be a whole number of dong.
    const vnd = convertCents(1_300, "USD", "VND", RATES);
    expect(vnd! % 100).toBe(0);
    const jpy = convertCents(100_000_000, "VND", "JPY", RATES);
    expect(jpy! % 100).toBe(0);
    // USD does have one, so cents survive.
    expect(convertCents(100_000_000, "VND", "USD", RATES)! % 100).not.toBe(0);
  });

  it("leaves an amount untouched when there is nothing to convert", () => {
    expect(convertCents(1_234, "USD", "USD", RATES)).toBe(1_234);
  });

  it("returns null instead of a confident zero when no rate can bridge the pair", () => {
    expect(convertCents(1_000, "USD", "XYZ", RATES)).toBeNull();
  });

  it("keeps a converted amount stable across a round trip", () => {
    const asVnd = convertCents(2_000, "USD", "VND", RATES);
    const backToUsd = convertCents(asVnd!, "VND", "USD", RATES);
    expect(backToUsd).toBe(2_000);
  });

  it("rounds a half up rather than toward zero", () => {
    expect(roundToMinorUnits(150, "VND")).toBe(200);
    expect(roundToMinorUnits(149, "VND")).toBe(100);
    expect(roundToMinorUnits(149, "USD")).toBe(149);
  });
});

describe("formatRate", () => {
  it("states the rate the way the reports header shows it", () => {
    expect(formatRate("USD", "VND", RATES)).not.toBeNull();
    expect(formatRate("USD", "XYZ", RATES)).toBeNull();
  });
});
