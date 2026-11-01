import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Lỗi 01/11 · "ghi chú khi đọc sách tạo lặp 100 bản". Đọc sách › Ghi chép mở
 * `/tin-nhan/<id>?xem=ghi-chep&sach=…&trich=…`; NotesPanel đẩy `gc=<id mới>` dựa trên địa chỉ cũ
 * (còn `sach=`), Messages thấy `sach=` lần nữa và tạo ghi chú mới, cứ thế ~100 lần. Bộ dựng ở đây
 * cố ý KHÔNG có chốt một-lần của Messages, để chứng minh riêng NotesPanel không đẩy lại `sach=`.
 */
const saved = vi.hoisted(() => [] as string[]);
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    const proxy: unknown = new Proxy({}, {
      get: (_t, key) => {
        if (key === "then") {
          const done = Promise.resolve({ data: rows, error: null, count: 0 });
          return done.then.bind(done);
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  return { supabase: { from: () => builder([]), rpc: () => builder([]), storage: { from: () => builder([]) }, channel: () => builder([]), removeChannel: () => undefined } };
});
vi.mock("@/lib/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notes")>();
  return { ...actual, saveNote: async (note: { id: string }) => { saved.push(note.id); return note; } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" }, session: null, profile: null, isLoading: false }), useDisplayName: () => "Thiện" }));

import { NotesPanel, type NotesRequest } from "@/components/notes/NotesPanel";
import type { NoteFolder } from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";

const now = new Date().toISOString();
const READING: NoteFolder = { id: "fr", parentId: null, name: "Đang đọc", isSystem: true, systemKey: "reading", color: null, position: 0, createdAt: now };
const DATA: NotesData = (() => {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, mutateAsync: async () => undefined, isPending: false };
  return {
    userId: "me", folders: q([READING]), notes: q([]), liveNotes: [], trashedNotes: [], attachments: q([]),
    urlOf: () => null, refresh: () => undefined, addFolder: m, move: m, rename: m, removeFolder: m, recolor: m, patch: m, removeAttachment: m,
  } as unknown as NotesData;
})();

const seenGc = new Set<string>();
let addressChanges = 0;
function Watch() {
  const location = useLocation();
  useEffect(() => {
    addressChanges += 1;
    const gc = new URLSearchParams(location.search).get("gc");
    if (gc !== null) seenGc.add(gc);
  }, [location]);
  return null;
}

function Thread() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<NotesRequest | null>(null);
  // As Messages did before the fix: every time `sach=` is in the address, start a note.
  useEffect(() => {
    const book = searchParams.get("sach");
    if (book === null) return;
    setRequest({ book: { recordId: book, title: searchParams.get("ten") ?? "Sách", excerpt: { text: searchParams.get("trich") ?? "", where: null, locator: null } } });
    navigate(`/tin-nhan/${conversationId}?xem=ghi-chep`, { replace: true });
  }, [searchParams, conversationId, navigate]);
  return <NotesPanel data={DATA} isWide request={request} onRequestHandled={() => setRequest(null)} onCreateTask={() => undefined} onToBoard={() => undefined} onOpenBook={() => undefined} />;
}

function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/tin-nhan/:conversationId" element={<Thread />} />
        </Routes>
        <Watch />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const ORIGINAL_URL = window.location.href;
afterEach(() => window.history.replaceState(null, "", ORIGINAL_URL));

describe("Lỗi 01/11 · ghi chép từ sách", () => {
  it("một lần bấm Ghi chép → đúng một ghi chú, địa chỉ không còn sach=", async () => {
    const trich = encodeURIComponent("Thời gian là tiền bạc");
    window.history.replaceState(null, "", `/tin-nhan/j1?xem=ghi-chep&sach=b1&ten=${encodeURIComponent("Tám mươi ngày")}&trich=${trich}`);
    await render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seenGc.size).toBe(1);
    expect(new Set(saved).size).toBeLessThanOrEqual(1);
    expect(addressChanges).toBeLessThan(6);
    expect(window.location.search).not.toContain("sach=");
  });
});
