import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * AVORA-94B (ADR-062) — one set of navigation rules, run through the real signed-in shell
 * (RequireAuth: top bar, sidebar, tool-belt, Toàn bộ AVORA, history and scroll tracking) with a real
 * browser history, at 390×844 and 1440×900. Ghi chép is the real NotesPanel + NotesTree; the other
 * screens are thin stand-ins that use the same `‹` (BackButton / useBack) the real ones use.
 */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const done = Promise.resolve({ data: rows, error: null, count: 0 });
            return done.then.bind(done);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: () => builder([]),
      rpc: () => builder([]),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    session: { user: { id: "me" }, access_token: "x" },
    profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" },
    isLoading: false,
    isRecovering: false,
    signOut: async () => undefined,
  }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));
vi.mock("@/lib/use-device", () => ({
  useDeviceStatus: () => ({ status: undefined, isPending: false, refetch: () => undefined }),
  useMyDevices: () => ({ devices: [], isPending: false }),
  useInvalidateDevices: () => () => undefined,
}));
vi.mock("@/components/PinGate", () => ({
  PinGate: ({ children }: { children: ReactNode }) => <>{children}</>,
  PinReminderBanner: () => null,
}));
vi.mock("@/lib/day-open-api", () => ({
  fetchLastOpenedDate: async () => {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
  },
  recordOpenedDate: async () => undefined,
}));

import { RequireAuth } from "@/components/RequireAuth";
import { BackButton } from "@/components/nav/BackButton";
import { NotesPanel, type NotesRequest } from "@/components/notes/NotesPanel";
import { NotesTree } from "@/components/notes/NotesTree";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetNavHistory } from "@/lib/nav-history";
import { writeLeftPlace } from "@/lib/resume-place";
import type { Note, NoteFolder } from "@/lib/notes";
import type { NotesData } from "@/lib/use-notes";

const ORIGINAL_URL = window.location.href;
const now = new Date().toISOString();
const folder = (id: string, name: string): NoteFolder => ({ id, parentId: null, name, isSystem: false, systemKey: null, color: null, position: 0, createdAt: now });
const note = (id: string, folderId: string | null, title: string): Note => ({
  id, folderId, title, blocks: [{ id: `${id}b`, text: "Một dòng", level: 0 }], tags: [], pinnedAt: null,
  bookRecordId: null, bookTitle: null, deletedAt: null, createdAt: now, updatedAt: now,
});
const FOLDERS = [folder("f2", "Bài giảng 2026")];
const NOTES = [note("n4", "f2", "Bài giảng ngày 29/9"), note("n1", null, "Ý tưởng quà")];
const NOTES_DATA: NotesData = (() => {
  const q = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: () => undefined });
  const m = { mutate: () => undefined, mutateAsync: async () => undefined, isPending: false };
  return {
    userId: "me", folders: q(FOLDERS), notes: q(NOTES), liveNotes: NOTES, trashedNotes: [], attachments: q([]),
    urlOf: () => null, refresh: () => undefined, addFolder: m, move: m, rename: m, removeFolder: m, recolor: m, patch: m, removeAttachment: m,
  } as unknown as NotesData;
})();

function Where() {
  const location = useLocation();
  return <p data-testid="where" className="sr-only">{`${location.pathname}${location.search}`}</p>;
}
const where = (): string => document.querySelector('[data-testid="where"]')?.textContent ?? "";
const pathOf = (): string => where().split("?")[0] ?? "";
const params = (): URLSearchParams => new URLSearchParams(where().split("?")[1] ?? "");

function Tall({ children }: { children?: ReactNode }) {
  return (
    <div data-scroll-memory="" data-page="" className="min-h-0 flex-1 overflow-y-auto">
      {children}
      <div style={{ height: 3000 }} />
    </div>
  );
}

function Home() {
  return (
    <Tall>
      <Link to="/tin-nhan/j1?xem=ghi-chep&gc=n1">Mở ghi chép</Link>
      <Link to="/lien-he/c1">Mở liên hệ</Link>
    </Tall>
  );
}

function Tasks() {
  const navigate = useNavigate();
  return (
    <Tall>
      <button type="button" onClick={() => navigate("/tin-nhan/d1")}>Mở chat từ việc</button>
      <button type="button" onClick={() => navigate("/ke-hoach?bang=b1")}>Mở bảng từ việc</button>
    </Tall>
  );
}

function List() {
  const navigate = useNavigate();
  return (
    <Tall>
      {/* Same as Messages.handleSelectTab (AVORA-100 · C): Nhật ký is a step deeper (push); the other sections replace. */}
      <button type="button" onClick={() => navigate("/tin-nhan/j1")}>Ngăn Nhật ký</button>
      <button type="button" onClick={() => navigate("/tin-nhan?tab=nhom", { replace: true })}>Ngăn Nhóm</button>
      <button type="button" onClick={() => navigate("/tin-nhan?tab=du-an", { replace: true })}>Ngăn Dự án</button>
      <button type="button" onClick={() => navigate("/tin-nhan/d1")}>mở d1</button>
    </Tall>
  );
}

function Thread() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<NotesRequest | null>(null);
  const isWide = window.innerWidth >= 768;
  const parent = conversationId === "g1" ? { path: "/tin-nhan?tab=nhom", label: "Kết nối" } : { path: "/tin-nhan?tab=1-1", label: "Kết nối" };
  const tree = <NotesTree data={NOTES_DATA} activeNoteId={null} showTrash={false} onOpenNote={(item) => setRequest({ noteId: item.id })} onNewNote={() => undefined} onOpenTrash={() => undefined} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2">
        <BackButton parent={parent} />
        <span>{conversationId}</span>
        {/* Same as openDiaryView: a view inside the journal is a replace. */}
        <button type="button" onClick={() => navigate(`/tin-nhan/${conversationId}?xem=ghi-chep`, { replace: true })}>Ghi chép</button>
      </header>
      {searchParams.get("xem") === "ghi-chep" ? (
        <div className="flex min-h-0 flex-1">
          {isWide ? <div className="w-72">{tree}</div> : null}
          <div className="min-h-0 flex-1">
            <NotesPanel data={NOTES_DATA} isWide={isWide} request={request} onRequestHandled={() => setRequest(null)} onCreateTask={() => undefined} onToBoard={() => undefined} onOpenBook={() => undefined} tree={isWide ? undefined : tree} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Kế hoạch: opening a Bảng and a Hạng mục are steps deeper (push), as in ThinkHub. */
function Plan() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ke = searchParams.get("ke");
  const board = searchParams.get("bang");
  const base = ke === null ? "" : `ke=${ke}&`;
  return (
    <Tall>
      {board !== null ? <BackButton showLabel /> : null}
      {board === null ? <button type="button" onClick={() => navigate(`/ke-hoach?${base}bang=b1`)}>Mở bảng</button> : null}
      {board !== null && searchParams.get("hm") === null ? <button type="button" onClick={() => navigate(`/ke-hoach?${base}bang=b1&hm=h1`)}>Mở hạng mục</button> : null}
    </Tall>
  );
}

function Inner() {
  return (
    <div className="p-2">
      <BackButton showLabel />
    </div>
  );
}

function Overlays() {
  const [isDialog, setIsDialog] = useState<boolean>(false);
  const [isSheet, setIsSheet] = useState<boolean>(false);
  const [isAlert, setIsAlert] = useState<boolean>(false);
  return (
    <Tall>
      <button type="button" onClick={() => setIsDialog(true)}>Mở hộp</button>
      <button type="button" onClick={() => setIsSheet(true)}>Mở tấm</button>
      <button type="button" onClick={() => setIsAlert(true)}>Mở hỏi</button>
      <Dialog open={isDialog} onOpenChange={setIsDialog}>
        <DialogContent>
          <DialogTitle>Hộp thử</DialogTitle>
          <DialogDescription>Nội dung</DialogDescription>
        </DialogContent>
      </Dialog>
      <Sheet open={isSheet} onOpenChange={setIsSheet}>
        <SheetContent side="bottom">
          <SheetTitle>Tấm thử</SheetTitle>
          <SheetDescription>Nội dung</SheetDescription>
        </SheetContent>
      </Sheet>
      <AlertDialog open={isAlert} onOpenChange={setIsAlert}>
        <AlertDialogContent>
          <AlertDialogTitle>Hỏi thử</AlertDialogTitle>
          <AlertDialogAction>Đồng ý</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </Tall>
  );
}

function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/tong-quan" element={<Home />} />
              <Route path="/tin-nhan" element={<List />} />
              <Route path="/tin-nhan/:conversationId" element={<Thread />} />
              <Route path="/nhiem-vu" element={<Tasks />} />
              <Route path="/ke-hoach" element={<Plan />} />
              <Route path="/ket-sat" element={<Tall />} />
              <Route path="/cai-dat" element={<Overlays />} />
              <Route path="/du-an/:id" element={<Inner />} />
              <Route path="/lien-he/:id" element={<Inner />} />
            </Route>
          </Routes>
          <Where />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function start(path: string): Promise<void> {
  // Left here a minute ago: the phone's reopen rule (ADR-059) keeps this exact place.
  writeLeftPlace("me", { at: Date.now() - 60_000, path, scroll: 0 });
  window.history.replaceState(null, "", path);
  await render(<App />);
  await settle(500);
}

/** The `‹` of the screen on top (visible, not inside a closed bar). */
function backButton(): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>("[data-back]")].filter((element) => element.getBoundingClientRect().width > 0);
  const found = all[all.length - 1];
  if (found === undefined) throw new Error("no visible ‹");
  return found;
}

function visibleLogo(): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[data-logo]")].find((element) => element.getBoundingClientRect().width > 0);
  if (found === undefined) throw new Error("no visible logo");
  return found;
}

async function hold(element: HTMLElement, pointerType: "touch" | "mouse"): Promise<void> {
  const rect = element.getBoundingClientRect();
  const init: PointerEventInit = { bubbles: true, cancelable: true, pointerType, button: 0, isPrimary: true, pointerId: 9, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  await settle(650);
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** Waits a second and checks nothing moved on its own (cam kết: không gì tự chuyển màn). */
async function staysAt(expected: string): Promise<void> {
  await expect.poll(where).toBe(expected);
  await settle(1000);
  expect(where()).toBe(expected);
}

/** The visible way to a big tab: the phone's tool-belt or the computer's sidebar. */
function tabLink(to: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`a[href="${to}"]`)].find((element) => element.getBoundingClientRect().width > 0);
  if (found === undefined) throw new Error(`no visible tab ${to}`);
  return found;
}

const scroller = (): HTMLElement => document.querySelector<HTMLElement>("main [data-page]") as HTMLElement;

beforeEach(() => {
  resetNavHistory();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("avora.nav.hold-back-hint-seen.v2", "1");
});

afterEach(() => {
  window.history.replaceState(null, "", ORIGINAL_URL);
});

const SIZES = [
  [390, 844],
  [1440, 900],
] as const;

describe.each(SIZES)("AVORA-94B / 100 · %i×%i", (w, h) => {
  beforeEach(async () => {
    await page.viewport(w, h);
    await expect.poll(() => window.innerWidth).toBe(w);
  });

  it("N.1 · Kết nối › Nhật ký › Ghi chép › thư mục › ghi chép, `‹` lùi từng bước rồi về Kết nối › 1-1", { timeout: 60_000 }, async () => {
    await start("/tin-nhan?tab=1-1");
    await userEvent.click(page.getByRole("button", { name: "Ngăn Nhật ký" }));
    await staysAt("/tin-nhan/j1");
    await userEvent.click(page.getByRole("button", { name: "Ghi chép", exact: true }));
    await staysAt("/tin-nhan/j1?xem=ghi-chep");
    const folderButton = [...document.querySelectorAll<HTMLElement>("button[aria-expanded]")].find((element) => element.textContent?.includes("Bài giảng 2026"));
    folderButton?.click();
    await settle();
    const isPhone = w < 768;
    // A phone: the folder is a step (pushed). A computer: the tree is an outline, opening it is not a step.
    if (isPhone) await staysAt("/tin-nhan/j1?xem=ghi-chep&tm=f2");
    const noteButton = [...document.querySelectorAll<HTMLElement>("button")].find((element) => element.textContent?.includes("Bài giảng ngày 29/9"));
    noteButton?.click();
    await expect.poll(() => params().get("gc")).toBe("n4");
    await settle(1000);
    expect(params().get("gc")).toBe("n4");

    await userEvent.click(backButton());
    await expect.poll(() => params().get("gc")).toBeNull();
    if (isPhone) {
      await staysAt("/tin-nhan/j1?xem=ghi-chep&tm=f2");
      await userEvent.click(backButton());
      await staysAt("/tin-nhan/j1?xem=ghi-chep");
    } else {
      await staysAt("/tin-nhan/j1?xem=ghi-chep");
    }
    await userEvent.click(backButton());
    await staysAt("/tin-nhan?tab=1-1");
  });

  it("N.2 · mở thẳng Ghi chép của Nhật ký → `‹` → Kết nối › 1-1, đứng yên", async () => {
    await start("/tin-nhan/j1?xem=ghi-chep");
    await userEvent.click(backButton());
    await staysAt("/tin-nhan?tab=1-1");
  });

  it("N.3 · Avora Space → một ghi chép → `‹ Avora Space` → Avora Space", async () => {
    await start("/tong-quan");
    await userEvent.click(page.getByRole("link", { name: "Mở ghi chép" }));
    await expect.poll(pathOf).toBe("/tin-nhan/j1");
    expect(backButton().getAttribute("aria-label")).toMatch(/^Quay lại Avora Space/);
    await userEvent.click(backButton());
    await staysAt("/tong-quan");
  });

  it("N.4 · Nhiệm vụ (đã cuộn) → chat → `‹` → Nhiệm vụ, đúng chỗ cuộn", async () => {
    await start("/nhiem-vu");
    scroller().scrollTop = 600;
    scroller().dispatchEvent(new Event("scroll"));
    await settle();
    (document.querySelector("main [data-page] button") as HTMLButtonElement).click();
    await expect.poll(pathOf).toBe("/tin-nhan/d1");
    await userEvent.click(backButton());
    await expect.poll(where).toBe("/nhiem-vu");
    await expect.poll(() => Math.round(scroller().scrollTop)).toBe(600);
  });

  it.each([
    ["/tin-nhan/g1", "/tin-nhan?tab=nhom"],
    ["/du-an/p1", "/tin-nhan?tab=du-an"],
    ["/lien-he/c1", "/tin-nhan?tab=1-1"],
  ])("N.6 · mở thẳng %s → `‹` → %s, không bị mở lại", async (from, to) => {
    await start(from);
    await userEvent.click(backButton());
    await staysAt(to);
  });

  it("N.7 · Nhiệm vụ → A → vào một thẻ → `‹` → A → về Nhiệm vụ, đúng chỗ cuộn", async () => {
    await start("/nhiem-vu");
    scroller().scrollTop = 450;
    scroller().dispatchEvent(new Event("scroll"));
    await settle();
    await userEvent.click(visibleLogo());
    await expect.poll(where).toBe("/tong-quan");
    await userEvent.click(page.getByRole("link", { name: "Mở liên hệ" }));
    await expect.poll(where).toBe("/lien-he/c1");
    await userEvent.click(backButton());
    await expect.poll(where).toBe("/tong-quan");
    await userEvent.click(visibleLogo());
    await expect.poll(where).toBe("/nhiem-vu");
    await expect.poll(() => Math.round(scroller().scrollTop)).toBe(450);
  });

  it("N.8 · giữ logo A 450 ms → Toàn bộ AVORA; nhả tay không về Avora Space", async () => {
    await start("/nhiem-vu");
    await hold(visibleLogo(), w < 768 ? "touch" : "mouse");
    await expect.element(page.getByRole("navigation", { name: "Toàn bộ AVORA" })).toBeInTheDocument();
    await settle(600);
    expect(where()).toBe("/nhiem-vu");
  });

  it("N.10 · hộp / tấm / câu hỏi đang mở → nút lùi chỉ đóng nó, màn dưới không đổi", async () => {
    await start("/cai-dat");
    for (const [open, title] of [["Mở hộp", "Hộp thử"], ["Mở tấm", "Tấm thử"], ["Mở hỏi", "Hỏi thử"]] as const) {
      await userEvent.click(page.getByRole("button", { name: open }));
      await expect.element(page.getByText(title)).toBeInTheDocument();
      window.history.back();
      await expect.poll(() => document.body.textContent?.includes(title) ?? false).toBe(false);
      await settle(300);
      expect(where()).toBe("/cai-dat");
    }
  });

  it("N.9 (sửa) · trong chat 1-1 giữ `‹` → Kết nối › 1-1, không mở Toàn bộ AVORA", async () => {
    await start("/tin-nhan/d1");
    await hold(backButton(), w < 768 ? "touch" : "mouse");
    await staysAt("/tin-nhan?tab=1-1");
    expect(document.querySelector('nav[aria-label="Toàn bộ AVORA"]')).toBeNull();
  });

  it("N.5 · Kế hoạch kệ 4 → Bảng → Hạng mục → chạm `‹` ×2 → Bảng → kệ 4", async () => {
    await start("/ke-hoach?ke=4");
    await userEvent.click(page.getByRole("button", { name: "Mở bảng" }));
    await expect.poll(where).toBe("/ke-hoach?ke=4&bang=b1");
    await userEvent.click(page.getByRole("button", { name: "Mở hạng mục" }));
    await expect.poll(where).toBe("/ke-hoach?ke=4&bang=b1&hm=h1");
    await userEvent.click(backButton());
    await staysAt("/ke-hoach?ke=4&bang=b1");
    await userEvent.click(backButton());
    await staysAt("/ke-hoach?ke=4");
  });

  /** Tab Kết nối remembers Nhật ký › Ghi chép; Avora Space → Kết nối opens it straight away. */
  async function intoRememberedJournal(): Promise<void> {
    await start("/tong-quan");
    window.localStorage.setItem("avora.tab-memory.v1:me", JSON.stringify({ "/tin-nhan": { path: "/tin-nhan/j1?xem=ghi-chep", scroll: 0 } }));
    await userEvent.click(tabLink("/tin-nhan"));
    await expect.poll(where).toBe("/tin-nhan/j1?xem=ghi-chep");
  }

  it("N.13 · Kết nối nhớ Nhật ký › Ghi chép: Avora Space → Kết nối → chạm `‹` → Avora Space, nhãn `‹ Avora Space`", async () => {
    await intoRememberedJournal();
    expect(backButton().getAttribute("data-back-label")).toBe("Avora Space");
    await userEvent.click(backButton());
    await staysAt("/tong-quan");
  });

  it("N.14 + N.15 · như N.13 nhưng giữ `‹` → Kết nối › 1-1, đứng yên, `Về đầu Kết nối`; mở chat 1-1 → `‹` → Kết nối › 1-1", async () => {
    await intoRememberedJournal();
    await hold(backButton(), w < 768 ? "touch" : "mouse");
    await expect.element(page.getByText("Về đầu Kết nối")).toBeInTheDocument();
    await staysAt("/tin-nhan?tab=1-1");
    await userEvent.click(page.getByRole("button", { name: "mở d1" }));
    await expect.poll(pathOf).toBe("/tin-nhan/d1");
    await userEvent.click(backButton());
    await staysAt("/tin-nhan?tab=1-1");
  });

  it("N.16 · 1-1 → Nhật ký → Ghi chép → thư mục → ghi chép → giữ `‹` → 1-1; nút lùi trình duyệt → ra trước Kết nối", { timeout: 60_000 }, async () => {
    await start("/tong-quan");
    await userEvent.click(tabLink("/tin-nhan"));
    await expect.poll(where).toBe("/tin-nhan");
    await userEvent.click(page.getByRole("button", { name: "Ngăn Nhật ký" }));
    await expect.poll(where).toBe("/tin-nhan/j1");
    await userEvent.click(page.getByRole("button", { name: "Ghi chép", exact: true }));
    await expect.poll(where).toBe("/tin-nhan/j1?xem=ghi-chep");
    [...document.querySelectorAll<HTMLElement>("button[aria-expanded]")].find((element) => element.textContent?.includes("Bài giảng 2026"))?.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>("button")].find((element) => element.textContent?.includes("Bài giảng ngày 29/9"))?.click();
    await expect.poll(() => params().get("gc")).toBe("n4");
    await hold(backButton(), w < 768 ? "touch" : "mouse");
    await staysAt("/tin-nhan");
    window.history.back();
    await staysAt("/tong-quan");
  });

  it("N.17 · Nhiệm vụ → Bảng từ một việc → Hạng mục → giữ `‹` → Kế hoạch (kệ đã nhớ)", async () => {
    await start("/nhiem-vu");
    await userEvent.click(page.getByRole("button", { name: "Mở bảng từ việc" }));
    await expect.poll(where).toBe("/ke-hoach?bang=b1");
    await userEvent.click(page.getByRole("button", { name: "Mở hạng mục" }));
    await expect.poll(where).toBe("/ke-hoach?bang=b1&hm=h1");
    await hold(backButton(), w < 768 ? "touch" : "mouse");
    await staysAt("/ke-hoach");
  });

  it("N.18 · Kết nối 1-1 → Nhóm → Dự án → nút lùi trình duyệt → ra trước Kết nối", async () => {
    await start("/tong-quan");
    await userEvent.click(tabLink("/tin-nhan"));
    await expect.poll(where).toBe("/tin-nhan");
    await userEvent.click(page.getByRole("button", { name: "Ngăn Nhóm" }));
    await expect.poll(where).toBe("/tin-nhan?tab=nhom");
    await userEvent.click(page.getByRole("button", { name: "Ngăn Dự án" }));
    await expect.poll(where).toBe("/tin-nhan?tab=du-an");
    window.history.back();
    await staysAt("/tong-quan");
  });
});
