import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Account, Category, Transaction } from "@/lib/finance";

/**
 * What Tổng quan says about money that is asking to be paid or collected, in real Chromium:
 * the three counts, which of them shouts, and where each one sends a person who taps it.
 */

const state = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  navigated: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

const WALLET_ID = "acc-1";

vi.mock("@/lib/finance-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/finance-api")>("@/lib/finance-api");
  return {
    ...actual,
    fetchAccounts: async () => [
      {
        id: WALLET_ID,
        name: "Ví tiền mặt",
        type: "cash",
        openingBalanceCents: 500_000,
        balanceCents: 500_000,
        currency: "USD",
        otherPersonName: null,
        accountNumber: null,
        tags: [],
        createdAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      } satisfies Account,
    ],
    fetchCategories: async () => [
      {
        id: "cat-groceries",
        name: "Tạp hoá",
        origin: "predefined",
        appliesTo: "expense",
        color: "#E0603C",
        slug: "groceries",
        sortOrder: 10,
        deletedAt: null,
      } satisfies Category,
    ],
    fetchTransactions: async () => state.transactions,
  };
});

vi.mock("@/lib/use-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-settings")>("@/lib/use-settings");
  return {
    ...actual,
    useProfileSettings: () => ({ data: { baseCurrency: "USD" }, isLoading: false }),
    useCurrencyRates: () => ({ data: {}, isLoading: false }),
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      state.navigated.push(to);
    },
  };
});

const Finance = (await import("@/pages/Finance")).default;

/**
 * "Today" is the day the browser is running on, so the fixtures are built relative to it —
 * a hardcoded date would make this suite start failing on its own one morning.
 */
function dayFromToday(offset: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${month}-${day}`;
}

function obligation(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountId: WALLET_ID,
    categoryId: null,
    type: "vay",
    amountCents: 100_000,
    currency: "USD",
    amountInBaseCents: 100_000,
    baseCurrency: "USD",
    conversionRate: 1,
    description: null,
    date: dayFromToday(-30),
    businessRelated: false,
    businessPurpose: null,
    receiptPath: null,
    isRecurring: false,
    recurringFrequency: null,
    recurringLabel: null,
    contactId: "c-ba",
    dueDate: dayFromToday(0),
    status: "ke_hoach",
    settledCents: 0,
    taxPeriodStart: null,
    taxPeriodEnd: null,
    createdAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

async function openOverview(transactions: Transaction[]) {
  state.transactions = transactions;
  state.navigated = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <div style={{ width: 900 }}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Finance />
        </MemoryRouter>
      </QueryClientProvider>
    </div>,
  );
  // The four stat cards paint before the data arrives, so they cannot be the signal. The
  // account count only appears once the accounts query has actually resolved.
  await expect.element(screen.getByText("1 tài khoản đang mở")).toBeInTheDocument();
  return screen;
}

describe("the overview says what money is asking for today", () => {
  it("shows nothing at all when there is no borrowing, lending or tax", async () => {
    const screen = await openOverview([]);
    expect(screen.container.querySelector("#due-strip-title")).toBeNull();
  });

  it("leaves the four existing figures exactly where they were", async () => {
    const screen = await openOverview([obligation({ id: "ob-1" })]);
    await expect.element(screen.getByText("Tổng tài sản")).toBeInTheDocument();
    await expect.element(screen.getByText("Thu tháng này")).toBeInTheDocument();
    await expect.element(screen.getByText("Chi tháng này")).toBeInTheDocument();
    await expect.element(screen.getByText("Giá trị ròng")).toBeInTheDocument();
  });

  it("counts late, today and the week ahead as three separate numbers", async () => {
    const screen = await openOverview([
      obligation({ id: "late-1", dueDate: dayFromToday(-9) }),
      obligation({ id: "late-2", dueDate: dayFromToday(-1), type: "thue_ca_nhan", contactId: null }),
      obligation({ id: "now", dueDate: dayFromToday(0), type: "cho_vay" }),
      obligation({ id: "soon", dueDate: dayFromToday(5) }),
      obligation({ id: "far", dueDate: dayFromToday(40) }),
    ]);

    await expect.element(screen.getByLabelText("Quá hạn: 2 khoản")).toBeInTheDocument();
    await expect.element(screen.getByLabelText("Hôm nay: 1 khoản")).toBeInTheDocument();
    await expect.element(screen.getByLabelText("7 ngày tới: 1 khoản")).toBeInTheDocument();
  });

  it("never folds what is late into the calmer number beside it", async () => {
    const screen = await openOverview([
      obligation({ id: "late", dueDate: dayFromToday(-3) }),
      obligation({ id: "soon", dueDate: dayFromToday(2) }),
    ]);

    await expect.element(screen.getByLabelText("Quá hạn: 1 khoản")).toBeInTheDocument();
    // The week ahead holds only the one that is genuinely still ahead.
    await expect.element(screen.getByLabelText("7 ngày tới: 1 khoản")).toBeInTheDocument();
  });

  it("names the late ones first in the line above the numbers", async () => {
    const screen = await openOverview([
      obligation({ id: "late", dueDate: dayFromToday(-3) }),
      obligation({ id: "soon", dueDate: dayFromToday(2) }),
    ]);
    await expect.element(screen.getByText("1 khoản đã quá hạn")).toBeInTheDocument();
  });

  it("stops counting an obligation that has been paid off", async () => {
    const screen = await openOverview([
      obligation({ id: "paid", dueDate: dayFromToday(-3), settledCents: 100_000 }),
      obligation({ id: "now", dueDate: dayFromToday(0) }),
    ]);
    await expect.element(screen.getByLabelText("Quá hạn: 0 khoản")).toBeInTheDocument();
    await expect.element(screen.getByLabelText("Hôm nay: 1 khoản")).toBeInTheDocument();
  });

  it("opens the same ledger, filtered, when a number is tapped", async () => {
    const screen = await openOverview([obligation({ id: "late", dueDate: dayFromToday(-3) })]);

    await userEvent.click(screen.getByLabelText("Quá hạn: 1 khoản"));
    expect(state.navigated).toEqual(["/ket-sat/giao-dich?can_lam=qua_han"]);
  });

  it("does not offer to open a list that would be empty", async () => {
    const screen = await openOverview([obligation({ id: "late", dueDate: dayFromToday(-3) })]);
    await expect.element(screen.getByLabelText("Hôm nay: 0 khoản")).toBeDisabled();
  });

  it("shows counts only — the strip never states an amount", async () => {
    const screen = await openOverview([
      obligation({ id: "late", dueDate: dayFromToday(-3), amountCents: 777_700 }),
    ]);
    await expect.element(screen.getByLabelText("Quá hạn: 1 khoản")).toBeInTheDocument();
    const strip = screen.container.querySelector("section[aria-labelledby='due-strip-title']");
    expect(strip).not.toBeNull();
    expect(strip?.textContent ?? "").not.toContain("7,777");
  });
});

describe("net worth counts what is owed each way", () => {
  it("adds money lent out to what a person is worth", async () => {
    const screen = await openOverview([
      obligation({ id: "lent", type: "cho_vay", amountCents: 100_000, dueDate: dayFromToday(20) }),
    ]);
    // 500000 opening - 100000 lent out = 400000 in the account, plus 100000 still to come back.
    await expect.element(screen.getByText("Đã cộng $1,000.00 cho vay chưa thu về")).toBeInTheDocument();
  });

  it("subtracts money borrowed, which is sitting in the account but is not yours", async () => {
    const screen = await openOverview([
      obligation({ id: "borrowed", type: "vay", amountCents: 300_000, dueDate: dayFromToday(20) }),
    ]);
    await expect.element(screen.getByText(/Đã trừ nợ/)).toBeInTheDocument();
    await expect.element(screen.getByText("$3,000.00")).toBeInTheDocument();
  });

  it("says there is no debt when a tax bill is the only thing outstanding", async () => {
    const screen = await openOverview([
      obligation({ id: "tax", type: "thue_ca_nhan", contactId: null, dueDate: dayFromToday(3) }),
    ]);
    // The account balance already fell when the bill was written; counting it again would
    // subtract the same money twice.
    await expect.element(screen.getByText("Không có khoản nợ nào")).toBeInTheDocument();
  });
});
