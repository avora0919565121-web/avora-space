import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const builder = (): unknown => {
    const proxy: unknown = new Proxy({}, { get: (_t, key) => (key === "then" ? (r: (v: unknown) => void) => r({ data: [], error: null }) : () => proxy) });
    return proxy;
  };
  return { supabase: { from: builder, rpc: builder, channel: builder, removeChannel: () => undefined, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
const AUTH = { user: { id: "me" }, session: null, isLoading: false };
vi.mock("@/lib/auth", () => ({ useAuth: () => AUTH, useDisplayName: () => "Thiện" }));

import { DefaultBoardsGroup, OpportunityBoardBar } from "@/components/think-hub/OpportunityBoard";
import { KanbanView } from "@/components/think-hub/KanbanView";
import { TableView, writePhoneMode } from "@/components/think-hub/TableView";
import type { OpportunityBoardRow } from "@/lib/opportunities";
import { syncColumnDefs, withSyncValues } from "@/lib/opportunity-board";
import type { ColumnDef, ThinkRecord, ThinkTable } from "@/lib/think-hub";

const OUT = "../../../docs/screens/2026-10-02";
const now = "2026-10-02T03:00:00Z";
const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();

const STATUS = [
  { key: "lead", label: "Lead" },
  { key: "tiem_nang", label: "Tiềm năng" },
  { key: "dang_cham_soc", label: "Đang chăm sóc" },
  { key: "doi_tac", label: "Đối tác" },
  { key: "khong_thanh", label: "Không thành" },
];
const OWN: ColumnDef[] = [{ id: "c-uu", key: "uu_tien", label: "Ưu tiên riêng", type: "text" }];
const BOARD = { id: "sb", name: "Danh bạ | Danh sách cơ hội", ownerUserId: "me", syncSource: "contact_opportunities", syncHidden: [], columns: OWN, statusOptions: STATUS, mobileColumns: ["sync_value", "sync_next_date"], parentRecordId: null, depth: 1 } as unknown as ThinkTable;
const SUB = { id: "sub1", name: "Hoạt động", ownerUserId: "me", columns: [{ id: "k", key: "ket_qua", label: "Kết quả", type: "text" }], statusOptions: null, mobileColumns: ["ket_qua"], parentRecordId: "r1", depth: 2 } as unknown as ThinkTable;

const rec = (id: string, title: string, status: string, extra: Partial<ThinkRecord> = {}): ThinkRecord => ({
  id, tableId: "sb", ownerUserId: "me", title, status, priority: "trung_binh", category: null, nextActionDate: null, remindAt: null, tags: [], notes: null,
  extensionFields: {}, projectId: null, createdAt: now, updatedAt: now, deletedAt: null, movedFrom: null, opportunityId: `o-${id}`, ...extra,
});
const RECORDS = [
  rec("r1", "Anam Cam Ranh — villa 12 căn", "dang_cham_soc", { extensionFields: { uu_tien: "Cao" } }),
  rec("r2", "Hoiana — gói nội thất", "tiem_nang"),
  rec("r3", "Sunbay Park — tư vấn", "lead"),
  rec("r4", "Novotel Phú Quốc", "doi_tac"),
];
const person = (name: string, phone: string, email: string, employer: string | null): OpportunityBoardRow["contact"] => ({
  name, phone, email, contactType: employer === null ? "business" : "person", employerName: employer, representative: null, industry: null, address: null, taxCode: null, relationship: null, note: null, needsDetails: false,
});
const ROWS: OpportunityBoardRow[] = [
  { id: "o-r1", contactId: "c1", title: "", stage: "dang_cham_soc", estimatedValue: 1_250_000_000, nextActionDate: "2026-10-06", nextActionNote: "Gửi báo giá đợt 2", lastContactAt: daysAgo(1), conversationId: null, removedAt: null, contact: person("Anh Minh", "0903 112 233", "minh@anam.vn", "Anam Group") },
  { id: "o-r2", contactId: "c2", title: "", stage: "tiem_nang", estimatedValue: 480_000_000, nextActionDate: "2026-10-09", nextActionNote: "Hẹn xem mẫu", lastContactAt: daysAgo(4), conversationId: null, removedAt: null, contact: person("Chị Lan", "0912 445 667", "lan@hoiana.vn", "Hoiana Resort") },
  { id: "o-r3", contactId: "c3", title: "", stage: "lead", estimatedValue: 300_000_000, nextActionDate: null, nextActionNote: "Gọi lần đầu", lastContactAt: null, conversationId: null, removedAt: null, contact: person("Sunbay Park", "0258 3 777 888", "info@sunbay.vn", null) },
  { id: "o-r4", contactId: "c4", title: "", stage: "doi_tac", estimatedValue: 2_100_000_000, nextActionDate: null, nextActionNote: null, lastContactAt: daysAgo(10), conversationId: null, removedAt: null, contact: person("Anh Quân", "0988 001 002", "quan@novotel.vn", "Accor") },
];
const SUB_RECORDS: ThinkRecord[] = [
  { ...rec("s1", "Gặp tại công trình", "xong"), tableId: "sub1", opportunityId: null, extensionFields: { ket_qua: "Chốt 8 căn" } },
  { ...rec("s2", "Gửi bản vẽ", "dang_lam"), tableId: "sub1", opportunityId: null, extensionFields: { ket_qua: "Chờ duyệt" } },
];

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div className="paper min-h-[100dvh]">{children}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function viewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerHeight).toBe(height);
}

const shown = withSyncValues(RECORDS, ROWS, () => "", (id) => (id === "r1" ? 3 : 0));
const columns = [...syncColumnDefs(BOARD), ...OWN];

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
  test(`72 · bảng đầy đủ trong lưới ${w}x${h}: 🔗, bảng con ▸, dòng tổng`, async () => {
    // Open sub-tables are remembered per device; start each size closed so the click opens it.
    window.localStorage.removeItem("avora.subtables-open");
    window.sessionStorage.removeItem("avora.subtables-open");
    writePhoneMode("sb", "table");
    await viewport(w, h);
    const screen = await render(
      <Frame>
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8">
          {w >= 1000 ? <DefaultBoardsGroup boards={[BOARD]} activeId="sb" onOpen={() => undefined} /> : null}
          <h2 className="mt-3 text-[21px] font-semibold tracking-tight">Danh bạ | Danh sách cơ hội</h2>
          <OpportunityBoardBar chip="all" onChip={() => undefined} records={shown} isEmpty={false} onNew={() => undefined} />
          <TableView
            tableId="sb"
            records={shown}
            columns={columns}
            onOpenRecord={() => undefined}
            today="2026-10-02"
            forcedMode="table"
            taskCountByRecord={new Map([["r1", 3]])}
            subTablesFor={(id) => (id === "r1" ? [SUB] : [])}
            renderSubTable={() => (
              <TableView tableId="sub1" records={SUB_RECORDS} columns={SUB.columns} onOpenRecord={() => undefined} today="2026-10-02" forcedMode="table" depth={2} isNested />
            )}
          />
        </div>
      </Frame>,
    );
    // Synced columns carry 🔗; the board's own column does not.
    const heads = [...document.querySelectorAll("[role=columnheader], th")].map((el) => el.textContent ?? "");
    expect(heads.some((t) => t.includes("🔗 Giá trị ước tính"))).toBe(true);
    expect(heads.some((t) => t.includes("Ưu tiên riêng") && !t.includes("🔗"))).toBe(true);
    expect(document.querySelector("[data-opportunity-total]")?.getAttribute("data-opportunity-total")).toBe("4130000000");
    void screen;
    const toggle = document.querySelector('[data-subtable-toggle="r1"]') as HTMLElement | null;
    expect(toggle).not.toBeNull();
    (toggle as HTMLElement).click();
    await expect.poll(() => document.querySelector('[data-subtable-of="r1"]') !== null).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `${OUT}/72-bang-luoi-day-du-${w}.png` });
  });
}

test("72 · Theo trạng thái: kéo thẻ sang cột khác đổi giai đoạn", async () => {
  await viewport(1280, 800);
  const moves: [string, string][] = [];
  await render(
    <Frame>
      <div className="px-8 py-4">
        <h2 className="text-[21px] font-semibold">Danh bạ | Danh sách cơ hội · Theo trạng thái</h2>
        <KanbanView records={shown} onOpenRecord={() => undefined} today="2026-10-02" statusOptions={STATUS} onMoveRecord={(r, s) => moves.push([r.id, s])} />
      </div>
    </Frame>,
  );
  const card = document.querySelector('[data-record-id="r3"]') as HTMLElement;
  const target = document.querySelector('[data-kanban-column="tiem_nang"]') as HTMLElement;
  expect(card.getAttribute("draggable")).toBe("true");
  const data = new DataTransfer();
  card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `${OUT}/72-keo-tha-giai-doan-1280.png` });
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  expect(moves).toEqual([["r3", "tiem_nang"]]);
  // Dropping on its own column changes nothing.
  const own = document.querySelector('[data-kanban-column="doi_tac"]') as HTMLElement;
  const again = new DataTransfer();
  (document.querySelector('[data-record-id="r4"]') as HTMLElement).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: again }));
  own.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: again }));
  expect(moves).toHaveLength(1);
});
