import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { PublicInvitePreview } from "@/lib/contact-invites";

const state = vi.hoisted(() => ({
  preview: null as PublicInvitePreview | null,
  acceptError: null as string | null,
  accepted: [] as string[],
  declined: [] as string[],
  navigated: [] as { to: string; state?: unknown }[],
  signedIn: true,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => (state.signedIn ? { user: { id: "u-guest" }, session: { user: { id: "u-guest" } }, isLoading: false } : { user: null, session: null, isLoading: false }),
}));

// KT-07a: the page reads the public preview (works signed out) and can decline without an account.
vi.mock("@/lib/contact-invites", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contact-invites")>("@/lib/contact-invites");
  return {
    ...actual,
    fetchPublicInvitePreview: async () => state.preview,
    declineInvite: async (token: string) => {
      state.declined.push(token);
    },
  };
});
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return {
    ...actual,
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
    useNavigate: () => (to: string, options?: { state?: unknown }) => {
      state.navigated.push({ to, state: options?.state });
    },
  };
});

const { default: AcceptContactInvite } = await import("@/pages/AcceptContactInvite");

function preview(over: Partial<PublicInvitePreview> = {}): PublicInvitePreview {
  return {
    inviterName: "Minh",
    status: "pending",
    expiresAt: "2026-11-26T10:00:00Z",
    note: null,
    isOwnInvite: false,
    alreadyLinked: false,
    signedIn: state.signedIn,
    ...over,
  };
}

async function open(path = "/loi-moi-lien-he/tok-123") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/loi-moi-lien-he/:token" element={<AcceptContactInvite />} />
          <Route path="/moi/:token" element={<AcceptContactInvite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.preview = null;
  state.acceptError = null;
  state.accepted = [];
  state.declined = [];
  state.navigated = [];
  state.signedIn = true;
});

test("the person invited is told who is asking, by name", async () => {
  state.preview = preview({ inviterName: "Trần Thị Hoa" });
  const screen = await open();

  // The name is the heading and also opens the sentence below it, so the heading is matched
  // by its role rather than by a substring that legitimately appears twice.
  await expect.element(screen.getByRole("heading")).toHaveTextContent("Trần Thị Hoa mời bạn vào AVORA");
  await expect.element(screen.getByRole("button", { name: "Chấp nhận" })).toBeInTheDocument();
});

test("accepting links the two accounts and lands on the address book", async () => {
  state.preview = preview();
  const screen = await open();

  await userEvent.click(screen.getByRole("button", { name: "Chấp nhận" }));

  await vi.waitFor(() => {
    expect(state.accepted).toEqual(["tok-123"]);
    // Landing on the list is the point: the contact just created is what proves it worked.
    expect(state.navigated.map((entry) => entry.to)).toContain("/lien-he");
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
  expect(screen.container.textContent).not.toContain("Chấp nhận");
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
  expect(state.navigated.map((entry) => entry.to)).not.toContain("/lien-he");
});

// ── KT-07a: người chưa có tài khoản ─────────────────────────────────────────────────────────────

test("KT-07a · signed out: the link opens with no sign-in wall — name, note, deadline, sign-up", async () => {
  state.signedIn = false;
  state.preview = preview({ note: "Cô ơi, con dùng AVORA để giữ ảnh cả nhà." });
  const screen = await open("/moi/tok-123");

  await expect.element(screen.getByRole("heading")).toHaveTextContent("Minh mời bạn vào AVORA");
  expect(screen.container.textContent).toContain("Cô ơi, con dùng AVORA");
  expect(screen.container.textContent).toContain("Lời mời dùng được đến 26/11/2026");
  expect(screen.container.textContent).not.toContain("Chấp nhận");

  await userEvent.click(screen.getByRole("button", { name: "Vào nhà cùng Minh" }));
  expect(state.navigated[0]).toEqual({ to: "/dang-nhap?mode=dang-ky", state: { from: "/moi/tok-123" } });

  await userEvent.click(screen.getByRole("button", { name: "Tôi đã có tài khoản · Đăng nhập" }));
  expect(state.navigated[1]).toEqual({ to: "/dang-nhap", state: { from: "/moi/tok-123" } });
});

test("KT-07a · Không, cảm ơn: asks once, then declines without an account", async () => {
  state.signedIn = false;
  state.preview = preview();
  const screen = await open("/moi/tok-123");

  await userEvent.click(screen.getByRole("button", { name: "Không, cảm ơn" }));
  await expect.element(screen.getByRole("heading")).toHaveTextContent("Bạn không nhận lời mời của Minh?");
  expect(screen.container.textContent).toContain("không gửi thêm lời nhắc");
  expect(state.declined).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Không nhận lời" }));
  await expect.element(screen.getByRole("heading")).toHaveTextContent("Bạn đã từ chối lời mời này");
  expect(state.declined).toEqual(["tok-123"]);
  expect(screen.container.textContent).toContain("tìm Minh bằng mã PIN");
});

test("KT-07a · a declined invitation reads as declined, never as an offer", async () => {
  state.signedIn = false;
  state.preview = preview({ status: "declined" });
  const screen = await open("/moi/tok-123");

  await expect.element(screen.getByRole("heading")).toHaveTextContent("Bạn đã từ chối lời mời này");
  expect(screen.container.textContent).not.toContain("Vào nhà cùng");
});
