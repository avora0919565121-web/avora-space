import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RecordConflictError, type RecordPatch, type ThinkRecord } from "@/lib/think-hub";

const NEWER = "2026-11-13T02:00:00.000002+00:00";
const base: ThinkRecord = {
  id: "r1", tableId: "t1", ownerUserId: "a", title: "Đèn sảnh", status: "dang_lam", priority: "trung_binh", category: null,
  nextActionDate: null, remindAt: null, tags: [], notes: "ghi chú gốc", extensionFields: {}, projectId: null,
  createdAt: "2026-11-13T00:00:00.000000+00:00", updatedAt: "2026-11-13T01:00:00.000001+00:00", deletedAt: null, movedFrom: null,
};

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`KT-09 · QA06-01 (${width}): Vẫn lưu của tôi lưu cả phần gõ thêm khi khung đang mở`, async () => {
    await page.viewport(width, height);
    const calls: { patch: RecordPatch; expected?: string | null }[] = [];
    const onSave = vi.fn(async (patch: RecordPatch, options?: { expectedUpdatedAt?: string | null }) => {
      calls.push({ patch, expected: options?.expectedUpdatedAt });
      if (calls.length === 1) throw new RecordConflictError(NEWER, "Phòng Kỹ thuật", false);
    });
    const onOpenChange = vi.fn();
    const screen = await render(
      <RecordDialog open onOpenChange={onOpenChange} columns={[]} record={base} knownStatuses={[]} onSave={onSave} isWorking={false} onReloadRecord={async () => undefined} />,
    );
    const notes = screen.getByRole("textbox", { name: "Ghi chú" });
    await userEvent.fill(notes, "ghi chú QA r1");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect.element(screen.getByText("Dòng này vừa được Phòng Kỹ thuật cập nhật.")).toBeInTheDocument();
    await userEvent.fill(notes, "ghi chú QA r1 + phần gõ thêm sau khung");
    await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].expected).toBe(NEWER);
    expect(calls[1].patch.notes).toBe("ghi chú QA r1 + phần gõ thêm sau khung");
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
}
