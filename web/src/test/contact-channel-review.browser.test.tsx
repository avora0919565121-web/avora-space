import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  contacts: [] as Contact[],
  channels: [] as ContactChannel[],
  confirmed: [] as string[],
  confirmedContacts: [] as string[],
  removed: [] as string[],
  actionError: null as string | null,
  navigated: [] as string[],
  /** Every (contact, value) the screen asked to give up, in order. */
  detached: [] as string[],
  /** Contacts the screen asked to hold a value — the "this is the company's" answer. */
  added: [] as string[],
  /** Contact ids whose detach call should fail, to exercise a partial cleanup. */
  detachFailsFor: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

// The two reads are the boundary: everything above them is the reasoning about which contacts
// still need a person to look at them, which is what these tests exercise.
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return { ...actual, fetchContacts: async () => state.contacts };
});

vi.mock("@/lib/contact-channels", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/contact-channels")>("@/lib/contact-channels");
  return {
    ...actual,
    fetchContactChannels: async () => state.channels,
    markChannelReviewed: async (channelId: string) => {
      if (state.actionError !== null) throw new Error(state.actionError);
      state.confirmed.push(channelId);
    },
    markContactReviewed: async (contactId: string) => {
      if (state.actionError !== null) throw new Error(state.actionError);
      state.confirmedContacts.push(contactId);
    },
    deleteContactChannel: async (channelId: string) => {
      if (state.actionError !== null) throw new Error(state.actionError);
      state.removed.push(channelId);
    },
    detachContactChannel: async (input: { contactId: string; kind: string; value: string }) => {
      if (state.detachFailsFor.includes(input.contactId)) {
        throw new Error("Đây là cách liên lạc duy nhất của liên hệ này, không bỏ được");
      }
      if (state.actionError !== null) throw new Error(state.actionError);
      state.detached.push(`${input.contactId}:${input.value}`);
    },
    addContactChannel: async (input: { contactId: string; value: string }) => {
      if (state.actionError !== null) throw new Error(state.actionError);
      state.added.push(`${input.contactId}:${input.value}`);
      return null;
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

const { default: ContactChannelReview } = await import("@/pages/ContactChannelReview");
const { normalizeChannelValue } = await import("@/lib/contact-channels");

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

function channel(over: Partial<ContactChannel> & { id: string; contactId: string }): ContactChannel {
  const kind = over.kind ?? "phone";
  const value = over.value ?? "0900111222";
  return {
    ownerUserId: "u-me",
    kind,
    value,
    valueNormalized: normalizeChannelValue(kind, value),
    label: null,
    source: "import_csv",
    needsReview: true,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    ...over,
  };
}

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <div style={{ width: 720 }}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ContactChannelReview />
        </MemoryRouter>
      </QueryClientProvider>
    </div>,
  );
}

beforeEach(() => {
  state.contacts = [];
  state.channels = [];
  state.confirmed = [];
  state.confirmedContacts = [];
  state.removed = [];
  state.actionError = null;
  state.navigated = [];
  state.detached = [];
  state.added = [];
  state.detachFailsFor = [];
});

function company(over: Partial<Contact> & { id: string; name: string }): Contact {
  return person({
    contactType: "business",
    taxCode: "0101234567",
    representativeName: "Chị Mai",
    ...over,
  });
}

/**
 * Nothing to review is a finished job, not a broken page — it says so and offers the way back,
 * rather than leaving someone on an empty list wondering what went wrong.
 */
test("an empty list reads as finished, not as missing", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];

  const screen = await open();

  await expect.element(screen.getByText("Không còn gì cần xem lại")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Về danh bạ" })).toBeInTheDocument();
});

test("a flagged channel shows whose it is and where it came from", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];
  state.channels = [channel({ id: "ch1", contactId: "c1", value: "0900 111 222" })];

  const screen = await open();

  await expect.element(screen.getByText("Hoà")).toBeInTheDocument();
  await expect.element(screen.getByText("0900 111 222")).toBeInTheDocument();
  await expect.element(screen.getByText(/Nhập từ tệp/)).toBeInTheDocument();
  // The primary channel is named, so it is clear which number the app is actually using.
  await expect.element(screen.getByText(/Đang dùng: 0912345678/)).toBeInTheDocument();
});

test("only the contacts with something unconfirmed are listed", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0912345678" }),
    person({ id: "c2", name: "Lan", phone: "0987000111" }),
  ];
  state.channels = [
    channel({ id: "ch1", contactId: "c1", value: "0900111222", needsReview: true }),
    channel({ id: "ch2", contactId: "c2", value: "0900333444", needsReview: false }),
  ];

  const screen = await open();

  await expect.element(screen.getByText("Hoà")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Lan");
  await expect.element(screen.getByText(/^1 liên hệ có nhiều số/)).toBeInTheDocument();
});

/**
 * Each row's button is named by its own number rather than a bare "Giữ": three identical
 * buttons in a column are ambiguous to anyone not looking at which row they sit in.
 */
test("keeping one channel confirms just that one", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];
  state.channels = [
    channel({ id: "ch1", contactId: "c1", value: "0900111222" }),
    channel({ id: "ch2", contactId: "c1", value: "0900333444" }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Giữ 0900111222" }));

  expect(state.confirmed).toEqual(["ch1"]);
  expect(state.confirmedContacts).toEqual([]);
  expect(state.removed).toEqual([]);
});

test("keeping all of them is one act, not one per channel", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];
  state.channels = [
    channel({ id: "ch1", contactId: "c1", value: "0900111222" }),
    channel({ id: "ch2", contactId: "c1", value: "0900333444" }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Giữ tất cả" }));

  expect(state.confirmedContacts).toEqual(["c1"]);
  expect(state.confirmed).toEqual([]);
});

/** Dropping a number is named by the number itself, so the wrong one cannot be removed blindly. */
test("a channel can be dropped by name", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];
  state.channels = [channel({ id: "ch1", contactId: "c1", value: "0900111222" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Bỏ 0900111222" }));

  expect(state.removed).toEqual(["ch1"]);
});

test("a refusal from the server is said in the reader's own language", async () => {
  state.contacts = [person({ id: "c1", name: "Hoà", phone: "0912345678" })];
  state.channels = [channel({ id: "ch1", contactId: "c1", value: "0900111222" })];
  state.actionError = "Bạn không có quyền với liên hệ này.";

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Giữ tất cả" }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Bạn không có quyền");
});

// ------------------------------------------------ one channel, several contacts

/**
 * The second kind of tangle: not "which of these numbers is theirs" but "which of these people
 * is it". The two read almost identically as sentences and mean opposite things, so the screen
 * keeps them in separate blocks with their own headings.
 */
test("a number on several contacts is named, counted, and kept apart from the other list", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0987000111" }),
  ];
  state.channels = [channel({ id: "ch1", contactId: "c2", value: "+84 900 111 222", needsReview: false })];

  const screen = await open();

  await expect.element(screen.getByText(/1 số điện thoại hoặc email đang dùng chung/)).toBeInTheDocument();
  await expect.element(screen.getByText(/đang gắn với 2 liên hệ/)).toBeInTheDocument();
  // The first list is absent entirely: nothing there is unconfirmed.
  expect(screen.container.textContent).not.toContain("liên hệ có nhiều số điện thoại");
});

/** The mixed case: one holds it as its primary channel, the other as an extra one. */
test("it says which contact is actually using the number and which merely stores it", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0987000111" }),
  ];
  state.channels = [channel({ id: "ch1", contactId: "c2", value: "0900111222", needsReview: false })];

  const screen = await open();

  await expect.element(screen.getByText("Đang dùng làm kênh chính")).toBeInTheDocument();
  await expect.element(screen.getByText("Kênh phụ")).toBeInTheDocument();
});

/** Every choice here deletes something, so nothing is pre-selected and nothing acts on one press. */
test("nothing is chosen up front and choosing alone changes nothing", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
  ];

  const screen = await open();

  expect(screen.container.textContent).not.toContain("Áp dụng");

  await userEvent.click(screen.getByRole("button", { name: "Chỉ của Hoà" }));

  await expect.element(screen.getByRole("button", { name: "Áp dụng" })).toBeInTheDocument();
  expect(state.detached).toEqual([]);
});

test("keeping one contact takes the number off exactly the others", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0987000111" }),
    person({ id: "c3", name: "Cúc", phone: "0977000222" }),
  ];
  state.channels = [
    channel({ id: "ch1", contactId: "c2", value: "0900111222", needsReview: false }),
    channel({ id: "ch2", contactId: "c3", value: "0900 111 222", needsReview: false }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Chỉ của Hoà" }));
  await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

  // Hoà keeps it; the other two give it up, each by the spelling they stored.
  expect(state.detached.sort()).toEqual(["c2:0900111222", "c3:0900 111 222"]);
  expect(state.added).toEqual([]);
});

test("removing from everyone touches every holder and nobody else", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
    person({ id: "c3", name: "Cúc", phone: "0933444555" }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Không của ai — bỏ khỏi tất cả" }));
  // Exact, because the chip that opened this choice also ends in these words.
  await userEvent.click(screen.getByRole("button", { name: "Bỏ khỏi tất cả", exact: true }));

  expect(state.detached.sort()).toEqual(["c1:0900111222", "c2:0900111222"]);
  // Cúc never held this number and is left completely alone.
  expect(state.detached.some((entry) => entry.startsWith("c3:"))).toBe(false);
});

/**
 * Offered only because a company is among the holders. Without one, the answer would mean
 * picking a company out of the whole address book — a bigger question than this screen asks.
 */
test("the business answer appears only when a company holds the number", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
  ];

  const screen = await open();

  expect(screen.container.textContent).not.toContain("thông tin của một doanh nghiệp");
});

test("assigning the number to the company clears it from the people", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0987000111" }),
    company({ id: "c3", name: "Công ty Sen", phone: "0900 111 222" }),
  ];
  state.channels = [channel({ id: "ch1", contactId: "c2", value: "0900111222", needsReview: false })];

  const screen = await open();

  await expect.element(screen.getByText(/thông tin của một doanh nghiệp/)).toBeInTheDocument();

  // Exact: "Chỉ của Công ty Sen" — the keep-one chip for the same contact — contains this name.
  await userEvent.click(screen.getByRole("button", { name: "Của Công ty Sen", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

  // The company is made certain to hold it before anyone gives it up, so a failure part-way
  // through cannot leave the number on nobody — and it keeps the number as IT spells it, not as
  // whichever holder happened to name the group.
  expect(state.added).toEqual(["c3:0900 111 222"]);
  expect(state.detached.sort()).toEqual(["c1:0900111222", "c2:0900111222"]);
  expect(state.detached.some((entry) => entry.startsWith("c3:"))).toBe(false);
});

/**
 * Six contacts sharing a number is already a mess; abandoning the cleanup at the second one
 * leaves a worse one. So the rest still run and the refusal is reported by name.
 */
test("one contact refusing does not stop the others, and is named", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
    person({ id: "c3", name: "Cúc", phone: "0900111222" }),
  ];
  state.detachFailsFor = ["c2"];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Chỉ của Hoà" }));
  await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

  expect(state.detached).toEqual(["c3:0900111222"]);
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Lan");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("duy nhất");
});

test("both kinds of tangle can be waiting at once, each under its own heading", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0912345678" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
    person({ id: "c3", name: "Cúc", phone: "0900111222" }),
  ];
  state.channels = [channel({ id: "ch1", contactId: "c1", value: "0966777888", needsReview: true })];

  const screen = await open();

  await expect.element(screen.getByText(/1 liên hệ có nhiều số điện thoại hoặc email/)).toBeInTheDocument();
  await expect.element(screen.getByText(/1 số điện thoại hoặc email đang dùng chung/)).toBeInTheDocument();
});

test("a shared number alone still counts as something to review", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
  ];

  const screen = await open();

  expect(screen.container.textContent).not.toContain("Không còn gì cần xem lại");
});

test("a holder's name opens that contact", async () => {
  state.contacts = [
    person({ id: "c1", name: "Hoà", phone: "0900111222" }),
    person({ id: "c2", name: "Lan", phone: "0900111222" }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: /^Hoà/ }));

  expect(state.navigated).toEqual(["/lien-he/c1"]);
});
