import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { toVietnameseHubError } from "@/lib/think-hub";
import { templateTableArgs, type BoardTemplate } from "@/lib/think-hub-shelf";

/** Every active system template on the server (probed 30/09: all 13 × Riêng tôi / 1-1 / Nhóm create). */
const SYSTEM_KEYS = [
  "project_plan", "customers", "suppliers", "construction", "problem", "weigh_options", "year_goals",
  "family_plan", "event", "shopping", "count_cost", "blank",
] as const;

function template(id: string, source: "system" | "mine" = "system"): BoardTemplate {
  return {
    id, source, name: id, thinkingType: null, guidingQuestion: null, description: null,
    scopes: ["journal", "direct", "group", "project"], columns: [], statuses: [], titleLabel: "Tiêu đề",
    subTemplateName: null, sortOrder: 0, audiences: ["moi_nguoi"], whenToUse: null, exampleRows: [],
  };
}

const EXPECTED_KEYS = ["p_conversation_id", "p_name", "p_template_key", "p_user_template_id"];

describe("Bảng từ mẫu — always the full signature (the 'Có lỗi xảy ra' of 30/09 was PGRST202)", () => {
  for (const key of SYSTEM_KEYS) {
    for (const place of [null, "conv-1-1", "conv-group"] as const) {
      it(`${key} · ${place ?? "Riêng tôi"} sends all four keys`, () => {
        const args = templateTableArgs({ template: template(key), conversationId: place, name: `  ${key}  ` });
        expect(Object.keys(args).sort()).toEqual(EXPECTED_KEYS);
        expect(args.p_template_key).toBe(key);
        expect(args.p_user_template_id).toBeNull();
        expect(args.p_conversation_id).toBe(place);
        expect(args.p_name).toBe(key);
      });
    }
  }

  it("Khách hàng & Cơ hội in Riêng tôi — the reported case", () => {
    const args = templateTableArgs({ template: template("customers"), conversationId: null, name: "Khách hàng & Cơ hội" });
    expect(args).toEqual({ p_template_key: "customers", p_user_template_id: null, p_conversation_id: null, p_name: "Khách hàng & Cơ hội" });
    // JSON keeps null keys; undefined keys would vanish and change the signature PostgREST looks for.
    expect(JSON.parse(JSON.stringify(args))).toHaveProperty("p_conversation_id", null);
  });

  it("Mẫu của tôi sends the id, and null for the system key", () => {
    const args = templateTableArgs({ template: template("u-1", "mine"), conversationId: null, name: "Của tôi" });
    expect(args.p_template_key).toBeNull();
    expect(args.p_user_template_id).toBe("u-1");
  });
});

describe("every template refusal has a Vietnamese sentence", () => {
  const codes = [
    "avora_template_missing", "avora_template_limit", "avora_template_bookshelf_only",
    "avora_template_source_required", "avora_template_table_not_empty",
  ];
  for (const code of codes) {
    it(code, () => {
      const text = toVietnameseHubError("P0001", code);
      expect(text).not.toBe("Có lỗi xảy ra. Vui lòng thử lại.");
      expect(text).not.toContain("avora_");
    });
  }
  it("a signature mismatch says so instead of the generic line", () => {
    expect(toVietnameseHubError("PGRST202", "Could not find the function")).toContain("chưa khớp");
  });
});
