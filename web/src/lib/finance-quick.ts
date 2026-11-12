import { activeAccounts, isLiabilityAccount, type Account } from "@/lib/finance";

/** The wallet created for a first expense when the book has none (CEO 12/11 · 6). */
export const CASH_WALLET_NAME = "Tiền mặt";

/**
 * Which account a quick expense goes to: an open cash wallet first, then any open account that is
 * not a debt. Null means the book has nowhere to put it yet — the sheet then makes "Tiền mặt".
 */
export function quickExpenseAccount(accounts: readonly Account[]): Account | null {
  const open = activeAccounts(accounts);
  return open.find((account) => account.type === "cash") ?? open.find((account) => !isLiabilityAccount(account.type)) ?? null;
}
