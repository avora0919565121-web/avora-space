import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import "@/index.css";

/* AVORA-E0 — the hidden test page runs end to end on made-up data, with no network request while running. */
import E2eeSpikePage from "@/spikes/e2ee/E2eeSpikePage";

const OUT = "../../../docs/screens/2026-10-12";
const q = (selector: string): HTMLElement | null => document.querySelector(selector);

test("Chạy thử: M1…M7 ra bảng kết quả; không có yêu cầu mạng trong lúc chạy; Chép kết quả", async () => {
  await page.viewport(390, 844);
  await render(<E2eeSpikePage />);
  expect(q("[data-spike-guide]")?.querySelectorAll("li")).toHaveLength(6);
  await expect.poll(() => (q("[data-spike-run]") as HTMLButtonElement).disabled, { timeout: 20_000 }).toBe(false);

  const requests: string[] = [];
  const realFetch = window.fetch;
  window.fetch = ((input: RequestInfo | URL) => {
    requests.push(`fetch ${String(input)}`);
    return realFetch(input);
  }) as typeof fetch;
  const resourceObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) requests.push(`resource ${entry.name}`);
  });
  resourceObserver.observe({ type: "resource", buffered: false });
  try {
    await userEvent.click(q("[data-spike-run]") as HTMLElement);
    await expect.poll(() => q("[data-spike-status]")?.textContent ?? "", { timeout: 170_000, interval: 1000 }).toContain("Xong");
  } finally {
    resourceObserver.disconnect();
    window.fetch = realFetch;
  }
  expect(requests).toEqual([]);
  const ids = [...document.querySelectorAll("[data-spike-results] > div")].map((row) => row.textContent?.split(" · ")[0] ?? "");
  for (const id of ["M1", "M2a", "M2b", "M2c", "M2d", "M2e", "M3", "M4", "M5.1", "M5.2", "M5.3", "M5.4", "M6", "M7a"]) expect(ids).toContain(id);
  expect(q("[data-spike-results]")?.textContent).toContain('"co phai" → "có phải": có');
  await page.screenshot({ path: `${OUT}/E0-trang-thu-ket-qua-390x844.png` });
  document.documentElement.classList.add("dark");
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/E0-trang-thu-ket-qua-toi-390x844.png` });
  document.documentElement.classList.remove("dark");
  await userEvent.click(q("[data-spike-clear]") as HTMLElement);
  await expect.poll(() => q("[data-spike-status]")?.textContent ?? "").toBe("Đã xoá dữ liệu thử.");
}, 200_000);
