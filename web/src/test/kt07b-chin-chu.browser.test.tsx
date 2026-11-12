import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Account, Category } from "@/lib/finance";

const state = vi.hoisted(() => ({ accounts: [] as unknown[], transactions: [] as unknown[], firsts: [] as unknown[], refuse: false }));

vi.mock("@/lib/use-finance", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-finance")>("@/lib/use-finance");
  return {
    ...actual,
    useFinanceActions: () => ({
      addAccount: { mutateAsync: async (draft: { name: string; type: string; currency: string }) => { state.accounts.push(draft); return { id: "new-cash", name: draft.name, type: draft.type, currency: draft.currency }; } },
      addTransaction: { mutateAsync: async (input: unknown) => { state.transactions.push(input); return input; } },
      // KT-08 · QA05-01: wallet + expense in one database transaction.
      addFirstExpense: {
        mutateAsync: async (input: unknown) => {
          if (state.refuse) throw new Error("Ngày giao dịch không thể ở tương lai.");
          state.firsts.push(input);
          return input;
        },
      },
    }),
  };
});

const { SettingsMenu } = await import("@/components/settings/SettingsMenu");
const { QuickExpenseSheet } = await import("@/components/finance/QuickExpenseSheet");
const { Dialog, DialogContent, DialogTitle } = await import("@/components/ui/dialog");
const { SETTINGS_TABS } = await import("@/lib/navigation");

afterEach(async () => {
  await page.viewport(414, 896);
  state.accounts = [];
  state.transactions = [];
  state.firsts = [];
  state.refuse = false;
});

test("KT-07b · 3: Cài đặt là danh sách nhóm; trên điện thoại hàng Hồ sơ mở /cai-dat/ho-so", async () => {
  await page.viewport(390, 844);
  const screen = await render(
    <MemoryRouter initialEntries={["/cai-dat"]}>
      <SettingsMenu tabs={SETTINGS_TABS} variant="page" />
    </MemoryRouter>,
  );
  await expect.element(screen.getByRole("heading", { name: "Tài khoản" })).toBeInTheDocument();
  expect([...document.querySelectorAll("[data-settings-menu] h2")].map((h) => h.textContent)).toEqual(["Tài khoản", "Giao diện & thông báo", "Dữ liệu & dung lượng", "Trợ giúp & góp ý"]);
  expect(document.querySelector('[data-settings-row="/cai-dat"]')?.getAttribute("href")).toBe("/cai-dat/ho-so");
  // Every row ≥ 44px and fully inside the 390px screen — no cut-off tab like "ách", "Du…".
  for (const row of document.querySelectorAll<HTMLElement>("[data-settings-row]")) {
    const box = row.getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(390);
  }
});

test("KT-07b · 3: máy tính — cột trái đánh dấu mục đang mở", async () => {
  await page.viewport(1440, 900);
  await render(
    <MemoryRouter initialEntries={["/cai-dat/thong-bao"]}>
      <SettingsMenu tabs={SETTINGS_TABS} variant="side" />
    </MemoryRouter>,
  );
  expect(document.querySelector('[aria-current="page"]')?.getAttribute("data-settings-row")).toBe("/cai-dat/thong-bao");
});

const categories: Category[] = [
  { id: "food", name: "Ăn uống", origin: "predefined", appliesTo: "expense", color: "#f00", slug: "food", sortOrder: 1, deletedAt: null },
  { id: "go", name: "Đi lại", origin: "predefined", appliesTo: "expense", color: "#0f0", slug: "transport", sortOrder: 2, deletedAt: null },
  { id: "pay", name: "Lương", origin: "predefined", appliesTo: "income", color: "#00f", slug: "salary", sortOrder: 3, deletedAt: null },
];

test("KT-07b · 6: khoản chi đầu tiên — 3 ô, tự tạo ví Tiền mặt, ngày hôm nay", async () => {
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <QuickExpenseSheet open onOpenChange={() => undefined} accounts={[]} categories={categories} currency="VND" onMore={() => undefined} />
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText(/Avora tạo sẵn ví Tiền mặt/)).toBeInTheDocument();
  expect(document.querySelectorAll("[data-quick-expense] input")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Lương" }).query()).toBeNull();
  await userEvent.fill(screen.getByRole("textbox", { name: "Số tiền" }), "45000");
  await expect.element(screen.getByRole("textbox", { name: "Số tiền" })).toHaveValue("45.000");
  await userEvent.click(screen.getByRole("button", { name: "Đi lại" }));
  await userEvent.fill(screen.getByRole("textbox", { name: "Ghi chú" }), "xe ôm");
  await userEvent.click(screen.getByRole("button", { name: "Ghi khoản chi" }));
  await vi.waitFor(() => expect(state.firsts).toHaveLength(1));
  // KT-08 · QA05-01: no separate "create wallet" call — the server makes it with the expense, or not at all.
  expect(state.accounts).toEqual([]);
  expect(state.transactions).toEqual([]);
  expect(state.firsts[0]).toEqual(expect.objectContaining({ walletName: "Tiền mặt", currency: "VND", categoryId: "go", amountCents: 4_500_000, description: "xe ôm" }));
});

test("KT-08 · QA05-01: khoản chi đầu tiên bị từ chối → không có lệnh tạo ví riêng, báo lỗi, giữ số đã nhập", async () => {
  state.refuse = true;
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <QuickExpenseSheet open onOpenChange={() => undefined} accounts={[]} categories={categories} currency="VND" onMore={() => undefined} />
    </QueryClientProvider>,
  );
  await userEvent.fill(screen.getByRole("textbox", { name: "Số tiền" }), "45000");
  await userEvent.click(screen.getByRole("button", { name: "Ghi khoản chi" }));
  await expect.element(screen.getByRole("button", { name: "Ghi khoản chi" })).toBeEnabled();
  expect(state.accounts).toEqual([]);
  expect(state.firsts).toEqual([]);
  await expect.element(screen.getByRole("textbox", { name: "Số tiền" })).toHaveValue("45.000");
});

test("KT-07b · 6: đã có ví thì ghi vào ví đó, không tạo thêm", async () => {
  const cash = { id: "cash-1", name: "Ví", type: "cash", currency: "VND", deletedAt: null } as unknown as Account;
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <QuickExpenseSheet open onOpenChange={() => undefined} accounts={[cash]} categories={categories} currency="VND" onMore={() => undefined} />
    </QueryClientProvider>,
  );
  await userEvent.fill(screen.getByRole("textbox", { name: "Số tiền" }), "10000");
  await userEvent.click(screen.getByRole("button", { name: "Ghi khoản chi" }));
  await vi.waitFor(() => expect(state.transactions).toHaveLength(1));
  expect(state.accounts).toEqual([]);
  expect(state.transactions[0]).toEqual(expect.objectContaining({ accountId: "cash-1", categoryId: "food" }));
});

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`KT-07b · 7: biểu mẫu tạo — ${width < 768 ? "điện thoại: tấm kéo từ dưới, có thanh kéo" : "máy tính: hộp giữa"} (${width})`, async () => {
    await page.viewport(width, height);
    await render(
      <Dialog open>
        <DialogContent phoneSheet>
          <DialogTitle>Tạo thói quen</DialogTitle>
          <p>nội dung</p>
        </DialogContent>
      </Dialog>,
    );
    await vi.waitFor(() => expect(document.querySelector("[data-phone-sheet]")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
    const box = (document.querySelector("[data-phone-sheet]") as HTMLElement).getBoundingClientRect();
    const handle = document.querySelector<HTMLElement>("[data-sheet-handle]");
    if (width < 768) {
      expect(Math.round(box.bottom)).toBe(height);
      expect(Math.round(box.width)).toBe(width);
      expect(handle !== null && getComputedStyle(handle).display !== "none").toBe(true);
    } else {
      expect(Math.abs((box.top + box.bottom) / 2 - height / 2)).toBeLessThan(4);
      expect(handle === null || getComputedStyle(handle).display === "none").toBe(true);
    }
  });
}
