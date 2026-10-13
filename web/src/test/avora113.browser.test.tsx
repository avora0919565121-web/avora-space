import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

import { mulberry32 } from "./pin-seeded";

/**
 * A stand-in for the server that enforces what the database enforces: the `user_pins_format`
 * table constraint (the copy that lagged behind in AVORA-113) and uniqueness. A PIN the app
 * offers but the table refuses fails here exactly as it did in production (23514).
 */
const server = vi.hoisted(() => ({
  format: /^A-[ABCDEFGHJKLMNPQRSTUVWXYZ][ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKLMNPQRSTUVWXYZ]$/,
  claimed: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: { p_pin: string }) => {
      if (name === "check_user_pin") return { data: server.claimed.includes(args.p_pin) ? "taken" : "ok", error: null };
      if (name === "claim_user_pin") {
        if (!server.format.test(args.p_pin)) {
          return {
            data: null,
            error: { code: "23514", message: 'new row for relation "user_pins" violates check constraint "user_pins_format"' },
          };
        }
        server.claimed.push(args.p_pin);
        return { data: args.p_pin, error: null };
      }
      return { data: null, error: null };
    },
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me", phone: "" } }) }));

import { PinSetup } from "@/components/PinGate";

function mount(onClaimed: (pin: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div data-pin-test="" style={{ width: 390, padding: 16 }}>
          <PinSetup onClaimed={onClaimed} />
        </div>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const saveButton = () => page.getByRole("button", { name: /^Lưu PIN/ });

it("AVORA-113 · gõ PIN có L → dùng được → Lưu → lưu được", async () => {
  server.claimed = [];
  const claimed: string[] = [];
  const screen = await mount((pin) => claimed.push(pin));
  await userEvent.click(page.getByRole("radio", { name: "Tự chọn PIN đẹp" }));
  await userEvent.fill(page.getByRole("textbox"), "lmnp23ql");
  await expect.element(page.getByText("PIN này dùng được.")).toBeVisible();
  await userEvent.click(page.getByRole("checkbox"));
  await expect.element(saveButton()).toBeEnabled();
  await userEvent.click(saveButton());
  await expect.poll(() => claimed).toEqual(["A-LMNP23QL"]);
  await expect.element(page.getByText("PIN của bạn là A-LMNP23QL.")).toBeVisible();
  await page.screenshot({ path: "../../../docs/screens/2026-10-13/113-pin-co-L-luu-duoc-390.png" });
  await screen.unmount();
});

it("AVORA-113 · Tạo giúp tôi 30 lần liên tiếp, lần nào cũng lưu được", { timeout: 60_000 }, async () => {
  server.claimed = [];
  // The app's own generator, fed a fixed seed so the run is repeatable (and draws plenty of L).
  const random = mulberry32(2026_10_13);
  const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) for (let index = 0; index < array.length; index += 1) array[index] = Math.floor(random() * 0x1_0000_0000);
    return array;
  });
  const claimed: string[] = [];
  const screen = await mount((pin) => claimed.push(pin));
  await userEvent.click(page.getByRole("checkbox"));
  for (let round = 1; round <= 30; round += 1) {
    await userEvent.click(page.getByRole("button", { name: "Sinh PIN khác" }));
    await expect.element(page.getByText("PIN này dùng được.")).toBeVisible();
    await expect.element(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());
    await expect.poll(() => claimed.length).toBe(round);
  }
  spy.mockRestore();
  expect(new Set(claimed).size).toBe(30);
  expect(claimed.filter((pin) => pin.slice(2).includes("L")).length).toBeGreaterThan(0);
  expect(document.body.textContent ?? "").not.toContain("Không lưu được PIN");
  await screen.unmount();
});

it("AVORA-113 · máy chủ từ chối lạ → câu báo có mã ngắn, không câu chung chung", async () => {
  // A server still on the old 23-letter constraint.
  server.format = /^A-[ABCDEFGHJKMNPQRSTUVWXYZ][ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKMNPQRSTUVWXYZ]$/;
  server.claimed = [];
  const screen = await mount(() => undefined);
  await userEvent.click(page.getByRole("radio", { name: "Tự chọn PIN đẹp" }));
  await userEvent.fill(page.getByRole("textbox"), "LBCDEFGH");
  await expect.element(page.getByText("PIN này dùng được.")).toBeVisible();
  await userEvent.click(page.getByRole("checkbox"));
  await userEvent.click(saveButton());
  await expect
    .element(page.getByText("Không lưu được PIN (mã P-23514-FORMAT). Thử PIN khác hoặc báo cho Avora."))
    .toBeVisible();
  await page.screenshot({ path: "../../../docs/screens/2026-10-13/113-pin-loi-co-ma-390.png" });
  await screen.unmount();
});
