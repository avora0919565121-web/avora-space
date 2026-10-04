import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadingOrRetry, STUCK_AFTER_MS } from "@/components/LoadingOrRetry";

/*
 * AVORA-94B · N.11 (cam kết "không bao giờ quay tròn mãi"): a spinner turns into `Chưa tải được ·
 * Thử lại` within 10 s, says `Đang không có mạng` when offline, and an inner screen keeps its `‹`.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("N.11 · LoadingOrRetry", () => {
  it("offline, inner screen: ≤ 10 s → `Đang không có mạng · Chưa tải được` + Thử lại + ‹", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onRetry = vi.fn();
    const screen = await render(
      <MemoryRouter initialEntries={["/ke-hoach?bang=b1"]}>
        <Routes>
          <Route path="/ke-hoach" element={<LoadingOrRetry withBack onRetry={onRetry} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector("[data-loading-or-retry]")?.getAttribute("data-loading-or-retry")).toBe("waiting");
    expect(document.querySelector("[data-back]")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(STUCK_AFTER_MS);
    expect(STUCK_AFTER_MS).toBeLessThanOrEqual(10_000);
    // React renders on its own scheduler (not faked): let it catch up.
    vi.useRealTimers();
    await expect.poll(() => document.querySelector("[data-loading-or-retry]")?.getAttribute("data-loading-or-retry")).toBe("stuck");
    expect(document.body.textContent).toContain("Đang không có mạng · Chưa tải được");
    (screen.getByRole("button", { name: "Thử lại" }).element() as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-back]")).not.toBeNull();
  });
});
