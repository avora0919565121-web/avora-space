import { logError } from "@/lib/log";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import type { RateTable } from "@/lib/currency";
import {
  buildLedger,
  postedEntries,
  toBaseLedger,
  unconvertibleEntries,
  type Account,
  type Category,
  type LedgerEntry,
  type Transaction,
} from "@/lib/finance";
import {
  createAccount,
  createCategory,
  createObligation,
  createTransaction,
  deleteCategory,
  fetchAccounts,
  fetchCategories,
  fetchFinanceTrash,
  purgeAccount,
  purgeTransaction,
  removeAccount,
  removeTransaction,
  restoreAccount,
  restoreTransaction,
  type FinanceTrash,
  fetchTransactions,
  financeKeys,
  setAccountClosed,
  setTransactionVoided,
  settleObligation,
  updateAccount,
  updateCategory,
  updateTransaction,
  type AccountDraft,
  type CategoryDraft,
  type ObligationInput,
  type TransactionInput,
} from "@/lib/finance-api";
import { useCurrencyRates, useProfileSettings } from "@/lib/use-settings";
import { useVaultUnlocked } from "@/lib/use-vault-lock";

export { financeKeys };

export function useAccounts(): UseQueryResult<Account[], Error> {
  const { user } = useAuth();
  // AVORA-51: nothing of Két sắt is asked for while it is locked (the server would refuse anyway).
  const isUnlocked = useVaultUnlocked();
  return useQuery<Account[], Error>({
    queryKey: financeKeys.accounts,
    queryFn: fetchAccounts,
    enabled: Boolean(user?.id) && isUnlocked,
  });
}

export function useCategories(): UseQueryResult<Category[], Error> {
  const { user } = useAuth();
  // AVORA-51: nothing of Két sắt is asked for while it is locked (the server would refuse anyway).
  const isUnlocked = useVaultUnlocked();
  return useQuery<Category[], Error>({
    queryKey: financeKeys.categories,
    queryFn: fetchCategories,
    enabled: Boolean(user?.id) && isUnlocked,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTransactions(): UseQueryResult<Transaction[], Error> {
  const { user } = useAuth();
  // AVORA-51: nothing of Két sắt is asked for while it is locked (the server would refuse anyway).
  const isUnlocked = useVaultUnlocked();
  return useQuery<Transaction[], Error>({
    queryKey: financeKeys.transactions,
    queryFn: fetchTransactions,
    enabled: Boolean(user?.id) && isUnlocked,
  });
}

/** Thùng rác Tài chính (Đợt gộp 2 · D2). */
export function useFinanceTrash(enabled: boolean = true): UseQueryResult<FinanceTrash, Error> {
  const { user } = useAuth();
  // AVORA-51: nothing of Két sắt is asked for while it is locked (the server would refuse anyway).
  const isUnlocked = useVaultUnlocked();
  return useQuery<FinanceTrash, Error>({
    queryKey: financeKeys.trash,
    queryFn: fetchFinanceTrash,
    enabled: Boolean(user?.id) && isUnlocked && enabled,
  });
}

export type Ledger = {
  accounts: Account[];
  categories: Category[];
  /** Every entry, including ones marked as an error. */
  allEntries: LedgerEntry[];
  /**
   * Entries that count, each still in the currency it was recorded in. The ledger list shows
   * these, because a 20 USD lunch should read as 20 USD and not as its converted shadow.
   */
  entries: LedgerEntry[];
  /**
   * The same entries restated in the base currency. Every total, chart and report reads these:
   * adding VND to USD would produce a number that means nothing.
   */
  baseEntries: LedgerEntry[];
  /** The currency totals are reported in — the person's own choice, from Hồ sơ. */
  currency: string;
  rates: RateTable;
  /** Entries no rate could value, so a screen can disclose them instead of dropping them. */
  unvalued: LedgerEntry[];
  /** True while the rate table or the base currency preference is still loading. */
  isConverting: boolean;
  isLoading: boolean;
  error: Error | null;
};

/** One join of the three queries, shared by every finance screen. */
export function useLedger(): Ledger {
  const accountsQuery = useAccounts();
  const categoriesQuery = useCategories();
  const transactionsQuery = useTransactions();

  const accounts = useMemo<Account[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = useMemo<Category[]>(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const transactions = useMemo<Transaction[]>(() => transactionsQuery.data ?? [], [transactionsQuery.data]);

  const allEntries = useMemo<LedgerEntry[]>(
    () => buildLedger(transactions, accounts, categories),
    [transactions, accounts, categories],
  );
  const entries = useMemo<LedgerEntry[]>(() => postedEntries(allEntries), [allEntries]);

  const settingsQuery = useProfileSettings();
  const ratesQuery = useCurrencyRates();
  const rates = useMemo<RateTable>(() => ratesQuery.data ?? {}, [ratesQuery.data]);

  /**
   * The base currency is the person's stated preference. Until it has loaded, fall back to a
   * currency actually present in the ledger rather than a hardcoded one, so the first paint
   * does not briefly relabel their money.
   */
  const currency = useMemo<string>(() => {
    if (settingsQuery.data !== undefined) return settingsQuery.data.baseCurrency;
    const open = accounts.find((account) => account.deletedAt === null);
    return open?.currency ?? accounts[0]?.currency ?? "USD";
  }, [settingsQuery.data, accounts]);

  const baseEntries = useMemo<LedgerEntry[]>(
    () => toBaseLedger(entries, currency, rates),
    [entries, currency, rates],
  );
  const unvalued = useMemo<LedgerEntry[]>(
    () => unconvertibleEntries(entries, currency, rates),
    [entries, currency, rates],
  );

  return {
    accounts,
    categories,
    allEntries,
    entries,
    baseEntries,
    currency,
    rates,
    unvalued,
    isConverting: settingsQuery.isLoading || ratesQuery.isLoading,
    isLoading: accountsQuery.isLoading || categoriesQuery.isLoading || transactionsQuery.isLoading,
    error: accountsQuery.error ?? categoriesQuery.error ?? transactionsQuery.error ?? null,
  };
}

export function useFinanceActions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  /**
   * Any write can move an account balance, which the database recomputes from the ledger,
   * so the cached accounts are refetched alongside the rows that changed.
   */
  const refreshLedger = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.accounts });
    void queryClient.invalidateQueries({ queryKey: financeKeys.transactions });
    void queryClient.invalidateQueries({ queryKey: financeKeys.trash });
  }, [queryClient]);

  const refreshCategories = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.categories });
  }, [queryClient]);

  const addAccount = useMutation({
    mutationFn: (draft: AccountDraft) => createAccount(userId, draft),
    onSuccess: refreshLedger,
  });

  const editAccount = useMutation({
    mutationFn: ({ accountId, draft }: { accountId: string; draft: AccountDraft }) =>
      updateAccount(accountId, draft),
    onSuccess: refreshLedger,
  });

  const closeAccount = useMutation({
    mutationFn: ({ accountId, closed }: { accountId: string; closed: boolean }) =>
      setAccountClosed(accountId, closed),
    onSuccess: refreshLedger,
  });

  const addCategory = useMutation({
    mutationFn: (draft: CategoryDraft) => createCategory(userId, draft),
    onSuccess: refreshCategories,
  });

  const editCategory = useMutation({
    mutationFn: ({ categoryId, draft }: { categoryId: string; draft: CategoryDraft }) =>
      updateCategory(categoryId, draft),
    onSuccess: () => {
      refreshCategories();
      refreshLedger();
    },
  });

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) => deleteCategory(categoryId),
    onSuccess: refreshCategories,
  });

  const addTransaction = useMutation({
    mutationFn: (input: TransactionInput) => createTransaction(userId, input),
    onSuccess: refreshLedger,
  });

  const editTransaction = useMutation({
    mutationFn: ({ transactionId, input }: { transactionId: string; input: TransactionInput }) =>
      updateTransaction(transactionId, input),
    onSuccess: refreshLedger,
  });

  const voidTransaction = useMutation({
    mutationFn: ({ transactionId, voided }: { transactionId: string; voided: boolean }) =>
      setTransactionVoided(transactionId, voided),
    onSuccess: refreshLedger,
  });

  const binAccount = useMutation({
    mutationFn: ({ accountId, withTransactions }: { accountId: string; withTransactions: boolean }) =>
      removeAccount(accountId, withTransactions),
    onSuccess: refreshLedger,
  });
  const unbinAccount = useMutation({ mutationFn: (accountId: string) => restoreAccount(accountId), onSuccess: refreshLedger });
  const binTransaction = useMutation({ mutationFn: (transactionId: string) => removeTransaction(transactionId), onSuccess: refreshLedger });
  const unbinTransaction = useMutation({ mutationFn: (transactionId: string) => restoreTransaction(transactionId), onSuccess: refreshLedger });
  const purgeTransactionMutation = useMutation({
    mutationFn: ({ transactionId, confirm }: { transactionId: string; confirm: string }) => purgeTransaction(transactionId, confirm),
    onSuccess: refreshLedger,
  });
  const purgeAccountMutation = useMutation({
    mutationFn: ({ accountId, confirm }: { accountId: string; confirm: string }) => purgeAccount(accountId, confirm),
    onSuccess: refreshLedger,
  });

  const addObligation = useMutation({
    mutationFn: (input: ObligationInput) => createObligation(input),
    onSuccess: refreshLedger,
  });

  const settleTransaction = useMutation({
    mutationFn: ({ transactionId, amountCents }: { transactionId: string; amountCents: number }) =>
      settleObligation(transactionId, amountCents),
    onSuccess: refreshLedger,
  });

  return {
    addAccount,
    editAccount,
    closeAccount,
    addCategory,
    editCategory,
    removeCategory,
    addTransaction,
    editTransaction,
    voidTransaction,
    addObligation,
    settleTransaction,
    binAccount,
    unbinAccount,
    binTransaction,
    unbinTransaction,
    purgeTransaction: purgeTransactionMutation,
    purgeAccount: purgeAccountMutation,
    isWorking:
      binAccount.isPending ||
      unbinAccount.isPending ||
      binTransaction.isPending ||
      unbinTransaction.isPending ||
      purgeTransactionMutation.isPending ||
      purgeAccountMutation.isPending ||
      addAccount.isPending ||
      editAccount.isPending ||
      closeAccount.isPending ||
      addCategory.isPending ||
      editCategory.isPending ||
      removeCategory.isPending ||
      addTransaction.isPending ||
      editTransaction.isPending ||
      voidTransaction.isPending ||
      addObligation.isPending ||
      settleTransaction.isPending,
  };
}

const DISMISSED_KEY = "avora.finance.recurring-dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Skipping a recurring reminder is a local preference, not ledger data — nothing financial
 * happened, so nothing is written to the database.
 */
export function useDismissedRecurring(): { dismissed: Set<string>; dismiss: (key: string) => void } {
  const [keys, setKeys] = useState<string[]>(() => readDismissed());

  const dismiss = useCallback((key: string): void => {
    setKeys((current) => {
      if (current.includes(key)) return current;
      const next = [...current, key].slice(-200);
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch (error) {
        logError("finance", error);
      }
      return next;
    });
  }, []);

  const dismissed = useMemo<Set<string>>(() => new Set(keys), [keys]);
  return { dismissed, dismiss };
}
