import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { tabForOpenedThread, tabOfKind, type ConversationKind, type MessageTab } from "@/lib/chat";

/**
 * Mirrors the tab ↔ thread wiring of Messages.tsx (AVORA 32, Nhóm A): a tab tap clears the thread
 * from the URL (or opens the journal), while opening a thread by link moves the tab. The bug was a
 * sync effect undoing the tap for the one render in which the router still reported the old thread.
 */
const THREADS: { id: string; kind: ConversationKind }[] = [
  { id: "j1", kind: "personal" },
  { id: "d1", kind: "direct" },
  { id: "g1", kind: "group" },
];
const TABS: { id: MessageTab; label: string }[] = [
  { id: "journal", label: "Nhật ký" },
  { id: "direct", label: "1-1" },
  { id: "group", label: "Nhóm" },
  { id: "projects", label: "Dự án" },
];

function Inbox() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<MessageTab>("direct");
  const active = useMemo(() => THREADS.find((item) => item.id === conversationId), [conversationId]);

  const handleSelectTab = useCallback(
    (tab: MessageTab): void => {
      setActiveTab(tab);
      if (tab === "projects") return;
      if (tab !== "journal") {
        navigate("/tin-nhan");
        return;
      }
      navigate("/tin-nhan/j1", { replace: conversationId === undefined });
    },
    [navigate, conversationId],
  );

  const syncedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId === undefined) {
      syncedThreadRef.current = null;
      return;
    }
    if (!active) return;
    const tab = tabForOpenedThread({ conversationId: active.id, kind: active.kind }, syncedThreadRef.current, activeTab);
    syncedThreadRef.current = active.id;
    if (tab !== null) setActiveTab(tab);
  }, [conversationId, active, activeTab]);

  return (
    <div>
      <p data-testid="tab">{activeTab}</p>
      <p data-testid="thread">{conversationId ?? "none"}</p>
      {TABS.map((tab) => (
        <button key={tab.id} type="button" onClick={() => handleSelectTab(tab.id)}>
          {tab.label}
        </button>
      ))}
      {THREADS.map((thread) => (
        <button key={thread.id} type="button" onClick={() => navigate(`/tin-nhan/${thread.id}`)}>
          {`mở ${thread.id}`}
        </button>
      ))}
    </div>
  );
}

function renderInbox(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/tin-nhan" element={<Inbox />} />
        <Route path="/tin-nhan/:conversationId" element={<Inbox />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const thread of THREADS) {
  for (const target of TABS) {
    if (target.id === tabOfKind(thread.kind)) continue;
    test(`one tap switches from an open ${thread.kind} thread to ${target.label}`, async () => {
      const screen = await renderInbox(`/tin-nhan/${thread.id}`);
      await expect.element(screen.getByTestId("tab")).toHaveTextContent(tabOfKind(thread.kind));

      await userEvent.click(screen.getByRole("button", { name: target.label, exact: true }));
      await pause(80);
      await expect.element(screen.getByTestId("tab")).toHaveTextContent(target.id);
    });
  }
}

test("opening a thread by link still lands on that thread's tab", async () => {
  const screen = await renderInbox("/tin-nhan");
  await userEvent.click(screen.getByRole("button", { name: "Nhóm", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "mở d1" }));
  await expect.element(screen.getByTestId("tab")).toHaveTextContent("direct");
  await userEvent.click(screen.getByRole("button", { name: "mở j1" }));
  await expect.element(screen.getByTestId("tab")).toHaveTextContent("journal");
});
