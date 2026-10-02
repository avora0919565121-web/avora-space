import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import type { VaultItem } from "@/lib/use-vault-e2ee";
import type { VaultPayload } from "@/lib/vault-templates";

const state: { items: VaultItem[]; saved: VaultPayload[]; pageUrl: string } = { items: [], saved: [], pageUrl: "" };

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }), from: () => ({}), auth: { getSession: async () => ({ data: { session: null } }) } } }));
const AUTH = { user: { id: "me" }, session: null, isLoading: false };
vi.mock("@/lib/auth", () => ({ useAuth: () => AUTH }));
// Stable like React Query data: a fresh object per render would re-run every effect keyed on it.
const RING = { section_keys: {} };
vi.mock("@/lib/use-vault-e2ee", () => ({
  vaultE2eeKeys: { keyring: () => ["vault-keyring"], items: (s: string) => ["vault-items", s] },
  useKeyring: () => ({ ring: RING, isPending: false }),
  useHasMasterKey: () => true,
  useVaultItems: () => ({ items: state.items, isPending: false, error: null }),
  useVaultItemActions: () => ({
    save: { isPending: false, mutateAsync: async (input: { payload: VaultPayload }) => { state.saved.push(input.payload); return "new"; } },
    trash: { mutateAsync: async () => undefined },
    purge: { mutateAsync: async () => undefined },
  }),
  openPage: async () => ({ url: state.pageUrl, blob: new Blob() }),
}));

import { ConfirmHost } from "@/components/ConfirmHost";
import { Toaster } from "@/components/ui/sonner";
import { VaultCompartment } from "@/components/vault/VaultCompartment";

const OUT = "../../../docs/screens/2026-10-02";
const iso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function item(id: string, payload: Partial<VaultPayload>, files = 0, deletedAt: string | null = null): VaultItem {
  return {
    id,
    section: "certificates",
    payload: { v: 1, type: "cccd", title: "", owner_label: "Tôi", owner_contact_id: null, fields: {}, tags: [], note: "", links: [], show_name_in_reminder: false, ...payload },
    remindOn: null,
    deletedAt,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    files: Array.from({ length: files }, (_, i) => ({ id: `${id}-f${i}`, pageNo: i + 1, storagePath: `p/${i}`, wrappedFileKey: "k", bytes: 1, mimeClass: "image" as const })),
  };
}

const ITEMS: VaultItem[] = [
  item("cccd", { type: "cccd", title: "CCCD của tôi", fields: { number: "0790 9012 3456", issued_on: "2021-04-12", issuer: "Cục Cảnh sát QLHC về TTXH", expires_on: iso(62) } }, 2),
  item("passport", { type: "passport", title: "Hộ chiếu", fields: { number: "C1234567", issued_on: "2019-08-01", expires_on: iso(400) } }),
  item("driving", { type: "driving", title: "Bằng lái B2", fields: { number: "790123456789", class: "B2", issued_on: "2018-06-20" } }),
  item("birth-an", { type: "birth", title: "Khai sinh bé An", owner_label: "Bé An", fields: { issued_on: "2020-02-14" } }),
  item("degree", { type: "degree", title: "Bằng Cử nhân Kinh tế", fields: { school: "ĐH Kinh tế TP.HCM", major: "Quản trị", issued_on: "2012-07-30" } }),
  item("ielts", { type: "language", title: "IELTS 7.5", fields: { score: "7.5", issued_on: "2024-03-02", expires_on: iso(18) } }),
  item("bhyt", { type: "insurance", title: "Thẻ BHYT", fields: { number: "DN4797912345678", provider: "BV Quận 1", expires_on: iso(140) } }),
  item("old", { type: "other-cert", title: "Thẻ thư viện cũ" }, 0, "2026-09-28T00:00:00Z"),
];

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div className="paper flex h-[100dvh] flex-col">{children}</div>
        <ConfirmHost />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}
const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A stand-in page scan (the real one is decrypted from storage). */
async function makePageUrl(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 856;
  canvas.height = 540;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#e9eef3";
  g.fillRect(0, 0, 856, 540);
  g.fillStyle = "#c33";
  g.fillRect(0, 0, 856, 70);
  g.fillStyle = "#fff";
  g.font = "bold 30px sans-serif";
  g.fillText("CĂN CƯỚC CÔNG DÂN", 230, 46);
  g.fillStyle = "#b7c3cf";
  g.fillRect(40, 110, 200, 260);
  g.fillStyle = "#56616d";
  for (let i = 0; i < 6; i += 1) g.fillRect(280, 120 + i * 48, 480 - i * 40, 16);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.85));
  return URL.createObjectURL(blob);
}

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
  test(`68 · Chứng chỉ: danh sách, Dòng đời, chi tiết, form CCCD, Thùng rác ${w}x${h}`, async () => {
    state.items = ITEMS;
    state.pageUrl = await makePageUrl();
    await viewport(w, h);
    const screen = await render(<Frame><VaultCompartment section="certificates" /></Frame>);
    await expect.element(screen.getByText("CCCD của tôi")).toBeInTheDocument();
    // A dot + `Còn N ngày` only on what is close to its date (CCCD lead 90 days, IELTS 30).
    expect(document.querySelector('[data-vault-row="cccd"]')?.textContent).toContain("Còn 62 ngày");
    expect(document.querySelector('[data-vault-row="ielts"]')?.textContent).toContain("Còn 18 ngày");
    expect(document.querySelector('[data-vault-row="passport"]')?.textContent).not.toContain("Còn");
    await page.screenshot({ path: `${OUT}/68-ngan-danh-sach-${w}.png` });

    await userEvent.click(screen.getByRole("tab", { name: "Dòng đời" }));
    await settle();
    await page.screenshot({ path: `${OUT}/68-ngan-dong-doi-${w}.png` });
    await userEvent.click(screen.getByRole("tab", { name: "Theo nhóm" }));

    await userEvent.click(screen.getByText("CCCD của tôi"));
    await expect.element(screen.getByRole("heading", { name: "CCCD của tôi" })).toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll("[data-vault-detail] img").length).toBe(2);
    await settle(300);
    await page.screenshot({ path: `${OUT}/68-chi-tiet-cccd-${w}.png` });

    await userEvent.click(screen.getByRole("button", { name: "Sửa" }));
    await expect.element(screen.getByText("Số")).toBeInTheDocument();
    await settle();
    await page.screenshot({ path: `${OUT}/68-form-cccd-${w}.png` });
    await userEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await userEvent.click(screen.getByRole("button", { name: "Chứng chỉ" }));

    await userEvent.click(screen.getByRole("button", { name: "Thùng rác" }));
    await expect.element(screen.getByText("Thẻ thư viện cũ")).toBeInTheDocument();
    await page.screenshot({ path: `${OUT}/68-thung-rac-${w}.png` });
  });
}

test("68.16 · số chạm: giấy 1 mặt từ `+` tới `Lưu` ≤ 4; PDF trên máy tính ≤ 3", async () => {
  state.items = [];
  state.saved = [];
  await viewport(390, 844);
  let taps = 0;
  const tap = async (el: Parameters<typeof userEvent.click>[0]): Promise<void> => {
    taps += 1;
    await userEvent.click(el);
  };
  const screen = await render(<Frame><VaultCompartment section="certificates" /></Frame>);
  await tap(screen.getByRole("button", { name: "Thêm" }));
  await tap(screen.getByRole("button", { name: "Chụp ảnh" }));
  // The camera's own shutter is one tap in the system camera.
  taps += 1;
  const photo = new File([await (await fetch(await makePageUrl())).blob()], "chup.jpg", { type: "image/jpeg" });
  const camera = document.querySelector('input[capture="environment"][accept="image/*"]') as HTMLInputElement;
  await userEvent.upload(camera, photo);
  await expect.element(screen.getByText("1 trang đính kèm")).toBeInTheDocument();
  // `Tên` has the focus already: typing is not a tap.
  await userEvent.keyboard("CCCD");
  await tap(screen.getByRole("button", { name: "Lưu" }));
  expect(state.saved[state.saved.length - 1]?.title).toBe("CCCD");
  expect(taps).toBeLessThanOrEqual(4);

  // Computer: drop a PDF on the compartment → the form opens → Tên → Lưu.
  await viewport(1280, 800);
  state.saved = [];
  const second = await render(<Frame><VaultCompartment section="documents" /></Frame>);
  let pcTaps = 1; // the drop
  const zone = document.querySelectorAll("[data-vault-section]");
  const target = zone[zone.length - 1] as HTMLElement;
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "hop-dong-thue.pdf", { type: "application/pdf" }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  await expect.element(second.getByText("1 trang đính kèm")).toBeInTheDocument();
  await userEvent.keyboard("Hợp đồng thuê");
  pcTaps += 1;
  await userEvent.click(second.getByRole("button", { name: "Lưu" }));
  expect(state.saved[state.saved.length - 1]?.title).toBe("Hợp đồng thuê");
  expect(pcTaps).toBeLessThanOrEqual(3);
  console.info(`[68.16] phone photo: ${taps} taps · computer PDF: ${pcTaps}`);
});

test("68 · mở ngăn 100 mục: danh sách hiện và tìm trên máy nhanh", async () => {
  const types = ["cccd", "passport", "driving", "degree", "language", "license", "insurance", "other-cert"];
  state.items = Array.from({ length: 100 }, (_, i) => item(`i${i}`, { type: types[i % types.length], title: `Giấy tờ số ${i + 1}`, owner_label: i % 3 === 0 ? "Bé An" : "Tôi", fields: { number: `NO${1000 + i}`, issued_on: `20${10 + (i % 15)}-01-01` } }));
  await viewport(390, 844);
  const started = performance.now();
  const screen = await render(<Frame><VaultCompartment section="certificates" /></Frame>);
  await expect.poll(() => document.querySelectorAll("[data-vault-row]").length).toBe(100);
  const openMs = performance.now() - started;
  const input = screen.getByRole("textbox", { name: "Tìm trong Chứng chỉ" });
  const searchStart = performance.now();
  await userEvent.fill(input, "NO1042");
  await expect.poll(() => document.querySelectorAll("[data-vault-row]").length).toBe(1);
  const searchMs = performance.now() - searchStart;
  console.info(`[68] 100 items: render ${Math.round(openMs)} ms · search ${Math.round(searchMs)} ms (decrypt excluded — measured in vault-crypto bench)`);
  expect(openMs).toBeLessThan(1500);
  expect(searchMs).toBeLessThan(800);
  await page.screenshot({ path: `${OUT}/68-ngan-100-muc-tim-390.png` });
});
