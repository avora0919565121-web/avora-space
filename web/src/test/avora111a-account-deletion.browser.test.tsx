import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * 111-A (ADR-092) · Xoá tài khoản — đường mật khẩu, đường "Tôi quên mật khẩu" → mã email, màn chờ
 * khi đăng nhập, Giữ tài khoản. No network: the RPCs answer like the server in
 * supabase/tests/avora111a_account_deletion.sql.
 */
type Rpc = { fn: string; args: unknown };
const calls: Rpc[] = [];
const server = {
  status: "none" as "none" | "pending" | "cancelled",
  executeAfter: "2026-11-23T08:00:00.000Z",
  password: "dung-mat-khau",
  code: "123456",
  reauth: false,
  otpRate: false,
};

function reply(data: unknown) {
  return Promise.resolve({ data, error: null });
}
function fail(message: string) {
  return Promise.resolve({ data: null, error: { code: "P0001", message } });
}

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const done = Promise.resolve({ data: [], error: null });
  const handler: ProxyHandler<object> = {
    get: (_target, key) => (key === "then" ? done.then.bind(done) : () => new Proxy(chain, handler)),
  };
  const proxy = new Proxy(chain, handler);
  return {
    supabase: {
      from: () => proxy,
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        switch (fn) {
          case "account_deletion_status":
            return reply({ grace_days: 14, status: server.status, requested_at: null, execute_after: server.status === "pending" ? server.executeAfter : null, method: null, reauth_valid: server.reauth });
          case "account_reauth_password":
            server.reauth = args.p_password === server.password;
            return reply(server.reauth);
          case "account_request_otp":
            if (server.otpRate) return fail("avora_account_otp_rate");
            return reply({ ok: true, channel: "email", expires_in_minutes: 10, to: "t•••@avora.test" });
          case "account_verify_otp":
            if (args.p_code === server.code) {
              server.reauth = true;
              return reply({ ok: true });
            }
            return reply({ ok: false, reason: "wrong" });
          case "request_account_deletion":
            if (!server.reauth) return fail("avora_account_reauth_required");
            server.reauth = false;
            server.status = "pending";
            return reply({ status: "pending", execute_after: server.executeAfter, repeated: false });
          case "cancel_account_deletion": {
            const was = server.status === "pending";
            server.status = was ? "cancelled" : server.status;
            return reply({ status: was ? "cancelled" : "none" });
          }
          default:
            return reply(true);
        }
      },
      storage: { from: () => proxy },
      channel: () => proxy,
      removeChannel: () => undefined,
    },
  };
});

const me = { id: "u-111a", email: "testera@avora.test", last_sign_in_at: "2026-11-09T01:00:00.000Z" };
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: me, session: { user: me }, isLoading: false, isRecovering: false }),
}));

import { AccountDeletionGate, AccountDeletionSection } from "@/components/AccountDeletion";

const OUT = "../../.test-output/screens/2026-11-09-111a";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cai-dat"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const settle = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const fns = (): string[] => calls.map((c) => c.fn).filter((fn) => fn !== "account_deletion_status");

function resetServer(): void {
  calls.length = 0;
  server.status = "none";
  server.reauth = false;
  server.otpRate = false;
  localStorage.clear();
  sessionStorage.clear();
  me.last_sign_in_at = "2026-11-09T01:00:00.000Z";
}

test("111-A · đường mật khẩu: danh sách mất · sai rồi đúng · Enter không gửi · gõ XOA", async () => {
  resetServer();
  await page.viewport(390, 844);
  const screen = await render(
    <Frame>
      <AccountDeletionSection />
    </Frame>,
  );
  // Chạm 1: nút đỏ nhạt trong mục Tài khoản.
  await userEvent.click(screen.getByRole("button", { name: "Xoá tài khoản" }));
  // Chạm 2: màn xác nhận liệt kê dữ liệu sẽ mất.
  const dialog = screen.getByTestId("account-delete-dialog");
  await expect.element(dialog).toBeInTheDocument();
  await expect.element(screen.getByText("Két sắt mất vĩnh viễn, kể cả khi bạn nhớ mật khẩu Két sắt.")).toBeInTheDocument();
  await expect.element(screen.getByText(/hiện tên “Người dùng đã xoá”/)).toBeInTheDocument();
  await expect.element(screen.getByText(/không bao giờ được cấp lại/)).toBeInTheDocument();
  await expect.element(screen.getByText(/bạn có 14 ngày để đổi ý/)).toBeInTheDocument();
  // Không có link xuất dữ liệu.
  expect(document.querySelector("[data-testid='account-delete-dialog'] a")).toBeNull();
  await page.screenshot({ path: `${OUT}/1-xac-nhan-390.png` });

  await userEvent.click(screen.getByTestId("account-delete-next"));
  // Không hỏi PIN hay mã Két sắt.
  await expect.element(screen.getByText(/Không cần PIN hay mã Két sắt/)).toBeInTheDocument();
  await userEvent.type(screen.getByTestId("account-delete-password"), "sai-roi{Enter}");
  expect(fns()).toEqual([]); // Enter không gửi
  await userEvent.click(screen.getByTestId("account-delete-password-ok"));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Mật khẩu chưa đúng.");
  expect(document.querySelector("[data-step]")?.getAttribute("data-step")).toBe("password");

  await userEvent.clear(screen.getByTestId("account-delete-password"));
  await userEvent.type(screen.getByTestId("account-delete-password"), server.password);
  await userEvent.click(screen.getByTestId("account-delete-password-ok"));
  await expect.element(screen.getByTestId("account-delete-word")).toBeInTheDocument();

  // Nút đỏ khoá đến khi gõ đúng XOA; "XOÁ" không tính.
  const confirm = screen.getByTestId("account-delete-confirm");
  await expect.element(confirm).toBeDisabled();
  await userEvent.type(screen.getByTestId("account-delete-word"), "XOÁ");
  await expect.element(confirm).toBeDisabled();
  await userEvent.clear(screen.getByTestId("account-delete-word"));
  await userEvent.type(screen.getByTestId("account-delete-word"), "XOA{Enter}");
  expect(fns()).not.toContain("request_account_deletion"); // Enter không gửi
  await expect.element(confirm).toBeEnabled();
  await page.screenshot({ path: `${OUT}/2-go-xoa-390.png` });
  await userEvent.click(confirm);
  await settle();

  expect(fns()).toEqual(["account_reauth_password", "account_reauth_password", "request_account_deletion"]);
  const request = calls.find((c) => c.fn === "request_account_deletion");
  expect(request?.args).toEqual({ p_except_endpoint: null });
  // Mục Tài khoản đổi sang ngày xoá + Giữ tài khoản.
  await expect.element(screen.getByTestId("account-pending")).toHaveTextContent("Tài khoản sẽ bị xoá vào ngày 23/11/2026");
  // Thiết bị vừa yêu cầu đã biết: màn chờ đợi lần đăng nhập sau.
  expect(Object.keys(localStorage).some((key) => key.startsWith("avora.account-deletion.ack.u-111a."))).toBe(true);
});

test("111-A · Tôi quên mật khẩu → mã email: sai rồi đúng", async () => {
  resetServer();
  await page.viewport(1280, 800);
  const screen = await render(
    <Frame>
      <AccountDeletionSection />
    </Frame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Xoá tài khoản" }));
  await userEvent.click(screen.getByTestId("account-delete-next"));
  await userEvent.click(screen.getByTestId("account-delete-forgot"));
  await expect.element(screen.getByText("t•••@avora.test")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/3-ma-email-1280.png` });

  await userEvent.type(screen.getByTestId("account-delete-code"), "999999");
  await userEvent.click(screen.getByTestId("account-delete-code-ok"));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Mã chưa đúng.");
  await userEvent.clear(screen.getByTestId("account-delete-code"));
  await userEvent.type(screen.getByTestId("account-delete-code"), "12a3456");
  expect((screen.getByTestId("account-delete-code").element() as HTMLInputElement).value).toBe("123456");
  await userEvent.click(screen.getByTestId("account-delete-code-ok"));
  await userEvent.type(screen.getByTestId("account-delete-word"), "xoa");
  await userEvent.click(screen.getByTestId("account-delete-confirm"));
  await settle();
  expect(fns()).toEqual(["account_request_otp", "account_verify_otp", "account_verify_otp", "request_account_deletion"]);
  expect(server.status).toBe("pending");
  screen.unmount();
});

test("111-A · giới hạn 3 mã / giờ → câu tiếng Việt, không lộ mã lỗi", async () => {
  resetServer();
  server.otpRate = true;
  await page.viewport(390, 844);
  const again = await render(
    <Frame>
      <AccountDeletionSection />
    </Frame>,
  );
  await userEvent.click(again.getByRole("button", { name: "Xoá tài khoản" }));
  await userEvent.click(again.getByTestId("account-delete-next"));
  await userEvent.click(again.getByTestId("account-delete-forgot"));
  await expect.element(again.getByRole("alert")).toHaveTextContent("Đã gửi mã 3 lần trong một giờ");
  expect(document.body.textContent ?? "").not.toContain("avora_account_otp_rate");
  again.unmount();
});

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
  test(`111-A · màn chờ khi đăng nhập · Tiếp tục xoá đến lần đăng nhập sau · ${w}×${h}`, async () => {
    resetServer();
    server.status = "pending";
    await page.viewport(w, h);
    const screen = await render(
      <Frame>
        <AccountDeletionGate>
          <p>Ứng dụng</p>
        </AccountDeletionGate>
      </Frame>,
    );
    const gate = screen.getByTestId("account-deletion-gate");
    await expect.element(gate).toBeInTheDocument();
    await expect.element(screen.getByRole("heading", { name: "Tài khoản sẽ bị xoá vào ngày 23/11/2026" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("Ứng dụng");
    await page.screenshot({ path: `${OUT}/4-man-cho-${w}x${h}.png` });

    await userEvent.click(screen.getByTestId("account-gate-continue"));
    await expect.element(screen.getByText("Ứng dụng")).toBeInTheDocument();
    // Chỉ đăng nhập / tiếp tục thì không huỷ.
    expect(fns()).not.toContain("cancel_account_deletion");
    expect(server.status).toBe("pending");

    // Cùng phiên đăng nhập: không hiện lại (key mới = dựng lại từ đầu, QueryClient mới).
    await screen.rerender(
      <Frame key="cung-phien">
        <AccountDeletionGate>
          <p>Ứng dụng</p>
        </AccountDeletionGate>
      </Frame>,
    );
    await settle();
    await expect.element(screen.getByText("Ứng dụng")).toBeInTheDocument();
    expect(document.querySelector("[data-testid='account-deletion-gate']")).toBeNull();

    // Lần đăng nhập sau: hiện lại.
    me.last_sign_in_at = "2026-11-10T01:00:00.000Z";
    await screen.rerender(
      <Frame key="lan-sau">
        <AccountDeletionGate>
          <p>Ứng dụng</p>
        </AccountDeletionGate>
      </Frame>,
    );
    await expect.element(screen.getByTestId("account-deletion-gate")).toBeInTheDocument();
  });
}

test("111-A · Giữ tài khoản trên màn chờ → huỷ trên server, vào ứng dụng", async () => {
  resetServer();
  server.status = "pending";
  await page.viewport(390, 844);
  const screen = await render(
    <Frame>
      <AccountDeletionGate>
        <p>Ứng dụng</p>
      </AccountDeletionGate>
    </Frame>,
  );
  await userEvent.click(screen.getByTestId("account-gate-keep"));
  await expect.element(screen.getByText("Ứng dụng")).toBeInTheDocument();
  expect(fns()).toEqual(["cancel_account_deletion"]);
  expect(server.status).toBe("cancelled");
});

test("111-A · mục Tài khoản khi đang chờ: ngày + Giữ tài khoản", async () => {
  resetServer();
  server.status = "pending";
  await page.viewport(390, 844);
  const screen = await render(
    <Frame>
      <AccountDeletionSection />
    </Frame>,
  );
  await expect.element(screen.getByTestId("account-pending")).toHaveTextContent("23/11/2026");
  expect(document.querySelector("[data-testid='account-delete-open']")).toBeNull();
  await userEvent.click(screen.getByTestId("account-keep"));
  await settle();
  expect(fns()).toEqual(["cancel_account_deletion"]);
  await expect.element(screen.getByTestId("account-delete-open")).toBeInTheDocument();
});
