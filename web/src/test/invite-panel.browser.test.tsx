import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Contact, ContactInvite, InviteMethod } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  invites: [] as ContactInvite[],
  sent: [] as { contactId: string; method: InviteMethod }[],
  inviteError: null as string | null,
}));

vi.mock("@/lib/use-contacts", () => ({
  useContactInvites: () => ({ data: state.invites }),
  useContactActions: () => ({
    invite: async (contactId: string, method: InviteMethod) => {
      if (state.inviteError !== null) throw new Error(state.inviteError);
      state.sent.push({ contactId, method });
      return "tok-new";
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
  state.inviteError = null;
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

  expect(state.sent).toEqual([{ contactId: "p-email", method: "email" }]);
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

  expect(state.sent).toEqual([{ contactId: "p-phone", method: "sms" }]);
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
