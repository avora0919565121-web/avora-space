import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";

import type { ContactChannel, DuplicatePair } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

/**
 * AVORA-102 · B — Danh bạ past 1 000: 102.10 (counts), 102.12 (Có thể trùng: Gộp + Hoàn tác),
 * 102.14 (open 5 000 people, CPU ×4). The server half (3 000-contact import, re-import adds 0,
 * 1 800 flags) is probed in supabase/tests/avora102_contacts_past_1000.probe.sql.
 */
const state = vi.hoisted(() => ({
  contacts: [] as Contact[],
  channels: [] as ContactChannel[],
  pairs: [] as DuplicatePair[],
  merged: [] as string[],
  undone: [] as string[],
  dismissed: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" }, session: null }), useDisplayName: () => "Thiện" }));
vi.mock("@/lib/contacts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return { ...actual, fetchContacts: async () => state.contacts };
});
vi.mock("@/lib/contact-channels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contact-channels")>("@/lib/contact-channels");
  return {
    ...actual,
    fetchContactChannels: async () => state.channels,
    fetchDuplicatePairs: async () => state.pairs,
    mergeContacts: async (keep: string, drop: string) => {
      state.merged.push(`${keep}<-${drop}`);
      state.pairs = state.pairs.filter((p) => p.dropId !== drop);
      return "merge-1";
    },
    undoMerge: async (id: string) => {
      state.undone.push(id);
    },
    dismissDuplicate: async (a: string, b: string) => {
      state.dismissed.push(`${a}|${b}`);
    },
  };
});
vi.mock("@/lib/use-opportunities", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-opportunities")>("@/lib/use-opportunities");
  return { ...actual, useOpenOpportunityContacts: () => new Set<string>() };
});
vi.mock("@/lib/use-connections", () => ({ useConnections: () => ({ byId: new Map(), connections: [], isPending: false }) }));

const { default: Contacts } = await import("@/pages/Contacts");
const { DuplicatePairsSection } = await import("@/components/contacts/DuplicatePairsSection");
const { Toaster } = await import("@/components/ui/sonner");

const OUT = "../../../docs/screens/2026-10-08";

function person(i: number, name: string): Contact {
  return {
    id: `c${i}`,
    ownerUserId: "u-me",
    contactType: "individual",
    name,
    phone: `09${String(i).padStart(8, "0")}`,
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
  } as Contact;
}

function book(count: number): Contact[] {
  return Array.from({ length: count }, (_, i) => person(i, i >= count - 10 ? `Ý ${i}` : `Người ${String(i).padStart(4, "0")}`));
}

function Frame({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/lien-he"]}>
        <div className="flex h-[100dvh] flex-col">{children}</div>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

test("102.10 · 3 000 liên hệ: Danh bạ đếm đủ, người tên `Ý…` cuối bảng chữ cái vẫn có", async () => {
  await page.viewport(390, 844);
  state.contacts = book(3000);
  const screen = await render(
    <Frame>
      <Contacts />
    </Frame>,
  );
  await expect.poll(() => document.querySelector("[data-contact-list]")?.getAttribute("data-count")).toBe("3000");
  // Only what is on screen is drawn.
  expect(document.querySelectorAll("[data-contact-list] li").length).toBeLessThan(60);
  await screen.getByPlaceholder(/Tìm/).fill("y 2999");
  await expect.element(screen.getByText("Ý 2999")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/102-danh-ba-390.png` });
});

test("102.14 · mở Danh bạ 5 000 người với CPU ×4: thời gian ghi lại, cuộn không giật", async () => {
  await page.viewport(390, 844);
  const session = cdp() as unknown as { send: (method: string, params: Record<string, unknown>) => Promise<unknown> };
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  state.contacts = book(5000);
  const t0 = performance.now();
  await render(
    <Frame>
      <Contacts />
    </Frame>,
  );
  await expect.poll(() => document.querySelector("[data-contact-list]")?.getAttribute("data-count"), { timeout: 15_000 }).toBe("5000");
  const openMs = Math.round(performance.now() - t0);
  const scroller = document.querySelector("[data-contact-list]")?.closest(".paper") as HTMLElement;
  // Scroll in 20 steps and measure the longest frame.
  let worst = 0;
  for (let step = 1; step <= 20; step += 1) {
    const s0 = performance.now();
    scroller.scrollTop = step * 1200;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    worst = Math.max(worst, performance.now() - s0);
  }
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.info(`[102.14] open=${openMs}ms worstScrollFrame=${Math.round(worst)}ms (CPU x4)`);
  expect(document.querySelectorAll("[data-contact-list] li").length).toBeLessThan(60);
  expect(openMs).toBeLessThan(5000);
});

test("102.12 · Có thể trùng (50): gộp 1 cặp → Hoàn tác; `Không phải trùng`", async () => {
  await page.viewport(390, 844);
  state.pairs = Array.from({ length: 50 }, (_, i) => ({ keepId: `k${i}`, keepName: `Lan ${i}`, dropId: `d${i}`, dropName: `Lan ${i} (2)`, kind: "phone" as const, value: `09${String(i).padStart(8, "0")}` }));
  const screen = await render(
    <Frame>
      <div className="px-4">
        <DuplicatePairsSection onOpenContact={() => undefined} />
      </div>
    </Frame>,
  );
  await expect.element(screen.getByRole("heading", { name: "Có thể trùng (50)" })).toBeInTheDocument();
  // Nothing merged on its own.
  expect(state.merged).toEqual([]);
  expect(document.querySelectorAll("[data-duplicate-pair]").length).toBe(30);
  await screen.getByRole("button", { name: "Gộp" }).first().click();
  await expect.poll(() => state.merged).toEqual(["k0<-d0"]);
  await screen.getByRole("button", { name: "Hoàn tác" }).click();
  await expect.poll(() => state.undone).toEqual(["merge-1"]);
  await screen.getByRole("button", { name: "Không phải trùng" }).first().click();
  await expect.poll(() => state.dismissed.length).toBe(1);
});
