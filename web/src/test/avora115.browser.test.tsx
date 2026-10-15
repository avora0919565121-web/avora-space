import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * AVORA-115 — ảnh đại diện. A stateful fake server that applies the real rule (owner + friends see,
 * everyone else gets nothing), real components, real image work in the browser.
 */
const ME = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";
const FRIEND = "ce09d234-af48-49a5-96f2-b2456ae4e5b0";
const GROUPMATE = "0b1f7a2c-0000-4000-8000-0000000115cc"; // synthetic — no real account (VMT 14/10)

type ServerState = {
  paths: Map<string, string>;
  friends: Set<string>;
  failSetAvatar: boolean;
  removed: string[];
  uploaded: { path: string; size: number; type: string }[];
  reports: unknown[];
};
const server: ServerState = { paths: new Map(), friends: new Set(), failSetAvatar: false, removed: [], uploaded: [], reports: [] };
(globalThis as { __avatarServer?: ServerState }).__avatarServer = server;

vi.mock("@/integrations/supabase/client", () => {
  const state = (): ServerState => (globalThis as unknown as { __avatarServer: ServerState }).__avatarServer;
  const builder = (rows: unknown): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
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
  const picture = (path: string): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    let hash = 0;
    for (const char of path) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    if (context !== null) {
      context.fillStyle = `hsl(${hash}, 55%, 52%)`;
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "rgba(255,255,255,0.85)";
      context.beginPath();
      context.arc(32, 26, 12, 0, Math.PI * 2);
      context.fill();
      context.fillRect(14, 42, 36, 22);
    }
    return canvas.toDataURL("image/png");
  };
  const me = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";
  return {
    supabase: {
      from: () => builder([]),
      rpc: (name: string, args?: Record<string, unknown>) => {
        const s = state();
        if (name === "avatar_paths") {
          const ids = (args?.p_user_ids as string[]) ?? [];
          const rows = ids
            .filter((id) => s.paths.has(id) && (id === me || s.friends.has(id)))
            .map((id) => ({ user_id: id, path: s.paths.get(id), version: "v" }));
          return Promise.resolve({ data: rows, error: null });
        }
        if (name === "set_avatar") {
          if (s.failSetAvatar) return Promise.resolve({ data: null, error: { code: undefined, message: "TypeError: Failed to fetch" } });
          const old = s.paths.get(me) ?? null;
          s.paths.set(me, String(args?.p_path));
          return Promise.resolve({ data: old, error: null });
        }
        if (name === "clear_avatar") {
          const old = s.paths.get(me) ?? null;
          s.paths.delete(me);
          return Promise.resolve({ data: old, error: null });
        }
        if (name === "report_user") {
          s.reports.push(args);
          return Promise.resolve({ data: "r1", error: null });
        }
        return builder([]);
      },
      storage: {
        from: (bucket: string) =>
          bucket !== "avatars"
            ? builder([])
            : {
                upload: async (path: string, blob: Blob) => {
                  state().uploaded.push({ path, size: blob.size, type: blob.type });
                  return { data: { path }, error: null };
                },
                remove: async (paths: string[]) => {
                  state().removed.push(...paths);
                  return { data: [], error: null };
                },
                createSignedUrls: async (paths: string[]) => ({
                  data: paths.map((path) => ({ path, signedUrl: picture(path), error: null })),
                  error: null,
                }),
              },
      },
      channel: () => builder([]),
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d", email: "me@probe.invalid" },
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

import { AvatarEditorHost } from "@/components/AvatarEditor";
import { ConfirmHost } from "@/components/ConfirmHost";
import { openPersonCard, PersonCardHost } from "@/components/PersonCard";
import { UserAvatar } from "@/components/UserAvatar";
import { invalidateAvatar, prepareAvatarImage, resetAvatarCacheForTests } from "@/lib/avatars";
import { VaultLockProvider } from "@/lib/use-vault-lock";
import Profile from "@/pages/Profile";

const OUT = "../../../docs/screens/2026-10-13";
/**
 * 112-A · 6: these waits cover compress → upload → set_avatar → delete old file → redraw. Under a full
 * parallel run that chain went past vi.waitFor's 1 s default once (the old-file delete, run 1 of 112-A).
 * A fixed budget that only fits an idle machine is the flake; give the chain room instead.
 */
const WAIT = { timeout: 8_000, interval: 50 } as const;

let client: QueryClient | null = null;

function Frame({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  client = queryClient;
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card">
            <main data-app-main="" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={null}>{children}</Suspense>
            </main>
          </div>
          <AvatarEditorHost />
          <PersonCardHost />
          <ConfirmHost />
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Every place an Avora account's avatar shows, side by side (sidebar, 1-1, group, Danh bạ, gán việc). */
function Places() {
  useQueryClient();
  return (
    <div className="flex gap-3 p-3" data-testid="places">
      <span data-place="sidebar"><UserAvatar userId={ME} name="Thiện Võ" size="sm" /></span>
      <span data-place="direct"><UserAvatar userId={ME} name="Thiện Võ" /></span>
      <span data-place="group"><UserAvatar userId={ME} name="Thiện Võ" size="sm" /></span>
      <span data-place="contacts"><UserAvatar userId={ME} name="Thiện Võ" size="sm" /></span>
      <span data-place="assign"><UserAvatar userId={ME} name="Thiện Võ" size="sm" /></span>
      <span data-place="friend"><UserAvatar userId={FRIEND} name="Lan Anh" /></span>
      <span data-place="groupmate"><UserAvatar userId={GROUPMATE} name="Minh Khoa" /></span>
    </div>
  );
}

const looks = (): Record<string, string | null> =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>("[data-place]")].map((el) => [el.dataset.place ?? "", el.querySelector<HTMLElement>("[data-avatar-look]")?.dataset.avatarLook ?? null]),
  );

async function photo(width: number, height: number, withExif: boolean): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context !== null) {
    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        context.fillStyle = `rgb(${(x * 7) % 255}, ${(y * 3) % 255}, ${((x + y) * 5) % 255})`;
        context.fillRect(x, y, 8, 8);
      }
    }
  }
  const jpeg = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob as Blob), "image/jpeg", 0.95));
  if (!withExif) return new File([jpeg], "anh.jpg", { type: "image/jpeg" });
  // An APP1 "Exif" segment carrying a fake GPS tag, right after SOI — what a phone camera writes.
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude=21.0285;GPSLongitude=105.8542;Make=PhoneCam");
  const segment = new Uint8Array(4 + payload.length);
  segment.set([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]);
  segment.set(payload, 4);
  const out = new Uint8Array(bytes.length + segment.length);
  out.set(bytes.slice(0, 2));
  out.set(segment, 2);
  out.set(bytes.slice(2), 2 + segment.length);
  return new File([out], "anh-exif.jpg", { type: "image/jpeg" });
}

const hasText = (bytes: Uint8Array, text: string): boolean => new TextDecoder("latin1").decode(bytes).includes(text);

beforeEach(() => {
  server.paths = new Map();
  server.friends = new Set([FRIEND]);
  server.failSetAvatar = false;
  server.removed = [];
  server.uploaded = [];
  server.reports = [];
  resetAvatarCacheForTests();
});

test("AVORA-115 · nén: đúng 512×512, JPEG ≤ 200 KB, bỏ EXIF/vị trí", async () => {
  const source = await photo(2400, 1600, true);
  expect(hasText(new Uint8Array(await source.arrayBuffer()), "GPSLatitude")).toBe(true);
  const out = await prepareAvatarImage(source, { zoom: 1.4, dx: 30, dy: -10 }, 260);
  const bitmap = await createImageBitmap(out);
  expect([bitmap.width, bitmap.height]).toEqual([512, 512]);
  expect(out.type).toBe("image/jpeg");
  expect(out.size).toBeLessThanOrEqual(200 * 1024);
  const bytes = new Uint8Array(await out.arrayBuffer());
  expect(hasText(bytes, "Exif")).toBe(false);
  expect(hasText(bytes, "GPSLatitude")).toBe(false);
});

test("AVORA-115 · ai thấy: bạn thấy ảnh, thành viên chung nhóm chưa là bạn chỉ thấy chữ cái đầu; huỷ kết bạn → về chữ cái đầu ngay", async () => {
  server.paths.set(FRIEND, `${FRIEND}/v1.jpg`);
  server.paths.set(GROUPMATE, `${GROUPMATE}/v1.jpg`);
  await render(
    <Frame>
      <Places />
    </Frame>,
  );
  await vi.waitFor(() => expect(looks().friend).toBe("image"), WAIT);
  expect(looks().groupmate).toBe("initials");

  // The friendship ends: the server tells this viewer's topic (`avatar`), the realtime layer invalidates.
  server.friends.delete(FRIEND);
  if (client !== null) invalidateAvatar(client, FRIEND);
  await vi.waitFor(() => expect(looks().friend).toBe("initials"), WAIT);
});

test("AVORA-115 · chỉ xem: ảnh người khác không kéo, không chọn, không menu, không có Lưu / Chia sẻ / Chuyển tiếp; có Báo cáo ảnh đại diện", async () => {
  server.paths.set(FRIEND, `${FRIEND}/v1.jpg`);
  await page.viewport(390, 844);
  await render(
    <Frame>
      <Places />
    </Frame>,
  );
  await vi.waitFor(() => expect(looks().friend).toBe("image"), WAIT);
  const holder = document.querySelector<HTMLElement>('[data-place="friend"] [data-avatar-look]');
  const img = holder?.querySelector("img");
  expect(img?.getAttribute("draggable")).toBe("false");
  const style = img !== null && img !== undefined ? getComputedStyle(img) : null;
  expect(style?.pointerEvents).toBe("none");
  expect(style?.userSelect).toBe("none");
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  holder?.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);

  openPersonCard({ userId: FRIEND, name: "Lan Anh" });
  await expect.element(page.getByRole("button", { name: "Báo cáo ảnh đại diện" })).toBeVisible();
  await page.getByRole("button", { name: "Xem ảnh đại diện toàn màn hình" }).click();
  const viewer = page.getByRole("dialog", { name: "Ảnh đại diện của Lan Anh" });
  await expect.element(viewer).toBeVisible();
  await vi.waitFor(() => expect(document.querySelector("[data-avatar-large] img")).not.toBeNull(), WAIT);
  const buttons = [...(viewer.element() as HTMLElement).querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
  expect(buttons).toEqual(["Đóng"]);
  expect((viewer.element() as HTMLElement).textContent ?? "").not.toMatch(/Lưu|Chia sẻ|Chuyển tiếp|Tải/);
  await page.screenshot({ path: `${OUT}/115-xem-anh-ban-chi-xem-390x844.png` });
  (viewer.element() as HTMLElement).click();

  await page.getByRole("button", { name: "Báo cáo ảnh đại diện" }).click();
  await page.getByRole("button", { name: "Gửi báo cáo" }).click();
  await vi.waitFor(() => expect(server.reports).toHaveLength(1), WAIT);
  expect(server.reports[0]).toMatchObject({ p_user_id: FRIEND, p_reason: "inappropriate", p_note: "Ảnh đại diện không phù hợp", p_also_block: false });
});

test("AVORA-115 · đổi ảnh ở Hồ sơ → hiện ngay ở thanh bên, 1-1, nhóm, Danh bạ, gán việc; xoá → chữ cái đầu", async () => {
  await page.viewport(390, 844);
  await render(
    <Frame>
      <Places />
      <Profile />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(looks().sidebar).toBe("initials");

  await page.getByTestId("profile-avatar").click();
  await expect.element(page.getByRole("button", { name: "Chọn từ thư viện" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Chụp ảnh" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/115-bang-chon-anh-390x844.png` });
  await userEvent.upload(page.getByTestId("avatar-library-input"), await photo(1600, 1200, true));
  await expect.element(page.getByTestId("avatar-crop-view")).toBeVisible();
  await page.screenshot({ path: `${OUT}/115-cat-tron-390x844.png` });
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect.element(page.getByText("Đã cập nhật ảnh")).toBeVisible();

  expect(server.uploaded).toHaveLength(1);
  expect(server.uploaded[0].type).toBe("image/jpeg");
  expect(server.uploaded[0].path).toMatch(new RegExp(`^${ME}/[A-Za-z0-9_-]+\\.jpg$`));
  await vi.waitFor(() => {
    const now = looks();
    expect([now.sidebar, now.direct, now.group, now.contacts, now.assign]).toEqual(["image", "image", "image", "image", "image"]);
  }, WAIT);
  await page.screenshot({ path: `${OUT}/115-ho-so-co-anh-390x844.png` });

  // Change again: the old file is deleted.
  const first = server.uploaded[0].path;
  await page.getByTestId("profile-avatar").click();
  await userEvent.upload(page.getByTestId("avatar-library-input"), await photo(900, 900, false));
  await page.getByRole("button", { name: "Lưu" }).click();
  await vi.waitFor(() => expect(server.removed).toContain(first), WAIT);

  // Remove: back to initials everywhere.
  await page.getByTestId("profile-avatar").click();
  await page.getByRole("button", { name: "Xoá ảnh" }).click();
  await page.getByRole("button", { name: "Xoá ảnh" }).last().click();
  await expect.element(page.getByText("Đã xoá ảnh")).toBeVisible();
  await vi.waitFor(() => expect(looks().sidebar).toBe("initials"), WAIT);
  expect(server.paths.has(ME)).toBe(false);
});

test("AVORA-115 · tệp sai định dạng bị từ chối; mất mạng giữa chừng báo lỗi, không để hồ sơ nửa vời, thử lại được", async () => {
  await render(
    <Frame>
      <Places />
      <Profile />
    </Frame>,
  );
  await page.getByTestId("profile-avatar").click();
  await userEvent.upload(page.getByTestId("avatar-library-input"), new File(["%PDF-1.4"], "giay.pdf", { type: "application/pdf" }));
  await expect.element(page.getByText("Hãy chọn một tệp ảnh.")).toBeVisible();
  expect(server.uploaded).toHaveLength(0);

  server.failSetAvatar = true;
  await userEvent.upload(page.getByTestId("avatar-library-input"), await photo(800, 800, false));
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Mất kết nối. Ảnh chưa đổi — thử lại khi có mạng.");
  // The uploaded file was taken back; the profile still has no picture.
  expect(server.removed).toEqual([server.uploaded[0].path]);
  expect(server.paths.has(ME)).toBe(false);

  server.failSetAvatar = false;
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect.element(page.getByText("Đã cập nhật ảnh")).toBeVisible();
  await vi.waitFor(() => expect(looks().sidebar).toBe("image"), WAIT);
});

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
  test(`AVORA-115 · ảnh Hồ sơ có ảnh + màn cắt ${w}×${h}`, async () => {
    await page.viewport(w, h);
    server.paths.set(ME, `${ME}/v9.jpg`);
    await render(
      <Frame>
        <Profile />
      </Frame>,
    );
    await vi.waitFor(() => expect(document.querySelector('[data-testid="profile-avatar"] [data-avatar-look="image"]')).not.toBeNull(), WAIT);
    await page.screenshot({ path: `${OUT}/115-ho-so-${w}x${h}.png` });
    await page.getByTestId("profile-avatar").click();
    await userEvent.upload(page.getByTestId("avatar-library-input"), await photo(1200, 900, false));
    await expect.element(page.getByTestId("avatar-crop-view")).toBeVisible();
    const save = page.getByRole("button", { name: "Lưu" });
    await expect.element(save).toBeVisible();
    const box = (save.element() as HTMLElement).getBoundingClientRect();
    expect(box.width).toBeGreaterThan(40);
    await page.screenshot({ path: `${OUT}/115-cat-tron-${w}x${h}.png` });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
  });
}
