import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-110 — Ngày nghỉ: vùng việc dùng tông `nghi`, vùng nội tâm giữ tông người dùng. No network. */
const prefs = vi.hoisted(() => ({ restWeekday: 0, restSaturday: false, restThemeEnabled: true }));
vi.mock("@/integrations/supabase/client", () => {
  const proxy = (rows: unknown): unknown =>
    new Proxy({}, { get: (_t, key) => (key === "then" ? Promise.resolve({ data: rows, error: null }).then.bind(Promise.resolve({ data: rows, error: null })) : () => proxy(rows)) });
  return { supabase: { from: () => proxy([]), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/use-settings", () => ({
  useProfileSettings: () => ({ data: { ...prefs } }),
}));

import { RestDayCard } from "@/components/space/RestDayCard";
import { REST_TONE } from "@/lib/rest-day";
import { paintLook, resolveLook, setRestTone, setSavedLook, TONES, type FixedTone } from "@/lib/theme";
import { previewRestTone, RestDaySync, useRestScope } from "@/lib/use-rest-day";
import type { RestInnerScope } from "@/lib/rest-day";

const OUT = "../../../docs/screens/2026-10-12";
const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));
const today = new Date().getDay();
const notToday = (today + 3) % 7;

function hslCss(v: { h: number; s: number; l: number }): string {
  const probe = document.createElement("span");
  probe.style.color = `hsl(${v.h} ${v.s}% ${v.l}%)`;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}

/** A page: its frame says whether it is an inward place, its accent is `bg-personal`. */
function Place({ scope, label }: { scope: RestInnerScope | null; label: string }) {
  useRestScope(scope);
  return (
    <div className="space-y-3 p-4">
      <p className="text-[15px] font-semibold text-foreground">{label}</p>
      <div data-accent="" className="flex h-11 items-center rounded-control bg-personal px-4 text-[15px] text-personal-foreground">Nút chính</div>
      <div className="max-w-[70%] rounded-bubble bg-personal px-3 py-2 text-[15px] text-personal-foreground">Tin của tôi</div>
      <span data-count-badge="" className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">3</span>
    </div>
  );
}

function Frame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RestDaySync />
        <div className={dark ? "dark" : undefined}>
          <main data-app-main="" className="paper min-h-[100dvh] bg-background">{children}</main>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const accent = (): string => getComputedStyle(document.querySelector("[data-accent]") as HTMLElement).backgroundColor;

beforeEach(() => {
  prefs.restWeekday = today;
  prefs.restSaturday = false;
  prefs.restThemeEnabled = true;
  setRestTone(null);
  setSavedLook({ scheme: "light", tone: "tim" });
  window.localStorage.removeItem("avora.rest-card-hidden");
});

afterAll(() => {
  setRestTone(null);
  paintLook(resolveLook({ scheme: "light", tone: "avora" }));
});

test("ngày nghỉ: vùng việc (Nhiệm vụ) dùng `nghi`; huy hiệu thành viền nhạt", async () => {
  await render(<Frame><Place scope={null} label="Nhiệm vụ" /></Frame>);
  await expect.poll(() => document.documentElement.dataset.rest).toBe("true");
  await settle(450);
  expect(accent()).toBe(hslCss(REST_TONE.light.personal));
  const badge = getComputedStyle(document.querySelector("[data-count-badge]") as HTMLElement);
  expect(badge.backgroundColor).not.toBe(hslCss({ h: 13, s: 73, l: 56 }));
  expect(badge.boxShadow).toContain("inset");
});

test("chat 1-1 và trình đọc sách giữ tông người dùng chọn (Tím); chat Nhóm dùng `nghi`", async () => {
  const view = await render(<Frame><Place scope="direct-chat" label="Chat 1-1" /></Frame>);
  await expect.poll(() => document.documentElement.dataset.rest).toBe("true");
  await settle(450);
  expect(document.querySelector("[data-app-main]")?.getAttribute("data-rest-scope")).toBe("inner");
  expect(accent()).toBe(hslCss(TONES.tim.light.personal));
  await view.rerender(<Frame><Place scope="reading" label="Đọc sách" /></Frame>);
  await settle(50);
  expect(accent()).toBe(hslCss(TONES.tim.light.personal));
  await view.rerender(<Frame><Place scope={null} label="Chat Nhóm" /></Frame>);
  await settle(50);
  expect(document.querySelector("[data-app-main]")?.hasAttribute("data-rest-scope")).toBe(false);
  expect(accent()).toBe(hslCss(REST_TONE.light.personal));
});

test("tắt `Đổi màu vào ngày nghỉ` → không đổi gì", async () => {
  prefs.restThemeEnabled = false;
  await render(<Frame><Place scope={null} label="Nhiệm vụ" /></Frame>);
  await settle(450);
  expect(document.documentElement.dataset.rest).toBeUndefined();
  expect(accent()).toBe(hslCss(TONES.tim.light.personal));
});

test("không phải ngày nghỉ → không đổi gì", async () => {
  prefs.restWeekday = notToday;
  await render(<Frame><Place scope={null} label="Nhiệm vụ" /></Frame>);
  await settle(450);
  expect(document.documentElement.dataset.rest).toBeUndefined();
});

test("tông Tím và tông Than thấy `nghi` giống hệt nhau ở vùng việc", async () => {
  const seen: string[] = [];
  for (const tone of ["tim", "than"] as FixedTone[]) {
    setSavedLook({ scheme: "light", tone });
    const view = await render(<Frame><Place scope={null} label={`Vùng việc · ${tone}`} /></Frame>);
    await expect.poll(() => document.documentElement.dataset.rest).toBe("true");
    await settle(450);
    seen.push(accent());
    await view.unmount();
  }
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).toBe(hslCss(REST_TONE.light.personal));
});

test("Xem thử: màu nghỉ 3 giây rồi trở lại, không đổi cài đặt", async () => {
  prefs.restWeekday = notToday;
  await render(<Frame><Place scope={null} label="Cài đặt" /></Frame>);
  await settle(200);
  expect(document.documentElement.dataset.rest).toBeUndefined();
  previewRestTone();
  await expect.poll(() => document.documentElement.dataset.rest).toBe("true");
  await expect.poll(() => document.documentElement.dataset.rest, { timeout: 5000 }).toBeUndefined();
  expect(prefs.restWeekday).toBe(notToday);
});

test("thẻ Avora Space: `Hôm nay là ngày nghỉ.` + 3 cửa; `Để sau` ẩn đến hết ngày", async () => {
  await page.viewport(390, 844);
  await render(
    <Frame>
      <div className="p-4">
        <RestDayCard />
      </div>
    </Frame>,
  );
  await expect.poll(() => document.querySelector("[data-rest-card]")).not.toBeNull();
  expect(document.querySelector("[data-rest-card]")?.textContent).toContain("Hôm nay là ngày nghỉ.");
  expect([...document.querySelectorAll("[data-rest-door]")].map((b) => b.textContent?.trim())).toEqual(["Đọc tiếp", "Suy gẫm hôm nay", "Nhắn cho một người"]);
  await settle(450);
  await page.screenshot({ path: `${OUT}/110-the-ngay-nghi-390x844.png` });
  await userEvent.click(document.querySelector("[data-rest-later]") as HTMLElement);
  await expect.poll(() => document.querySelector("[data-rest-card]")).toBeNull();
});

for (const dark of [false, true]) {
  for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
    test(`ảnh: vùng việc (Nhóm) cạnh vùng nội tâm (1-1) · ${dark ? "Tối" : "Sáng"} · ${w}x${h}`, async () => {
      setSavedLook({ scheme: dark ? "dark" : "light", tone: "bien" });
      await page.viewport(w, h);
      await render(
        <Frame dark={dark}>
          <div className="grid grid-cols-2 gap-2">
            <Place scope={null} label="Chat Nhóm · Nhiệm vụ (vùng việc)" />
            <section data-rest-scope="inner">
              <Place scope={null} label="Chat 1-1 · Đọc sách · Suy gẫm (nội tâm)" />
            </section>
          </div>
        </Frame>,
      );
      await expect.poll(() => document.documentElement.dataset.rest).toBe("true");
      await settle(450);
      await page.screenshot({ path: `${OUT}/110-viec-va-noi-tam-${dark ? "toi" : "sang"}-${w}x${h}.png` });
    });
  }
}
