import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * KT-04 · sửa lỗi báo cáo QA-01 (Nhà mới) — phần trên màn (iPhone 390 px trừ khi ghi khác).
 * Không có mạng: Supabase giả trả rỗng, chỉ bảng app_features có dữ liệu.
 */
type Srv = { features: { key: string; status: string }[] };
const srv: Srv = { features: [] };
(globalThis as { __qa01Srv?: Srv }).__qa01Srv = srv;

vi.mock("@/integrations/supabase/client", () => {
  const s = (): Srv => (globalThis as unknown as { __qa01Srv: Srv }).__qa01Srv;
  const builder = (rows: () => unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const done = Promise.resolve({ data: rows(), error: null, count: 0 });
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
      from: (table: string) =>
        table === "app_features"
          ? builder(() => s().features.map((row) => ({ ...row, min_app_version: null, note: null, updated_at: "2026-11-12T00:00:00Z" })))
          : builder(() => []),
      rpc: () => builder(() => null),
      channel: () => builder(() => []),
      removeChannel: () => undefined,
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "qa01-user", email: "me@probe.invalid" }, session: {}, profile: null, isProfileLoading: false, isLoading: false }),
  useDisplayName: () => "Người mới",
}));
// QA01-03: a newcomer with no Két sắt code — Tài chính open, the Két sắt itself locked.
vi.mock("@/lib/use-vault-lock", () => {
  const vault = { status: { hasCode: false }, isLoading: false, error: null, isUnlocked: false, hasCode: false, isFinanceOpen: true };
  return {
    useVaultLock: () => vault,
    useVaultUnlocked: () => false,
    useFinanceOpen: () => true,
    VaultLockProvider: ({ children }: { children: ReactNode }) => children,
    isVaultPath: (p: string) => p.startsWith("/ket-sat"),
  };
});
vi.mock("@/lib/use-view-board-rows", async () => {
  const boards = await import("@/lib/avora-default-boards");
  const locks = boards.vaultBoardLocks({ isVaultOpen: false, isFinanceOpen: true, hasKey: false });
  const rows = Object.fromEntries(
    boards.VIEW_BOARDS.map((def) => {
      const isFinance = def.source === "Két sắt › Tài chính";
      const locked = def.zone === "ket-sat" && (isFinance ? locks.finance : locks.items);
      return [def.key, { rows: [], locked, isLoading: false, error: null }];
    }),
  );
  return {
    useViewBoardRows: () => ({ boards: rows, byMonth: [], byPerson: [], currency: "VND", assetsValued: false }),
    useDefaultShelfAttention: () => false,
  };
});

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { FinanceHeader } from "@/components/finance/primitives";
import { DefaultShelf } from "@/components/library/ShelfPanels";
import { WorkDesk } from "@/components/library/PlanRoom";
import { NavGestures } from "@/components/nav/NavGestures";
import { RouteFeatureGate } from "@/components/features/FeatureGate";
import Settings from "@/pages/Settings";

const WAIT = { timeout: 5_000, interval: 50 } as const;

function Frame({ children, at }: { children: ReactNode; at: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <div className="flex h-[100dvh] flex-col bg-card">
          <Suspense fallback={null}>{children}</Suspense>
        </div>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Where() {
  const location = useLocation();
  return <p data-where="">{`${location.pathname}${location.search}`}</p>;
}

beforeEach(async () => {
  localStorage.clear();
  srv.features = [];
  await page.viewport(390, 844);
});

test("QA01-03 · Lập sẵn khi chưa có mã: bảng Tài chính mở, chỉ Giấy tờ / Tài sản mời đặt mã", async () => {
  await render(
    <Frame at="/ke-hoach?ke=4">
      <DefaultShelf boards={[]} countOf={() => 0} activeId={null} activeView={null} onOpen={() => undefined} onOpenView={() => undefined} />
    </Frame>,
  );
  const zone = document.querySelector('[data-zone="ket-sat"]') as HTMLElement;
  await vi.waitFor(() => expect(zone.querySelector("[data-vault-locked]")).not.toBeNull(), WAIT);
  expect(zone.textContent).not.toContain("Mở Két sắt để xem");
  expect(zone.querySelector("[data-vault-locked]")?.textContent).toContain("Đặt mã Két sắt");
  for (const key of ["cashflow", "summary", "loans", "payment_calendar"]) {
    const row = zone.querySelector(`[data-view-board-link="${key}"]`) as HTMLElement;
    expect(row.textContent).toContain("0 dòng");
    expect(row.querySelector("svg.lucide-lock")).toBeNull();
  }
  for (const key of ["expiring_docs", "assets"]) {
    const row = zone.querySelector(`[data-view-board-link="${key}"]`) as HTMLElement;
    expect(row.textContent).not.toContain("dòng");
  }
});

test("QA01-06 · Bàn làm việc: không còn 'kệ 3', câu hỏi trong ô không bị cắt trên iPhone", async () => {
  const screen = await render(
    <Frame at="/ke-hoach?ke=6">
      <WorkDesk boards={[]} placeOf={() => null} countOf={() => 0} onOpen={() => undefined} onCreate={async () => null} onFull={() => undefined} onGo={() => undefined} />
    </Frame>,
  );
  await expect.element(screen.getByRole("button", { name: "Lấy từ Tiến trình ›" })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/kệ \d/);
  await expect.element(screen.getByRole("button", { name: "Đặt lên bàn" })).toBeInTheDocument();
  const input = document.querySelector("[data-desk-input]") as HTMLInputElement;
  // The placeholder fits: measure it in the input's own font against the room inside the box.
  const style = getComputedStyle(input);
  const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  expect(ctx.measureText(input.placeholder).width).toBeLessThanOrEqual(room);
});

test("QA01-09 · ảnh chữ viết tắt không hiện '?' hay 'BẠ' khi tên chưa về", async () => {
  await render(
    <div>
      <span data-a="empty"><InitialsAvatar name="" /></span>
      <span data-a="name"><InitialsAvatar name="Người mới" /></span>
    </div>,
  );
  expect(document.querySelector('[data-a="empty"]')?.textContent).toBe("");
  expect(document.querySelector('[data-a="name"]')?.textContent).toBe("NM");
});

test("QA01-10 · Cài đặt › Avora AI (Sắp có) giữ tiêu đề và dải tab; đổi tab con vẫn giữ đường về", async () => {
  srv.features = [{ key: "avora_ai", status: "soon" }];
  // KT-07b: the grouped list is the left column on a computer.
  await page.viewport(1280, 800);
  const screen = await render(
    <Frame at="/cai-dat/avora-ai?tu=%2Ftong-quan&tu_ten=Avora+Space">
      <RouteFeatureGate>
        <Routes>
          <Route path="/cai-dat" element={<Settings />}>
            <Route index element={<p>Trang Hồ sơ</p>} />
            <Route path="thong-bao" element={<p>Trang Thông báo</p>} />
            <Route path="avora-ai" element={<p>Trang Avora AI thật</p>} />
          </Route>
        </Routes>
      </RouteFeatureGate>
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector("[data-feature-soon]")?.textContent).toBe("Sắp có"), WAIT);
  expect(document.body.textContent).not.toContain("Trang Avora AI thật");
  // KT-07b: Cài đặt is a grouped list now (CEO 12/11 · 3), not a strip of tabs.
  const strip = screen.getByRole("navigation", { name: "Mục Cài đặt" }).first();
  await expect.element(strip).toBeInTheDocument();
  await userEvent.click(strip.getByText("Thông báo", { exact: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-where]")?.textContent).toBe("/cai-dat/thong-bao?tu=%2Ftong-quan&tu_ten=Avora+Space"), WAIT);
  await expect.element(screen.getByText("Trang Thông báo")).toBeInTheDocument();
  await page.viewport(414, 896);
});

test("QA01-11 · gợi ý 'Chạm ‹ để lùi' nằm thấp, không đè dải chip dưới hàng trên", async () => {
  await render(
    <Frame at="/tin-nhan/c1?xem=ghi-chep">
      <NavGestures />
    </Frame>,
  );
  const hint = await vi.waitFor(() => {
    const found = document.querySelector("[data-hold-back-hint]") as HTMLElement | null;
    expect(found).not.toBeNull();
    return found as HTMLElement;
  }, WAIT);
  const box = hint.getBoundingClientRect();
  // The first strip of a screen sits under the 52 px top row; the hint stays in the lower half.
  expect(box.top).toBeGreaterThan(844 / 2);
  expect(box.bottom).toBeLessThanOrEqual(844 - 90);
});

test("QA01-12 · Tài chính: bốn tab con nằm một dòng trên iPhone", async () => {
  await render(
    <Frame at="/ket-sat">
      <div className="px-6">
        <FinanceHeader subtitle="Bắt đầu bằng một tài khoản, rồi ghi khoản thu chi đầu tiên." />
      </div>
    </Frame>,
  );
  const links = [...document.querySelectorAll<HTMLElement>("[data-finance-tabs] a")];
  expect(links.map((link) => link.textContent)).toEqual(["Tổng quan", "Giao dịch", "Tài khoản", "Báo cáo"]);
  const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)));
  expect(tops.size).toBe(1);
  const list = document.querySelector("[data-finance-tabs]") as HTMLElement;
  expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
});
