import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { toVietnameseChatError } from "@/lib/chat";
import { toVietnameseGroupError } from "@/lib/groups";
import { toVietnameseProjectError } from "@/lib/projects";
import { REPORT_REASONS, toVietnameseReportError } from "@/lib/reports";
import { POLICY_CONTACT, COMMUNITY } from "@/lib/policy-content";
import {
  BLOCKED_TERM_MESSAGE,
  NOTICE_TEXT,
  SUPPORT_EMAIL,
  TERMS_VERSION,
  gateFrom,
  isBlockedTermError,
  suspensionText,
} from "@/lib/safety";

const root = path.resolve(__dirname, "../../..");
const migration = readFileSync(path.join(root, "supabase/migrations/20261110090000_avora111b_safety.sql"), "utf8");

describe("111-B · an toàn nội dung", () => {
  it("offers exactly the reasons the server accepts, with the four new ones", () => {
    const list = /p_reason not in \(([^)]+)\)/.exec(migration)?.[1] ?? "";
    const server = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(REPORT_REASONS.map((r) => r.value).sort()).toEqual(server);
    for (const value of ["sexual", "violence", "minor_safety", "self_harm"]) expect(server).toContain(value);
    expect(REPORT_REASONS.find((r) => r.value === "minor_safety")?.label).toBe("Liên quan đến an toàn trẻ em");
  });

  it("asks for the same Điều khoản version the server records", () => {
    const server = /function private\.terms_version\(\)[\s\S]*?select '([^']+)'::text/.exec(migration)?.[1];
    expect(TERMS_VERSION).toBe(server);
  });

  it("explains a filtered name without naming the word, wherever a name is saved", () => {
    const raw = 'new row violates check: avora_blocked_term';
    expect(isBlockedTermError(new Error(raw))).toBe(true);
    expect(isBlockedTermError({ message: raw })).toBe(true);
    expect(isBlockedTermError(new Error("avora_rate_limited"))).toBe(false);
    expect(toVietnameseGroupError("P0001", raw)).toBe(BLOCKED_TERM_MESSAGE);
    expect(toVietnameseProjectError("P0001", raw)).toBe(BLOCKED_TERM_MESSAGE);
    expect(toVietnameseChatError("P0001", raw)).toBe(BLOCKED_TERM_MESSAGE);
    expect(BLOCKED_TERM_MESSAGE).not.toMatch(/"|“/);
  });

  it("refuses a report target outside the reporter's reach in Vietnamese", () => {
    expect(toVietnameseReportError("P0001", "avora_report_target_invalid")).toBe("Không thể báo cáo nội dung này.");
  });

  it("says how long a suspension lasts, and when it is permanent", () => {
    expect(suspensionText("infinity")).toMatch(/vĩnh viễn/);
    expect(suspensionText("2026-11-20T03:00:00Z", new Date("2026-11-10T00:00:00Z"))).toMatch(/^Tài khoản đang bị hạn chế đến .*20\/11\/2026/);
  });

  it("passes through when the gate answer is not a gate (older server, test doubles)", () => {
    expect(gateFrom(null)).toBeNull();
    expect(gateFrom({})).toBeNull();
    expect(gateFrom({ termsVersion: "2026-11-10", termsAccepted: true, suspendedUntil: null, notices: [] })).toEqual({
      termsVersion: "2026-11-10",
      termsAccepted: true,
      suspendedUntil: null,
      notices: [],
    });
  });

  it("names the support address and tells the reporter their report was reviewed", () => {
    expect(SUPPORT_EMAIL).toBe("support@avorachat.com");
    expect(POLICY_CONTACT).toBe(SUPPORT_EMAIL);
    expect(NOTICE_TEXT.report_reviewed.title).toBe("Báo cáo của bạn đã được xem xét");
    const ids = COMMUNITY.sections.flatMap((s) => s.items.map((i) => i.id));
    for (const id of ["sexual", "violence", "scam", "minors", "private", "abuse"]) expect(ids).toContain(id);
  });
});
