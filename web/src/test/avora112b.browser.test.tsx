import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * AVORA-112-B — công tắc tính năng trên màn thật: cổng nội dung, cổng tuyến, thanh điều hướng, bản lưu đệm
 * khi ngoại tuyến, màn quản trị (ops và người thường).
 */
type Srv = { rows: { key: string; status: string; min_app_version: string | null; note: string | null; updated_at: string }[]; offline: boolean; ops: boolean; sets: unknown[] };
const srv: Srv = { rows: [], offline: false, ops: false, sets: [] };
(globalThis as { __featSrv?: Srv }).__featSrv = srv;

vi.mock("@/integrations/supabase/client", () => {
  const s = (): Srv => (globalThis as unknown as { __featSrv: Srv }).__featSrv;
  const builder = (rows: () => unknown, table = ""): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const result =
              table === "app_features" && s().offline
                ? { data: null, error: { code: undefined, message: "TypeError: Failed to fetch" } }
                : { data: rows(), error: null, count: 0 };
            const done = Promise.resolve(result);
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
          ? builder(() => s().rows.map((r) => ({ ...r })), table)
          : table === "app_feature_changes"
            ? builder(() => [{ id: "h1", key: "habits", from_status: "stable", to_status: "soon", note: "thử", at: "2026-10-14T03:00:00Z" }])
            : builder(() => []),
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        if (name === "am_i_ops") return Promise.resolve({ data: s().ops, error: null });
        if (name === "ops_set_feature") {
          if (!s().ops) return Promise.resolve({ data: null, error: { code: "P0001", message: "avora_not_allowed" } });
          s().sets.push(args);
          const target = s().rows.find((r) => r.key === args.p_key);
          if (target !== undefined) target.status = String(args.p_status);
          return Promise.resolve({ data: target ?? null, error: null });
        }
        return builder(() => []);
      },
      channel: () => builder(() => []),
      removeChannel: () => undefined,
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d", email: "me@probe.invalid" }, session: {}, profile: null, isLoading: false }),
  useDisplayName: () => "Thiện Võ",
}));

import { ConfirmHost } from "@/components/ConfirmHost";
import { FeatureGate, RouteFeatureGate } from "@/components/features/FeatureGate";
import { featureKeys, writeCachedFeatures } from "@/lib/features";
import { NAV_ITEMS, VAULT_TABS } from "@/lib/navigation";
import { useVisibleNav } from "@/lib/use-feature";
import OpsFeatures from "@/pages/OpsFeatures";

const OUT = "../../../docs/screens/2026-10-14";
const WAIT = { timeout: 5_000, interval: 50 } as const;

let client: QueryClient | null = null;

function Frame({ children, at = "/tong-quan" }: { children: ReactNode; at?: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  client = queryClient;
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <div className="flex h-[100dvh] flex-col bg-card">
          <Suspense fallback={null}>{children}</Suspense>
        </div>
        <ConfirmHost />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Where() {
  return <p data-where="">{useLocation().pathname}</p>;
}

function Nav() {
  const main = useVisibleNav(NAV_ITEMS);
  const vault = useVisibleNav(VAULT_TABS);
  return (
    <nav>
      {main.map((item) => (
        <a key={item.to} data-tab={item.to} href={item.to}>{item.label}</a>
      ))}
      {vault.map((item) => (
        <a key={item.to} data-vtab={item.to} href={item.to}>{item.label}</a>
      ))}
    </nav>
  );
}

function setRows(map: Record<string, string>): void {
  srv.rows = Object.entries(map).map(([key, status]) => ({ key, status, min_app_version: null, note: null, updated_at: "2026-10-14T00:00:00Z" }));
}

beforeEach(async () => {
  localStorage.removeItem("avora.features.v1");
  srv.offline = false;
  srv.ops = false;
  srv.sets = [];
  setRows({ habits: "stable", books: "stable", tasks: "stable", vault_assets: "stable" });
  await page.viewport(390, 844);
});

const habitsBlock = (
  <FeatureGate feature="habits">
    <button type="button">Thêm thói quen</button>
  </FeatureGate>
);

test("112B.1 · stable / soon / hidden trong nội dung: soon chỉ một dòng, không nút", async () => {
  const screen = await render(<Frame>{habitsBlock}</Frame>);
  await expect.element(screen.getByRole("button", { name: "Thêm thói quen" })).toBeInTheDocument();

  setRows({ habits: "soon" });
  await client?.invalidateQueries({ queryKey: featureKeys.all });
  await vi.waitFor(() => expect(document.querySelector("[data-feature-soon]")?.textContent).toBe("Sắp có"), WAIT);
  expect(document.querySelectorAll("button").length).toBe(0);

  setRows({ habits: "hidden" });
  await client?.invalidateQueries({ queryKey: featureKeys.all });
  await vi.waitFor(() => expect(document.querySelector("[data-feature-soon]")).toBeNull(), WAIT);
  expect(document.body.textContent).not.toContain("Thêm thói quen");
});

test("112B.2 · tuyến hidden → về Avora Space (cả link sâu)", async () => {
  setRows({ tasks: "hidden", books: "soon" });
  const screen = await render(
    <Frame at="/nhiem-vu?mo=t1">
      <Routes>
        <Route path="*" element={<><Where /><RouteFeatureGate><p>Trang thật</p></RouteFeatureGate></>} />
      </Routes>
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector("[data-where]")?.textContent).toBe("/tong-quan"), WAIT);
  expect(screen.container.textContent).toContain("/tong-quan");
});

test("112B.2b · tuyến soon: một dòng thay trang", async () => {
  setRows({ books: "soon" });
  await render(
    <Frame at="/ke-hoach/ke-sach/doc/r1">
      <RouteFeatureGate><p>Trang thật</p></RouteFeatureGate>
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector("[data-feature-soon]")).not.toBeNull(), WAIT);
  expect(document.body.textContent).toContain("Sách");
  expect(document.body.textContent).not.toContain("Trang thật");
  await page.screenshot({ path: `${OUT}/112B-tuyen-sap-co-390.png` });
});

test("112B.3 · thanh điều hướng: hidden bỏ tab; soon giữ tab, không chữ Sắp có trên tab", async () => {
  setRows({ think_hub: "hidden", vault_assets: "soon" });
  await render(<Frame><Nav /></Frame>);
  await vi.waitFor(() => {
    expect(document.querySelector('[data-tab="/tong-quan"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="/ke-hoach"]')).toBeNull();
  }, WAIT);
  expect(document.querySelector('[data-vtab="/ket-sat/tai-san"]')?.textContent).toBe("Tài sản");
  expect(document.querySelector("nav")?.textContent).not.toContain("Sắp có");
});

test("112B.4 · ngoại tuyến: chưa có bản lưu đệm thì mọi thứ stable", async () => {
  srv.offline = true;
  const screen = await render(<Frame>{habitsBlock}</Frame>);
  await expect.element(screen.getByRole("button", { name: "Thêm thói quen" })).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await expect.element(screen.getByRole("button", { name: "Thêm thói quen" })).toBeInTheDocument();
});

test("112B.4b · ngoại tuyến: dùng bản lưu đệm của lần mở trước", async () => {
  srv.offline = true;
  writeCachedFeatures({ habits: "hidden" });
  const screen = await render(<Frame><p>khung</p>{habitsBlock}</Frame>);
  await expect.element(screen.getByText("khung")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(document.body.textContent).not.toContain("Thêm thói quen");
});

test("112B.5 · màn quản trị: người thường bị chặn", async () => {
  const screen = await render(<Frame><OpsFeatures /></Frame>);
  await vi.waitFor(() => expect(document.querySelector("[data-ops-denied]")).not.toBeNull(), WAIT);
  expect(screen.container.querySelector("[data-ops-features]")).toBeNull();
});

test("112B.5b · màn quản trị: ops đổi được và thấy lịch sử", async () => {
  srv.ops = true;
  const ops = await render(<Frame><OpsFeatures /></Frame>);
  await vi.waitFor(() => expect(document.querySelectorAll("[data-ops-features] li").length).toBe(29), WAIT);
  await expect.element(ops.getByText("Chưa đổi lần nào.").or(ops.getByText("thử"))).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/112B-quan-tri-tinh-nang-390.png` });
  await page.viewport(1280, 800);
  await page.screenshot({ path: `${OUT}/112B-quan-tri-tinh-nang-1280.png` });
  await page.viewport(844, 390);
  await page.screenshot({ path: `${OUT}/112B-quan-tri-tinh-nang-844x390.png` });
  await page.viewport(390, 844);
  await userEvent.click(ops.getByRole("radiogroup", { name: "Thói quen" }).getByRole("radio", { name: "Sắp có" }));
  await userEvent.fill(ops.getByRole("textbox"), "đồng hồ lệch trên máy thật");
  await userEvent.click(ops.getByRole("button", { name: "Đổi" }));
  await vi.waitFor(() => expect(srv.sets).toEqual([{ p_key: "habits", p_status: "soon", p_note: "đồng hồ lệch trên máy thật" }]), WAIT);
});
