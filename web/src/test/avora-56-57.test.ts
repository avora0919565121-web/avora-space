import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; some modules import the Supabase client, which refuses to start without env.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  celebrationRepeats,
  CELEBRATION_LIMITS_MS,
  effectiveCelebrationStyle,
} from "@/lib/confetti";
import { ambiguousKindsOf, candidateNeedsReview, extraChannelsOf, kindIsAmbiguous } from "@/lib/contact-candidates";
import {
  cleanContactEmail,
  cleanContactName,
  formatPhoneForDisplay,
  nameCaseSuggestion,
  toStoredPhone,
} from "@/lib/contact-clean";
import { withPinnedFirst } from "@/lib/conversation-order";
import { GUIDE_CARDS } from "@/lib/guide-content";
import {
  INVITE_LENGTH_MESSAGE,
  INVITE_NO_LINKS_MESSAGE,
  inviteMessageProblem,
  textHasLink,
} from "@/lib/invite-message";
import { isButtonStyle, isCelebrationStyle } from "@/lib/look-prefs";
import { vaultAddFor, VAULT_ADD_ENTRIES } from "@/lib/vault-add";

describe("AVORA-56 · A — the request message", () => {
  it("56.1: an empty or short message is refused with a clear sentence", () => {
    expect(inviteMessageProblem("")).toBe(INVITE_LENGTH_MESSAGE);
    expect(inviteMessageProblem("  chào  ")).toBe(INVITE_LENGTH_MESSAGE);
    expect(inviteMessageProblem("x".repeat(201))).toBe(INVITE_LENGTH_MESSAGE);
    expect(inviteMessageProblem("Mình là Hùng, gặp ở hội thảo")).toBeNull();
  });

  it("56.2: links are refused (http, www, domain) and ordinary words are not", () => {
    expect(textHasLink("xem www.abc.com nhé")).toBe(true);
    expect(textHasLink("https://x.io")).toBe(true);
    expect(textHasLink("ghé abc.vn đi")).toBe(true);
    expect(textHasLink("Mình là Hùng. Rất vui.")).toBe(false);
    expect(textHasLink("v.v. và 3.5 điểm")).toBe(false);
    expect(inviteMessageProblem("Mình là Hùng, xem www.abc.com")).toBe(INVITE_NO_LINKS_MESSAGE);
  });
});

describe("AVORA-56 · B — tidying a contact on save", () => {
  it("56.4: name, email and phone", () => {
    expect(cleanContactName("  nguyễn   văn a ")).toBe("nguyễn văn a");
    expect(nameCaseSuggestion("  nguyễn   văn a ")).toBe("Nguyễn Văn A");
    expect(nameCaseSuggestion("NGUYỄN VĂN A")).toBe("Nguyễn Văn A");
    expect(nameCaseSuggestion("Nguyễn văn A")).toBeNull();
    expect(cleanContactEmail("ABC@GMAIL.COM ")).toBe("abc@gmail.com");
    expect(toStoredPhone("0901234567")).toBe("+84901234567");
    expect(toStoredPhone("+84 90 123 4567")).toBe("+84901234567");
    expect(formatPhoneForDisplay("+84901234567")).toBe("+84 90 123 4567");
    // Old rows are shown grouped without being rewritten.
    expect(formatPhoneForDisplay("0901234567")).toBe("+84 90 123 4567");
  });

  it("keeps what it cannot read rather than guessing", () => {
    expect(toStoredPhone("0613936622,812")).toBe("0613936622,812");
    expect(toStoredPhone("")).toBe("");
  });
});

describe("AVORA-56 · E — completion effect", () => {
  it("56.8: reduced motion always plays the subtle one", () => {
    expect(effectiveCelebrationStyle("fireworks", true)).toBe("subtle");
    expect(effectiveCelebrationStyle("vivid", true)).toBe("subtle");
    expect(effectiveCelebrationStyle("inspiring", false)).toBe("inspiring");
  });

  it("56.7: durations stay within the brief; milestones are stronger", () => {
    expect(CELEBRATION_LIMITS_MS.inspiring).toBeLessThanOrEqual(500);
    expect(CELEBRATION_LIMITS_MS.vivid).toBeLessThanOrEqual(1200);
    expect(CELEBRATION_LIMITS_MS.fireworks).toBeLessThanOrEqual(1200);
    expect(celebrationRepeats("vivid", "milestone")).toBe(2);
    expect(celebrationRepeats("fireworks", "milestone")).toBe(3);
    expect(celebrationRepeats("vivid", "task")).toBe(1);
  });

  it("reads stored values defensively", () => {
    expect(isCelebrationStyle("inspiring")).toBe(true);
    expect(isCelebrationStyle("loud")).toBe(false);
    expect(isButtonStyle("icon")).toBe(true);
    expect(isButtonStyle("square")).toBe(false);
  });
});

describe("AVORA-57 · A — Hướng dẫn", () => {
  it("57.2: six cards, 3–5 lines each, no promises it cannot keep", () => {
    expect(GUIDE_CARDS).toHaveLength(6);
    for (const card of GUIDE_CARDS) {
      expect(card.lines.length).toBeGreaterThanOrEqual(3);
      expect(card.lines.length).toBeLessThanOrEqual(5);
      for (const line of card.lines) {
        expect(line).not.toMatch(/an toàn|bảo mật tuyệt đối|mã hoá|mã hóa|sắp có/i);
      }
    }
  });
});

describe("AVORA-57 · D — pinned conversations", () => {
  it("pinned first in pin order, the rest untouched", () => {
    const rows = [{ conversationId: "a" }, { conversationId: "b" }, { conversationId: "c" }, { conversationId: "d" }];
    const pins = new Map([
      ["d", "2026-10-01T10:00:00Z"],
      ["b", "2026-10-01T09:00:00Z"],
    ]);
    expect(withPinnedFirst(rows, pins).map((row) => row.conversationId)).toEqual(["b", "d", "a", "c"]);
    expect(withPinnedFirst(rows, new Map()).map((row) => row.conversationId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("AVORA-57 · E — Két sắt `+`", () => {
  it("57.6: the label follows the sub-tab; Sắp có sub-tabs have none (68: the paper compartments have one)", () => {
    expect(vaultAddFor("/ket-sat")?.label).toBe("Giao dịch");
    expect(vaultAddFor("/ket-sat/mat-khau")).toBeNull();
    expect(vaultAddFor("/ket-sat/tai-san")?.label).toBe("Tài sản");
    expect(vaultAddFor("/ket-sat/chung-chi")?.label).toBe("Chứng chỉ");
    expect(VAULT_ADD_ENTRIES.map((entry) => entry.label)).toEqual(["Giao dịch", "Mật khẩu", "Chứng chỉ", "Tài liệu", "Tài sản"]);
  });
});

describe("AVORA-57 · J — Cần xem lại only when it is a real choice", () => {
  const candidate = (phones: string[], emails: string[], labels: Record<string, string> = {}) => ({
    name: "Hùng",
    phones,
    emails,
    suggestedType: "individual" as const,
    source: "import_vcf" as const,
    channelLabels: labels,
  });

  it("57.12: one phone + one email is never asked", () => {
    expect(candidateNeedsReview(candidate(["0901234567"], ["a@b.vn"]))).toBe(false);
  });

  it("57.13: two unlabelled phones are asked — and only the phones", () => {
    const c = candidate(["0901234567", "0912345678"], ["a@b.vn", "c@d.vn"], { "email:c@d.vn": "Cơ quan" });
    expect([...ambiguousKindsOf(c)]).toEqual(["phone"]);
    const extras = extraChannelsOf(c);
    expect(extras.find((entry) => entry.kind === "phone")?.needsReview).toBe(true);
    expect(extras.find((entry) => entry.kind === "email")?.needsReview).toBeUndefined();
  });

  it("differently labelled values are not asked; the same label is", () => {
    expect(kindIsAmbiguous([{ value: "0901", label: "Cơ quan" }, { value: "0902", label: "Cá nhân" }], "phone")).toBe(false);
    expect(kindIsAmbiguous([{ value: "0901", label: null }, { value: "0902", label: "Cá nhân" }], "phone")).toBe(false);
    expect(kindIsAmbiguous([{ value: "0901", label: "Cơ quan" }, { value: "0902", label: "cơ quan" }], "phone")).toBe(true);
    expect(kindIsAmbiguous([{ value: "0901234567", label: null }, { value: "+84901234567", label: null }], "phone")).toBe(false);
  });
});
