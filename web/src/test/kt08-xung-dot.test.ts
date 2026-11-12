import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { conflictMessage, isRecordConflict, recordConflictOf, RecordConflictError, toVietnameseHubError } from "@/lib/think-hub";

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("KT-08 · QA04-06 — xung đột khi cùng sửa một dòng bảng", () => {
  it("đọc DETAIL máy chủ thành lỗi xung đột có tên người sửa", () => {
    const conflict = recordConflictOf({
      message: "avora_think_hub_record_conflict",
      details: JSON.stringify({ updated_at: "2026-11-13T04:10:00.123456+00:00", by_id: "b", by_name: "Phòng Sản phẩm", by_me: false }),
    });
    expect(conflict).toBeInstanceOf(RecordConflictError);
    expect(isRecordConflict(conflict)).toBe(true);
    expect(conflict?.message).toBe("Dòng này vừa được Phòng Sản phẩm cập nhật.");
    // Microseconds kept exactly — "Vẫn lưu của tôi" sends this back and the server compares it as is.
    expect(conflict?.updatedAt).toBe("2026-11-13T04:10:00.123456+00:00");
  });

  it("không có tên / chính mình / lỗi khác", () => {
    expect(conflictMessage(null, false)).toBe("Dòng này vừa được người khác cập nhật.");
    expect(conflictMessage("  ", false)).toBe("Dòng này vừa được người khác cập nhật.");
    expect(conflictMessage("X", true)).toBe("Dòng này vừa được bạn cập nhật ở nơi khác.");
    expect(recordConflictOf({ message: "avora_think_hub_record_deleted", details: null })).toBeNull();
    expect(recordConflictOf({ message: "avora_think_hub_record_conflict", details: "không phải json" })).toBeNull();
    expect(toVietnameseHubError("P0001", "avora_think_hub_record_conflict")).toBe("Dòng này vừa được người khác cập nhật.");
  });

  it("mọi chỗ sửa Hạng mục trên bảng gửi phiên bản đã mở", () => {
    const hub = source("pages/ThinkHub.tsx");
    expect(hub).toMatch(/updateRecord\(editing\.id, patch, expected\)/);
    expect(hub).toMatch(/updateRecord\(editing\.id, split\.board, expected\)/);
    expect(hub).toMatch(/updateRecord\(record\.id, \{ status \}, \{ expectedUpdatedAt: record\.updatedAt \}\)/);
    expect(hub).toMatch(/updateRecord\(record\.id, apply\(record\), \{ expectedUpdatedAt: record\.updatedAt \}\)/);
    expect(source("components/projects/TablePeekSheet.tsx")).toMatch(/expectedUpdatedAt: options\?\.expectedUpdatedAt \?\? editing\.updatedAt/);
    expect(source("lib/think-hub.ts")).toMatch(/p_expected_updated_at: options\.expectedUpdatedAt/);
  });
});
