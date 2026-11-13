import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * KT-09 · lỗi CEO gặp trên điện thoại: tài khoản chưa đồng ý Điều khoản thấy WelcomeHome (fixed
 * z-[60]) che mất hộp Điều khoản (z-50, modal) — bấm không ăn. Giờ chỉ có màn Điều khoản; đồng ý
 * xong mới tới màn chào. Máy chủ giả: accept_terms lật termsAccepted.
 */
type Fake = { gate: Record<string, unknown> | null; calls: string[] };
const fake: Fake = { gate: null, calls: [] };
(globalThis as { __fakeKt09?: Fake }).__fakeKt09 = fake;

vi.mock("@/integrations/supabase/client", () => {
  const state = (): Fake => (globalThis as unknown as { __fakeKt09: Fake }).__fakeKt09;
  return {
    supabase: {
      rpc: (name: string) => {
        const s = state();
        s.calls.push(name);
        if (name === "my_account_gate") return Promise.resolve({ data: s.gate, error: null });
        if (name === "accept_terms" && s.gate !== null) s.gate = { ...s.gate, termsAccepted: true };
        if (name === "ack_account_notice" && s.gate !== null) s.gate = { ...s.gate, notices: [] };
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "c9c3c628-0000-4000-8000-000000000000", user_metadata: {} }, signOut: async () => undefined }),
}));

import { SafetyGate } from "@/components/SafetyGate";
import { WelcomeHome } from "@/components/space/WelcomeHome";
import { TERMS_VERSION } from "@/lib/safety";

const WAIT = { timeout: 6_000, interval: 50 } as const;

function Frame({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** The app as a newcomer meets it: WelcomeHome over the page until a choice is made. */
function App() {
  const [done, setDone] = useState<string | null>(null);
  return done === null ? <WelcomeHome name="CEO" onDone={(choices) => setDone(choices.join(",") || "none")} /> : <p data-app-home="">Đã vào: {done}</p>;
}

/** The element a finger at the centre of `el` actually lands on. */
const hitsItself = (el: Element | null): boolean => {
  if (el === null) return false;
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
};

beforeEach(async () => {
  fake.calls = [];
  await page.viewport(390, 844);
});

test("KT-09 (390): chưa đồng ý Điều khoản → chỉ có màn Điều khoản, bấm được; đồng ý xong mới tới màn chào", async () => {
  fake.gate = { suspendedUntil: null, termsVersion: TERMS_VERSION, termsAccepted: false, notices: [] };
  await render(
    <Frame>
      <SafetyGate>
        <App />
      </SafetyGate>
    </Frame>,
  );
  await expect.element(page.getByTestId("terms-prompt")).toBeVisible();
  // Nothing of the app (and no fixed layer of it) under the agreement.
  expect(document.querySelector("[data-welcome-home]")).toBeNull();
  const box = document.querySelector("[data-terms-check]");
  expect(hitsItself(box)).toBe(true);
  await userEvent.click(page.getByRole("checkbox", { name: /Tôi đồng ý với Điều khoản/ }));
  const agree = page.getByRole("button", { name: "Đồng ý và tiếp tục" });
  await expect.element(agree).toBeEnabled();
  expect(hitsItself(agree.element())).toBe(true);
  await userEvent.click(agree);
  await vi.waitFor(() => expect(fake.calls).toContain("accept_terms"), WAIT);
  // Then the welcome — and its choices answer a tap.
  await expect.element(page.getByRole("heading", { name: "Bạn muốn Avora là nơi để làm gì?" })).toBeVisible();
  expect(document.querySelector("[data-testid=terms-prompt]")).toBeNull();
  const first = document.querySelector<HTMLElement>("[data-welcome-home] [role=checkbox]");
  expect(hitsItself(first)).toBe(true);
  first?.click();
  await vi.waitFor(() => expect(first?.getAttribute("aria-checked")).toBe("true"), WAIT);
  expect(document.body.style.pointerEvents).not.toBe("none");
});

test("KT-09 (390): thông báo tài khoản là màn riêng trước màn chào, bấm được Đã hiểu", async () => {
  fake.gate = { suspendedUntil: null, termsVersion: TERMS_VERSION, termsAccepted: true, notices: [{ id: "n1", kind: "report_reviewed", createdAt: "2026-11-13T00:00:00Z" }] };
  await render(
    <Frame>
      <SafetyGate>
        <App />
      </SafetyGate>
    </Frame>,
  );
  const ok = page.getByRole("button", { name: "Đã hiểu" });
  await expect.element(ok).toBeVisible();
  expect(document.querySelector("[data-welcome-home]")).toBeNull();
  expect(hitsItself(ok.element())).toBe(true);
  await userEvent.click(ok);
  await vi.waitFor(() => expect(fake.calls).toContain("ack_account_notice"), WAIT);
  await vi.waitFor(() => expect(document.querySelector("[data-testid=account-notice]")).toBeNull(), WAIT);
  await expect.element(page.getByRole("heading", { name: "Bạn muốn Avora là nơi để làm gì?" })).toBeVisible();
  const first = document.querySelector<HTMLElement>("[data-welcome-home] [role=checkbox]");
  expect(hitsItself(first)).toBe(true);
});
