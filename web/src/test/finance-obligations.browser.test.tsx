import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Account } from "@/lib/finance";
import type { Contact } from "@/lib/contacts";
import type { ObligationInput } from "@/lib/finance-api";

/**
 * The obligation form in real Chromium: what a person must fill in before AVORA will
 * write a borrowing, a loan out, or a tax bill — and what it sends when they do.
 */

const state = vi.hoisted(() => ({
  written: [] as ObligationInput[],
  failWith: null as string | null,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

vi.mock("@/lib/use-finance", () => ({
  useFinanceActions: () => ({
    addObligation: {
      mutateAsync: async (input: ObligationInput) => {
        if (state.failWith !== null) throw new Error(state.failWith);
        state.written.push(input);
        return { id: "new-1" };
      },
      isPending: false,
    },
    isWorking: false,
  }),
}));

const { ObligationForm } = await import("@/components/finance/ObligationForm");
const { StatusBadge } = await import("@/components/finance/primitives");

const WALLET: Account = {
  id: "acc-1",
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
};

function person(id: string, name: string): Contact {
  return {
    id,
    ownerUserId: "u-me",
    contactType: "individual",
    name,
    phone: null,
    email: null,
    note: null,
    linkedUserId: null,
    employerContactId: null,
    dateOfBirth: null,
    relationshipTag: null,
    taxCode: null,
    businessAddress: null,
    representativeName: null,
    representativePhone: null,
    representativeEmail: null,
    industry: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

const ANH_BA = person("c-ba", "Anh Ba");

function mount(type: "vay" | "cho_vay" | "thue_ca_nhan" | "thue_kinh_doanh", contacts: Contact[] = [ANH_BA]) {
  state.written = [];
  state.failWith = null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <div style={{ width: 520, padding: 16 }}>
        <ObligationForm type={type} accounts={[WALLET]} contacts={contacts} />
      </div>
    </QueryClientProvider>,
  );
}

describe("recording money that was promised rather than moved", () => {
  it("says plainly which way the money goes before anything is typed", async () => {
    const screen = await mount("vay");
    await expect
      .element(screen.getByText(/Bạn nhận tiền bây giờ và sẽ trả lại sau/))
      .toBeInTheDocument();
  });

  it("asks a borrowing who it is owed to", async () => {
    const screen = await mount("vay");
    await expect.element(screen.getByLabelText(/Vay từ ai/)).toBeInTheDocument();
  });

  it("asks a loan out who is holding the money", async () => {
    const screen = await mount("cho_vay");
    await expect.element(screen.getByLabelText(/Cho ai vay/)).toBeInTheDocument();
  });

  it("does not ask a tax bill for a person, because there is nobody to name", async () => {
    const screen = await mount("thue_ca_nhan");
    await expect.element(screen.getByText("Kỳ thuế")).toBeInTheDocument();
    expect(screen.container.querySelector("#ob-contact")).toBeNull();
  });

  it("will not write a borrowing until a person has been chosen", async () => {
    const screen = await mount("vay");
    await userEvent.fill(screen.getByLabelText(/Số tiền/), "300");
    await userEvent.fill(screen.getByLabelText(/Ngày đến hạn/), "2026-12-31");

    const submit = screen.getByRole("button", { name: /Ghi khoản vay/ });
    await expect.element(submit).toBeDisabled();
    expect(state.written).toHaveLength(0);
  });

  it("writes the borrowing once the person, amount and date are all there", async () => {
    const screen = await mount("vay");
    await userEvent.fill(screen.getByLabelText(/Số tiền/), "300");
    await userEvent.selectOptions(screen.getByLabelText(/Vay từ ai/), "c-ba");
    await userEvent.fill(screen.getByLabelText(/Ngày đến hạn/), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: /Ghi khoản vay/ }));

    expect(state.written).toEqual([
      expect.objectContaining({
        type: "vay",
        accountId: "acc-1",
        amountCents: 30_000,
        dueDate: "2026-12-31",
        contactId: "c-ba",
      }),
    ]);
  });

  it("sends no person on a tax bill even though the form shares the same code", async () => {
    const screen = await mount("thue_ca_nhan");
    await userEvent.fill(screen.getByLabelText(/Số tiền/), "120.50");
    await userEvent.fill(screen.getByLabelText(/Ngày đến hạn/), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: /Ghi khoản thuế cá nhân/ }));

    expect(state.written).toEqual([
      expect.objectContaining({ type: "thue_ca_nhan", contactId: null, amountCents: 12_050 }),
    ]);
  });

  it("carries the tax period through when one is given", async () => {
    const screen = await mount("thue_kinh_doanh");
    await userEvent.fill(screen.getByLabelText(/Số tiền/), "500");
    await userEvent.fill(screen.getByLabelText(/Ngày đến hạn/), "2026-10-31");
    await userEvent.fill(screen.getByLabelText("Từ ngày"), "2026-07-01");
    await userEvent.fill(screen.getByLabelText("Đến ngày"), "2026-09-30");
    await userEvent.click(screen.getByRole("button", { name: /Ghi khoản thuế kinh doanh/ }));

    expect(state.written).toEqual([
      expect.objectContaining({
        type: "thue_kinh_doanh",
        taxPeriodStart: "2026-07-01",
        taxPeriodEnd: "2026-09-30",
        // A business tax is business activity; nobody should have to tick that separately.
        businessRelated: true,
      }),
    ]);
  });

  it("refuses an amount that is not a number rather than sending it on", async () => {
    const screen = await mount("cho_vay");
    await userEvent.fill(screen.getByLabelText(/Số tiền/), "ba trăm");
    await userEvent.selectOptions(screen.getByLabelText(/Cho ai vay/), "c-ba");
    await userEvent.fill(screen.getByLabelText(/Ngày đến hạn/), "2026-12-31");

    await expect.element(screen.getByRole("button", { name: /Ghi khoản cho vay/ })).toBeDisabled();
    expect(state.written).toHaveLength(0);
  });

  it("points at Liên hệ when there is nobody to borrow from yet", async () => {
    const screen = await mount("vay", []);
    await expect
      .element(screen.getByText(/Chưa có liên hệ nào/))
      .toBeInTheDocument();
  });
});

describe("the state of an obligation is legible at a glance", () => {
  it("names each state in the person's own words", async () => {
    const screen = await render(
      <div style={{ padding: 16 }}>
        <StatusBadge status="qua_han" />
        <StatusBadge status="den_han" />
        <StatusBadge status="hoan_thanh_mot_phan" />
        <StatusBadge status="ke_hoach" />
        <StatusBadge status="hoan_thanh" />
      </div>,
    );

    await expect.element(screen.getByText("Quá hạn")).toBeInTheDocument();
    await expect.element(screen.getByText("Đến hạn")).toBeInTheDocument();
    await expect.element(screen.getByText("Trả một phần")).toBeInTheDocument();
    await expect.element(screen.getByText("Kế hoạch")).toBeInTheDocument();
    await expect.element(screen.getByText("Xong")).toBeInTheDocument();
  });
});
