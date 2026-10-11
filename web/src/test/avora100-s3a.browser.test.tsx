import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-100 · S.3 (a) — chuyển tiếp từ Nhật ký; thẻ `Ghi chép · …` ở người nhận. No network. */
const calls = vi.hoisted(() => [] as { fn: string; args: Record<string, unknown> }[]);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: "x", error: null });
    },
  },
}));
vi.mock("@/lib/use-conversations", () => ({
  useConversations: () => ({
    data: [
      { conversationId: "j", kind: "personal", title: "Nhật ký", verification: null, isConnected: true },
      { conversationId: "d1", kind: "direct", otherName: "Lan", title: "Lan", verification: null, isConnected: true },
      { conversationId: "g1", kind: "group", title: "Lớp 12A", memberCount: 30, verification: null, isConnected: true },
    ],
  }),
}));
vi.mock("@/lib/chat", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chat")>();
  return { ...real, conversationTitle: (c: { title?: string }) => c.title ?? "", matchesConversationQuery: () => true };
});

import { JournalForwardDialog } from "@/components/chat/JournalForwardDialog";
import { NoteCardBubble } from "@/components/chat/NoteCardBubble";
import { noteCardMarkers } from "@/lib/note-card";

const OUT = "../../../docs/screens/2026-10-11";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("đánh số cấp như trình soạn: I. · 1. · A. · a.", () => {
  expect(noteCardMarkers([{ level: 0 }, { level: 1 }, { level: 1 }, { level: 2 }, { level: 3 }, { level: 0 }])).toEqual(["I.", "1.", "2.", "A.", "a.", "II."]);
});

test("Chuyển tiếp ghi chép: chọn quyền (mặc định Cho tải ra), không có Nhật ký trong nơi nhận", async () => {
  calls.length = 0;
  await page.viewport(390, 844);
  render(
    <Frame>
      <JournalForwardDialog item={{ kind: "note", noteId: "n1", label: "Bài giảng Chương 3" }} onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle();
  expect(document.querySelector("[data-forward-permission='export']")?.getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector("[data-forward-target='j']")).toBeNull();
  await page.screenshot({ path: `${OUT}/S3a-chuyen-tiep-ghi-chep-390.png` });
  await userEvent.click(document.querySelector("[data-forward-permission='view']") as HTMLElement);
  await userEvent.click(document.querySelector("[data-forward-target='d1']") as HTMLElement);
  await expect.poll(() => calls.find((c) => c.fn === "forward_note")?.args).toEqual({ p_note_id: "n1", p_target: "d1", p_permission: "view" });
});

test("Chuyển tiếp một tệp ghi chép / một tệp File của tôi → đúng RPC", async () => {
  calls.length = 0;
  render(
    <Frame>
      <JournalForwardDialog item={{ kind: "note-files", attachmentIds: ["f2"], label: "so-do.png" }} onOpenChange={() => undefined} />
    </Frame>,
  );
  await settle();
  const targets = document.querySelectorAll<HTMLElement>("[data-forward-target='g1']");
  await userEvent.click(targets[targets.length - 1]);
  await expect.poll(() => calls.find((c) => c.fn === "forward_note_files")?.args).toEqual({ p_attachment_ids: ["f2"], p_target: "g1", p_permission: "export" });
});

test("Người nhận: thẻ `Ghi chép · tiêu đề`, mở ra đúng cấu trúc, chỉ xem; `Lưu vào Nhật ký`", async () => {
  calls.length = 0;
  await page.viewport(390, 844);
  const card = {
    title: "Bài giảng Chương 3",
    noteId: "n1",
    blocks: [
      { text: "Mở đầu", level: 0 },
      { text: "Khái niệm", level: 1 },
      { text: "Ví dụ có tên rất dài để thấy dòng xuống dòng trong bản chụp", level: 2 },
      { text: "Kết luận", level: 0 },
    ],
  };
  const screen = await render(
    <Frame>
      <div className="p-4">
        <NoteCardBubble card={card} messageId="m2" outgoing={false} />
      </div>
    </Frame>,
  );
  await expect.element(screen.getByText("Bài giảng Chương 3")).toBeInTheDocument();
  await userEvent.click(document.querySelector("[data-note-card]") as HTMLElement);
  await settle(400);
  const view = document.querySelector("[data-note-card-view]");
  expect(view?.textContent).toContain("I.Mở đầu");
  expect(view?.textContent).toContain("A.Ví dụ");
  expect(view?.textContent).toContain("II.Kết luận");
  expect(view?.querySelector("textarea, input, [contenteditable='true']")).toBeNull();
  await page.screenshot({ path: `${OUT}/S3a-the-ghi-chep-nguoi-nhan-390.png` });
  await userEvent.click(document.querySelector("[data-note-card-save]") as HTMLElement);
  await expect.poll(() => calls.find((c) => c.fn === "save_note_card")?.args).toEqual({ p_message_id: "m2" });
});
