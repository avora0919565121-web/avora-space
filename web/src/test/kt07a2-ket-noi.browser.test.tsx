import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { MessageComposer } from "@/components/chat/MessageComposer";

vi.mock("@/lib/groups", async () => {
  const actual = await vi.importActual<typeof import("@/lib/groups")>("@/lib/groups");
  return { ...actual, createSubGroup: vi.fn(async () => "new-sub") };
});

const { SubGroupDialog } = await import("@/components/chat/SubGroupDialog");
const { VerificationPanel } = await import("@/components/chat/VerificationPanel");

function Composer({ onSend }: { onSend: (content: string) => void }) {
  const [value, setValue] = useState<string>("");
  return (
    <div style={{ padding: 16, paddingTop: 260 }}>
      <MessageComposer
        value={value}
        onValueChange={setValue}
        onSend={(content) => {
          onSend(content);
          setValue("");
        }}
        placeholder="Nhắn…"
        ariaLabel="Nhắn tin"
        isSending={false}
        mentionCandidates={[
          { userId: "u-kt", name: "Phòng Kỹ thuật" },
          { userId: "u-qa", name: "Phòng Kiểm thử" },
        ]}
      />
    </div>
  );
}

afterEach(async () => {
  await page.viewport(414, 896);
});

test("KT-07a2 · QA04-05: bấm chuột vào gợi ý @tên thì tên được chèn", async () => {
  const screen = await render(<Composer onSend={() => undefined} />);
  await userEvent.click(screen.getByRole("textbox", { name: "Nhắn tin" }));
  await userEvent.keyboard("Chào @Kỹ");
  await userEvent.click(screen.getByRole("option", { name: /Phòng Kỹ thuật/ }));
  expect((screen.container.querySelector("textarea") as HTMLTextAreaElement).value).toContain("@Phòng Kỹ thuật");
});

test("KT-07a2 · máy tính: Enter gửi, Shift+Enter xuống dòng", async () => {
  await page.viewport(1280, 800);
  const sent: string[] = [];
  const screen = await render(<Composer onSend={(content) => sent.push(content)} />);
  await userEvent.click(screen.getByRole("textbox", { name: "Nhắn tin" }));
  await userEvent.keyboard("dòng một{Shift>}{Enter}{/Shift}dòng hai");
  expect(sent).toEqual([]);
  await userEvent.keyboard("{Enter}");
  expect(sent).toEqual(["dòng một\ndòng hai"]);
});

test("KT-07a2 · điện thoại: Enter vẫn chỉ xuống dòng", async () => {
  await page.viewport(390, 844);
  const sent: string[] = [];
  const screen = await render(<Composer onSend={(content) => sent.push(content)} />);
  await userEvent.click(screen.getByRole("textbox", { name: "Nhắn tin" }));
  await userEvent.keyboard("a{Enter}b");
  expect(sent).toEqual([]);
});

const members = [
  { userId: "me", displayName: "AICOS", role: "owner" as const, joinedAt: "2026-11-01T00:00:00Z" },
  { userId: "kt", displayName: "Phòng Kỹ thuật", role: "member" as const, joinedAt: "2026-11-01T00:00:00Z" },
  { userId: "qa", displayName: "Phòng Kiểm thử", role: "member" as const, joinedAt: "2026-11-01T00:00:00Z" },
  { userId: "sp", displayName: "Phòng Sản phẩm", role: "member" as const, joinedAt: "2026-11-01T00:00:00Z" },
];

test("KT-07a2 · QA04-04: Tạo nhóm con không chọn sẵn ai; chọn tất cả là một nút riêng", async () => {
  const client = new QueryClient();
  const groups = await import("@/lib/groups");
  const screen = await render(
    <QueryClientProvider client={client}>
      <SubGroupDialog open onOpenChange={() => undefined} parentGroupId="g1" parentName="Văn phòng" members={members} selfId="me" onCreated={() => undefined} />
    </QueryClientProvider>,
  );
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>("[role=dialog] input[type=checkbox]")];
  await vi.waitFor(() => expect(boxes()).toHaveLength(3));
  expect(boxes().filter((box) => box.checked)).toHaveLength(0);
  await userEvent.click(screen.getByText("Phòng Kỹ thuật"));
  await userEvent.click(screen.getByText("Phòng Kiểm thử"));
  await userEvent.fill(screen.getByRole("textbox"), "Kỹ thuật & Kiểm thử");
  await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm con" }));
  await vi.waitFor(() => expect(groups.createSubGroup).toHaveBeenCalledWith("g1", "Kỹ thuật & Kiểm thử", ["kt", "qa"]));
  await userEvent.click(screen.getByRole("button", { name: "Chọn tất cả" }));
  expect(boxes().filter((box) => box.checked)).toHaveLength(3);
});

test("KT-07a2 · QA04-08: người mời đang chờ thì khung tự đọc lại (không cần tải lại trang)", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  await render(
    <QueryClientProvider client={client}>
      <VerificationPanel
        conversationId="c1"
        viewerId="me"
        verification={{ expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), viaGroupId: null, viaGroupName: null, openedBy: "me", messagesLeft: 4, confirmedByMe: true }}
      />
    </QueryClientProvider>,
  );
  expect(spy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(4100);
  expect(spy).toHaveBeenCalledWith({ queryKey: ["conversations"] });
  vi.useRealTimers();
});

// ── QA04-01: một tin bị bỏ dở ở trạng thái "sending" (tải lại ngay sau Gửi) được gửi lại khi mở app ──
const sendState = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
  return {
    ...actual,
    sendMessage: async (conversationId: string, senderId: string, content: string, ...rest: unknown[]) => {
      const id = rest[6] as string;
      sendState.sent.push(id);
      return { id, conversationId, senderId, content, createdAt: new Date().toISOString() };
    },
    // KT-08 · QA04-07: plain words queued behind the head now go in one request.
    sendMessages: async (items: { id: string; conversationId: string; content: string }[]) => {
      for (const item of items) sendState.sent.push(item.id);
      return { sent: items.map((item) => ({ id: item.id, conversationId: item.conversationId, senderId: "u-a2", content: item.content, createdAt: new Date().toISOString() })), failedId: null, error: null };
    },
  };
});

test("KT-07a2 · QA04-01: mở lại app thì tin 'sending' được gửi, tin sau không kẹt, không trùng id", async () => {
  const { outboxStore } = await import("@/lib/outbox");
  const { useOutboxRunner } = await import("@/lib/use-outbox");
  const base = {
    userId: "u-a2", conversationId: "c-a2", replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null,
    isUrgent: false, files: [], createdAt: new Date().toISOString(), attempts: 1, lastError: null,
  };
  await outboxStore.put({ ...base, id: "a2-stuck", content: "một", seq: 1, state: "sending" });
  await outboxStore.put({ ...base, id: "a2-next", content: "hai", seq: 2, state: "queued", attempts: 0 });
  function Runner() {
    useOutboxRunner("u-a2");
    return null;
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Runner />
    </QueryClientProvider>,
  );
  await vi.waitFor(async () => expect(await outboxStore.all("u-a2")).toEqual([]), { timeout: 8000 });
  expect(sendState.sent).toEqual(["a2-stuck", "a2-next"]);
});
