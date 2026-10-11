import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-108 — trạng thái tin thật (sheet, chip, công tắc) và viên cảm xúc nổi. No network. */
const state = vi.hoisted(() => ({ off: false, share: true, calls: [] as { fn: string; args: unknown }[] }));
vi.mock("@/integrations/supabase/client", () => {
  const proxy = (rows: unknown): unknown =>
    new Proxy({}, { get: (_t, key) => (key === "then" ? Promise.resolve({ data: rows, error: null }).then.bind(Promise.resolve({ data: rows, error: null })) : () => proxy(rows)) });
  return {
    supabase: {
      from: () => proxy({ share_read_status: state.share }),
      rpc: (fn: string, args: unknown) => {
        state.calls.push({ fn, args });
        if (fn === "get_message_receipts") {
          if (state.off) return Promise.resolve({ data: null, error: { message: "avora_receipts_off" } });
          const at = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();
          return Promise.resolve({
            data: [
              { user_id: "b", display_name: "Bảo", state: "read", at: at(3) },
              { user_id: "c", display_name: "Chi", state: "read", at: at(30) },
              { user_id: "d", display_name: "Dũng", state: "delivered", at: at(40) },
              { user_id: "e", display_name: "Én", state: "not_delivered", at: null },
              { user_id: "f", display_name: "Phúc", state: "hidden", at: null },
              { user_id: "g", display_name: "Giang", state: "hidden", at: null },
            ],
            error: null,
          });
        }
        if (fn === "set_share_read_status") state.off = false;
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

import { ReactionPill } from "@/components/chat/ReactionPill";
import { ReceiptsSheet } from "@/components/chat/ReceiptsSheet";
import { ShareReadCard } from "@/components/ShareReadCard";
import type { ReactionGroup } from "@/lib/reactions";

const OUT = "../../../docs/screens/2026-10-11";
const SIZES = [[390, 844], [844, 390], [1280, 800]] as const;

function Frame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  document.documentElement.classList.toggle("dark", dark);
  return (
    <QueryClientProvider client={client}>
      <div className="paper min-h-[100dvh] bg-background p-4">{children}</div>
    </QueryClientProvider>
  );
}
const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));
const grp = (emoji: string, count: number, mine = false): ReactionGroup => ({ emoji, count, mine, userIds: Array.from({ length: count }, (_, i) => (mine && i === 0 ? "me" : `${emoji}-${i}`)) });

/** A bubble like the thread's, with or without the floating pill (and its 8 px + 12 px of room). */
function Bubble({ text, outgoing, groups }: { text: string; outgoing: boolean; groups: ReactionGroup[] }) {
  const has = groups.length > 0;
  return (
    <div className={outgoing ? "flex justify-end" : "flex justify-start"} data-row="">
      <div className="max-w-[86%]">
        <div className="relative">
          <div className={`rounded-bubble px-3 py-[7px] text-[16px] leading-[21px] ${outgoing ? "bg-personal text-personal-foreground" : "border border-border bg-card text-foreground"} ${has ? "pb-[15px]" : ""}`}>{text}</div>
          {has ? <ReactionPill groups={groups} outgoing={outgoing} viewerId="me" nameOf={(id) => `Người ${id}`} onRemoveMine={() => undefined} /> : null}
        </div>
        {has ? <div className="h-3" /> : null}
      </div>
    </div>
  );
}

test("viên nổi không làm dòng cao thêm quá 12 px so với hàng cảm xúc riêng cũ (≈ 32 px)", async () => {
  await page.viewport(390, 844);
  await render(
    <Frame>
      <div data-plain="">
        <Bubble text="Tối nay đi ăn không?" outgoing={false} groups={[]} />
      </div>
      <div data-with="">
        <Bubble text="Tối nay đi ăn không?" outgoing={false} groups={[grp("❤️", 2)]} />
      </div>
    </Frame>,
  );
  await settle();
  const plain = document.querySelector("[data-plain]")?.getBoundingClientRect().height ?? 0;
  const withPill = document.querySelector("[data-with]")?.getBoundingClientRect().height ?? 0;
  expect(withPill - plain).toBeLessThanOrEqual(20); // 8 px padding + 12 px overhang, no extra row
  expect(withPill - plain).toBeGreaterThan(0);
  const pill = document.querySelector<HTMLElement>("[data-with] [data-reaction-pill]");
  expect(Math.round(pill?.getBoundingClientRect().height ?? 0)).toBe(24);
});

for (const [w, h] of SIZES) {
  for (const dark of [false, true]) {
    test(`ảnh · viên cảm xúc 1 loại / 3 loại / +N, tin gửi và nhận · ${w}×${h}${dark ? " · tối" : ""}`, async () => {
      await page.viewport(w, h);
      await render(
        <Frame dark={dark}>
          <div className="mx-auto max-w-2xl space-y-1.5">
            <Bubble text="Chiều nay họp lúc 3 giờ nhé" outgoing={false} groups={[grp("👍", 1)]} />
            <Bubble text="ok" outgoing groups={[grp("❤️", 8, true), grp("👍", 3), grp("😂", 1)]} />
            <Bubble text="Ai mang máy chiếu giúp mình với, phòng họp tầng 2 không có" outgoing={false} groups={[grp("❤️", 6), grp("👍", 3), grp("😂", 1), grp("😮", 1), grp("🙏", 1)]} />
            <Bubble text="Mình mang" outgoing groups={[]} />
          </div>
        </Frame>,
      );
      await settle();
      // The narrow "ok" pill may stick out inward but never past the screen edge.
      for (const pill of Array.from(document.querySelectorAll<HTMLElement>("[data-reaction-pill]"))) {
        const r = pill.getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(w);
      }
      await page.screenshot({ path: `${OUT}/108-vien-cam-xuc-${w}x${h}${dark ? "-toi" : ""}.png` });
      document.documentElement.classList.remove("dark");
    });
  }
}

test("chạm viên → danh sách người thả, lọc theo emoji, `Bỏ cảm xúc của tôi` ở dòng của mình", async () => {
  await page.viewport(390, 844);
  await render(
    <Frame>
      <Bubble text="ok" outgoing groups={[grp("❤️", 2, true), grp("👍", 1)]} />
    </Frame>,
  );
  await userEvent.click(document.querySelector("[data-reaction-pill]") as HTMLElement);
  await settle();
  const list = document.querySelector("[data-reaction-list]");
  expect(list?.textContent).toContain("Bạn");
  expect(list?.querySelectorAll("[data-reaction-remove]").length).toBe(1);
  await page.screenshot({ path: `${OUT}/108-danh-sach-cam-xuc-390.png` });
});

for (const [w, h] of SIZES) {
  test(`Ai đã xem: 3 nhóm + số người Ẩn (không tên) · ${w}×${h}`, async () => {
    state.off = false;
    await page.viewport(w, h);
    await render(
      <Frame>
        <ReceiptsSheet messageId="m1" onOpenChange={() => undefined} />
      </Frame>,
    );
    await settle(500);
    const groups = Array.from(document.querySelectorAll("[data-receipts-group]")).map((g) => g.getAttribute("data-receipts-group"));
    expect(groups).toEqual(["read", "delivered", "not_delivered"]);
    expect(document.querySelector("[data-receipts-hidden]")?.textContent).toBe("2 người không chia sẻ trạng thái");
    expect(document.body.textContent).not.toContain("Phúc");
    expect(document.body.textContent).toContain("Có thể đang ngoại tuyến.");
    // Newest read first.
    const read = document.querySelector("[data-receipts-group='read']")?.textContent ?? "";
    expect(read.indexOf("Bảo")).toBeLessThan(read.indexOf("Chi"));
    await page.screenshot({ path: `${OUT}/108-ai-da-xem-${w}x${h}.png` });
  });
}

test("đang tắt chia sẻ → sheet nói đúng câu đó + nút Bật một chạm", async () => {
  state.off = true;
  state.calls.length = 0;
  await page.viewport(390, 844);
  await render(
    <Frame>
      <ReceiptsSheet messageId="m2" onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle(500);
  const off = document.querySelector("[data-receipts-off]");
  expect(off?.textContent).toContain("Tắt thì bạn cũng không thấy ai đã xem tin của bạn.");
  await userEvent.click(off?.querySelector("button") as HTMLElement);
  await expect.poll(() => state.calls.some((c) => c.fn === "set_share_read_status")).toBe(true);
});

for (const [w, h] of SIZES) {
  test(`Cài đặt › Riêng tư · ${w}×${h}`, async () => {
    await page.viewport(w, h);
    await render(
      <Frame>
        <div className="mx-auto max-w-2xl">
          <ShareReadCard />
        </div>
      </Frame>,
    );
    await settle();
    expect(document.querySelector("[data-share-read-card]")?.textContent).toContain("Cho nhóm biết khi tôi đã xem tin");
    await page.screenshot({ path: `${OUT}/108-rieng-tu-${w}x${h}.png` });
  });
}
