import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { borrowKeyOf, borrowLink, catalogLink, catalogRefOf, coverUrl, sourceLabel, sourceLine } from "@/lib/book-catalog";
import { bannedBookHosts, isBannedBookLink, lastPublicDeathYear } from "@/lib/book-sources";
import { FINISHED_PERCENT, MAX_ON_DEVICE } from "@/lib/reading-state";
import { PRIVACY } from "@/lib/policy-content";

/*
 * AVORA-103 · KHỐI 3A — Nguồn sách chính trực · Open Library · bìa · tối đa 5 cuốn.
 */
const WEB_SRC = join(__dirname, "..");
const REPO = join(WEB_SRC, "..", "..");

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".temp") return [];
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

describe("103.1 · không tên miền sách lậu nào trong mã nguồn hay dữ liệu", () => {
  it("danh sách cấm có đủ tên (đọc ngược lại được)", () => {
    const hosts = bannedBookHosts();
    expect(hosts.length).toBeGreaterThanOrEqual(15);
    for (const host of hosts) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,4}$/);
  });

  it("web/src, supabase/functions, migrations, seed, docs: 0 kết quả", () => {
    const hosts = bannedBookHosts();
    const scanned = [
      ...files(WEB_SRC, /\.(ts|tsx|css|json)$/),
      ...files(join(REPO, "supabase", "functions"), /\.(ts|json)$/),
      ...files(join(REPO, "supabase", "migrations"), /\.sql$/),
      ...files(join(REPO, "supabase", "seed"), /\.csv$/),
      ...files(join(REPO, "supabase", "tests"), /\.sql$/),
      join(REPO, "ADR.md"),
      join(REPO, "DESIGN.md"),
    ];
    expect(scanned.length).toBeGreaterThan(300);
    const hits = scanned.flatMap((file) => {
      const text = readFileSync(file, "utf8").toLowerCase();
      return hosts.filter((host) => text.includes(host)).map((host) => `${file.slice(REPO.length + 1)} · ${host.length}`);
    });
    expect(hits).toEqual([]);
  });

  it("link tới trang lậu (kể cả tên miền con) bị từ chối; nguồn hợp pháp thì không", () => {
    const [first, second] = bannedBookHosts();
    expect(isBannedBookLink(`https://${first}/md5/abc`)).toBe(true);
    expect(isBannedBookLink(`http://www.${second}/`)).toBe(true);
    expect(isBannedBookLink(`${first}/search?q=x`)).toBe(true);
    expect(isBannedBookLink("https://www.gutenberg.org/ebooks/1342")).toBe(false);
    expect(isBannedBookLink("https://openlibrary.org/books/OL7173379M")).toBe(false);
    expect(isBannedBookLink("https://read.amazon.com/kp/kshare")).toBe(false);
    expect(isBannedBookLink("không phải link")).toBe(false);
  });
});

describe("103.2 · phạm vi công cộng ở Việt Nam và châu Âu", () => {
  it("năm 2026: tác giả / dịch giả mất từ 1955 trở về trước", () => {
    expect(lastPublicDeathYear(2026)).toBe(1955);
    expect(lastPublicDeathYear(2027)).toBe(1956);
  });

  it("bảng trạng thái nạp kệ: sách 'ok' không có ai mất sau 1955; Russell, Sinclair bị loại; King James còn", () => {
    const rows = readFileSync(join(REPO, "supabase", "seed", "book_pd_status.csv"), "utf8").trim().split("\n").slice(1).map((line) => line.split(","));
    expect(rows.length).toBeGreaterThan(60_000);
    const byId = new Map(rows.map(([id, status, died]) => [id, { status, died: died === "" ? null : Number(died) }] as const));
    for (const { status, died } of byId.values()) if (status === "ok" && died !== null) expect(died).toBeLessThanOrEqual(1955);
    expect(byId.get("1342")?.status).toBe("ok");
    expect(byId.get("5827")?.status).toBe("recent");
    expect(byId.get("140")?.status).toBe("recent");
    expect(byId.get("10")?.status).toBe("ok");
  });

  it("Open Library: danh sách VMT soát — sách đọc được đều có mã IA, sách còn bản quyền chỉ link", () => {
    const lines = readFileSync(join(REPO, "supabase", "seed", "openlibrary_candidates.csv"), "utf8").trim().split("\n").slice(1);
    expect(lines.length).toBeGreaterThanOrEqual(30);
    for (const line of lines) {
      const [olid] = line.split(",");
      expect(olid).toMatch(/^OL\d+M$/);
      if (line.includes(",read,")) expect(line).toMatch(/_djvu\.txt/);
      else expect(line).toContain(",borrow,");
    }
  });
});

describe("103.3 / 103.4 · Open Library trong app", () => {
  it("sách công cộng: link đọc được trong Avora; sách còn bản quyền: link mượn không bao giờ là sách đọc", () => {
    const read = catalogLink({ source: "openlibrary", sourceId: "OL7063784M" });
    expect(read).toBe("https://openlibrary.org/books/OL7063784M");
    expect(catalogRefOf(read)).toEqual({ source: "openlibrary", sourceId: "OL7063784M" });
    const borrow = borrowLink({ sourceId: "OL20402052M" });
    expect(catalogRefOf(borrow)).toBeNull();
    expect(borrowKeyOf(borrow)).toBe("openlibrary:OL20402052M");
    expect(sourceLabel("openlibrary")).toBe("Open Library");
    expect(sourceLine("openlibrary")).toBe("Open Library / Internet Archive · Phạm vi công cộng");
  });
});

describe("103.5 · bìa chỉ đến từ máy chủ AVORA", () => {
  it("địa chỉ bìa luôn là kho của Avora; đường dẫn lạ bị bỏ", () => {
    const url = coverUrl("gutenberg/1342.webp");
    expect(url).toMatch(/\/storage\/v1\/object\/public\/book-covers\/gutenberg\/1342\.webp$/);
    expect(url).not.toMatch(/gutenberg\.org|openlibrary\.org|archive\.org/);
    expect(coverUrl("../x.webp")).toBeNull();
    expect(coverUrl("https://covers.openlibrary.org/b/olid/OL1M-M.jpg")).toBeNull();
    expect(coverUrl(null)).toBeNull();
  });

  it("không component nào nạp ảnh thẳng từ trang sách ngoài", () => {
    const offenders = files(WEB_SRC, /\.tsx$/).filter((file) => !file.includes(`${join("src", "test")}`)).filter((file) => /src=\{?["'`]https:\/\/(covers\.openlibrary|gutenberg|archive\.org)/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("chính sách ghi Open Library / Internet Archive: chỉ sách công cộng và bìa, trình duyệt không kết nối tới họ", () => {
    const third = PRIVACY.sections.find((section) => section.id === "ben-thu-ba");
    const row = third?.table?.rows.find((cells) => cells[0].startsWith("Open Library"));
    expect(row?.join(" ")).toMatch(/phạm vi công cộng.*bìa/);
    expect(row?.join(" ")).toContain("trình duyệt của bạn không kết nối tới họ");
  });
});

describe("103.7–103.9 · tối đa 5 cuốn trên máy", () => {
  it("5 cuốn, đọc xong = 95%", () => {
    expect(MAX_ON_DEVICE).toBe(5);
    expect(FINISHED_PERCENT).toBe(95);
  });
});
