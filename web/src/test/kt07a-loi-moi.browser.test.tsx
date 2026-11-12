import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { Contact, InviteMethod } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  prepared: [] as { contactId: string; method: InviteMethod; batch: boolean }[],
  confirmed: [] as string[],
  discarded: [] as string[],
  refuse: new Set<string>(),
  done: null as { sent: number; failed: { name: string; reason: string }[] } | null,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me", user_metadata: { display_name: "Minh" } } }) }));
vi.mock("@/lib/use-contacts", () => ({
  useInviteActions: () => ({
    prepare: async (contactId: string, method: InviteMethod, options?: { batch?: boolean }) => {
      if (state.refuse.has(contactId)) throw new Error("Người này đã từ chối lời mời trước đây.");
      state.prepared.push({ contactId, method, batch: options?.batch ?? false });
      return { inviteId: `inv-${contactId}`, token: `tok-${contactId}`, status: "draft", expiresAt: "2026-11-27T00:00:00Z", reused: false };
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
// Handing over must not leave the test page.
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return { ...actual, inviteHref: (method: InviteMethod) => `#da-mo-${method}` };
});

const { BulkInvitePanel } = await import("@/components/contacts/BulkInvitePanel");

function person(id: string, name: string, phone: string | null, email: string | null = null): Contact {
  return {
    id, name, phone, email, ownerUserId: "u-me", contactType: "individual", note: null, linkedUserId: null,
    employerContactId: null, dateOfBirth: null, relationshipTag: null, taxCode: null, businessAddress: null,
    representativeName: null, representativePhone: null, representativeEmail: null, industry: null,
    needsDetails: false, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  };
}

beforeEach(() => {
  state.prepared = [];
  state.confirmed = [];
  state.discarded = [];
  state.refuse = new Set();
  state.done = null;
});

async function open(contacts: Contact[]) {
  return await render(
    <div style={{ width: 560, padding: 16 }}>
      <BulkInvitePanel contacts={contacts} onDone={(outcome) => { state.done = outcome; }} />
    </div>,
  );
}

test("KT-07a · mời nhiều người: mở từng người một, chỉ 'Đã gửi' mới tính, không báo đã gửi khi chưa gửi", async () => {
  const screen = await open([person("a", "Cô Lan", "0900000001"), person("b", "Chú Tư", "0900000002"), person("c", "Bà Năm", null, "nam@example.com")]);

  // Pressing the main button sends nothing by itself.
  await userEvent.click(screen.getByRole("button", { name: "Mời 3 người" }));
  expect(state.prepared).toEqual([]);
  await expect.element(screen.getByText("Mời 3 người · Người 1/3")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Mở Tin nhắn cho Cô Lan" }));
  await expect.element(screen.getByText("Bạn đã gửi lời mời cho Cô Lan chưa?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Đã gửi" }));

  await userEvent.click(screen.getByRole("button", { name: "Mở Tin nhắn cho Chú Tư" }));
  await userEvent.click(screen.getByRole("button", { name: "Chưa gửi" }));

  await userEvent.click(screen.getByRole("button", { name: "Bỏ qua người này" }));

  await vi.waitFor(() => expect(state.done).toEqual({ sent: 1, failed: [] }));
  expect(state.prepared).toEqual([
    { contactId: "a", method: "sms", batch: true },
    { contactId: "b", method: "sms", batch: true },
  ]);
  expect(state.confirmed).toEqual(["inv-a"]);
  expect(state.discarded).toEqual(["inv-b"]);
});

test("KT-07a · người đã từ chối bị máy chủ loại khỏi lô, hàng đợi đi tiếp và nói rõ", async () => {
  state.refuse.add("a");
  const screen = await open([person("a", "Cô Lan", "0900000001"), person("b", "Chú Tư", "0900000002")]);
  await userEvent.click(screen.getByRole("button", { name: "Mời 2 người" }));
  await userEvent.click(screen.getByRole("button", { name: "Mở Tin nhắn cho Cô Lan" }));

  await expect.element(screen.getByRole("status")).toHaveTextContent("Chưa mời Cô Lan");
  await expect.element(screen.getByText("Mời 2 người · Người 2/2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Dừng lại" }));
  expect(state.done?.sent).toBe(0);
  expect(state.done?.failed.map((entry) => entry.name)).toEqual(["Cô Lan"]);
});
