import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Opportunity, OpportunityStage } from "@/lib/opportunities";

const state = vi.hoisted(() => ({
  opportunities: [] as Opportunity[],
  created: [] as { contactId: string; title: string }[],
  staged: [] as { opportunityId: string; stage: string }[],
  removed: [] as string[],
  createError: null as string | null,
  stageError: null as string | null,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

// The reads and writes are the boundary; everything above them is the reasoning this file is
// about — which contacts count as live business, and what the section offers in each state.
vi.mock("@/lib/opportunities", async () => {
  const actual = await vi.importActual<typeof import("@/lib/opportunities")>("@/lib/opportunities");
  return {
    ...actual,
    fetchOpportunities: async () => state.opportunities,
    createOpportunity: async (input: { contactId: string; title: string }) => {
      if (state.createError !== null) throw new Error(state.createError);
      state.created.push({ contactId: input.contactId, title: input.title });
      const row: Opportunity = {
        id: `o-new-${state.created.length}`,
        ownerUserId: "u-me",
        contactId: input.contactId,
        title: input.title,
        stage: "lead",
        estimatedValue: null,
        conversationId: null,
        projectId: null,
        createdAt: "2026-09-16T00:00:00Z",
        updatedAt: "2026-09-16T00:00:00Z",
      };
      state.opportunities = [row, ...state.opportunities];
      return row;
    },
    updateOpportunityStage: async (opportunityId: string, stage: OpportunityStage) => {
      if (state.stageError !== null) throw new Error(state.stageError);
      state.staged.push({ opportunityId, stage });
      state.opportunities = state.opportunities.map((entry) =>
        entry.id === opportunityId ? { ...entry, stage } : entry,
      );
      return state.opportunities.find((entry) => entry.id === opportunityId) as Opportunity;
    },
    deleteOpportunity: async (opportunityId: string) => {
      state.removed.push(opportunityId);
      state.opportunities = state.opportunities.filter((entry) => entry.id !== opportunityId);
    },
  };
});

const { OpportunitySection } = await import("@/components/contacts/OpportunitySection");

function opportunity(
  over: Partial<Opportunity> & { id: string; contactId: string },
): Opportunity {
  return {
    ownerUserId: "u-me",
    title: "Cơ hội với Chị Hoa",
    stage: "lead",
    estimatedValue: null,
    conversationId: null,
    projectId: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

async function open(contactId = "c-1", contactName = "Chị Hoa") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <div style={{ width: 720 }}>
      <QueryClientProvider client={client}>
        <OpportunitySection contactId={contactId} contactName={contactName} />
      </QueryClientProvider>
    </div>,
  );
}

beforeEach(() => {
  state.opportunities = [];
  state.created = [];
  state.staged = [];
  state.removed = [];
  state.createError = null;
  state.stageError = null;
});

/**
 * A contact who is not business says so in one quiet line and one button. Most of an address
 * book is family and friends, and that majority should not pay for the CRM in screen space.
 */
test("a contact with no opportunity offers one way in and nothing else", async () => {
  const screen = await open();

  await expect
    .element(screen.getByRole("button", { name: "Đánh dấu là cơ hội kinh doanh" }))
    .toBeInTheDocument();
  // No stage words at all until there is something to have a stage.
  expect(screen.container.textContent).not.toContain("Đang chăm sóc");
});

test("marking a contact borrows their name for the title", async () => {
  const screen = await open("c-1", "Chị Hoa");

  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu là cơ hội kinh doanh" }));

  expect(state.created).toEqual([{ contactId: "c-1", title: "Cơ hội với Chị Hoa" }]);
});

test("a new opportunity starts at the stage that claims the least", async () => {
  const screen = await open();

  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu là cơ hội kinh doanh" }));

  await expect.element(screen.getByText("Mới ghi nhận")).toBeInTheDocument();
});

test("an existing opportunity shows its title and current stage", async () => {
  state.opportunities = [
    opportunity({ id: "o-1", contactId: "c-1", title: "Bán 50 thùng hàng", stage: "dang_cham_soc" }),
  ];

  const screen = await open();

  await expect.element(screen.getByText("Bán 50 thùng hàng")).toBeInTheDocument();
  await expect.element(screen.getByText("Đang chăm sóc")).toBeInTheDocument();
});

/**
 * An unestimated deal says so rather than showing nothing or a zero: "0 ₫" would claim the
 * business is worthless, which is a different statement from not having priced it yet.
 */
test("a deal with no estimate says so instead of showing a zero", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1", estimatedValue: null })];

  const screen = await open();

  await expect.element(screen.getByText("Chưa định giá")).toBeInTheDocument();
});

test("an estimated deal reads as Vietnamese money", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1", estimatedValue: 15000000 })];

  const screen = await open();

  await expect.element(screen.getByText(/Dự kiến/)).toBeInTheDocument();
  expect(screen.container.textContent).toContain("₫");
});

test("all five stages are offered at once, not a next step", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));

  for (const label of ["Mới ghi nhận", "Tiềm năng", "Đang chăm sóc", "Đối tác", "Không thành"]) {
    await expect.element(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
});

/**
 * Stepping backwards is ordinary judgement, not a mistake. Someone re-reading a customer as
 * cooler than they thought must be able to say so, so no stage is closed off.
 */
test("a stage can be moved backwards as freely as forwards", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1", stage: "dang_cham_soc" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));
  await userEvent.click(screen.getByRole("button", { name: "Tiềm năng" }));

  expect(state.staged).toEqual([{ opportunityId: "o-1", stage: "tiem_nang" }]);
});

test("the stage a deal is already at is shown as current and not re-sendable", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1", stage: "tiem_nang" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));

  await expect.element(screen.getByRole("button", { name: "Tiềm năng" })).toBeDisabled();
});

test("a contact can be followed as more than one piece of business", async () => {
  state.opportunities = [
    opportunity({ id: "o-1", contactId: "c-1", title: "Đơn hàng tháng 9" }),
    opportunity({ id: "o-2", contactId: "c-1", title: "Hợp đồng bảo trì" }),
  ];

  const screen = await open();

  await expect.element(screen.getByText("Đơn hàng tháng 9")).toBeInTheDocument();
  await expect.element(screen.getByText("Hợp đồng bảo trì")).toBeInTheDocument();
  // Adding another is offered from the header once the first one exists.
  await expect.element(screen.getByRole("button", { name: /Thêm cơ hội/ })).toBeInTheDocument();
});

test("only this contact's opportunities are shown", async () => {
  state.opportunities = [
    opportunity({ id: "o-1", contactId: "c-1", title: "Của liên hệ này" }),
    opportunity({ id: "o-2", contactId: "c-2", title: "Của người khác" }),
  ];

  const screen = await open("c-1");

  await expect.element(screen.getByText("Của liên hệ này")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Của người khác");
});

/** Dropping an opportunity takes two presses, like every destructive act in the address book. */
test("dropping an opportunity asks once before doing it", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));
  await userEvent.click(screen.getByRole("button", { name: /Bỏ cơ hội này/ }));

  expect(state.removed).toEqual([]);
  // And the question says what survives, because the contact is not what is being dropped.
  await expect.element(screen.getByText(/Liên hệ vẫn giữ nguyên/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Bỏ cơ hội", exact: true }));
  expect(state.removed).toEqual(["o-1"]);
});

test("changing your mind about dropping leaves the opportunity alone", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));
  await userEvent.click(screen.getByRole("button", { name: /Bỏ cơ hội này/ }));
  await userEvent.click(screen.getByRole("button", { name: "Giữ lại" }));

  expect(state.removed).toEqual([]);
});

/**
 * A refusal from the server is shown where the action was taken. The most likely one here is
 * "this is not your contact", which the reader can only make sense of next to the button.
 */
test("a refusal is explained in place rather than silently dropped", async () => {
  state.createError = "Đây không phải liên hệ của bạn.";

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu là cơ hội kinh doanh" }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(
    "Đây không phải liên hệ của bạn.",
  );
});

test("a refused stage change says so and leaves the stage as it was", async () => {
  state.opportunities = [opportunity({ id: "o-1", contactId: "c-1", stage: "lead" })];
  state.stageError = "Đây không phải cơ hội của bạn.";

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /Đổi giai đoạn/ }));
  await userEvent.click(screen.getByRole("button", { name: "Đối tác" }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(
    "Đây không phải cơ hội của bạn.",
  );
  await expect.element(screen.getByText("Mới ghi nhận")).toBeInTheDocument();
});

/** A company is as much a lead as a person is — the section is offered either way. */
test("a company is offered the same section as a person", async () => {
  const screen = await open("c-biz", "Công ty ABC");

  await userEvent.click(screen.getByRole("button", { name: "Đánh dấu là cơ hội kinh doanh" }));

  expect(state.created).toEqual([{ contactId: "c-biz", title: "Cơ hội với Công ty ABC" }]);
});
