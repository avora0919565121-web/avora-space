import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { BackToSettings } from "@/components/settings/SettingsMenu";
import { VaultOffline } from "@/components/vault/VaultCompartment";
import { lazyRetry } from "@/lib/lazy-retry";

const WAIT = { timeout: 6_000, interval: 50 } as const;

function setOnline(isOnline: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => isOnline });
}
function restoreOnline(): void {
  delete (navigator as unknown as { onLine?: boolean }).onLine;
}

function Frame({ children, at }: { children: ReactNode; at: string }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

test("KT-08 · QA05-03: có mạng lại thì Tài sản tự mở, dù trình duyệt nhớ lần tải hỏng (tải lại dưới URL mới)", async () => {
  await page.viewport(1440, 900);
  const url = `${location.origin}/src/test/fixtures/kt08-lazy-room.tsx`;
  let plainTries = 0;
  // The browser keeps a failed module import: the SAME url fails again even once the network is back.
  const Room = lazyRetry(async () => {
    plainTries += 1;
    throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  });
  setOnline(false);
  try {
    await render(
      <Frame at="/ket-sat/tai-san">
        <RouteErrorBoundary resetKey="/ket-sat/tai-san">
          <Suspense fallback={null}>
            <Room />
          </Suspense>
        </RouteErrorBoundary>
      </Frame>,
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain("Cần có mạng để mở Két sắt lần đầu"), WAIT);
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(document.querySelector("[data-kt08-room]")).not.toBeNull(), WAIT);
    expect(plainTries).toBe(2);
    expect(document.body.textContent).not.toContain("Chưa tải được");
  } finally {
    restoreOnline();
  }
});

test("KT-08 · QA05-03: nút Thử lại cũng mở được", async () => {
  await page.viewport(390, 844);
  const url = `${location.origin}/src/test/fixtures/kt08-lazy-room.tsx`;
  const Room = lazyRetry(async () => {
    throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  });
  await render(
    <Frame at="/ket-sat/tai-san">
      <RouteErrorBoundary resetKey="/ket-sat/tai-san">
        <Suspense fallback={null}>
          <Room />
        </Suspense>
      </RouteErrorBoundary>
    </Frame>,
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("Chưa tải được Két sắt"), WAIT);
  await userEvent.click(page.getByRole("button", { name: "Thử lại" }));
  await vi.waitFor(() => expect(document.querySelector("[data-kt08-room]")).not.toBeNull(), WAIT);
});

test("KT-08 · QA05-02: ngăn chưa có trên máy và mất mạng → nói rõ cần mạng, có Thử lại, không xoay", async () => {
  await page.viewport(390, 844);
  const onRetry = vi.fn();
  await render(<VaultOffline section="passwords" onRetry={onRetry} />);
  await expect.element(page.getByText("Cần có mạng để mở Mật khẩu")).toBeInTheDocument();
  await expect.element(page.getByText(/AVORA tự mở lại khi có mạng/)).toBeInTheDocument();
  expect(document.querySelector(".animate-spin")).toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Thử lại" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

for (const [path, title] of [["/cai-dat/thong-bao", "Thông báo"], ["/cai-dat/ho-so", "Hồ sơ"], ["/cai-dat/dung-luong", "Dung lượng"]] as const) {
  test(`KT-08 · QA05-05: điện thoại, ${path} có tên trang "${title}"`, async () => {
    await page.viewport(390, 844);
    await render(
      <Frame at={path}>
        <Routes>
          <Route path="*" element={<BackToSettings />} />
        </Routes>
      </Frame>,
    );
    await expect.element(page.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "Cài đặt" })).toBeInTheDocument();
  });
}
