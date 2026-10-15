import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * AVORA-117 — gỡ / chuyển / gắn liên kết liên hệ ↔ tài khoản AVORA. A stateful fake server applies the
 * same rules as the migration (chủ, đích cá nhân & trống, một tài khoản ↔ một liên hệ, chỉ bạn bè khi gắn,
 * hoàn tác một lần); real ContactDetail, real person card, real link manager.
 */
const ME = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";
const BAO = "ce09d234-af48-49a5-96f2-b2456ae4e5b0"; // linked by mistake to "Chú Tư"
const LINH = "0b1f7a2c-0000-4000-8000-0000000117aa"; // a friend no contact names yet

type Row = Record<string, unknown> & { id: string; name: string; linked_user_id: string | null; contact_type: string };
type Change = { id: string; kind: string; from: string | null; to: string | null; user: string | null; undone: boolean };
type ServerState = { rows: Row[]; changes: Change[]; failNext: number; calls: string[] };

const server: ServerState = { rows: [], changes: [], failNext: 0, calls: [] };
(globalThis as { __linkServer?: ServerState }).__linkServer = server;

function row(id: string, name: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    owner_user_id: ME,
    contact_type: "individual",
    name,
    phone: null,
    email: null,
    note: null,
    linked_user_id: null,
    employer_contact_id: null,
    date_of_birth: null,
    relationship_tag: null,
    tax_code: null,
    business_address: null,
    representative_name: null,
    representative_phone: null,
    representative_email: null,
    industry: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    needs_details: false,
    ...extra,
  };
}

vi.mock("@/integrations/supabase/client", () => {
  const s = (): ServerState => (globalThis as unknown as { __linkServer: ServerState }).__linkServer;
  const builder = (rows: () => unknown): unknown => {
    let single = false;
    let range: [number, number] | null = null;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "range") {
            return (from: number, to: number) => {
              range = [from, to];
              return proxy;
            };
          }
          if (key === "then") {
            const every = rows();
            const all = range !== null && Array.isArray(every) ? every.slice(range[0], range[1] + 1) : every;
            const data = single ? (Array.isArray(all) ? (all[0] ?? null) : all) : all;
            const done = Promise.resolve({ data, error: null, count: 0 });
            return done.then.bind(done);
          }
          if (key === "single" || key === "maybeSingle") {
            return () => {
              single = true;
              return proxy;
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const err = (message: string) => Promise.resolve({ data: null, error: { code: "P0001", message } });
  const record = (kind: string, from: string | null, to: string | null, user: string | null): string => {
    const id = `chg-${s().changes.length + 1}`;
    s().changes.push({ id, kind, from, to, user, undone: false });
    return id;
  };
  const find = (id: unknown): Row | undefined => s().rows.find((r) => r.id === id);
  const friends = new Set(["ce09d234-af48-49a5-96f2-b2456ae4e5b0", "0b1f7a2c-0000-4000-8000-0000000117aa"]);
  const linkedElsewhere = (user: string | null): boolean => s().rows.some((r) => r.linked_user_id === user);
  return {
    supabase: {
      from: (table: string) =>
        table === "contact"
          ? builder(() => s().rows.map((r) => ({ ...r })))
          : table === "contact_link_changes"
            ? builder(() => s().changes.filter((c) => !c.undone && (c.kind === "relink" || c.kind === "link")).map((c) => ({ to_contact_id: c.to })))
            : builder(() => []),
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        const st = s();
        st.calls.push(name);
        if (["unlink_contact", "relink_contact", "link_contact_to_friend", "undo_contact_link_change"].includes(name) && st.failNext > 0) {
          st.failNext -= 1;
          return Promise.resolve({ data: null, error: { code: undefined, message: "TypeError: Failed to fetch" } });
        }
        if (name === "list_my_connections") {
          return Promise.resolve({
            data: [
              { user_id: "ce09d234-af48-49a5-96f2-b2456ae4e5b0", display_name: "Bảo Trần", pin: "A-BAO11700", created_at: "2026-09-01" },
              { user_id: "0b1f7a2c-0000-4000-8000-0000000117aa", display_name: "Linh Phạm", pin: "A-LINH1170", created_at: "2026-09-01" },
            ],
            error: null,
          });
        }
        if (name === "unlink_contact") {
          const from = find(args.p_contact_id);
          if (from === undefined) return err("avora_contact_not_yours");
          if (from.linked_user_id === null) return err("avora_contact_not_linked");
          const user = from.linked_user_id;
          from.linked_user_id = null;
          return Promise.resolve({ data: record("unlink", from.id, null, user), error: null });
        }
        if (name === "relink_contact") {
          const from = find(args.p_from_contact_id);
          const to = find(args.p_to_contact_id);
          if (from === undefined || to === undefined) return err("avora_contact_not_yours");
          if (from.id === to.id) return err("avora_contact_same");
          if (from.linked_user_id === null) return err("avora_contact_not_linked");
          if (to.contact_type !== "individual") return err("avora_contact_not_individual");
          if (to.linked_user_id !== null) return err("avora_contact_target_linked");
          const user = from.linked_user_id;
          from.linked_user_id = null;
          to.linked_user_id = user;
          return Promise.resolve({ data: record("relink", from.id, to.id, user), error: null });
        }
        if (name === "link_contact_to_friend") {
          const to = find(args.p_contact_id);
          const user = String(args.p_friend_id);
          if (to === undefined) return err("avora_contact_not_yours");
          if (to.linked_user_id !== null) return err("avora_contact_target_linked");
          if (!friends.has(user)) return err("avora_contact_not_friend");
          if (linkedElsewhere(user)) return err("avora_contact_account_linked_elsewhere");
          to.linked_user_id = user;
          return Promise.resolve({ data: record("link", null, to.id, user), error: null });
        }
        if (name === "undo_contact_link_change") {
          const change = st.changes.find((c) => c.id === args.p_change_id);
          if (change === undefined || change.undone) return err("avora_contact_undo_expired");
          change.undone = true;
          if (change.kind === "unlink") find(change.from)!.linked_user_id = change.user;
          if (change.kind === "relink") {
            find(change.to)!.linked_user_id = null;
            find(change.from)!.linked_user_id = change.user;
          }
          if (change.kind === "link") find(change.to)!.linked_user_id = null;
          return Promise.resolve({ data: record("undo", change.from, change.to, change.user), error: null });
        }
        return builder(() => []);
      },
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
      channel: () => builder(() => []),
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: { access_token: "t" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d", email: "me@probe.invalid", user_metadata: { display_name: "Thiện Võ" } },
    session: {},
    profile: { id: "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d", display_name: "Thiện Võ", avatar_url: null, created_at: "2026-09-01T00:00:00Z" },
    isLoading: false,
    signOut: async () => undefined,
    signOutOthers: async () => ({ ok: true }),
    updateDisplayName: async () => ({ ok: true }),
    profileError: null,
  }),
  useDisplayName: () => "Thiện Võ",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { ConfirmHost } from "@/components/ConfirmHost";
import { ContactLinkHost } from "@/components/contacts/ContactLinkManager";
import { openPersonCard, PersonCardHost } from "@/components/PersonCard";
import { closeContactLinkManager, openContactLinkManager } from "@/lib/contact-link-store";
import { personCardView } from "@/lib/person-card";
import { useConnections } from "@/lib/use-connections";
import { useContacts } from "@/lib/use-contacts";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import ContactDetail from "@/pages/ContactDetail";

const OUT = "../../../docs/screens/2026-10-14";
const WAIT = { timeout: 6_000, interval: 50 } as const;

/**
 * The name each place shows for an AVORA account, computed the way the place computes it: chat
 * list / group / task assignee all build `linkedUserId → contact.name` from `contactKeys.list`
 * (Messages, GroupCard, GroupInfoSheet, RecipientPicker), and the person card uses personCardView.
 */
function Names() {
  const { data: contacts } = useContacts();
  const { byId } = useConnections();
  const map = useMemo(
    () => new Map((contacts ?? []).filter((c) => c.linkedUserId !== null).map((c) => [c.linkedUserId as string, c.name] as const)),
    [contacts],
  );
  const shown = (id: string): string => map.get(id) ?? byId.get(id)?.displayName ?? "?";
  return (
    <div data-testid="names" className="hidden">
      <span data-name="chat">{shown(BAO)}</span>
      <span data-name="group">{shown(BAO)}</span>
      <span data-name="task">{shown(BAO)}</span>
      <span data-name="card">{personCardView({ userId: BAO, name: "Bảo Trần" }, ME, byId, contacts ?? []).name}</span>
    </div>
  );
}

const names = (): Record<string, string> =>
  Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-name]")].map((el) => [el.dataset.name ?? "", el.textContent ?? ""]));

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card">
            <main data-app-main="" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={null}>
                <Routes>
                  <Route path="/lien-he/:contactId" element={children} />
                  <Route path="*" element={children} />
                </Routes>
              </Suspense>
            </main>
          </div>
          <Names />
          <PersonCardHost />
          <ContactLinkHost />
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
}

beforeEach(async () => {
  server.rows = [
    row("c-tu", "Chú Tư", { phone: "0901117001", note: "Hàng xóm cũ, hay gọi buổi sáng", relationship_tag: "Gia đình", linked_user_id: BAO }),
    row("c-bao", "Bảo Trần (bạn đại học)", { phone: "0901117002" }),
    row("c-lan", "Lan Hương", { phone: "0901117003" }),
    row("c-biz", "Công ty Mây Xanh", { contact_type: "business", tax_code: "0101170000", representative_name: "Ông Hai" }),
  ];
  server.changes = [];
  server.failNext = 0;
  server.calls = [];
  closeContactLinkManager();
  await viewport(390, 844);
});

test("117.1 · gỡ liên kết: liên hệ còn nguyên, tên ở chat/nhóm/giao việc/thẻ người về tên AVORA; Hoàn tác", async () => {
  const screen = await render(<Frame at="/lien-he/c-tu"><ContactDetail /></Frame>);
  await expect.element(screen.getByRole("heading", { name: "Chú Tư" })).toBeInTheDocument();
  await vi.waitFor(() => expect(names()).toEqual({ chat: "Chú Tư", group: "Chú Tư", task: "Chú Tư", card: "Chú Tư" }), WAIT);

  await userEvent.click(screen.getByRole("button", { name: "Quản lý liên kết AVORA" }));
  await expect.element(screen.getByText("Tài khoản AVORA Bảo Trần đang gắn với liên hệ", { exact: false })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/117-quan-ly-lien-ket-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Gỡ liên kết/ }));
  await expect.element(screen.getByText("vẫn còn nguyên (tên, số, ghi chú)", { exact: false })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/117-xac-nhan-go-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Gỡ liên kết", exact: true }));

  await vi.waitFor(() => expect(names()).toEqual({ chat: "Bảo Trần", group: "Bảo Trần", task: "Bảo Trần", card: "Bảo Trần" }), WAIT);
  // The contact itself: same name, number, note, label.
  await expect.element(screen.getByRole("heading", { name: "Chú Tư" })).toBeInTheDocument();
  await expect.element(screen.getByText("Hàng xóm cũ, hay gọi buổi sáng")).toBeInTheDocument();
  expect(server.rows.find((r) => r.id === "c-tu")).toMatchObject({ name: "Chú Tư", phone: "0901117001", relationship_tag: "Gia đình", linked_user_id: null });
  expect(document.querySelector("[data-manage-link]")).toBeNull();
  await expect.element(screen.getByText("Đã gỡ liên kết khỏi Chú Tư")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
  await vi.waitFor(() => expect(names().chat).toBe("Chú Tư"), WAIT);
  expect(server.rows.find((r) => r.id === "c-tu")?.linked_user_id).toBe(BAO);
});

test("117.2 · chuyển sang liên hệ khác: bộ chọn chỉ liên hệ cá nhân chưa gắn, xác nhận đúng chữ, mọi nơi hiện tên mới; Hoàn tác", async () => {
  const screen = await render(<Frame at="/lien-he/c-tu"><ContactDetail /></Frame>);
  await userEvent.click(await screen.getByRole("button", { name: "Quản lý liên kết AVORA" }));
  await userEvent.click(screen.getByRole("button", { name: /Chuyển sang liên hệ khác/ }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-link-target]").length).toBe(2), WAIT);
  const targets = [...document.querySelectorAll<HTMLElement>("[data-link-target]")].map((el) => el.dataset.linkTarget);
  expect(targets.sort()).toEqual(["c-bao", "c-lan"]); // not itself, not the company

  await userEvent.fill(screen.getByRole("textbox", { name: "Tìm liên hệ" }), "bao tran");
  await vi.waitFor(() => expect(document.querySelectorAll("[data-link-target]").length).toBe(1), WAIT);
  await userEvent.click(screen.getByRole("button", { name: /Bảo Trần \(bạn đại học\)/ }));
  const confirm = document.querySelector("[data-link-confirm]")?.textContent ?? "";
  expect(confirm).toContain("Tài khoản AVORA Bảo Trần đang gắn với liên hệ Chú Tư");
  expect(confirm).toContain("Chuyển sang Bảo Trần (bạn đại học)?");
  expect(confirm).toContain("Liên hệ Chú Tư vẫn còn nguyên (tên, số, ghi chú)");
  expect(confirm).toContain("người này sẽ hiện tên Bảo Trần (bạn đại học)");
  await page.screenshot({ path: `${OUT}/117-xac-nhan-chuyen-390.png` });
  await viewport(844, 390);
  await page.screenshot({ path: `${OUT}/117-xac-nhan-chuyen-844x390.png` });
  await viewport(1280, 800);
  await page.screenshot({ path: `${OUT}/117-xac-nhan-chuyen-1280.png` });
  await viewport(390, 844);

  await userEvent.click(screen.getByRole("button", { name: "Chuyển liên kết" }));
  const moved = "Bảo Trần (bạn đại học)";
  await vi.waitFor(() => expect(names()).toEqual({ chat: moved, group: moved, task: moved, card: moved }), WAIT);
  await expect.element(screen.getByText(`Đã chuyển liên kết sang ${moved}`)).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/117-da-chuyen-hoan-tac-390.png` });
  expect(server.rows.find((r) => r.id === "c-tu")).toMatchObject({ name: "Chú Tư", phone: "0901117001", note: "Hàng xóm cũ, hay gọi buổi sáng", linked_user_id: null });

  await userEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
  await vi.waitFor(() => expect(names().chat).toBe("Chú Tư"), WAIT);
  expect(server.rows.find((r) => r.id === "c-bao")?.linked_user_id).toBeNull();
});

test("117.3 · từ thẻ người: Đổi tên trong danh bạ → chuyển; bạn chưa có liên hệ → Liên kết với liên hệ có sẵn", async () => {
  const screen = await render(<Frame at="/"><div /></Frame>);
  await vi.waitFor(() => expect(names().card).toBe("Chú Tư"), WAIT);
  openPersonCard({ userId: BAO, name: "Bảo Trần" });
  await userEvent.click(await screen.getByRole("button", { name: "Đổi tên trong danh bạ" }));
  await userEvent.click(screen.getByRole("button", { name: /Chuyển sang liên hệ khác/ }));
  await userEvent.click(screen.getByRole("button", { name: /Bảo Trần \(bạn đại học\)/ }));
  await userEvent.click(screen.getByRole("button", { name: "Chuyển liên kết" }));
  await vi.waitFor(() => expect(names().card).toBe("Bảo Trần (bạn đại học)"), WAIT);

  openPersonCard({ userId: LINH, name: "Linh Phạm" });
  await userEvent.click(await screen.getByRole("button", { name: "Liên kết với liên hệ có sẵn…" }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-link-target]").length).toBe(2), WAIT); // Chú Tư (now free) + Lan Hương
  await page.screenshot({ path: `${OUT}/117-lien-ket-voi-lien-he-390.png` });
  await userEvent.click(screen.getByRole("button", { name: /Lan Hương/ }));
  await userEvent.click(screen.getByRole("button", { name: "Liên kết", exact: true }));
  await vi.waitFor(() => expect(server.rows.find((r) => r.id === "c-lan")?.linked_user_id).toBe(LINH), WAIT);
  // Business contacts never get the manager.
  expect(server.calls.filter((c) => c === "link_contact_to_friend")).toHaveLength(1);
});

test("117.4 · bộ chọn với 1.000 liên hệ: chỉ vẽ phần nhìn thấy, tìm nhanh, cuộn tới cuối", async () => {
  server.rows.push(...Array.from({ length: 1000 }, (_, i) => row(`c-n${i}`, `Người thử ${String(i).padStart(4, "0")}`, { phone: `09${String(10000000 + i)}` })));
  const screen = await render(<Frame at="/lien-he/c-tu"><ContactDetail /></Frame>);
  await expect.element(screen.getByRole("heading", { name: "Chú Tư" })).toBeInTheDocument();
  openContactLinkManager({ kind: "manage", contactId: "c-tu", startAt: "pick" });
  await vi.waitFor(() => expect(document.querySelectorAll("[data-link-target]").length).toBeGreaterThan(3), WAIT);
  const drawn = document.querySelectorAll("[data-link-target]").length;
  expect(drawn).toBeLessThan(60);

  // In-page time from the keystroke to the redrawn list (the Playwright round trip is not the app's).
  const times: number[] = [];
  const input = screen.getByRole("textbox", { name: "Tìm liên hệ" });
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Tìm liên hệ"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const q of ["0999", "Người thử 05", "nguoi thu 0777", "09100009"]) {
    const t0 = performance.now();
    setValue?.call(field, q);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    times.push(performance.now() - t0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("[data-link-target]")).not.toBeNull();
  }
  await userEvent.fill(input, "");
  const list = document.querySelector<HTMLElement>("[data-link-picker]");
  list?.scrollTo({ top: list.scrollHeight });
  await vi.waitFor(() => expect(document.querySelector('[data-link-target="c-n999"]')).not.toBeNull(), WAIT);
  expect(document.querySelectorAll("[data-link-target]").length).toBeLessThan(60);
  console.log(`117.4 vẽ ${drawn} hàng / 1002; tìm (ms) ${times.map((t) => t.toFixed(0)).join(", ")}`);
  expect(Math.max(...times)).toBeLessThan(100);
});

test("117.5 · rớt mạng giữa chừng: báo rõ, nút Thử lại, không đổi gì cho tới khi gửi được", async () => {
  server.failNext = 1;
  const screen = await render(<Frame at="/lien-he/c-tu"><ContactDetail /></Frame>);
  await userEvent.click(await screen.getByRole("button", { name: "Quản lý liên kết AVORA" }));
  await userEvent.click(screen.getByRole("button", { name: /Gỡ liên kết/ }));
  await userEvent.click(screen.getByRole("button", { name: "Gỡ liên kết", exact: true }));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  expect(server.rows.find((r) => r.id === "c-tu")?.linked_user_id).toBe(BAO);
  expect(names().chat).toBe("Chú Tư");
  await page.screenshot({ path: `${OUT}/117-mat-mang-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  await vi.waitFor(() => expect(names().chat).toBe("Bảo Trần"), WAIT);
});

test("117.6 · liên hệ doanh nghiệp không có mục Quản lý liên kết", async () => {
  const screen = await render(<Frame at="/lien-he/c-biz"><ContactDetail /></Frame>);
  await expect.element(screen.getByRole("heading", { name: "Công ty Mây Xanh" })).toBeInTheDocument();
  expect(document.querySelector("[data-manage-link]")).toBeNull();
});
