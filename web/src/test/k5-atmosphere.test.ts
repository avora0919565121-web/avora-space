import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { bigEmojiCount } from "@/lib/chat-cache";
import { atmosphereToneStyle, effectiveEffectsLevel } from "@/lib/atmosphere";
import { STICKERS, stickerById } from "@/lib/stickers";

const IDS = {
  thuong_ngay: ["miu.okela", "miu.doi_qua", "miu.cuoi_xiu", "cun.chuyen_nho", "mam.nghi_chut", "mam.ngu_ngon", "mam.binh_an", "mam.ngay_tot"],
  gia_dinh: ["cun.nho_qua", "cun.om", "ga.an_com", "miu.ve_nha", "cau.di_cho", "cau.xin_loi", "miu_cun.ban_than", "cun.sinh_nhat"],
  hoc_lam: ["miu.y_tuong", "ga.hieu_roi", "cun.dang_hoc", "cun.co_len", "ga.sap_tre", "ga_cau.cung_lam", "cau.thu_toi", "cau.cam_on"],
};

describe("K5 · 84 §4.2D stickers", () => {
  it("are exactly the 24 approved ids, 8 per pack, each a full drawing with the die-cut edge", () => {
    for (const [pack, ids] of Object.entries(IDS)) {
      expect(STICKERS.filter((s) => s.pack === pack).map((s) => s.id).sort()).toEqual([...ids].sort());
    }
    expect(STICKERS).toHaveLength(24);
    for (const sticker of STICKERS) {
      expect(sticker.body).toContain("url(#die)");
      expect(sticker.label.length).toBeGreaterThan(3);
    }
    expect(stickerById("abc.xyz")).toBeNull();
  });
});

describe("K5 · 84 §4.2B big emoji", () => {
  it("1–3 emoji alone are big; words or more emoji are not", () => {
    expect(bigEmojiCount("😂")).toBe(1);
    expect(bigEmojiCount("🎉🎉")).toBe(2);
    expect(bigEmojiCount("👍❤️🔥")).toBe(3);
    expect(bigEmojiCount("ok 😂")).toBe(0);
    expect(bigEmojiCount("😂😂😂😂")).toBe(0);
    expect(bigEmojiCount("123")).toBe(0);
  });
});

describe("K5 · 84 §4.1 effects level and colour", () => {
  it("defaults to Đầy đủ in a 1-1, Nhẹ in a group; reduced motion is always Tắt", () => {
    expect(effectiveEffectsLevel(null, "direct", false)).toBe("full");
    expect(effectiveEffectsLevel(null, "group", false)).toBe("light");
    expect(effectiveEffectsLevel("full", "group", true)).toBe("off");
    expect(effectiveEffectsLevel("off", "direct", false)).toBe("off");
  });
  it("a conversation colour only sets the 'your zone' variables, never --primary", () => {
    const style = atmosphereToneStyle("bien", false) ?? {};
    expect(Object.keys(style).sort()).toEqual(["--personal", "--personal-foreground", "--personal-soft", "--personal-soft-foreground"]);
    expect(atmosphereToneStyle(null, false)).toBeUndefined();
  });
});
