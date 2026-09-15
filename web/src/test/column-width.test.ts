import { describe, expect, it } from "vitest";

import {
  clampColumnWidth,
  LIST_COLUMN,
  NAV_COLUMN,
  parseColumnWidth,
  storageKey,
} from "@/lib/column-width";

describe("column width limits", () => {
  it("keeps a dragged width inside the column's own range", () => {
    expect(clampColumnWidth(150, NAV_COLUMN)).toBe(NAV_COLUMN.min);
    expect(clampColumnWidth(999, NAV_COLUMN)).toBe(NAV_COLUMN.max);
    expect(clampColumnWidth(300, NAV_COLUMN)).toBe(300);
    expect(clampColumnWidth(100, LIST_COLUMN)).toBe(LIST_COLUMN.min);
    expect(clampColumnWidth(9999, LIST_COLUMN)).toBe(LIST_COLUMN.max);
    expect(clampColumnWidth(420, LIST_COLUMN)).toBe(420);
  });

  it("stores whole pixels", () => {
    expect(clampColumnWidth(300.4, NAV_COLUMN)).toBe(300);
    expect(clampColumnWidth(300.6, NAV_COLUMN)).toBe(301);
  });

  it("uses different ranges for the rail and the list", () => {
    expect(NAV_COLUMN.min).toBeLessThan(LIST_COLUMN.min);
    expect(NAV_COLUMN.max).toBeLessThan(LIST_COLUMN.max);
  });
});

describe("a remembered width", () => {
  it("reads a stored pixel value back", () => {
    expect(parseColumnWidth("320", NAV_COLUMN)).toBe(320);
    expect(parseColumnWidth("480", LIST_COLUMN)).toBe(480);
  });

  it("clamps a stale or impossible value instead of trusting it", () => {
    expect(parseColumnWidth("10", NAV_COLUMN)).toBe(NAV_COLUMN.min);
    expect(parseColumnWidth("99999", NAV_COLUMN)).toBe(NAV_COLUMN.max);
    expect(parseColumnWidth("-40", LIST_COLUMN)).toBe(LIST_COLUMN.min);
  });

  it("falls back on nothing stored or unreadable", () => {
    expect(parseColumnWidth(null, NAV_COLUMN)).toBe(NAV_COLUMN.fallback);
    expect(parseColumnWidth("abc", NAV_COLUMN)).toBe(NAV_COLUMN.fallback);
    expect(parseColumnWidth("", LIST_COLUMN)).toBe(LIST_COLUMN.fallback);
  });
});

describe("storage", () => {
  it("keys each column separately, per device", () => {
    expect(storageKey("nav")).toBe("avora.column.nav");
    expect(storageKey("list")).toBe("avora.column.list");
    expect(storageKey("nav")).not.toBe(storageKey("list"));
  });
});
