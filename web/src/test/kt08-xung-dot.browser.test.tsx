import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { RecordConflictError, type RecordPatch, type ThinkRecord } from "@/lib/think-hub";

const base: ThinkRecord = {
  id: "r1", tableId: "t1", ownerUserId: "a", title: "Đèn sảnh", status: "dang_lam", priority: "trung_binh", category: null,
  nextActionDate: null, remindAt: null, tags: [], notes: "bản gốc", extensionFields: {}, projectId: null,
  createdAt: "2026-11-13T00:00:00.000000+00:00", updatedAt: "2026-11-13T01:00:00.000001+00:00", deletedAt: null, movedFrom: null,
};

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`KT-08 · QA04-06 (${width}): lưu sau bị báo "vừa được … cập nhật", Vẫn lưu của tôi gửi bản mới`, async () => {
    await page.viewport(width, height);
    const calls: { patch: RecordPatch; expected?: string | null }[] = [];
    const onSave = vi.fn(async (patch: RecordPatch, options?: { expectedUpdatedAt?: string | null }) => {
      calls.push({ patch, expected: options?.expectedUpdatedAt });
      if (calls.length === 1) throw new RecordConflictError("2026-11-13T02:00:00.000002+00:00", "Phòng Sản phẩm", false);
    });
    const onOpenChange = vi.fn();
    const screen = await render(
      <RecordDialog open onOpenChange={onOpenChange} columns={[]} record={base} knownStatuses={[]} onSave={onSave} isWorking={false} onReloadRecord={async () => undefined} />,
    );
    await userEvent.fill(screen.getByRole("textbox", { name: "Tiêu đề" }), "Đèn sảnh chính");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await expect.element(screen.getByText("Dòng này vừa được Phòng Sản phẩm cập nhật.")).toBeInTheDocument();
    // Nothing lost: the form still holds what was typed, the dialog stays open.
    await expect.element(screen.getByRole("textbox", { name: "Tiêu đề" })).toHaveValue("Đèn sảnh chính");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const banner = document.querySelector<HTMLElement>("[data-record-conflict]");
    expect(banner?.getBoundingClientRect().right ?? 0).toBeLessThanOrEqual(width);
    await userEvent.click(screen.getByRole("button", { name: "Vẫn lưu của tôi" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].expected).toBe("2026-11-13T02:00:00.000002+00:00");
    expect(calls[1].patch.title).toBe("Đèn sảnh chính");
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
}

test("KT-08 · QA04-06: Xem bản mới nạp dòng hiện tại vào form", async () => {
  await page.viewport(1440, 900);
  let record: ThinkRecord = base;
  const reload = vi.fn(async () => undefined);
  const onSave = vi.fn(async () => {
    throw new RecordConflictError("2026-11-13T02:00:00+00:00", null, true);
  });
  const screen = await render(
    <RecordDialog open onOpenChange={() => undefined} columns={[]} record={record} knownStatuses={[]} onSave={onSave} isWorking={false} onReloadRecord={reload} />,
  );
  await userEvent.fill(screen.getByRole("textbox", { name: "Tiêu đề" }), "Bản của tôi");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await expect.element(screen.getByText("Dòng này vừa được bạn cập nhật ở nơi khác.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Xem bản mới" }));
  expect(reload).toHaveBeenCalledTimes(1);
  record = { ...base, title: "Bản mới của người khác", updatedAt: "2026-11-13T02:00:00+00:00" };
  await screen.rerender(
    <RecordDialog open onOpenChange={() => undefined} columns={[]} record={record} knownStatuses={[]} onSave={onSave} isWorking={false} onReloadRecord={reload} />,
  );
  await expect.element(screen.getByRole("textbox", { name: "Tiêu đề" })).toHaveValue("Bản mới của người khác");
  expect(document.querySelector("[data-record-conflict]")).toBeNull();
});
