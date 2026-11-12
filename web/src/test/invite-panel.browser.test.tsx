import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Contact, ContactInvite, InviteMethod } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  invites: [] as ContactInvite[],
  sent: [] as { contactId: string; method: InviteMethod; note?: string | null; reinvite?: boolean }[],
  confirmed: [] as string[],
  discarded: [] as string[],
  inviteError: null as string | null,
  inviteRefusal: null as string | null,
}));

vi.mock("@/lib/use-contacts", () => ({
  useContactInvites: () => ({ data: state.invites, refetch: async () => undefined }),
  useInviteActions: () => ({
    prepare: async (contactId: string, method: InviteMethod, options?: { note?: string | null; reinvite?: boolean }) => {
      if (state.inviteError !== null) {
        const error = new Error(state.inviteError) as Error & { raw?: string };
        error.raw = state.inviteRefusal ?? undefined;
        throw error;
      }
      state.sent.push({ contactId, method, note: options?.note ?? null, reinvite: options?.reinvite ?? false });
      return { inviteId: "inv-1", token: "tok-new", status: "draft", expiresAt: "2026-11-27T00:00:00Z", reused: false };
    },
    confirmSent: async (id: string) => {
      state.confirmed.push(id);
    },
    discardDraft: async (id: string) => {
      state.discarded.push(id);
    },
    isWorking: false,
  }),
}));

/**
 * Handing over to the messages app is the one step these tests must not actually take: a real
 * `sms:`/`mailto:` address would send the test runner out of the page. The address is swapped
 * for a harmless hash so the click still travels the whole path — issue a token, then hand over
 * — while the real addresses are covered by the unit tests for `inviteHref`.
 */
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return { ...actual, inviteHref: (method: InviteMethod) => `#da-mo-${method}` };
});

const { InvitePanel } = await import("@/components/contacts/InvitePanel");

function person(over: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: "u-me",
    contactType: "individual",
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
    needsDetails: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

async function open(contact: Contact) {
  return await render(
    <div style={{ width: 560, padding: 16 }}>
      <InvitePanel contact={contact} inviterName="Minh" />
    </div>,
  );
}

beforeEach(() => {
  state.invites = [];
  state.sent = [];
  state.confirmed = [];
  state.discarded = [];
  state.inviteError = null;
  state.inviteRefusal = null;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => undefined }, configurable: true });
});

const emailOnly = person({ id: "p-email", name: "Chị Email", email: "chi@example.com" });
const phoneOnly = person({ id: "p-phone", name: "Anh Phone", phone: "0912345678" });

/**
 * A button that is certain to fail is not drawn at all — the same rule already used for
 * importing from the phone book, rather than showing it disabled and leaving people guessing.
 */
test("someone with only an email is not offered a message", async () => {
  const screen = await open(emailOnly);

  await expect.element(screen.getByRole("button", { name: "Email" })).toBeInTheDocument();
  expect(screen.container.querySelectorAll("button")).toHaveLength(2);
  expect(screen.container.textContent).not.toContain("Tin nhắn");
});

test("someone with only an email can still be invited by email", async () => {
  const screen = await open(emailOnly);

  await userEvent.click(screen.getByRole("button", { name: "Email" }));

  expect(state.sent).toEqual([{ contactId: "p-email", method: "email", note: null, reinvite: false }]);
});

test("someone with only a number is not offered an email", async () => {
  const screen = await open(phoneOnly);

  await expect.element(screen.getByRole("button", { name: "Tin nhắn" })).toBeInTheDocument();
  expect(screen.container.querySelectorAll("button")).toHaveLength(2);
  expect(screen.container.textContent).not.toContain("Email");
});

test("someone with only a number can still be invited by message", async () => {
  const screen = await open(phoneOnly);

  await userEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));

  expect(state.sent).toEqual([{ contactId: "p-phone", method: "sms", note: null, reinvite: false }]);
});

/** The link needs no channel of its own: whoever sends it chooses how to pass it on. */
test("copying a link is offered even to a contact with nothing written down", async () => {
  const screen = await open(person({ id: "p-bare", name: "Trống" }));

  await expect.element(screen.getByRole("button", { name: /Sao chép liên kết/ })).toBeInTheDocument();
  expect(screen.container.querySelectorAll("button")).toHaveLength(1);
});

test("both ways are offered when both are written down", async () => {
  const screen = await open(
    person({ id: "p-both", name: "Cả Hai", phone: "0900000000", email: "ca@example.com" }),
  );

  await expect.element(screen.getByRole("button", { name: "Tin nhắn" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Email" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /Sao chép liên kết/ })).toBeInTheDocument();
});

/**
 * The database refuses the same thing the screen leaves out, so a page left open while the
 * number was deleted elsewhere reports it in the user's own words instead of a raw error.
 */
test("a refusal from the database is said in plain Vietnamese", async () => {
  state.inviteError = "Liên hệ này chưa có số điện thoại. Hãy thêm số, hoặc mời bằng liên kết.";
  const screen = await open(phoneOnly);

  await userEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent("chưa có số điện thoại");
});

/** An invitation already waiting replaces the buttons, so no second token is ever issued. */
test("an invitation already waiting is shown instead of the buttons", async () => {
  state.invites = [
    {
      id: "i1",
      contactId: "p-email",
      method: "email",
      inviteToken: "tok-1",
      status: "pending",
      invitedAt: new Date().toISOString(),
      acceptedAt: null,
    },
  ];
  const screen = await open(emailOnly);

  await expect.element(screen.getByText(/đang chờ/)).toBeInTheDocument();
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});

// ── KT-07a: "Đã mời" chỉ khi người mời xác nhận đã gửi ──────────────────────────────────────────

test("KT-07a · opening the messages app asks 'Bạn đã gửi chưa?' — only Đã gửi confirms", async () => {
  const screen = await open(phoneOnly);
  await userEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));

  await expect.element(screen.getByText("Bạn đã gửi lời mời cho Anh Phone chưa?")).toBeInTheDocument();
  expect(state.confirmed).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Đã gửi" }));
  await vi.waitFor(() => expect(state.confirmed).toEqual(["inv-1"]));
  expect(state.discarded).toEqual([]);
});

test("KT-07a · Chưa gửi throws the draft away and nothing is recorded", async () => {
  const screen = await open(phoneOnly);
  await userEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));
  await userEvent.click(screen.getByRole("button", { name: "Chưa gửi" }));

  await vi.waitFor(() => expect(state.discarded).toEqual(["inv-1"]));
  expect(state.confirmed).toEqual([]);
  await expect.element(screen.getByRole("button", { name: "Tin nhắn" })).toBeInTheDocument();
});

test("KT-07a · a draft left unanswered asks again when the page is reopened", async () => {
  state.invites = [
    { id: "d1", contactId: "p-phone", method: "sms", inviteToken: "t", status: "draft", invitedAt: new Date().toISOString(), acceptedAt: null, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  ];
  const screen = await open(phoneOnly);
  await expect.element(screen.getByText("Bạn đã gửi lời mời cho Anh Phone chưa?")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("đang chờ");
});

test("KT-07a · someone who declined can be invited again only with a note of your own", async () => {
  state.invites = [
    { id: "x1", contactId: "p-phone", method: "sms", inviteToken: "t", status: "declined", invitedAt: "2026-11-01T00:00:00Z", acceptedAt: null, declinedAt: "2026-11-02T09:00:00Z" },
  ];
  const screen = await open(phoneOnly);
  await expect.element(screen.getByText("Anh Phone đã từ chối lời mời ngày 02/11.")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Mời lại qua Tin nhắn" }));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("ít nhất 10 ký tự");
  expect(state.sent).toEqual([]);

  await userEvent.fill(screen.getByRole("textbox"), "Anh ơi, em mời lại anh vào nhà mình nhé.");
  await userEvent.click(screen.getByRole("button", { name: "Mời lại qua Tin nhắn" }));
  expect(state.sent).toEqual([{ contactId: "p-phone", method: "sms", note: "Anh ơi, em mời lại anh vào nhà mình nhé.", reinvite: true }]);
});

test("KT-07a · the server saying 'declined' switches the panel to the re-invite form", async () => {
  state.inviteError = "Người này đã từ chối lời mời trước đây. Nếu bạn muốn mời lại, hãy viết vài lời cho họ.";
  state.inviteRefusal = "avora_invite_declined";
  const screen = await open(phoneOnly);
  await userEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));
  await expect.element(screen.getByRole("button", { name: "Mời lại qua Tin nhắn" })).toBeInTheDocument();
  await expect.element(screen.getByRole("textbox")).toBeInTheDocument();
});
