import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { describeDevice, feedbackPage, feedbackShotRejection, feedbackStatusLabel } from "@/lib/feedback";
import { inviteMessage, inviteUsage, normalizeInviteCode, type InviteCodeRow } from "@/lib/invites";
import { SETTINGS_TABS } from "@/lib/navigation";
import { QUICK_ACTIONS } from "@/lib/quick-actions";

const root = path.resolve(__dirname, "..");

describe("AVORA-100 · G.1 góp ý", () => {
  it("bỏ toàn bộ query (cả `tu`) khỏi trang đang đứng", () => {
    expect(feedbackPage("/tin-nhan/abc?tu=/nhiem-vu&q=bí mật")).toBe("/tin-nhan/abc");
    expect(feedbackPage("/ke-hoach#x")).toBe("/ke-hoach");
    expect(feedbackPage("")).toBe("/");
  });

  it("tên máy ngắn gọn, không gửi nguyên user-agent", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
    expect(describeDevice(iphone)).toBe("Safari · iOS 18.2");
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
    expect(describeDevice(android)).toBe("Chrome · Android 14");
  });

  it("người gửi thấy Đã gửi · Đang xem · Đã làm; đội thấy đủ bốn", () => {
    expect(["moi", "dang_xem", "da_lam"].map((s) => feedbackStatusLabel(s as "moi"))).toEqual(["Đã gửi", "Đang xem", "Đã làm"]);
    expect(feedbackStatusLabel("khong_lam", true)).toBe("Không làm");
  });

  it("chỉ nhận ảnh", () => {
    expect(feedbackShotRejection({ size: 1000, type: "application/pdf" })).not.toBeNull();
    expect(feedbackShotRejection({ size: 1000, type: "image/png" })).toBeNull();
  });

  it("lối vào: tab cuối của Cài đặt và một dòng trong menu bubble", () => {
    expect(SETTINGS_TABS[SETTINGS_TABS.length - 1]).toEqual({ to: "/cai-dat/gop-y", label: "Góp ý cho Avora" });
    expect(QUICK_ACTIONS[QUICK_ACTIONS.length - 1]?.id).toBe("feedback");
  });

  it("góp ý không bao giờ đọc tin nhắn hay dữ liệu trang", () => {
    const src = readFileSync(path.join(root, "lib/feedback.ts"), "utf8") + readFileSync(path.join(root, "components/feedback/FeedbackForm.tsx"), "utf8");
    expect(src).not.toMatch(/from\("messages"|innerText|document\.body|textContent/);
  });
});

describe("AVORA-100 · G.3 mã mời", () => {
  it("chuẩn hoá mã dán từ tin nhắn", () => {
    expect(normalizeInviteCode(" avr-us-01 ")).toBe("AVR-US-01");
  });

  it("hết lượt → `Mã mời đã dùng hết`", () => {
    expect(inviteMessage("used_up")).toBe("Mã mời đã dùng hết.");
  });

  it("đếm đã dùng theo nước / đợt", () => {
    const row = (code: string, country: InviteCodeRow["country"], wave: number, used: number, max: number): InviteCodeRow => ({
      code, country, wave, used, max_uses: max, partner: null, locale: "en", active: true, created_at: "",
    });
    expect(inviteUsage([row("A", "US", 1, 3, 10), row("B", "US", 1, 2, 5), row("C", "VN", 0, 1, 50)])).toEqual([
      { country: "VN", wave: 0, used: 1, max: 50, codes: 1 },
      { country: "US", wave: 1, used: 5, max: 15, codes: 2 },
    ]);
  });
});
