import { useMemo, useSyncExternalStore } from "react";

import { buildLedger, postedEntries, toBaseLedger, todayIso, unconvertibleEntries } from "@/lib/finance";
import { buildSampleBook } from "@/lib/finance-sample";
import { useLedger, type Ledger } from "@/lib/use-finance";
import { useGuidance } from "@/lib/use-task-flags";

/**
 * KT-07c (CEO 12/11 · 17): which book Tài chính shows — "Sổ của tôi" or the static "Sổ mẫu".
 *
 * Rules: a person whose own book is still empty starts on the sample (unless they hid it); once
 * their book has something, it opens on theirs. The sample is never shown while the real book is
 * loading or failed to load ("khi lỗi tải không hiện mẫu"). The choice lives in memory for the
 * session only; hiding is per account (dismissed_guidance `sample_hidden_finance`).
 */
export type FinanceBookMode = "mine" | "sample";

let chosen: FinanceBookMode | null = null;
const listeners = new Set<() => void>();
export function chooseFinanceBook(mode: FinanceBookMode | null): void {
  chosen = mode;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const read = (): FinanceBookMode | null => chosen;

/** The decision itself, pure (tested): what to show given what is known. */
export function financeBookMode(input: { chosen: FinanceBookMode | null; hidden: boolean; real: Pick<Ledger, "isLoading" | "isUnavailable" | "accounts" | "allEntries"> }): FinanceBookMode {
  const { real } = input;
  if (real.isLoading || real.isUnavailable || input.hidden) return "mine";
  if (input.chosen !== null) return input.chosen;
  return real.accounts.length === 0 && real.allEntries.length === 0 ? "sample" : "mine";
}

export type BookLedger = Ledger & {
  isSample: boolean;
  /** The toggle can show: the sample is not hidden and the real book could be read. */
  canShowSample: boolean;
  setBook: (mode: FinanceBookMode) => void;
  hideSample: () => void;
  /** KT-09: the sample was hidden and the real book is readable — "Xem lại mẫu" can bring it back. */
  canRestoreSample: boolean;
  restoreSample: () => void;
};

export function useBookLedger(): BookLedger {
  const real = useLedger();
  const picked = useSyncExternalStore(subscribe, read, read);
  const { shouldShow, dismiss, isDismissed, restore } = useGuidance();
  // While the dismissed list is still loading `shouldShow` says false — read as hidden, so the real
  // book shows first and the sample never flashes for someone who hid it.
  const hidden = !shouldShow("sample_hidden_finance");
  const mode = financeBookMode({ chosen: picked, hidden, real });
  const sample = useMemo<Ledger | null>(() => {
    if (mode !== "sample") return null;
    const book = buildSampleBook(todayIso(), real.currency);
    const allEntries = buildLedger(book.transactions, book.accounts, book.categories);
    const entries = postedEntries(allEntries);
    return {
      ...real,
      accounts: book.accounts,
      categories: book.categories,
      allEntries,
      entries,
      baseEntries: toBaseLedger(entries, real.currency, real.rates),
      unvalued: unconvertibleEntries(entries, real.currency, real.rates),
      isLoading: false,
      isUnavailable: false,
      error: null,
    };
  }, [mode, real]);
  return {
    ...(sample ?? real),
    isSample: mode === "sample",
    canShowSample: !hidden && !real.isLoading && !real.isUnavailable,
    setBook: chooseFinanceBook,
    hideSample: () => {
      chooseFinanceBook(null);
      dismiss("sample_hidden_finance");
    },
    canRestoreSample: isDismissed("sample_hidden_finance") && !real.isLoading && !real.isUnavailable,
    restoreSample: () => {
      restore("sample_hidden_finance");
      chooseFinanceBook("sample");
    },
  };
}
