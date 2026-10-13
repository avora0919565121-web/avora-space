import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/log", () => ({ logError: () => undefined }));

import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { recordMeasure } from "@/test/reliability/record";

/**
 * 112-A · Luồng 5.1 — "không có màn hình trắng; lỗi một màn không làm hỏng tab khác", đo trên
 * đúng RouteErrorBoundary mà RequireAuth bọc quanh mỗi màn (resetKey = đường dẫn).
 */
function Broken(): never {
  throw new Error("màn này hỏng");
}

function Shell() {
  const location = useLocation();
  return (
    <div>
      <nav aria-label="thanh tab">
        <Link to="/hong">Màn hỏng</Link>
        <Link to="/viec">Nhiệm vụ</Link>
      </nav>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/hong" element={<Broken />} />
          <Route path="/viec" element={<p>Danh sách việc</p>} />
        </Routes>
      </RouteErrorBoundary>
    </div>
  );
}

test("L5.1 · một màn ném lỗi → thấy 'Phần này đang gặp sự cố' (không trắng), thanh tab vẫn bấm được, sang tab khác dùng bình thường", async () => {
  const [client] = [new QueryClient()];
  function App() {
    const [queryClient] = useState(() => client);
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/hong"]}>
          <Shell />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const screen = await render(<App />);
  const fallbackShown = await expect.element(screen.getByText("Phần này đang gặp sự cố")).toBeVisible().then(() => true, () => false);
  const navStillThere = document.querySelector('nav[aria-label="thanh tab"]') !== null;
  await userEvent.click(screen.getByRole("link", { name: "Nhiệm vụ" }));
  const otherTabWorks = await expect.element(screen.getByText("Danh sách việc")).toBeVisible().then(() => true, () => false);
  await recordMeasure("L5.1-man-loi-khong-lan", {
    threshold: "0 màn hình trắng; lỗi một màn không làm hỏng tab khác",
    fallbackShown,
    navStillThere,
    otherTabWorks,
  });
  expect(fallbackShown && navStillThere && otherTabWorks).toBe(true);
});
