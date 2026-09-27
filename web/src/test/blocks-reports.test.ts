import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; the client refuses to construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  BLOCKED_SEND_NOTICE,
  blockedPersonLabel,
  CONTACT_UNAVAILABLE_MESSAGE,
  isContactUnavailable,
} from "@/lib/blocks";
import { toVietnameseChatError } from "@/lib/chat";
import { toVietnameseTaskError } from "@/lib/tasks";
import { toVietnameseSuggestionError } from "@/lib/task-suggestions";
import { toVietnameseCollabError } from "@/lib/task-collab";
import { REPORT_REASONS, reportPreview, toVietnameseReportError } from "@/lib/reports";

describe("Chặn (AVORA-37 / A)", () => {
  it("recognises the server refusal code however it is wrapped", () => {
    expect(isContactUnavailable("avora_contact_unavailable")).toBe(true);
    expect(isContactUnavailable("P0001: AVORA_CONTACT_UNAVAILABLE")).toBe(true);
    expect(isContactUnavailable("avora_not_a_participant")).toBe(false);
    expect(isContactUnavailable(null)).toBe(false);
  });

  it("the blocked sender sees one neutral line, never the word 'chặn'", () => {
    const shown = toVietnameseChatError("P0001", "avora_contact_unavailable");
    expect(shown).toBe(BLOCKED_SEND_NOTICE);
    expect(shown.toLowerCase()).not.toContain("chặn");
  });

  it("task paths translate the refusal to the same neutral sentence", () => {
    for (const shown of [
      toVietnameseTaskError("P0001", "avora_contact_unavailable"),
      toVietnameseSuggestionError("P0001", "avora_contact_unavailable"),
      toVietnameseCollabError("avora_contact_unavailable"),
    ]) {
      expect(shown).toBe(CONTACT_UNAVAILABLE_MESSAGE);
      expect(shown.toLowerCase()).not.toContain("chặn");
    }
    expect(CONTACT_UNAVAILABLE_MESSAGE).toBe("Không thể liên lạc với người này lúc này.");
  });

  it("names a blocked person by name, then email, then a fallback", () => {
    expect(blockedPersonLabel({ displayName: "An", email: "an@example.com" })).toBe("An");
    expect(blockedPersonLabel({ displayName: "  ", email: "an@example.com" })).toBe("an@example.com");
    expect(blockedPersonLabel({ displayName: null, email: null })).toBe("Người dùng AVORA");
  });
});

describe("Báo cáo (AVORA-37 / B)", () => {
  it("offers exactly the five reasons the database accepts, in order", () => {
    expect(REPORT_REASONS.map((reason) => reason.value)).toEqual([
      "harassment",
      "scam",
      "inappropriate",
      "impersonation",
      "other",
    ]);
    expect(REPORT_REASONS.map((reason) => reason.label)).toEqual([
      "Quấy rối",
      "Lừa đảo",
      "Nội dung không phù hợp",
      "Giả mạo",
      "Khác",
    ]);
  });

  it("previews the first two non-empty lines of the reported message", () => {
    expect(reportPreview("một\n\nhai\nba")).toBe("một\nhai…");
    expect(reportPreview("chỉ một dòng")).toBe("chỉ một dòng");
    expect(reportPreview("")).toBe("");
  });

  it("translates the daily limit and self-report refusals", () => {
    expect(toVietnameseReportError("P0001", "avora_report_limit")).toBe(
      "Bạn đã gửi nhiều báo cáo hôm nay. Thử lại vào ngày mai.",
    );
    expect(toVietnameseReportError("P0001", "avora_report_self")).toBe("Bạn không thể báo cáo chính mình.");
  });
});
