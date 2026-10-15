import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/* 112-F — lỗi được thấy và được ghi: màn lỗi theo màn + dòng client_errors; nhãn ngoại tuyến; màn Sức khoẻ. */
type Srv = { calls: { name: string; args: Record<string, unknown> }[]; ops: boolean };
const srv: Srv = { calls: [], ops: false };
(globalThis as { __f112?: Srv }).__f112 = srv;

vi.mock("@/integrations/supabase/client", () => {
  const s = (): Srv => (globalThis as unknown as { __f112: Srv }).__f112;
  const empty = { data: [], error: null };
  const chain: unknown = new Proxy({}, { get: (_t, key) => (key === "then" ? (resolve: (v: unknown) => void) => resolve(empty) : () => chain) });
  return {
    supabase: {
      from: () => chain,
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        s().calls.push({ name, args });
        if (name === "am_i_ops") return Promise.resolve({ data: s().ops, error: null });
        if (name === "ops_health_summary") {
          return Promise.resolve({
            data: {
              since: "2026-10-08",
              byDay: [{ day: "2026-10-14", count: 12, people: 3 }],
              byScope: [{ scope: "outbox", count: 5 }, { scope: "realtime", count: 4 }],
              byVersion: [{ version: "1.12.0", count: 12 }],
              sendFailed: 5,
              realtimeReconnects: 4,
              top: [{ scope: "outbox", code: "send_failed avora_contact_unavailable", route: "/tin-nhan/:id", count: 5, people: 2 }],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => chain,
      removeChannel: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "0b1f7a2c-0000-4000-8000-0000000112f0" }, session: {}, profile: null, isLoading: false }),
}));

import { OfflineNotice } from "@/components/OfflineNotice";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { resetClientErrorReportsForTests } from "@/lib/client-errors";
import OpsHealth from "@/pages/OpsHealth";

const OUT = "../../../docs/screens/2026-10-14";

function Frame({ children, at = "/nhiem-vu" }: { children: ReactNode; at?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <div className="flex h-[100dvh] flex-col bg-card">{children}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Boom(): ReactNode {
  throw new TypeError("không được lộ: lan@example.com");
}

beforeEach(async () => {
  srv.calls = [];
  srv.ops = false;
  resetClientErrorReportsForTests();
  await page.viewport(390, 844);
});

test("112F.1 · màn lỗi: chữ thân thiện + Thử lại + Về Avora Space; client_errors nhận tên lỗi, không nội dung", async () => {
  const screen = await render(<Frame><RouteErrorBoundary resetKey="/nhiem-vu"><Boom /></RouteErrorBoundary></Frame>);
  await expect.element(screen.getByText("Phần này đang gặp sự cố")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Thử lại" }).first()).toBeInTheDocument();
  await expect.element(screen.getByText("Về Avora Space")).toBeInTheDocument();
  await vi.waitFor(() => expect(srv.calls.some((call) => call.name === "log_client_error")).toBe(true));
  const sent = srv.calls.find((call) => call.name === "log_client_error")?.args ?? {};
  expect(sent).toMatchObject({ p_error_name: "route", p_route: expect.any(String) });
  expect(JSON.stringify(sent)).not.toContain("lan@example.com");
  await page.screenshot({ path: `${OUT}/112F-man-loi-390.png` });
});

test("112F.2 · mất mạng: mọi tab (trừ Kết nối, đã có dòng riêng) hiện dòng Ngoại tuyến", async () => {
  const restore = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  try {
    const screen = await render(<Frame><OfflineNotice /></Frame>);
    await expect.element(screen.getByRole("status")).toHaveTextContent("Ngoại tuyến");
  } finally {
    delete (navigator as unknown as { onLine?: boolean }).onLine;
    if (restore === undefined) Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  }
});

test("112F.3 · Sức khoẻ: người thường bị chặn; ops thấy số liệu", async () => {
  const denied = await render(<Frame><OpsHealth /></Frame>);
  await vi.waitFor(() => expect(denied.container.querySelector("[data-ops-denied]")).not.toBeNull());
});

test("112F.3b · Sức khoẻ: ops thấy tin gửi lỗi, nối lại realtime, 10 lỗi thường gặp", async () => {
  srv.ops = true;
  const screen = await render(<Frame><OpsHealth /></Frame>);
  await vi.waitFor(() => expect(screen.container.querySelector("[data-ops-health]")).not.toBeNull());
  expect(screen.container.textContent).toContain("Tin gửi lỗi (máy báo)");
  expect(screen.container.textContent).toContain("send_failed avora_contact_unavailable");
  await page.screenshot({ path: `${OUT}/112F-suc-khoe-390.png` });
  await page.viewport(1280, 800);
  await page.screenshot({ path: `${OUT}/112F-suc-khoe-1280.png` });
  await page.viewport(844, 390);
  await page.screenshot({ path: `${OUT}/112F-suc-khoe-844x390.png` });
});
