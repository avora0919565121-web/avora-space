import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ConfirmHost } from "@/components/ConfirmHost";
import { writeDraft } from "@/lib/chat-drafts";
import { outboxStore, type OutboxItem } from "@/lib/outbox";
import { confirmSignOut } from "@/lib/unsynced";

/* 112-C · đăng xuất khi còn dữ liệu chưa lên máy chủ: cảnh báo rõ, cho chờ; không âm thầm xoá. */
const USER = "0b1f7a2c-0000-4000-8000-0000000112cc";
const OUT = "../../../docs/screens/2026-10-14";

function waiting(id: string): OutboxItem {
  return {
    id, userId: USER, conversationId: "c-112c", content: "chưa gửi", replyToMessageId: null, mentionedUserIds: [], refs: [],
    originGroupId: null, isUrgent: false, files: [], createdAt: new Date().toISOString(), seq: Date.now(), state: "waiting_network", attempts: 1, lastError: null,
  };
}

beforeEach(async () => {
  for (const entry of await outboxStore.all(USER)) await outboxStore.remove(entry.id);
  writeDraft(USER, "c-112c-a", "");
  await page.viewport(390, 844);
});

test("112C.1 · còn tin chưa gửi + nháp → hỏi trước; Chờ gửi xong giữ nguyên tất cả", async () => {
  await outboxStore.put(waiting("00000000-0000-4000-8000-0000000112c1"));
  await outboxStore.put(waiting("00000000-0000-4000-8000-0000000112c2"));
  writeDraft(USER, "c-112c-a", "viết dở");
  const screen = await render(<ConfirmHost />);
  const answer = confirmSignOut(USER);
  await expect.element(screen.getByText("Còn 2 tin chưa gửi và 1 bản nháp")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/112C-dang-xuat-con-tin-390.png` });
  await userEvent.click(screen.getByRole("button", { name: "Chờ gửi xong" }));
  expect(await answer).toBe(false);
  expect((await outboxStore.all(USER)).length).toBe(2);
});

test("112C.2 · không còn gì chưa gửi → đăng xuất không hỏi", async () => {
  expect(await confirmSignOut(USER)).toBe(true);
});

test("112C.3 · Vẫn đăng xuất → trả true (người dùng đã chọn)", async () => {
  await outboxStore.put(waiting("00000000-0000-4000-8000-0000000112c3"));
  const screen = await render(<ConfirmHost />);
  const answer = confirmSignOut(USER);
  await userEvent.click(await screen.getByRole("button", { name: "Vẫn đăng xuất" }));
  expect(await answer).toBe(true);
});
