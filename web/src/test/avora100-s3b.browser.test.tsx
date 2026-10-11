import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-100 · S.3 (b) — Ghi chép thụt lề ít hơn: cây 10 px một cấp; trình soạn 12 px trên điện thoại. */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    const proxy: unknown = new Proxy({}, { get: (_t, key) => (key === "then" ? Promise.resolve({ data: rows, error: null }).then.bind(Promise.resolve({ data: rows, error: null })) : () => proxy) });
    return proxy;
  };
  return { supabase: { from: () => builder([]), rpc: () => builder([]), storage: { from: () => builder([]) }, channel: () => builder([]), removeChannel: () => undefined } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" }, session: null, isLoading: false }), useDisplayName: () => "Thiện" }));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { NotesPanel } from "@/components/notes/NotesPanel";
import { NotesTree } from "@/components/notes/NotesTree";
import { treeIndent } from "@/lib/notes-tree";
import { OPEN_FOLDERS_KEY, type Note, type NoteFolder } from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";

const OUT = "../../../docs/screens/2026-10-11";
const now = new Date().toISOString();
const folder = (id: string, parentId: string | null, name: string): NoteFolder => ({ id, parentId, name, isSystem: false, systemKey: null, color: null, position: 0, createdAt: now });
const LONG = "Bài giảng ngày 29/9 về chương ba sinh học"; // 40 ký tự
const deep: Note = {
  id: "n4",
  folderId: "f3",
  title: LONG,
  blocks: [
    { id: "b1", text: "Mở đầu", level: 0 },
    { id: "b2", text: "Khái niệm tế bào", level: 1 },
    { id: "b3", text: "Cấu trúc màng", level: 2 },
    { id: "b4", text: "Dòng ở cấp bốn vẫn phải còn đủ chỗ cho chữ ở khổ điện thoại 390", level: 3 },
  ],
  tags: [], pinnedAt: null, bookRecordId: null, bookTitle: null, deletedAt: null, createdAt: now, updatedAt: now,
};
const FOLDERS = [folder("f1", null, "Năm học 2026"), folder("f2", "f1", "Sinh học"), folder("f3", "f2", "Chương 3")];
const DATA: NotesData = (() => {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, mutateAsync: async () => undefined, isPending: false };
  return {
    userId: "me", folders: q(FOLDERS), notes: q([deep]), liveNotes: [deep], trashedNotes: [], attachments: q([]),
    urlOf: () => null, refresh: () => undefined, addFolder: m, move: m, rename: m, removeFolder: m, recolor: m, patch: m, removeAttachment: m,
  } as unknown as NotesData;
})();

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("mỗi cấp 10 px, lề gốc 4 px", () => {
  expect([0, 1, 2, 3].map(treeIndent)).toEqual([4, 14, 24, 34]);
});

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`cây: ghi chép tên 40 ký tự ở cấp 3 hiện đủ trong 2 dòng · ${w}`, async () => {
    await page.viewport(w, h);
    window.localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(["f1", "f2", "f3"]));
    await render(
      <Frame>
        <div style={{ width: w >= 768 ? 288 : w }}>
          <NotesTree data={DATA} activeNoteId={null} showTrash={false} onOpenNote={() => undefined} onNewNote={() => undefined} onOpenTrash={() => undefined} />
        </div>
      </Frame>,
    );
    await settle();
    const title = document.querySelector<HTMLElement>("[data-note-row='n4'] [data-note-title]");
    expect(title).not.toBeNull();
    if (title === null) return;
    expect(title.textContent).toBe(LONG);
    // Not cut: the whole name fits in at most two lines.
    expect(title.scrollHeight).toBeLessThanOrEqual(title.clientHeight + 1);
    expect(Math.round(title.getBoundingClientRect().height / 20)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `${OUT}/S3b-cay-ghi-chep-${w}.png` });
  });

  test(`trình soạn: dòng cấp 4 còn ≥ 75 % bề ngang · ${w}`, async () => {
    await page.viewport(w, h);
    await render(
      <Frame>
        <NotesPanel data={DATA} isWide={w >= 768} request={{ noteId: "n4" }} onRequestHandled={() => undefined} onCreateTask={() => undefined} onToBoard={() => undefined} onOpenBook={() => undefined} />
      </Frame>,
    );
    await settle(600);
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-note-blocks] > div"));
    const fourth = rows[3]?.querySelector("textarea");
    const container = document.querySelector<HTMLElement>("[data-note-blocks]");
    expect(fourth).toBeTruthy();
    const ratio = (fourth?.getBoundingClientRect().width ?? 0) / (container?.getBoundingClientRect().width ?? 1);
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    if (w < 768) expect(getComputedStyle(container as Element).getPropertyValue("--note-indent").trim()).toBe("12px");
    await page.screenshot({ path: `${OUT}/S3b-trinh-soan-4-cap-${w}.png` });
  });
}
