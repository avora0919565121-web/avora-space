import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * Screenshots for the AVORA-44b / 49 report, drawn with fixed fake data (no account, no network).
 * They show the pieces that changed, at 360px, an iPhone width (390px) and a computer.
 */
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const done = Promise.resolve({ data: [], error: null });
  const handler: ProxyHandler<object> = {
    get: (_target, key) => {
      if (key === "then") return done.then.bind(done);
      return () => new Proxy(chain, handler);
    },
  };
  const proxy = new Proxy(chain, handler);
  return { supabase: { from: () => proxy, rpc: () => proxy, storage: { from: () => proxy }, channel: () => proxy, removeChannel: () => undefined } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" }, session: {} }) }));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ isLive: true, setReadingConversation: () => undefined }) }));

import { DateField } from "@/components/calendar/DateField";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { MessageActionsMenu } from "@/components/chat/MessageActionsMenu";
import { ThreadChipRow, type ThreadChipId } from "@/components/chat/ThreadChipRow";
import { NotesPanel } from "@/components/notes/NotesPanel";
import type { NotesData } from "@/lib/use-notes";
import type { Note, NoteFolder } from "@/lib/notes";

const OUT = "../../../docs/screens/2026-09-30";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const now = new Date().toISOString();
const folders: NoteFolder[] = [
  { id: "f1", parentId: null, name: "Bài giảng Chúa nhật", isSystem: false, systemKey: null, position: 0, createdAt: now },
  { id: "f2", parentId: null, name: "Họp dự án", isSystem: false, systemKey: null, position: 1, createdAt: now },
  { id: "f3", parentId: null, name: "Ghi chép đọc sách", isSystem: true, systemKey: "reading", position: 99, createdAt: now },
];
const block = (id: string, text: string, level: 0 | 1 | 2 | null = null) => ({ id, text, level });
const notes: Note[] = [
  {
    id: "n1",
    folderId: "f1",
    title: "Sống chậm lại giữa mùa bận rộn",
    blocks: [block("b1", "Ba điều giữ lại", 0), block("b2", "Nghỉ ngơi không phải lười", 1), block("b3", "Lắng nghe trước khi trả lời", 1), block("b4", "Một việc mỗi lúc", 1)],
    tags: ["Bài giảng"],
    pinnedAt: null,
    bookRecordId: null,
    bookTitle: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "n2",
    folderId: "f1",
    title: "",
    blocks: [block("c1", "Tuần trước: về lòng biết ơn"), block("c2", "Viết ra 3 điều mỗi tối")],
    tags: [],
    pinnedAt: null,
    bookRecordId: null,
    bookTitle: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
];

function fakeNotes(list: Note[]): NotesData {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, isPending: false };
  return {
    userId: "me",
    folders: q(folders),
    notes: q(list),
    liveNotes: list,
    trashedNotes: [],
    attachments: q([]),
    urlOf: () => null,
    refresh: () => undefined,
    addFolder: m,
    move: m,
    rename: m,
    removeFolder: m,
    patch: m,
    removeAttachment: m,
  } as unknown as NotesData;
}

function Notes({ list, isWide }: { list: Note[]; isWide: boolean }) {
  return (
    <Frame>
      <div style={{ height: "100vh" }} className="bg-card">
        <NotesPanel
          data={fakeNotes(list)}
          isWide={isWide}
          request={null}
          onRequestHandled={() => undefined}
          onCreateTask={() => undefined}
          onToBoard={() => undefined}
          onOpenBook={() => undefined}
        />
      </div>
    </Frame>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // The selection tests leave a live range and a scrolled document behind; a later popover
  // would measure itself against that leftover scroll offset.
  window.getSelection()?.removeAllRanges();
  (document.activeElement as HTMLElement | null)?.blur?.();
  window.scrollTo(0, 0);
  document.scrollingElement?.scrollTo(0, 0);
});

test("52.A · the pane holds only the editor (the tree lives in the Nhật ký column)", async () => {
  await page.viewport(1180, 760);
  window.localStorage.setItem("avora.notes.place", JSON.stringify({ folderId: "f1", noteId: "n1" }));
  const screen = await render(<Notes list={notes} isWide />);
  await expect.element(screen.getByLabelText("Tiêu đề ghi chép")).toBeInTheDocument();
  expect(screen.getByText("Thư mục", { exact: true }).elements()).toHaveLength(0);
});

test("52.A · nothing open → Gần đây, no folder column", async () => {
  await page.viewport(1100, 760);
  const screen = await render(<Notes list={notes} isWide />);
  await expect.element(screen.getByText("Gần đây", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("Sống chậm lại giữa mùa bận rộn")).toBeInTheDocument();
  expect(screen.getByText("Thư mục", { exact: true }).elements()).toHaveLength(0);
});

test("7 · selecting words shows Áp dụng (computer)", async () => {
  await page.viewport(1180, 760);
  window.localStorage.setItem("avora.notes.place", JSON.stringify({ folderId: "f1", noteId: "n1" }));
  const screen = await render(<Notes list={notes} isWide />);
  // A real selection, the way a person makes one: click at the end, Shift+Home.
  await userEvent.click(screen.getByLabelText("Mục 1."));
  await userEvent.keyboard("{End}{Shift>}{Home}{/Shift}");
  await expect.element(screen.getByRole("toolbar", { name: "Áp dụng đoạn đã chọn" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/viec7-ap-dung-may-tinh.png` });
});

test("7 · selecting words shows Áp dụng (phone 360)", async () => {
  await page.viewport(360, 640);
  window.localStorage.setItem("avora.notes.place", JSON.stringify({ folderId: "f1", noteId: "n1" }));
  const screen = await render(<Notes list={notes} isWide={false} />);
  // A real selection, the way a person makes one: click at the end, Shift+Home.
  await userEvent.click(screen.getByLabelText("Mục 1."));
  await userEvent.keyboard("{End}{Shift>}{Home}{/Shift}");
  await expect.element(screen.getByRole("toolbar", { name: "Áp dụng đoạn đã chọn" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/viec7-ap-dung-360.png` });
});

test("3 · pasting in the list asks where the words go", async () => {
  await page.viewport(1180, 760);
  window.localStorage.setItem("avora.notes.place", JSON.stringify({ folderId: "f1", noteId: null }));
  const screen = await render(<Notes list={notes} isWide />);
  await expect.element(screen.getByText("Gần đây", { exact: true })).toBeInTheDocument();
  const data = new DataTransfer();
  data.setData("text/plain", "Ý chính buổi họp\nChốt ngân sách tháng 10");
  document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  await expect.element(screen.getByText("Dán vào đâu?")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/viec3-dan-hoi-cho.png` });
});

function Thread({ open }: { open: ThreadChipId | null }) {
  const [chip, setChip] = useState<ThreadChipId | null>(open);
  const [draft, setDraft] = useState<string>("");
  return (
    <Frame>
      <div className="flex h-screen flex-col bg-card">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="h-10 w-9" />
          <span className="h-8 w-8 rounded-full bg-secondary" />
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">Nhóm Dự án Nhà thờ Thánh Tâm</p>
          <span className="h-10 w-10 rounded-md border border-dashed border-border text-center leading-10">🔍</span>
          <span className="h-10 w-10 rounded-md border border-dashed border-border text-center leading-10">⋯</span>
        </header>
        <ThreadChipRow
          chips={[
            { id: "pins", label: "2 ghim", count: 2 },
            { id: "project", label: "Dự án Sửa mái", to: "/du-an/x" },
            { id: "suggestions", label: "1 gợi ý", count: 1, needsMe: true },
            { id: "tasks", label: "Việc của bạn ở đây (3)", count: 3 },
            { id: "scheduled", label: "1 hẹn giờ", count: 1 },
          ]}
          open={chip}
          onToggle={(id) => setChip((current) => (current === id ? null : id))}
        />
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {["Chào cả nhà", "Mai 7h họp nhé", "Ok anh", "Em mang bản vẽ", "Nhớ mang thước dây", "Đã gửi báo giá", "Cảm ơn mọi người"].map((text, index) => (
            <p key={text} className={index % 2 === 0 ? "w-fit rounded-bubble bg-secondary px-4 py-2.5 text-[14px]" : "ml-auto w-fit rounded-bubble bg-primary px-4 py-2.5 text-[14px] text-primary-foreground"}>
              {text}
            </p>
          ))}
        </div>
        <div className="border-t border-border bg-card px-3 pb-3 pt-3">
          <MessageComposer
            value={draft}
            onValueChange={setDraft}
            onSend={() => setDraft("")}
            placeholder="Nhắn tin cho nhóm…"
            ariaLabel="Nhắn tin"
            isSending={false}
            onStartRecording={() => undefined}
            leadingAction={<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border">+</span>}
          />
        </div>
      </div>
    </Frame>
  );
}

test("49.5 / 49.6 · thread at 360×640: one chip row, composer field ≥ 220px, 🎙 when empty", async () => {
  await page.viewport(360, 640);
  const screen = await render(<Thread open={null} />);
  const field = screen.getByRole("textbox", { name: "Nhắn tin" }).element();
  expect(field.getBoundingClientRect().width).toBeGreaterThanOrEqual(220);
  await expect.element(screen.getByRole("button", { name: "Ghi âm tin nhắn thoại" })).toBeInTheDocument();
  const header = document.querySelector("header") as HTMLElement;
  const chips = screen.getByRole("navigation", { name: "Trong cuộc này" }).element();
  const composer = field.closest("div.border-t") as HTMLElement;
  const fixed = header.getBoundingClientRect().height + chips.getBoundingClientRect().height + composer.getBoundingClientRect().height;
  expect(fixed / 640).toBeLessThanOrEqual(0.35);
  await page.screenshot({ path: `${OUT}/49-5-6-cuoc-tro-chuyen-360.png` });
  await userEvent.click(field);
  await userEvent.keyboard("Ok");
  await expect.element(screen.getByRole("button", { name: "Gửi" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/49-6-co-chu-thi-nut-gui-360.png` });
});

test("49.5 · iPhone width with the tasks chip open (list capped at 35%)", async () => {
  await page.viewport(390, 844);
  await render(<Thread open="tasks" />);
  await page.screenshot({ path: `${OUT}/49-5-iphone-390.png` });
});

test("49.7 · long press menu starts with six quick reactions", async () => {
  await page.viewport(390, 844);
  const message = { id: "m1", conversationId: "c", senderId: "other", content: "Mai 7h họp nhé", createdAt: now } as const;
  const screen = await render(
    <Frame>
      <div className="flex h-screen items-start justify-end bg-card p-6">
        <MessageActionsMenu
          message={message}
          viewerId="me"
          canRaiseTask
          canForward
          canReport
          onAction={() => undefined}
          onQuickReact={() => undefined}
          open
          onOpenChange={() => undefined}
          className="opacity-100"
        />
      </div>
    </Frame>,
  );
  await expect.element(screen.getByRole("group", { name: "Thả cảm xúc" })).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/49-7-giu-tin-cam-xuc.png` });
});

function DateAt({ top }: { top: number | "bottom" }) {
  const [value, setValue] = useState<string>("");
  return (
    <Frame>
      <div className="relative h-screen bg-card">
        <div className="absolute left-10 w-[320px]" style={top === "bottom" ? { bottom: 24 } : { top }}>
          <DateField value={value} onChange={setValue} label="Ngày hạn" allow="any" />
        </div>
      </div>
    </Frame>
  );
}

for (const [name, top, height] of [
  ["h1-dau-man", 24, 800],
  ["h1-giua-man", 380, 800],
  ["h1-cuoi-man", "bottom", 800],
  ["h3-cua-so-thap-700", 330, 700],
] as const) {
  test(`${name} · the calendar is never cut off`, async () => {
    await page.viewport(1280, height);
    // In the full run the frame is still at the previous file's size when `viewport()` resolves;
    // the calendar then measures its room against a stale height. Wait until the frame really is
    // the size this test is about.
    await expect.poll(() => window.innerHeight).toBe(height);
    const screen = await render(<DateAt top={top} />);
    await userEvent.click(screen.getByRole("button", { name: /Ngày hạn/ }));
    const tuan = screen.getByRole("tab", { name: "Tuần" });
    await expect.element(tuan).toBeInTheDocument();
    const panel = (tuan.element() as HTMLElement).closest("[role='dialog']") as HTMLElement;
    const rect = panel.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(15);
    expect(rect.bottom).toBeLessThanOrEqual(height - 15);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  });
}

test("h5 · phone: the calendar is a sheet from the top, close always visible", async () => {
  await page.viewport(390, 844);
  const screen = await render(<DateAt top={600} />);
  await userEvent.click(screen.getByRole("button", { name: /Ngày hạn/ }));
  await expect.element(screen.getByRole("button", { name: "Đóng lịch" })).toBeInTheDocument();
  const close = screen.getByRole("button", { name: "Đóng lịch" }).element().getBoundingClientRect();
  expect(close.top).toBeGreaterThanOrEqual(0);
  expect(close.top).toBeLessThan(120);
  await page.screenshot({ path: `${OUT}/h5-lich-dien-thoai.png` });
});
