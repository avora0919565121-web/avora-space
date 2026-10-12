import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { fakeMessages, SAMPLE_QUERIES } from "@/spikes/e2ee/fake-data";
import { foldVi, InvertedIndex, linearSearch, tokenize } from "@/spikes/e2ee/normalize";
import { isSpikeAllowed } from "@/spikes/e2ee/gate";

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("AVORA-E0 · chuẩn hoá tiếng Việt cho tìm kiếm trên máy", () => {
  it("`co phai` khớp `có phải`, `đường` khớp `duong`", () => {
    expect(foldVi("có phải")).toBe("co phai");
    expect(foldVi("Đường")).toBe("duong");
    const texts = ["Có phải mai họp không?", "đường về nhà", "không liên quan"];
    const index = new InvertedIndex();
    texts.forEach((t, i) => index.add(i, t));
    expect(index.search("co phai")).toEqual([0]);
    expect(index.search("duong")).toEqual([1]);
    expect(index.search("đường")).toEqual([1]);
    expect(linearSearch(texts.map(foldVi), "co phai")).toEqual([0]);
    expect(linearSearch(texts.map(foldVi), "duong")).toEqual([1]);
  });

  it("khớp tiền tố và emoji là một từ riêng", () => {
    const index = new InvertedIndex();
    index.add(7, "Hợp đồng chiếu sáng 🙏");
    expect(index.search("hop d")).toEqual([7]);
    expect(index.search("🙏")).toEqual([7]);
    expect(tokenize("Đà Lạt ☕")).toEqual(["da", "lat", "☕"]);
  });

  it("dữ liệu giả cố định, có dấu, ~120 ký tự; 20 truy vấn mẫu", () => {
    const a = fakeMessages(200);
    expect(a).toEqual(fakeMessages(200));
    const avg = a.reduce((n, t) => n + t.length, 0) / a.length;
    expect(avg).toBeGreaterThan(100);
    expect(avg).toBeLessThan(150);
    expect(SAMPLE_QUERIES).toHaveLength(20);
  });
});

describe("AVORA-E0 · trang thử tắt mặc định, không lẫn vào mã sản phẩm", () => {
  it("chỉ mở khi VITE_E2EE_SPIKE=1, hoặc đã đăng nhập + ?spike=e2ee", () => {
    expect(isSpikeAllowed(undefined, false, "")).toBe(false);
    expect(isSpikeAllowed(undefined, true, "")).toBe(false);
    expect(isSpikeAllowed(undefined, false, "?spike=e2ee")).toBe(false);
    expect(isSpikeAllowed(undefined, true, "?spike=e2ee")).toBe(true);
    expect(isSpikeAllowed("1", false, "")).toBe(true);
  });

  it("không tệp sản phẩm nào import spikes/ (trừ route trong App.tsx); spike không gọi Supabase / fetch", () => {
    const importers = files(SRC)
      .filter((path) => !path.includes(`${join("src", "spikes")}`) && !path.includes(`${join("src", "test")}`))
      .filter((path) => /from\s+["'](@\/spikes|\.\/spikes)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(importers).toEqual(["App.tsx"]);
    for (const path of files(join(SRC, "spikes"))) {
      const text = readFileSync(path, "utf8");
      expect([relative(SRC, path), /integrations\/supabase|fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(text)]).toEqual([relative(SRC, path), false]);
    }
  });

  it("không dùng chữ \"mã hoá đầu-cuối\" trong giao diện trang thử", () => {
    for (const path of files(join(SRC, "spikes"))) expect(readFileSync(path, "utf8")).not.toMatch(/đầu[- ]cuối/i);
  });
});
