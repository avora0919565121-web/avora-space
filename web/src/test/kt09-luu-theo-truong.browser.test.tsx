import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

vi.mock("@/lib/use-contacts", () => ({ useContacts: () => ({ data: [] }) }));

import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RecordConflictError, type ColumnDef, type RecordPatch, type ThinkRecord } from "@/lib/think-hub";

const OPENED = "2026-11-13T01:00:00.000001+00:00";
const NEWER = "2026-11-13T02:00:00.000002+00:00";
const columns: ColumnDef[] = [
  { id: "c1", key: "han", label: "Hạn", type: "text" },
  { id: "c2", key: "noi", label: "Nơi", type: "text" },
];
const base: ThinkRecord = {
  id: "r1", tableId: "t1", ownerUserId: "a", title: "Đèn sảnh", status: "dang_lam", priority: "trung_binh", category: null,
  nextActionDate: null, remindAt: null, tags: [], notes: "ghi chú gốc", extensionFields: { han: "thứ hai", noi: "Q1" }, projectId: null,
  createdAt: "2026-11-13T00:00:00.000000+00:00", updatedAt: OPENED, deletedAt: null, movedFrom: null,
};

type Call = { patch: RecordPatch; expected?: string | null };
function harness(latest: ThinkRecord) {
  const calls: Call[] = [];
  const onSave = vi.fn(async (patch: RecordPatch, options?: { expectedUpdatedAt?: string | null }) => {
    calls.push({ patch, expected: options?.expectedUpdatedAt });
    if (calls.length === 1 && options?.expectedUpdatedAt === undefined) throw new RecordConflictError(NEWER, "Phòng Kỹ thuật", false);
  });
  const onOpenChange = vi.fn();
  const ui = (
    <RecordDialog open onOpenChange={onOpenChange} columns={columns} record={base} knownStatuses={[]} onSave={onSave} isWorking={false}
      onReloadRecord={async () => undefined} loadLatest={async () => latest} />
  );
  return { calls, onSave, onOpenChange, ui };
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`KT-09 · QA06-01 (${width}): Vẫn lưu của tôi lưu cả phần gõ thêm khi khung đang mở`, async () => {
    await page.viewport(width, height);
    const h = harness({ ...base, title: "Tiêu đề của KT", updatedAt: NEWER });
    const screen = await render(h.ui);
    const notes = screen.getByRole("textbox", { name: "Ghi chú" });
    await userEvent.fill(notes, "ghi chú QA r1");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect.element(screen.getByText("Dòng này vừa được Phòng Kỹ thuật cập nhật.")).toBeInTheDocument();
    await userEvent.fill(notes, "ghi chú QA r1 + phần gõ thêm sau khung");
    await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1].expected).toBe(NEWER);
    expect(h.calls[1].patch).toEqual({ notes: "ghi chú QA r1 + phần gõ thêm sau khung" });
    await vi.waitFor(() => expect(h.onOpenChange).toHaveBeenCalledWith(false));
  });

  test(`KT-09 · QA06-02 (${width}): chỉ sửa tiêu đề thì ghi chú người kia vừa sửa giữ nguyên`, async () => {
    await page.viewport(width, height);
    const h = harness({ ...base, notes: "ghi chú của KT", updatedAt: NEWER });
    const screen = await render(h.ui);
    await userEvent.fill(screen.getByRole("textbox", { name: "Tiêu đề" }), "Tiêu đề của QA");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(h.calls[0].patch).toEqual({ title: "Tiêu đề của QA" });
    await expect.element(screen.getByText("Ghi chú Phòng Kỹ thuật vừa sửa vẫn giữ nguyên. Chỉ lưu Tiêu đề bạn đã đổi.")).toBeInTheDocument();
    const box = document.querySelector<HTMLElement>("[data-record-conflict]");
    expect(box?.getBoundingClientRect().right ?? 0).toBeLessThanOrEqual(width);
    await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1].patch).toEqual({ title: "Tiêu đề của QA" });
    expect("notes" in h.calls[1].patch).toBe(false);
  });
}

test("KT-09: cả hai cùng sửa ghi chú — khung báo sẽ thay, Vẫn lưu của tôi lấy bản của người này", async () => {
  await page.viewport(390, 844);
  const h = harness({ ...base, notes: "ghi chú của KT", updatedAt: NEWER });
  const screen = await render(h.ui);
  await userEvent.fill(screen.getByRole("textbox", { name: "Ghi chú" }), "ghi chú của QA");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await expect.element(screen.getByText("Sẽ thay Ghi chú của Phòng Kỹ thuật bằng bản của bạn.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
  await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  expect(h.calls[1].patch).toEqual({ notes: "ghi chú của QA" });
});

test("KT-09: ô riêng — ghép từng ô với bản mới trên máy chủ", async () => {
  await page.viewport(1440, 900);
  const h = harness({ ...base, extensionFields: { han: "thứ sáu", noi: "Q1" }, updatedAt: NEWER });
  const screen = await render(h.ui);
  await userEvent.fill(screen.getByRole("textbox", { name: "Nơi" }), "Q7");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
  // Normal save: only the changed cell, the map from the opened version.
  expect(h.calls[0].patch).toEqual({ extensionFields: { han: "thứ hai", noi: "Q7" } });
  await expect.element(screen.getByText("Hạn Phòng Kỹ thuật vừa sửa vẫn giữ nguyên. Chỉ lưu Nơi bạn đã đổi.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
  await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  expect(h.calls[1].patch).toEqual({ extensionFields: { han: "thứ sáu", noi: "Q7" } });
});

test("KT-09: lưu khi không đổi gì thì không gửi gì", async () => {
  await page.viewport(390, 844);
  const h = harness(base);
  const screen = await render(h.ui);
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await vi.waitFor(() => expect(h.onOpenChange).toHaveBeenCalledWith(false));
  expect(h.calls).toHaveLength(0);
});
