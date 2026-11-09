import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, expect, test, vi } from "vitest";

import "@/index.css";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ session: null, user: null, isLoading: false }) }));

import { PolicyView } from "@/components/PolicyView";

/* 111-D · bật ?shell=native trong bản thử: Điều khoản không còn câu "Ủng hộ"; trên web vẫn còn. */
const OUT = "../../.test-output/screens/111d";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/chinh-sach#dieu-khoan"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  window.sessionStorage.removeItem("avora-shell-override");
  window.history.replaceState(null, "", "/");
});

test("111D.1 · web: Điều khoản có câu Ủng hộ", async () => {
  await page.viewport(390, 844);
  window.history.replaceState(null, "", "/?shell=web");
  const screen = await render(<Frame><PolicyView isPublic /></Frame>);
  await expect.element(screen.getByRole("heading", { name: "Chính sách" })).toBeInTheDocument();
  await expect.poll(() => document.body.textContent ?? "").toContain("Ủng hộ là tự nguyện");
});

test("111D.2 · native (?shell=native): không còn câu nhắc tiền", async () => {
  await page.viewport(390, 844);
  window.history.replaceState(null, "", "/?shell=native");
  const screen = await render(<Frame><PolicyView isPublic /></Frame>);
  await expect.element(screen.getByRole("heading", { name: "Chính sách" })).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(document.body.textContent ?? "").not.toMatch(/Ủng hộ|Donation|thanh toán|bảng giá/i);
  await page.screenshot({ path: `${OUT}/111d-dieu-khoan-native-390.png` });
});
