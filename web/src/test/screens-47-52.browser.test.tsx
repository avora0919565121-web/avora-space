import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/*
 * Screenshots for the AVORA-47 / 52 report, drawn with fixed fake data (no account, no network),
 * at a computer width and at 360px.
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

import { ConversationDiarySheet } from "@/components/chat/ConversationDiarySheet";
import { ConversationNotifySheet } from "@/components/chat/ConversationNotifySheet";
import { DiaryList } from "@/components/chat/DiaryViews";
import { FocusModeSheet } from "@/components/chat/FocusModeSheet";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { NotesTree } from "@/components/notes/NotesTree";
import { attachmentKeys } from "@/lib/attachments";
import type { DiaryLine } from "@/lib/chat";
import type { Note, NoteFolder } from "@/lib/notes";
import { taskKeys } from "@/lib/tasks";
import type { NotesData } from "@/lib/use-notes";

const OUT = "../../../docs/screens/2026-10-01";
const CONVERSATION = "c1";

function Frame({ children, seed }: { children: ReactNode; seed?: (client: QueryClient) => void }) {
  const [client] = useState(() => {
    const made = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed?.(made);
    return made;
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/tin-nhan/${CONVERSATION}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const now = new Date().toISOString();
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const folder = (id: string, name: string, parentId: string | null, position: number, isSystem = false): NoteFolder => ({
  id,
  parentId,
  name,
  isSystem,
  systemKey: isSystem ? "reading" : null,
  position,
  createdAt: now,
});
const folders: NoteFolder[] = [
  folder("f1", "Học tập", null, 0),
  folder("f1a", "Tiếng Anh", "f1", 0),
  folder("f1a1", "Ngữ pháp", "f1a", 0),
  folder("f1b", "Kế toán", "f1", 1),
  folder("f2", "Họp dự án", null, 1),
  folder("f3", "Ghi chép đọc sách", null, 99, true),
];
const note = (id: string, folderId: string | null, title: string, hours: number, pinned = false): Note => ({
  id,
  folderId,
  title,
  blocks: [{ id: `${id}b`, text: "Ba điều giữ lại", level: 0 }, { id: `${id}c`, text: "Một việc mỗi lúc", level: 1 }],
  tags: [],
  pinnedAt: pinned ? now : null,
  bookRecordId: null,
  bookTitle: null,
  deletedAt: null,
  createdAt: ago(hours),
  updatedAt: ago(hours),
});
const notes: Note[] = [
  note("n1", "f1a1", "Thì hiện tại hoàn thành", 2, true),
  note("n2", "f1a", "50 từ vựng tuần 3", 26),
  note("n3", "f1b", "Bút toán khấu hao", 72),
  note("n4", "f2", "Họp sửa mái — chốt ngân sách", 5),
  note("n5", "f3", "Atomic Habits — chương 2", 120),
  note("n6", null, "Ý tưởng quà sinh nhật", 9),
];

function fakeNotes(): NotesData {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, isPending: false };
  return {
    userId: "me",
    folders: q(folders),
    notes: q(notes),
    liveNotes: notes,
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

const counts = { journal: 42, notes: notes.length, files: 7, links: 3, sources: 2 };
const openTree = () => window.localStorage.setItem("avora.notes.openFolders", JSON.stringify(["f1", "f1a", "f1a1", "f2"]));

/** Sheets slide in; wait for the animation to finish before the picture. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 900));

beforeEach(() => {
  window.localStorage.clear();
});

test("52.A · Ghi chép tree in the Nhật ký column, pane = editor (computer)", async () => {
  await page.viewport(1280, 800);
  openTree();
  window.localStorage.setItem("avora.notes.place", JSON.stringify({ folderId: "f1a1", noteId: "n1" }));
  const data = fakeNotes();
  const screen = await render(
    <Frame>
      <div className="flex h-screen bg-background">
        <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-border bg-card pt-4">
          <DiaryList
            journalId={CONVERSATION}
            active="notes"
            counts={counts}
            isWide
            onPaste={() => undefined}
            isPasting={false}
            notesTree={<NotesTree data={data} activeNoteId="n1" showTrash={false} onOpenNote={() => undefined} onNewNote={() => undefined} onOpenTrash={() => undefined} />}
          />
        </aside>
        <main className="min-w-0 flex-1 bg-card">
          <NotesPanel data={data} isWide request={null} onRequestHandled={() => undefined} onCreateTask={() => undefined} onToBoard={() => undefined} onOpenBook={() => undefined} />
        </main>
      </div>
    </Frame>,
  );
  await expect.element(screen.getByRole("list", { name: "Cây ghi chép" }).getByText("Ngữ pháp")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Tiêu đề ghi chép")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/52A-ghi-chep-cay-may-tinh.png` });
});

test("52.A · Ghi chép tree as the list screen (phone 360)", async () => {
  await page.viewport(360, 720);
  openTree();
  const data = fakeNotes();
  const screen = await render(
    <Frame>
      <div className="h-screen bg-card">
        <NotesPanel
          data={data}
          isWide={false}
          request={null}
          onRequestHandled={() => undefined}
          onCreateTask={() => undefined}
          onToBoard={() => undefined}
          onOpenBook={() => undefined}
          tree={<NotesTree data={data} activeNoteId={null} showTrash={false} onOpenNote={() => undefined} onNewNote={() => undefined} onOpenTrash={() => undefined} />}
        />
      </div>
    </Frame>,
  );
  await expect.element(screen.getByText("Ngữ pháp")).toBeInTheDocument();
  await expect.element(screen.getByText("Chưa xếp")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/52A-ghi-chep-cay-360.png` });
  await userEvent.click(screen.getByRole("button", { name: "Thao tác thư mục Tiếng Anh" }));
  await expect.element(screen.getByText("Thư mục con")).toBeInTheDocument();
  await page.screenshot({ path: `${OUT}/52A-menu-thu-muc-360.png` });
});

const lines: DiaryLine[] = [
  { id: "m1", senderId: "k", content: "Báo giá mái tôn: https://maiton.vn/bao-gia", createdAt: ago(2) },
  { id: "m2", senderId: "me", content: "Mai 7h họp nhé", createdAt: ago(26) },
  { id: "m3", senderId: "k", content: "Bản vẽ ở https://drive.google.com/x", createdAt: ago(24 * 4) },
  { id: "m4", senderId: "me", content: "Ok anh", createdAt: ago(24 * 9) },
];
const seedDiary = (client: QueryClient): void => {
  client.setQueryData(["chat", "conversation-diary", CONVERSATION], lines);
  client.setQueryData(attachmentKeys.thread(CONVERSATION), []);
  client.setQueryData(taskKeys.list, []);
};

function Diary() {
  return (
    <Frame seed={seedDiary}>
      <ConversationDiarySheet
        open
        conversationId={CONVERSATION}
        title="Nhóm Sửa mái nhà thờ"
        stacked={{ backLabel: "Nhóm Sửa mái nhà thờ", onBack: () => undefined, onCloseAll: () => undefined }}
        urlOf={() => null}
        nameOf={(id) => (id === "me" ? "Bạn" : "Anh Khoa")}
        onJumpToMessage={() => undefined}
        onOpenTask={() => undefined}
      />
    </Frame>
  );
}

test("52.B · Nhật ký trò chuyện (computer)", async () => {
  await page.viewport(1280, 800);
  const screen = await render(<Diary />);
  await expect.element(screen.getByText("Theo ngày")).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/52B-nhat-ky-tro-chuyen-may-tinh.png` });
});

test("52.B · Nhật ký trò chuyện (phone 360) + Liên kết", async () => {
  await page.viewport(360, 720);
  const screen = await render(<Diary />);
  await expect.element(screen.getByText("Theo ngày")).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/52B-nhat-ky-tro-chuyen-360.png` });
  await userEvent.click(screen.getByRole("tab", { name: /Liên kết/ }));
  await expect.element(screen.getByText(/maiton\.vn/).first()).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/52B-lien-ket-360.png` });
});

function Stacked() {
  return (
    <Frame>
      <ConversationNotifySheet
        open
        conversationId={CONVERSATION}
        title="Nhóm Sửa mái nhà thờ"
        stacked={{ backLabel: "Nhóm Sửa mái nhà thờ", onBack: () => undefined, onCloseAll: () => undefined }}
      />
    </Frame>
  );
}

test("52.C · stacked sheet over ⋯: ‹ name + ✕ (computer)", async () => {
  await page.viewport(1280, 800);
  const screen = await render(<Stacked />);
  await expect.element(screen.getByText("Nhóm Sửa mái nhà thờ").first()).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/52C-tam-chong-may-tinh.png` });
});

test("52.C · stacked sheet over ⋯ (phone 360)", async () => {
  await page.viewport(360, 720);
  const screen = await render(<Stacked />);
  await expect.element(screen.getByText("Nhóm Sửa mái nhà thờ").first()).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/52C-tam-chong-360.png` });
});

function Focus() {
  return (
    <Frame>
      <FocusModeSheet open onOpenChange={() => undefined} activeMode={null} onStart={() => undefined} onStop={() => undefined} />
    </Frame>
  );
}

test("47.C · Chế độ tập trung (computer)", async () => {
  await page.viewport(1280, 800);
  const screen = await render(<Focus />);
  await expect.element(screen.getByText("Chế độ tập trung")).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/47C-che-do-tap-trung-may-tinh.png` });
});

test("47.C · Chế độ tập trung (phone 360)", async () => {
  await page.viewport(360, 720);
  const screen = await render(<Focus />);
  await expect.element(screen.getByText("Chế độ tập trung")).toBeInTheDocument();
  await settle();
  await page.screenshot({ path: `${OUT}/47C-che-do-tap-trung-360.png` });
});
