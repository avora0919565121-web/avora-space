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
});

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
