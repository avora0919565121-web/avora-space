import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

const db: { rpcs: Record<string, unknown> } = { rpcs: {} };

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const done = Promise.resolve({ data: rows, error: null });
            return done.then.bind(done);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: () => builder([]),
      rpc: (name: string) => builder(db.rpcs[name] ?? null),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", email: "me@example.vn" }, session: { user: { id: "me" }, access_token: undefined }, signOut: async () => undefined, isLoading: false }),
  useDisplayName: () => "Thiện",
}));

import { BlockScreen } from "@/components/DeviceGuard";
import { DeviceSecuritySection } from "@/components/DeviceSecurity";
import { PolicyView } from "@/components/PolicyView";
import { DefaultBoardsGroup, OpportunityBoardBar } from "@/components/think-hub/OpportunityBoard";
import { DiaryFilesView } from "@/components/chat/DiaryViews";
import { Toaster } from "@/components/ui/sonner";
import { VaultSetupFlow } from "@/components/vault/VaultSetup";
import { VaultForgotEncrypted } from "@/components/vault/VaultForgot";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import type { MessageAttachment } from "@/lib/attachments";
import type { DiaryFileNote } from "@/lib/diary-views";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";
import DeviceConfirm from "@/pages/DeviceConfirm";

const OUT = "../../../docs/screens/2026-10-02";
const now = new Date().toISOString();
const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

function Frame({ children, at = "/" }: { children: ReactNode; at?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <VaultLockProvider>
          <div className="paper min-h-[100dvh]">{children}</div>
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

const SIZES: readonly [number, number][] = [
  [390, 844],
  [844, 390],
];

// ------------------------------------------------------------------ 66 · Chính sách
for (const [w, h] of [...SIZES, [1280, 800] as [number, number]]) {
  test(`66 · Chính sách (công khai) ${w}x${h}: chip + Lớp 2 mở`, async () => {
    await viewport(w, h);
    const screen = await render(
      <Frame at="/chinh-sach?chi-tiet=1#ket-sat">
        <PolicyView isPublic />
      </Frame>,
    );
    await expect.element(screen.getByRole("heading", { name: "D. Két sắt" })).toBeInTheDocument();
    expect(document.querySelector('[data-policy-tech="ket-sat"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-status="done"]').length).toBeGreaterThan(10);
    await settle(300);
    await page.screenshot({ path: `${OUT}/66-chinh-sach-cong-khai-${w}.png` });
  });
}

// ------------------------------------------------------------------ 67 · Thiết bị
const STATUS = {
  allowed: true,
  reason: null,
  device: "d1",
  my_rank: 1,
  guest: false,
  lost_by: null,
  lost_at: null,
  lock: { rank: 1, at: hoursAgo(1), mine: true, by_label: "iPhone · Safari", escape_at: null },
  rank_taken: { "1": true, "2": true },
  vault_other_allowed: false,
};
const DEVICES = [
  { id: "d1", label: "iPhone · Safari", kind: "phone", rank: 1, guest: false, last_seen_at: now, is_me: true, lost_status: null, lost_deadline: null, can_revoke: false, can_report_lost: false, can_open_vault: true },
  { id: "d2", label: "Mac · Chrome", kind: "computer", rank: 2, guest: false, last_seen_at: hoursAgo(3), is_me: false, lost_status: null, lost_deadline: null, can_revoke: true, can_report_lost: true, can_open_vault: true },
  { id: "d3", label: "Windows · Edge", kind: "computer", rank: 3, guest: false, last_seen_at: hoursAgo(50), is_me: false, lost_status: null, lost_deadline: null, can_revoke: true, can_report_lost: false, can_open_vault: false },
];

for (const [w, h] of SIZES) {
  test(`67 · Hồ sơ › Bảo mật ${w}x${h}: Ưu tiên 1, 2, Máy khác, đang khoá`, async () => {
    db.rpcs = { device_status: STATUS, list_my_devices: DEVICES, device_challenge: "bm9uY2U=" };
    await viewport(w, h);
    const screen = await render(
      <Frame>
        <div className="mx-auto max-w-2xl p-6">
          <h2 className="text-[17px] font-semibold">Bảo mật</h2>
          <DeviceSecuritySection signOutOthers={<button type="button" className="min-h-11 rounded-md border border-border px-4 text-[14px] font-medium">Đăng xuất mọi thiết bị khác</button>} />
        </div>
      </Frame>,
    );
    await expect.element(screen.getByText("Mac · Chrome")).toBeInTheDocument();
    expect(document.querySelector("[data-lock-strip]")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Máy khác/ }));
    await settle(300);
    await page.screenshot({ path: `${OUT}/67-bao-mat-thiet-bi-${w}.png` });
  });

  test(`67 · sheet Báo mất ${w}x${h}`, async () => {
    db.rpcs = { device_status: { ...STATUS, lock: null }, list_my_devices: DEVICES, device_challenge: "bm9uY2U=" };
    await viewport(w, h);
    const screen = await render(
      <Frame>
        <div className="mx-auto max-w-2xl p-6">
          <DeviceSecuritySection signOutOthers={<span />} />
        </div>
      </Frame>,
    );
    await expect.element(screen.getByText("Mac · Chrome")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tuỳ chọn cho Mac · Chrome" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Tôi mất thiết bị này" }));
    await expect.element(screen.getByRole("radio", { name: "3 ngày" })).toBeInTheDocument();
    await settle(300);
    await page.screenshot({ path: `${OUT}/67-bao-mat-sheet-${w}.png` });
  });

  for (const reason of ["lost", "revoked", "locked"] as const) {
    test(`67 · màn chặn ${reason} ${w}x${h}`, async () => {
      await viewport(w, h);
      await render(
        <Frame>
          <BlockScreen status={{ allowed: false, reason, device: "d2", myRank: 2, guest: false, lostBy: "iPhone · Safari", lostAt: hoursAgo(2), lock: null, rankTaken: { 1: true, 2: true }, vaultOtherAllowed: false }} />
        </Frame>,
      );
      expect(document.querySelector(`[data-block-screen="${reason}"]`)).not.toBeNull();
      await settle(200);
      await page.screenshot({ path: `${OUT}/67-man-chan-${reason}-${w}.png` });
    });
  }

  test(`67 · /xac-nhan-thiet-bi ${w}x${h}: mở link không đổi gì`, async () => {
    const calls: unknown[] = [];
    const original = window.fetch;
    window.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ status: "open", kind: "lost_confirm", label: "Mac · Chrome", when: "09:12 02/10/2026" }), { status: 200 });
    }) as typeof window.fetch;
    await viewport(w, h);
    const screen = await render(
      <Frame at={`/xac-nhan-thiet-bi?t=${"a".repeat(64)}`}>
        <DeviceConfirm />
      </Frame>,
    );
    await expect.element(screen.getByRole("button", { name: "Đúng, tôi đã báo" })).toBeInTheDocument();
    // Opening only asked for a description (67.5).
    expect(calls.every((c) => (c as { op?: string }).op === "info")).toBe(true);
    await settle(200);
    await page.screenshot({ path: `${OUT}/67-xac-nhan-thiet-bi-${w}.png` });
    window.fetch = original;
  });
}

// ------------------------------------------------------------------ 68 · Két sắt mã hoá
for (const [w, h] of SIZES) {
  test(`68 · lần đầu 4 bước ${w}x${h}`, async () => {
    await viewport(w, h);
    const screen = await render(
      <Frame>
        <VaultSetupFlow />
      </Frame>,
    );
    await expect.element(screen.getByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
    await page.screenshot({ path: `${OUT}/68-1-gioi-thieu-${w}.png` });
    await userEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    const first = document.querySelector<HTMLInputElement>("[data-passphrase]") as HTMLInputElement;
    const again = document.querySelector<HTMLInputElement>("[data-passphrase-again]") as HTMLInputElement;
    // AVORA-75 · A1: hidden by default, never offered to a password manager.
    expect(first.type).toBe("password");
    expect(again.type).toBe("password");
    expect(first.autocomplete).toBe("off");
    await userEvent.fill(first, "mot hai ba bon nam");
    await userEvent.fill(again, "mot hai ba bon nam");
    // The suggestion shows its words once, so they can be copied down.
    await userEvent.click(screen.getByRole("button", { name: /Gợi ý một cụm dễ nhớ/ }));
    expect(first.type).toBe("text");
    await userEvent.fill(again, first.value);
    await settle(200);
    await page.screenshot({ path: `${OUT}/68-2-mat-khau-ket-sat-${w}.png` });
    await userEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    await expect.element(screen.getByText(/Đây là cách duy nhất để mở lại Két sắt/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-kit-words] li").length).toBe(24);
    await page.screenshot({ path: `${OUT}/68-3-bo-khoi-phuc-${w}.png` });
    await userEvent.click(screen.getByRole("button", { name: "Tôi đã cất" }));
    expect(document.querySelectorAll("[data-kit-check]").length).toBe(3);
    // No skip button on the check.
    expect(screen.getByRole("button", { name: /Bỏ qua/ }).elements().length).toBe(0);
    await page.screenshot({ path: `${OUT}/68-4-hoi-3-tu-${w}.png` });
  });

  test(`68 · Quên mã? (đã mã hoá) ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(
      <Frame>
        <VaultForgotEncrypted onBack={() => undefined} />
      </Frame>,
    );
    expect(document.querySelector("[data-forgot-menu]")?.textContent).not.toContain("email");
    await settle(200);
    await page.screenshot({ path: `${OUT}/68-quen-ma-${w}.png` });
  });
}

// ------------------------------------------------------------------ 72 · Danh sách cơ hội
const SYNC_BOARD = { id: "sb", name: "Danh bạ | Danh sách cơ hội", syncSource: "contact_opportunities", hiddenInList: false } as unknown as ThinkTable;
const rec = (title: string, status: string, value: number): ThinkRecord =>
  ({ id: title, tableId: "sb", ownerUserId: "me", title, status, priority: "trung_binh", category: null, nextActionDate: null, remindAt: null, tags: [], notes: null, extensionFields: { sync_value: String(value) }, projectId: null, createdAt: now, updatedAt: now, deletedAt: null, movedFrom: null }) as ThinkRecord;

for (const [w, h] of [...SIZES, [1280, 800] as [number, number]]) {
  test(`72 · nhóm Bảng Avora mặc định + thanh chip ${w}x${h}`, async () => {
    await viewport(w, h);
    await render(
      <Frame>
        <div className="mx-auto max-w-3xl space-y-4 p-5">
          <DefaultBoardsGroup boards={[SYNC_BOARD]} activeId="sb" onOpen={() => undefined} />
          <h2 className="text-[20px] font-semibold">Danh bạ | Danh sách cơ hội</h2>
          <OpportunityBoardBar chip="doi_tac" onChip={() => undefined} records={[rec("Anam Cam Ranh", "doi_tac", 500_000_000), rec("Hoiana", "doi_tac", 1_250_000_000)]} isEmpty={false} onNew={() => undefined} />
          <h3 className="pt-6 text-[14px] text-muted-foreground">Màn trống (72.0)</h3>
          <OpportunityBoardBar chip="open" onChip={() => undefined} records={[]} isEmpty onNew={() => undefined} />
        </div>
      </Frame>,
    );
    // 72.12: the total of the rows shown under `Đối tác`.
    expect(document.querySelector("[data-opportunity-total]")?.getAttribute("data-opportunity-total")).toBe("1750000000");
    expect(document.querySelector("[data-opportunity-empty]")?.textContent).toContain("Gán Cơ hội cho một liên hệ để bắt đầu");
    await settle(200);
    await page.screenshot({ path: `${OUT}/72-danh-sach-co-hoi-${w}.png` });
  });
}

// ------------------------------------------------------------------ 73 · File của tôi theo loại
const att = (id: string, kind: MessageAttachment["kind"], mimeType: string, fileName: string, captureSource: "camera" | "library" | null = null, hours = 1): MessageAttachment => ({
  id, messageId: `m-${id}`, conversationId: "j1", attachedBy: "me", kind, storagePath: `p/${id}`, fileName, mimeType, byteSize: 240_000, width: null, height: null, durationSeconds: null, permission: "export", originMessageId: null, createdAt: hoursAgo(hours), captureSource,
});
const FILES: DiaryFileNote[] = [
  att("1", "image", "image/jpeg", "anh-cong-trinh.jpg", "camera", 2),
  att("2", "image", "image/jpeg", "anh-thu-vien.jpg", "library", 3),
  att("3", "file", "video/mp4", "quay-hien-truong.mp4", "camera", 4),
  att("4", "voice", "audio/webm", "ghi-am.webm", null, 26),
  att("5", "file", "audio/mpeg", "nhac-nen.mp3", null, 27),
  att("6", "file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "de-xuat.docx", null, 28),
  att("7", "file", "application/pdf", "bao-gia.pdf", null, 50),
  att("8", "file", "application/epub+zip", "sach-quan-tri.epub", null, 51),
  att("9", "file", "application/zip", "ho-so.zip", null, 52),
].map((a) => ({ messageId: a.messageId, attachments: [a], note: "", source: "uploaded", createdAt: a.createdAt, place: "files" }) as DiaryFileNote);

for (const [w, h] of [...SIZES, [1280, 800] as [number, number]]) {
  test(`73 · File của tôi: hàng chip ${w}x${h}`, async () => {
    window.localStorage.removeItem("avora.diary-files.chip");
    await viewport(w, h);
    const screen = await render(
      <Frame>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center px-3 py-3"><h2 className="text-[18px] font-semibold">File của tôi</h2></div>
          <DiaryFilesView notes={FILES} urlOf={() => null} isLoading={false} onOpenNote={() => undefined} onDelete={() => undefined} />
        </div>
      </Frame>,
    );
    const chips = [...document.querySelectorAll("[data-file-chip]")].map((el) => el.getAttribute("data-file-chip"));
    // 73.1: every kind present, in the fixed order, nothing empty.
    expect(chips).toEqual(["all", "image", "camera", "video", "voice", "audio", "document", "pdf", "book", "other"]);
    await settle(200);
    await page.screenshot({ path: `${OUT}/73-file-chip-${w}.png` });
    // 73.2: Chụp từ máy shows only the camera photo + video.
    await userEvent.click(screen.getByRole("tab", { name: /Chụp từ máy/ }));
    expect(document.querySelectorAll("[data-line]").length).toBe(2);
    await settle(200);
    await page.screenshot({ path: `${OUT}/73-file-chup-tu-may-${w}.png` });
    // 73.3: the chip is remembered on this device.
    expect(window.localStorage.getItem("avora.diary-files.chip")).toBe("camera");
  });
}
