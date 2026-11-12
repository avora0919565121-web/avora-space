import { describe, expect, it } from "vitest";

import { chunkUrlOf } from "@/lib/lazy-retry";
import { settingsPageTitle } from "@/lib/settings-groups";

describe("KT-08 · lỗi nhẹ", () => {
  it("QA05-03: đọc URL chunk trong lỗi tải module của trình duyệt", () => {
    expect(chunkUrlOf(new TypeError("Failed to fetch dynamically imported module: https://app.avorachat.com/assets/VaultAssets-B1x2.js"))).toBe("https://app.avorachat.com/assets/VaultAssets-B1x2.js");
    expect(chunkUrlOf(new TypeError("error loading dynamically imported module: http://127.0.0.1:4194/assets/A.js?retry=1"))).toBe("http://127.0.0.1:4194/assets/A.js");
    expect(chunkUrlOf(new Error("no url here"))).toBeNull();
    expect(chunkUrlOf("x")).toBeNull();
  });

  it("QA05-05: tên trang con của Cài đặt", () => {
    expect(settingsPageTitle("/cai-dat")).toBeNull();
    expect(settingsPageTitle("/cai-dat/")).toBeNull();
    expect(settingsPageTitle("/cai-dat/thong-bao")).toBe("Thông báo");
    expect(settingsPageTitle("/cai-dat/ho-so")).toBe("Hồ sơ");
    expect(settingsPageTitle("/cai-dat/thiet-lap")).toBe("Tuỳ chọn chung");
    expect(settingsPageTitle("/cai-dat/gop-y")).toBe("Góp ý cho Avora");
    expect(settingsPageTitle("/cai-dat/la")).toBeNull();
  });
});
