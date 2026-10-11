import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-100 · S.2 §4.3 — Dấu ấn Avora Space (84.12 · 84.13). No network. */
type K = { kind: "sticker"; stickerId: string } | { kind: "photo"; path: string; focusY: number } | null;
const state = vi.hoisted(() => ({ keepsake: null as unknown, photoUrl: null as string | null, calls: [] as string[] }));
vi.mock("@/lib/use-keepsake", () => ({
  useKeepsake: () => ({
    keepsake: state.keepsake,
    photoUrl: state.photoUrl,
    isLoaded: true,
    setSticker: async (id: string) => {
      state.calls.push(`sticker:${id}`);
      state.keepsake = { kind: "sticker", stickerId: id };
    },
    setPhoto: async () => undefined,
    setFocus: async (y: number) => {
      state.calls.push(`focus:${y.toFixed(2)}`);
    },
    clear: async () => {
      state.calls.push("clear");
    },
  }),
}));

import { KeepsakeGreeting } from "@/components/space/KeepsakeGreeting";

const OUT = "../../../docs/screens/2026-10-11";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div className="paper min-h-[100dvh] px-4 pt-4 md:px-10">{children}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Greeting() {
  return (
    <KeepsakeGreeting>
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-[19px] leading-snug text-foreground" data-greeting="">
          <span className="font-normal text-muted-foreground">Chào buổi sáng, </span>
          <span className="font-semibold">Minh Anh</span>
          <span className="font-normal text-muted-foreground"> · Thứ Bảy, 11/10</span>
        </h1>
      </div>
    </KeepsakeGreeting>
  );
}

/** A worst case for the words: a nearly white photo. */
function brightPhoto(): string {
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 600;
  const g = c.getContext("2d");
  if (g !== null) {
    const grad = g.createLinearGradient(0, 0, 0, 600);
    grad.addColorStop(0, "#f7e7c9");
    grad.addColorStop(1, "#ffffff");
    g.fillStyle = grad;
    g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#e6b980";
    g.beginPath();
    g.arc(400, 250, 140, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL("image/png");
}

function settle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`84.12 · sticker cun.om cạnh lời chào, 72 px, nhún một lần · ${w}`, async () => {
    state.keepsake = { kind: "sticker", stickerId: "cun.om" } satisfies K;
    await page.viewport(w, h);
    await render(
      <Frame>
        <Greeting />
      </Frame>,
    );
    await settle();
    const sticker = document.querySelector<SVGElement>("[data-keepsake=sticker] [data-sticker-id='cun.om']");
    expect(sticker).not.toBeNull();
    expect(sticker?.getAttribute("width")).toBe("72");
    expect(sticker?.classList.contains("avora-keepsake-bob")).toBe(true);
    const greet = document.querySelector("[data-greeting]")?.getBoundingClientRect();
    const s = sticker?.getBoundingClientRect();
    // Beside the greeting, on the same row.
    expect((s?.right ?? 0) <= (greet?.left ?? 0) + 1).toBe(true);
    expect(Math.abs(((s?.top ?? 0) + (s?.bottom ?? 0)) / 2 - ((greet?.top ?? 0) + (greet?.bottom ?? 0)) / 2) < 30).toBe(true);
    await page.screenshot({ path: `${OUT}/84-12-dau-an-sticker-${w}.png` });
  });
}

test("84.13 · ảnh: dải ≤ 22 % màn điện thoại, chữ trắng trên lớp tối (sáng + tối), vị trí theo focus_y", async () => {
  state.keepsake = { kind: "photo", path: "me/k.webp", focusY: 0.25 } satisfies K;
  state.photoUrl = brightPhoto();
  await page.viewport(390, 844);
  for (const scheme of ["light", "dark"] as const) {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    await render(
      <Frame>
        <Greeting />
      </Frame>,
    );
    await settle();
    const strips = document.querySelectorAll<HTMLElement>("[data-keepsake=photo]");
    const strip = strips[strips.length - 1];
    expect(strip).not.toBeNull();
    expect((strip?.getBoundingClientRect().height ?? 999) <= 844 * 0.22 + 0.5).toBe(true);
    expect(strip?.style.backgroundPosition).toBe("50% 25%");
    for (const span of Array.from(strip.querySelectorAll<HTMLElement>("[data-greeting] span"))) {
      expect(getComputedStyle(span).color).toBe("rgb(255, 255, 255)");
    }
    await page.screenshot({ path: `${OUT}/84-13-dau-an-anh-${scheme}-390.png` });
  }
  document.documentElement.classList.remove("dark");
});

test("giữ lâu lời chào → `Đặt dấu ấn của tôi` → chọn sticker", async () => {
  state.keepsake = null;
  state.calls.length = 0;
  await page.viewport(390, 844);
  const screen = await render(
    <Frame>
      <Greeting />
    </Frame>,
  );
  await expect.poll(() => document.querySelectorAll("[data-keepsake-hold]").length).toBeGreaterThan(0);
  const holds = document.querySelectorAll<HTMLElement>("[data-keepsake-hold]");
  const hold = holds[holds.length - 1];
  hold?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }));
  await settle(200);
  await expect.poll(() => document.querySelector("[data-keepsake-open]")?.textContent).toBe("Đặt dấu ấn của tôi");
  await userEvent.click(document.querySelector("[data-keepsake-open]") as HTMLElement);
  await expect.element(screen.getByRole("heading", { name: "Dấu ấn của tôi" })).toBeInTheDocument();
  await settle(300);
  await page.screenshot({ path: `${OUT}/84-12-dat-dau-an-390.png` });
  await userEvent.click(document.querySelector("[data-keepsake-sticker='miu.okela']") as HTMLElement);
  expect(state.calls).toContain("sticker:miu.okela");
});
