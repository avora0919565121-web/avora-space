import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { ContactInvitePreview } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  preview: null as ContactInvitePreview | null,
  acceptError: null as string | null,
  accepted: [] as string[],
  navigated: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-guest" } }) }));

// The screen's two data calls are the boundary being tested: everything above them is the
// reasoning about what an invitation link should say, which is what these tests exercise.
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return {
    ...actual,
    fetchContactInvitePreview: async () => state.preview,
    acceptContactInvite: async (token: string) => {
      if (state.acceptError !== null) throw new Error(state.acceptError);
      state.accepted.push(token);
      return "new-contact-id";
    },
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

const { default: AcceptContactInvite } = await import("@/pages/AcceptContactInvite");

function preview(over: Partial<ContactInvitePreview> = {}): ContactInvitePreview {
  return { inviterName: "Minh", status: "pending", isOwnInvite: false, alreadyLinked: false, ...over };
}

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/loi-moi-lien-he/tok-123"]}>
        <Routes>
          <Route path="/loi-moi-lien-he/:token" element={<AcceptContactInvite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.preview = null;
  state.acceptError = null;
  state.accepted = [];
  state.navigated = [];
});

test("the person invited is told who is asking, by name", async () => {
  state.preview = preview({ inviterName: "Trần Thị Hoa" });
  const screen = await open();

  // The name is the heading and also opens the sentence below it, so the heading is matched
  // by its role rather than by a substring that legitimately appears twice.
  await expect.element(screen.getByRole("heading")).toHaveTextContent("Trần Thị Hoa");
  expect(screen.container.textContent).toContain("muốn kết nối với bạn trên AVORA");
  await expect.element(screen.getByRole("button", { name: "Chấp nhận" })).toBeInTheDocument();
});

test("accepting links the two accounts and lands on the address book", async () => {
  state.preview = preview();
  const screen = await open();

  await userEvent.click(screen.getByRole("button", { name: "Chấp nhận" }));

  await vi.waitFor(() => {
    expect(state.accepted).toEqual(["tok-123"]);
    // Landing on the list is the point: the contact just created is what proves it worked.
    expect(state.navigated).toContain("/lien-he");
  });
});

test("a token nobody has heard of is explained, not shown as an error", async () => {
  state.preview = null;
  const screen = await open();

  await expect.element(screen.getByText("Lời mời không còn hiệu lực")).toBeInTheDocument();
  expect(screen.container.textContent).toContain("xin người mời một liên kết mới");
});

test("an invitation already used says so instead of offering it again", async () => {
  state.preview = preview({ status: "accepted" });
  const screen = await open();

  await expect.element(screen.getByText("Lời mời này đã được dùng")).toBeInTheDocument();
});

/**
 * The sender opening their own link made an ordinary mistake — they meant to forward it — so
 * they are told that and what to do, never the refusal the database writes for its own log.
 */
test("the sender opening their own link is told to pass it on", async () => {
  state.preview = preview({ isOwnInvite: true });
  const screen = await open();

  await expect.element(screen.getByText("Đây là lời mời của chính bạn")).toBeInTheDocument();
  expect(screen.container.textContent).toContain("chuyển liên kết này cho người bạn muốn mời");
  expect(screen.container.textContent).not.toContain("Không thể tự chấp nhận");
});

/**
 * Expiry and never-existed are different facts and must read differently: an expired link was
 * real and the sender can simply send another, while an unknown token never existed at all.
 */
test("an expired invitation names its deadline instead of reading as a dead link", async () => {
  state.preview = preview({ status: "expired" });
  const screen = await open();

  await expect.element(screen.getByText("Lời mời đã hết hạn")).toBeInTheDocument();
  expect(screen.container.textContent).toContain("14 ngày");
  expect(screen.container.textContent).toContain("gửi lại một lời mời mới");
  expect(screen.container.textContent).not.toContain("không tồn tại");
});

test("an invitation someone else already claimed says so", async () => {
  state.preview = preview({ alreadyLinked: true });
  const screen = await open();

  await expect.element(screen.getByText("Liên hệ này đã được kết nối")).toBeInTheDocument();
});

/**
 * The button exists only where pressing it can work. Anywhere else the single way out is back
 * to the address book — a button that could only be refused would be a promise never made.
 */
test("a dead end offers one way out, and it is not an acceptance", async () => {
  state.preview = preview({ status: "accepted" });
  const screen = await open();

  await expect.element(screen.getByRole("button", { name: "Về danh bạ" })).toBeInTheDocument();
  expect(screen.container.querySelectorAll("button").length).toBe(1);
});

/**
 * The preview is a courtesy, not a gate: the server re-checks every rule, so a link left open
 * while something changed elsewhere must refuse in Vietnamese rather than stall.
 */
test("a rule that changed since the page opened is reported in plain Vietnamese", async () => {
  state.preview = preview();
  state.acceptError = "Lời mời này đã được chấp nhận.";
  const screen = await open();

  await userEvent.click(screen.getByRole("button", { name: "Chấp nhận" }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Lời mời này đã được chấp nhận.");
  expect(state.navigated).not.toContain("/lien-he");
});
