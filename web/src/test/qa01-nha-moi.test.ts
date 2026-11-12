import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { vaultBoardLock, vaultBoardLocks, vaultZoneLockText } from "@/lib/avora-default-boards";
import { topSearchButtons } from "@/lib/chat-cache";
import { soonInsideSection } from "@/lib/features";
import { ownDisplayName } from "@/lib/initials";
import { MUTE_SCOPE_LABELS, MUTE_SCOPE_NOTES } from "@/lib/mute";
import { toolBeltTabOf } from "@/lib/navigation";
import { tabTarget } from "@/lib/tab-memory";
import { lockThenStatus, type VaultStatus } from "@/lib/vault-lock";
import { journalStepPath } from "@/lib/welcome";

/*
 * KT-04 · sửa lỗi báo cáo QA-01 (Nhà mới) — phần thuần, mỗi khối một mã lỗi.
 */

describe("QA01-01 · bước Bắt đầu mở đúng Nhật ký (ghi nhanh)", () => {
  it("có Nhật ký → mở thẳng view Nhật ký, không theo view dùng lần trước", () => {
    expect(journalStepPath("c1")).toBe("/tin-nhan/c1?xem=nhat-ky");
  });
  it("chưa có cuộc Nhật ký → Kết nối (người mới vào thẳng tab Nhật ký)", () => {
    expect(journalStepPath(null)).toBe("/tin-nhan");
  });
});

describe("QA01-02 · chạm lại tab Thư phòng về đầu Thư phòng (Đọc)", () => {
  it("đang ở Kế hoạch › Tổng quan, chạm lại → kệ 5 (Đọc), không phải kệ 2", () => {
    expect(tabTarget("/ke-hoach", "/ke-hoach", "qa01-u").path).toBe("/ke-hoach?ke=5");
    expect(tabTarget("/ke-hoach", "/ke-hoach/ke-sach/doc/b1", "qa01-u").path).toBe("/ke-hoach?ke=5");
  });
  it("các tab khác vẫn về gốc của mình", () => {
    expect(tabTarget("/nhiem-vu", "/nhiem-vu", "qa01-u").path).toBe("/nhiem-vu");
  });
});

describe("QA01-03 · bảng Tài chính ở Lập sẵn theo Tài chính, không theo khoá Két sắt", () => {
  it("chưa có mã: Tài chính mở, Giấy tờ / Tài sản vẫn đóng", () => {
    expect(vaultBoardLocks({ isVaultOpen: false, isFinanceOpen: true, hasKey: false })).toEqual({ finance: false, items: true });
  });
  it("có mã, đang khoá: cả hai đóng; đã mở và có khoá: cả hai mở", () => {
    expect(vaultBoardLocks({ isVaultOpen: false, isFinanceOpen: false, hasKey: true })).toEqual({ finance: true, items: true });
    expect(vaultBoardLocks({ isVaultOpen: true, isFinanceOpen: true, hasKey: true })).toEqual({ finance: false, items: false });
  });
  it("chưa có mã thì không bảo người dùng 'mở' — mời đặt mã, đúng ngăn", () => {
    expect(vaultBoardLock("assets", false)).toEqual({ text: "Chưa có mã · Đặt mã Két sắt để xem", action: "Đặt mã", to: "/ket-sat/tai-san" });
    expect(vaultBoardLock("expiring_docs", false).to).toBe("/ket-sat/tai-lieu");
    expect(vaultBoardLock("cashflow", true)).toEqual({ text: "Đang khoá · Mở Két sắt để xem", action: "Mở Két sắt", to: "/ket-sat" });
    expect(vaultZoneLockText(false)).not.toContain("Mở Két sắt");
    expect(vaultZoneLockText(true)).toBe("Đang khoá · Mở Két sắt để xem");
  });
});

describe("QA01-04 · Kết nối không có hai kính lúp giống nhau", () => {
  it("1-1, Nhóm, Dự án: chỉ ô tìm của danh sách (đã có 'trong toàn AVORA')", () => {
    for (const tab of ["direct", "group", "projects"] as const) expect(topSearchButtons(tab, false)).toEqual({ list: true, avora: false });
  });
  it("Nhật ký và tab Sắp có: chỉ Avora Search", () => {
    expect(topSearchButtons("journal", false)).toEqual({ list: false, avora: true });
    expect(topSearchButtons("email", true)).toEqual({ list: false, avora: true });
  });
});

describe("QA01-07 · Cài đặt › Thông báo nói tiếng Việt", () => {
  it("'Dự án', không còn 'Project'", () => {
    expect(MUTE_SCOPE_LABELS.project).toBe("Dự án");
    expect(MUTE_SCOPE_NOTES.project).toBe("Chỉ các dự án");
    for (const text of [...Object.values(MUTE_SCOPE_LABELS), ...Object.values(MUTE_SCOPE_NOTES)]) expect(text).not.toMatch(/Project/);
  });
});

describe("QA01-08 · lần nhìn đầu của Két sắt: khoá và đọc trạng thái cùng lúc", () => {
  const status: VaultStatus = {
    hasCode: true, hasData: true, unlocked: true, expiresAt: "2026-11-12T10:00:00Z", lockedUntil: null, remaining: 5,
    hasKeyring: true, deviceShare: true, deviceAllowed: true, deviceBound: true, hasMainDevice: true,
  };
  it("hai lời gọi bay song song, không chờ nhau", async () => {
    const order: string[] = [];
    let releaseLock: () => void = () => undefined;
    const lock = (): Promise<void> => { order.push("lock"); return new Promise<void>((resolve) => { releaseLock = resolve; }); };
    const read = async (): Promise<VaultStatus> => { order.push("status"); return status; };
    const done = lockThenStatus(lock, read, () => undefined);
    await Promise.resolve();
    expect(order).toEqual(["lock", "status"]);
    releaseLock();
    await done;
  });
  it("trạng thái 'đã khoá' (thường gặp) dùng ngay — một lượt đọc", async () => {
    const read = vi.fn(async (): Promise<VaultStatus> => ({ ...status, unlocked: false, expiresAt: null }));
    const result = await lockThenStatus(async () => undefined, read, () => undefined);
    expect(read).toHaveBeenCalledOnce();
    expect(result.unlocked).toBe(false);
  });
  it("đọc thấy 'đang mở' (có thể tới server trước lệnh khoá) → đọc lại sau khi khoá xong, server quyết", async () => {
    let locked = false;
    let releaseLock: () => void = () => undefined;
    const lock = (): Promise<void> => new Promise<void>((resolve) => { releaseLock = () => { locked = true; resolve(); }; });
    const read = vi.fn(async (): Promise<VaultStatus> => ({ ...status, unlocked: !locked, expiresAt: locked ? null : status.expiresAt }));
    const done = lockThenStatus(lock, read, () => undefined);
    await Promise.resolve();
    releaseLock();
    const result = await done;
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.unlocked).toBe(false);
  });
  it("khoá hỏng → ghi lỗi, lấy trạng thái như server trả (như trước)", async () => {
    const onError = vi.fn();
    const result = await lockThenStatus(async () => { throw new Error("mạng"); }, async () => status, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect(result).toEqual(status);
  });
});

describe("QA01-09 · tên mình không nháy 'Bạn' → tên thật", () => {
  it("đang tải hồ sơ → chuỗi rỗng; tải xong → tên, hoặc 'Bạn' khi chưa đặt", () => {
    expect(ownDisplayName(undefined, true)).toBe("");
    expect(ownDisplayName(null, false)).toBe("Bạn");
    expect(ownDisplayName("  ", false)).toBe("Bạn");
    expect(ownDisplayName("Người mới", true)).toBe("Người mới");
    expect(ownDisplayName("Người mới", false)).toBe("Người mới");
  });
});

describe("QA01-10 · Cài đặt trên điện thoại", () => {
  it("thanh dưới sáng Avora Space khi đang ở Cài đặt (mở từ ảnh đại diện)", () => {
    expect(toolBeltTabOf("/cai-dat")).toBe("/tong-quan");
    expect(toolBeltTabOf("/cai-dat/avora-ai")).toBe("/tong-quan");
    expect(toolBeltTabOf("/ket-sat/tai-lieu")).toBe("/ket-sat");
    expect(toolBeltTabOf("/dang-nhap")).toBeNull();
  });
  it("tab con 'Sắp có' của Cài đặt giữ khung (tiêu đề + dải tab), nơi khác vẫn thay cả trang", () => {
    expect(soonInsideSection("/cai-dat/avora-ai")).toBe(true);
    expect(soonInsideSection("/nhiem-vu")).toBe(false);
    expect(soonInsideSection("/ket-sat/mat-khau")).toBe(false);
  });
});
