import { MemoryRouter } from "react-router-dom";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Transaction } from "@/lib/finance";

/**
 * The Két sắt badge in real Chromium.
 *
 * What is being protected here is not a number but a silence: this badge is visible on every
 * screen of the app, outside the vault, so it may say how many things are waiting and nothing
 * whatsoever about what they are.
 */

const state = vi.hoisted(() => ({
  transactions: [] as Transaction[],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u-me", email: "me@avora.app" }, signOut: async () => {} }),
  useDisplayName: () => "Người dùng",
}));

vi.mock("@/lib/use-conversations", () => ({ useTotalUnread: () => 0 }));
vi.mock("@/lib/use-tasks", () => ({ useTasks: () => ({ data: [] }) }));

vi.mock("@/lib/use-finance", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-finance")>("@/lib/use-finance");
  return {
    ...actual,
    useTransactions: () => ({ data: state.transactions }),
  };
});

const { AppSidebar } = await import("@/components/AppSidebar");

function dayFromToday(offset: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${month}-${day}`;
}

function obligation(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountId: "acc-1",
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

async function mount(transactions: Transaction[]) {
  state.transactions = transactions;
  return await render(
    <div style={{ width: 260 }}>
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>
    </div>,
  );
}

describe("the rail says Két sắt wants attention, and nothing more", () => {
  it("stays unlit when no money is due", async () => {
    const screen = await mount([obligation({ id: "far", dueDate: dayFromToday(40) })]);
    await expect.element(screen.getByText("Két sắt")).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("khoản tới hạn");
  });

  it("counts what is late together with what is due this week", async () => {
    const screen = await mount([
      obligation({ id: "late", dueDate: dayFromToday(-4) }),
      obligation({ id: "now", dueDate: dayFromToday(0) }),
      obligation({ id: "soon", dueDate: dayFromToday(6), type: "thue_ca_nhan", contactId: null }),
      obligation({ id: "far", dueDate: dayFromToday(30) }),
    ]);
    await expect.element(screen.getByLabelText("3 khoản tới hạn")).toBeInTheDocument();
  });

  it("never shows the amount, the kind, or who it is with", async () => {
    const screen = await mount([
      obligation({ id: "late", dueDate: dayFromToday(-4), amountCents: 777_700, description: "Vay anh Ba" }),
    ]);
    await expect.element(screen.getByLabelText("1 khoản tới hạn")).toBeInTheDocument();

    const rail = screen.container.textContent ?? "";
    expect(rail).not.toContain("7,777");
    expect(rail).not.toContain("anh Ba");
    expect(rail).not.toContain("Vay");
    expect(rail).not.toContain("Thuế");
  });

  it("stops counting an obligation once it has been paid off", async () => {
    const screen = await mount([
      obligation({ id: "paid", dueDate: dayFromToday(-4), settledCents: 100_000 }),
      obligation({ id: "now", dueDate: dayFromToday(0) }),
    ]);
    await expect.element(screen.getByLabelText("1 khoản tới hạn")).toBeInTheDocument();
  });

  it("ignores a row marked as an error", async () => {
    const screen = await mount([
      obligation({ id: "oops", dueDate: dayFromToday(-4), deletedAt: "2026-09-10T00:00:00Z" }),
    ]);
    expect(screen.container.textContent).not.toContain("khoản tới hạn");
  });

  it("leaves the badges the other tabs already had alone", async () => {
    const screen = await mount([obligation({ id: "now", dueDate: dayFromToday(0) })]);
    await expect.element(screen.getByText("Tin nhắn")).toBeInTheDocument();
    await expect.element(screen.getByText("Nhiệm vụ")).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("tin nhắn chưa đọc");
  });
});
