import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { isOnServer } from "@/lib/chat-cache";
import { changedFields, changedPatch, conflictSummary, type RecordDraft } from "@/lib/record-merge";
import type { ColumnDef } from "@/lib/think-hub";

const columns: ColumnDef[] = [
  { id: "c1", key: "han", label: "Hạn", type: "text" },
  { id: "c2", key: "so", label: "Số lượng", type: "number" },
];
const base: RecordDraft = {
  title: "Đèn sảnh", status: "dang_lam", priority: "trung_binh", category: "", nextActionDate: "", remindAt: "",
  tags: "a, b", notes: "gốc", extension: { han: "", so: "1" },
};

describe("KT-09 · QA06-02 — chỉ gửi trường đã đổi", () => {
  it("bỏ qua khác biệt khoảng trắng, nhận ra trường thật sự đổi", () => {
    expect(changedFields(base, { ...base, notes: " gốc ", tags: "a,b" }, columns)).toEqual([]);
    expect(changedFields(base, { ...base, title: "Đèn sảnh chính", extension: { han: "x", so: "1" } }, columns)).toEqual(["title", "ext:han"]);
  });

  it("patch chỉ có trường đã đổi; bảng ô ghép trên bản mới của máy chủ", () => {
    const mine: RecordDraft = { ...base, title: "Mới", extension: { han: "thứ hai", so: "1" } };
    const full = { title: "Mới", status: "dang_lam", notes: "gốc", extensionFields: { han: "thứ hai", so: 1 } };
    const patch = changedPatch(base, mine, full, columns, { han: null, so: 5, khac: "giữ" });
    expect(patch).toEqual({ title: "Mới", extensionFields: { han: "thứ hai", so: 5, khac: "giữ" } });
    expect(changedPatch(base, base, full, columns, {})).toEqual({});
  });

  it("khung nói rõ trường nào bị thay, trường nào giữ", () => {
    const latest: RecordDraft = { ...base, notes: "của KT", status: "xong" };
    const both = conflictSummary({ base, mine: { ...base, notes: "của QA" }, latest, columns, byName: "Phòng Kỹ thuật", byMe: false });
    expect(both.replaced).toEqual(["notes"]);
    expect(both.text).toContain("Sẽ thay Ghi chú của Phòng Kỹ thuật bằng bản của bạn.");
    expect(both.text).toContain("Trạng thái Phòng Kỹ thuật vừa sửa vẫn giữ nguyên.");
    const apart = conflictSummary({ base, mine: { ...base, title: "Tiêu đề QA" }, latest, columns, byName: "Phòng Kỹ thuật", byMe: false });
    expect(apart.replaced).toEqual([]);
    expect(conflictSummary({ base, mine: base, latest: null, columns, byName: "Phòng Kỹ thuật", byMe: false, loading: true }).text).toBe("Đang xem Phòng Kỹ thuật đã sửa ô nào…");
    expect(conflictSummary({ base, mine: base, latest: null, columns, byName: "Phòng Kỹ thuật", byMe: false }).text).toContain("Chưa xem được Phòng Kỹ thuật");
    expect(apart.text).toBe("Trạng thái và Ghi chú Phòng Kỹ thuật vừa sửa vẫn giữ nguyên. Chỉ lưu Tiêu đề bạn đã đổi.");
  });
});

describe("KT-09 · gợi ý QA-06 — không hỏi Đã xem cho tin chưa lên máy chủ", () => {
  it("tin trong hộp chờ có uuid thật vẫn chưa được tính là đã lên máy chủ", () => {
    const id = "3f1c2b9a-0000-4000-8000-000000000001";
    expect(isOnServer({ id })).toBe(true);
    expect(isOnServer({ id, pending: true })).toBe(false);
    expect(isOnServer({ id, outboxState: "waiting_network" })).toBe(false);
    expect(isOnServer({ id: `failed-${id}` })).toBe(false);
    expect(isOnServer(undefined)).toBe(false);
  });
});
