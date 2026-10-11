import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/* AVORA-100 · PHẦN G — tấm góp ý, /gop-y, ô mã mời, màn chặn mã mời. No network. */
const calls: { fn: string; args: unknown }[] = [];
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
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        if (fn === "check_invite") return Promise.resolve({ data: { ok: false, reason: "used_up" }, error: null });
        if (fn === "invite_required") return Promise.resolve({ data: false, error: null });
        return Promise.resolve({ data: true, error: null });
      },
      storage: { from: () => proxy },
      channel: () => proxy,
      removeChannel: () => undefined,
    },
  };
});
const signUp = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    session: null,
    isLoading: false,
    isRecovering: false,
    signIn: async () => ({ ok: true }),
    signUp,
    signOut: async () => undefined,
    resendConfirmation: async () => undefined,
    requestPasswordReset: async () => undefined,
  }),
}));

import { InviteGateScreen } from "@/components/InviteGate";
import { SignUpRedirect } from "@/components/LegacyRedirect";
import Auth from "@/pages/Auth";
import PublicFeedback from "@/pages/PublicFeedback";

const OUT = "../../../docs/screens/2026-10-11";

function Frame({ at, children }: { at: string; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`G.2 · /gop-y chưa đăng nhập · ${w}`, async () => {
    calls.length = 0;
    await page.viewport(w, h);
    const screen = await render(
      <Frame at="/gop-y">
        <PublicFeedback />
      </Frame>,
    );
    await expect.element(screen.getByRole("heading", { name: "Góp ý cho Avora" })).toBeInTheDocument();
    // `‹ AVORA` is the way out; there is an email field but no picture.
    expect(document.querySelector("[data-feedback-exit]")?.getAttribute("href")).toBe("/dang-nhap");
    expect(document.querySelector("[data-feedback-file]")).toBeNull();
    // The trap is not visible to a person.
    const trap = document.querySelector<HTMLInputElement>("[data-feedback-trap]");
    expect(trap).not.toBeNull();
    const rect = trap?.closest("[aria-hidden]")?.getBoundingClientRect();
    expect((rect?.right ?? 0) <= 0).toBe(true);
    // Body text is 16 px under md.
    const body = document.querySelector<HTMLTextAreaElement>("[data-feedback-body]");
    if (w < 768) expect(getComputedStyle(body as Element).fontSize).toBe("16px");
    // Enter adds a line, it does not send.
    await userEvent.click(screen.getByRole("radio", { name: "Ý tưởng" }));
    await userEvent.type(screen.getByLabelText("Nội dung góp ý"), "Dòng một{Enter}Dòng hai");
    await settle(200);
    expect(calls.filter((c) => c.fn === "submit_public_feedback")).toHaveLength(0);
    expect(body?.value).toBe("Dòng một\nDòng hai");
    await page.screenshot({ path: `${OUT}/G2-gop-y-${w}.png` });
    await userEvent.click(document.querySelector("[data-feedback-send]") as HTMLElement);
    await expect.element(screen.getByText("Đã nhận góp ý. Cảm ơn bạn!")).toBeInTheDocument();
    const sent = calls.find((c) => c.fn === "submit_public_feedback")?.args as Record<string, unknown>;
    expect(sent.p_kind).toBe("y_tuong");
    expect(sent.p_page).toBe("/gop-y");
    expect(sent.p_trap).toBe("");
  });
}

test("G.3 · `/dang-ky?moi=AVR-DE-01` → mã điền sẵn; mã hết lượt → `Mã mời đã dùng hết`", async () => {
  calls.length = 0;
  await page.viewport(390, 844);
  const screen = await render(
    <Frame at="/dang-ky?moi=avr-de-01">
      <Routes>
        <Route path="/dang-ky" element={<SignUpRedirect />} />
        <Route path="/dang-nhap" element={<Auth />} />
      </Routes>
    </Frame>,
  );
  const input = screen.getByLabelText(/Mã mời/);
  await expect.element(input).toHaveValue("AVR-DE-01");
  await userEvent.type(screen.getByLabelText("Email"), "ban@example.com");
  await userEvent.type(screen.getByLabelText("Mật khẩu", { exact: false }), "matkhau123");
  await settle(300);
  await page.screenshot({ path: `${OUT}/G3-dang-ky-ma-moi-390.png` });
  await userEvent.click(document.querySelector("form button[type=submit]") as HTMLElement);
  await expect.element(screen.getByText("Mã mời đã dùng hết.")).toBeInTheDocument();
  expect(signUp).not.toHaveBeenCalled();
});

test("G.5 · màn `Nhập mã mời để vào Avora` có Đăng xuất", async () => {
  await page.viewport(390, 844);
  const screen = await render(
    <Frame at="/tong-quan">
      <InviteGateScreen />
    </Frame>,
  );
  await expect.element(screen.getByRole("heading", { name: "Nhập mã mời để vào Avora" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Đăng xuất" })).toBeInTheDocument();
  await settle(200);
  await page.screenshot({ path: `${OUT}/G5-nhap-ma-moi-390.png` });
});
