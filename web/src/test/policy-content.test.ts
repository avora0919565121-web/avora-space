import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SETTINGS_TABS } from "@/lib/navigation";
import { POLICY_DOCS, POLICY_VERSION, PRIVACY } from "@/lib/policy-content";

const root = path.resolve(__dirname, "../../..");
const allItems = POLICY_DOCS.flatMap((d) => d.sections.flatMap((s) => s.items));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" || name === "integrations" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("AVORA-66 policy content", () => {
  it("every `done` item names its evidence, and file evidence exists", () => {
    for (const item of allItems.filter((i) => i.status === "done")) {
      expect(item.evidence, item.id).toBeTruthy();
      const file = /(web\/src\/[\w/.-]+\.tsx?|supabase\/migrations\/[\w.-]+\.sql)/.exec(item.evidence ?? "")?.[1];
      if (file !== undefined) expect(existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it("never overclaims; end-to-end only for done items backed by AVORA-68, soon items or negations", () => {
    for (const item of allItems) {
      expect(/an toàn tuyệt đối|bảo mật cấp ngân hàng|bảo mật tuyệt đối/i.test(item.text), item.id).toBe(false);
      if (/mã hoá đầu-cuối|E2EE|zero-knowledge/i.test(item.text)) {
        const ok = item.status === "soon" || /chưa/.test(item.text) || /vault-crypto|avora68/.test(item.evidence ?? "");
        expect(ok, item.id).toBe(true);
      }
    }
  });

  it("no screen anywhere overclaims", () => {
    const offenders = walk(path.join(root, "web/src")).filter((f) => /an toàn tuyệt đối|bảo mật cấp ngân hàng|bảo mật tuyệt đối/i.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
    expect(offenders).toEqual([]);
  });

  it("Chính sách is the second Settings tab", () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(["Hồ sơ", "Chính sách", "Tuỳ chọn chung", "Thông báo", "Dung lượng", "Avora AI", "Hướng dẫn"]);
  });

  it("has the anchors the app links to", () => {
    const ids = PRIVACY.sections.map((s) => s.id);
    for (const id of ["tai-khoan", "ket-noi", "nhiem-vu", "ket-sat", "ai", "du-lieu", "ben-thu-ba", "cua-ban", "lien-he"]) expect(ids).toContain(id);
    expect(POLICY_VERSION).toBe("2026-10-02");
  });
});
