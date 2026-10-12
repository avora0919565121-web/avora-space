import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-109 · B — ⋯ Tin tự biến mất, đề nghị 1-1, Ẩn dấu vết / Dọn. No network. */
const state = vi.hoisted(() => ({ calls: [] as { fn: string; args: Record<string, unknown> }[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (fn === "set_disappear_timer") return Promise.resolve({ data: args.p_seconds === null ? "applied" : "proposed", error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { Toaster } from "@/components/ui/sonner";
import { DisappearProposalLine, DisappearRows } from "@/components/chat/DisappearControls";
import { useTidyTombstones } from "@/lib/use-tidy-tombstones";
import { disappearKeys, type DisappearState } from "@/lib/disappear";

const OUT = "../../../docs/screens/2026-10-12";
const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));
const q = (selector: string): HTMLElement | null => document.querySelector(selector);

function Frame({ children, seed }: { children: ReactNode; seed?: DisappearState }) {
  const [client] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (seed !== undefined) c.setQueryData(disappearKeys.state("conv"), seed);
    return c;
  });
  return (
    <QueryClientProvider client={client}>
      <div className="paper min-h-[100dvh] bg-background p-4">{children}</div>
      <Toaster />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  state.calls = [];
});

test("1-1: chọn 24 giờ = gửi đề nghị; có dòng 'Người nhận vẫn có thể chụp màn hình…'; Tắt có hiệu lực ngay", async () => {
  await page.viewport(390, 844);
  await render(
    <Frame>
      <DisappearRows conversationId="conv" kind="direct" canChange state={{ seconds: null, proposal: null, hideTombstones: false }} />
    </Frame>,
  );
  expect(q("[data-disappear-value]")?.textContent).toBe("Tắt");
  await userEvent.click(q("[data-disappear-row]") as HTMLElement);
  await expect.poll(() => q("[data-disappear-sheet]")).not.toBeNull();
  expect(q("[data-disappear-note]")?.textContent).toBe("Người nhận vẫn có thể chụp màn hình hoặc sao chép trước khi tin biến mất.");
  expect(q("[data-disappear-sheet]")?.textContent).toContain("cần người kia đồng ý");
  await settle(500);
  await page.screenshot({ path: `${OUT}/109B-chon-thoi-gian-390x844.png` });
  await userEvent.click(q('[data-disappear-option="86400"]') as HTMLElement);
  await expect.poll(() => state.calls.find((c) => c.fn === "set_disappear_timer")?.args.p_seconds).toBe(86400);
  await expect.poll(() => document.body.textContent ?? "").toContain("Đã gửi đề nghị 24 giờ");
});

test("Nhóm, thành viên thường: các lựa chọn bị khoá, nói rõ chỉ quản trị đổi được", async () => {
  await render(
    <Frame>
      <DisappearRows conversationId="conv" kind="group" canChange={false} state={{ seconds: 86400, proposal: null, hideTombstones: false }} />
    </Frame>,
  );
  expect(q("[data-disappear-value]")?.textContent).toBe("24 giờ");
  await userEvent.click(q("[data-disappear-row]") as HTMLElement);
  await expect.poll(() => q("[data-disappear-sheet]")).not.toBeNull();
  expect(q("[data-disappear-sheet]")?.textContent).toContain("Chỉ chủ nhóm hoặc quản trị viên đổi được.");
  const options = [...document.querySelectorAll<HTMLButtonElement>("[data-disappear-option]")];
  expect(options).toHaveLength(5);
  expect(options.every((button) => button.disabled)).toBe(true);
});

test("Ẩn dấu vết: công tắc gọi set_hide_tombstones cho riêng mình", async () => {
  await render(
    <Frame>
      <DisappearRows conversationId="conv" kind="group" canChange state={{ seconds: null, proposal: null, hideTombstones: false }} />
    </Frame>,
  );
  await userEvent.click(q("[data-hide-tombstones-switch]") as HTMLElement);
  await expect.poll(() => state.calls.find((c) => c.fn === "set_hide_tombstones")?.args).toEqual({ p_conversation_id: "conv", p_value: true });
});

test("đề nghị 1-1: người kia thấy Đồng ý / Không đồng ý; người đề nghị thấy đang chờ", async () => {
  await page.viewport(390, 844);
  const proposal = { id: "p1", proposedBy: "lan", seconds: 86400 as const, messageId: "sys1", createdAt: new Date().toISOString() };
  const line = { id: "sys1", content: "Lan đề nghị tin tự biến mất sau 24 giờ" };
  const view = await render(
    <Frame>
      <DisappearProposalLine message={line} proposal={proposal} viewerId="minh" conversationId="conv" />
    </Frame>,
  );
  expect(q("[data-disappear-accept]")).not.toBeNull();
  expect(q("[data-disappear-decline]")).not.toBeNull();
  await page.screenshot({ path: `${OUT}/109B-de-nghi-390x844.png` });
  await userEvent.click(q("[data-disappear-accept]") as HTMLElement);
  await expect.poll(() => state.calls.find((c) => c.fn === "answer_disappear_proposal")?.args).toEqual({ p_proposal_id: "p1", p_accept: true });
  await view.unmount();
  await render(
    <Frame>
      <DisappearProposalLine message={line} proposal={proposal} viewerId="lan" conversationId="conv" />
    </Frame>,
  );
  expect(q("[data-disappear-accept]")).toBeNull();
  expect(q("[data-disappear-waiting]")?.textContent).toBe("Đang chờ người kia đồng ý.");
});

function TidyButton() {
  const tidy = useTidyTombstones("conv");
  return (
    <button type="button" data-tombstone-tidy="" onClick={tidy}>
      Dọn
    </button>
  );
}

test("Dọn: ẩn dấu vết trên màn hình mình ngay, Hoàn tác trong 5 giây bật lại", async () => {
  await render(
    <Frame seed={{ seconds: 3600, proposal: null, hideTombstones: false }}>
      <TidyButton />
    </Frame>,
  );
  await userEvent.click(q("[data-tombstone-tidy]") as HTMLElement);
  await expect.poll(() => state.calls.filter((c) => c.fn === "set_hide_tombstones").map((c) => c.args.p_value)).toEqual([true]);
  const undo = await vi.waitFor(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Hoàn tác");
    if (button === undefined) throw new Error("no undo yet");
    return button;
  });
  await userEvent.click(undo);
  await expect.poll(() => state.calls.filter((c) => c.fn === "set_hide_tombstones").map((c) => c.args.p_value)).toEqual([true, false]);
});
