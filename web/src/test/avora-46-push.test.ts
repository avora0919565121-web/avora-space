import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { shouldBlockNotification, type MuteScope } from "@/lib/mute";
import { deviceLabel, pushSupport, shouldOfferPush } from "@/lib/push";

import SERVER_MATRIX from "./fixtures-push-mute-server.json";

/**
 * AVORA-46 · the one mute rule. The server's answers (private.push_mute_blocks, captured from the
 * live database for every combination of the five layers × surface × family × mention) must equal
 * shouldBlockNotification on the same data.
 */
describe("mute rule: client = server (4608 cases, AVORA-47 · 47.20)", () => {
  // [muted layers, focus, surface, family, mention, urgent, server blocks] — captured from
  // private.mute_decide over 6 layers (incl. one conversation) × focus × surface × family × mention × urgent.
  const rows = SERVER_MATRIX as [
    MuteScope[],
    "none" | "quiet" | "disconnect",
    "direct" | "group" | "project",
    boolean,
    boolean,
    boolean,
    boolean,
  ][];
  it("covers every combination", () => {
    expect(rows).toHaveLength(64 * 3 * 3 * 2 * 2 * 2);
  });
  it("gives the same answer as the server for each", () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const mismatches = rows.filter(([muted, focus, surface, isFromFamily, mentionsRecipient, isUrgent, serverBlocks]) => {
      const index = new Map<MuteScope, string>(
        muted.filter((scope) => scope !== "conversation").map((scope) => [scope, until] as const),
      );
      const decision = shouldBlockNotification(index, {
        surface,
        isFromFamily,
        mentionsRecipient,
        isUrgent,
        conversationMuted: muted.includes("conversation"),
        focus: focus === "none" ? null : focus,
      });
      return decision.blocked !== serverBlocks;
    });
    expect(mismatches).toEqual([]);
  });
});

describe("asking at the right moment", () => {
  const base = { support: "supported" as const, permission: "default" as const, subscribed: false, laterAt: null };
  it("offers once there is a reason, never when already on or refused", () => {
    expect(shouldOfferPush(base)).toBe(true);
    expect(shouldOfferPush({ ...base, subscribed: true })).toBe(false);
    expect(shouldOfferPush({ ...base, permission: "denied" })).toBe(false);
    expect(shouldOfferPush({ ...base, support: "unsupported" })).toBe(false);
  });
  it("'Để sau' waits 7 days", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(shouldOfferPush({ ...base, laterAt: "2026-10-05T00:00:00Z", now })).toBe(false);
    expect(shouldOfferPush({ ...base, laterAt: "2026-10-02T00:00:00Z", now })).toBe(true);
  });
  it("an iPhone Safari not on the Home Screen gets the install steps, not a permission prompt", () => {
    const env = { hasPushManager: false, hasNotification: false, hasServiceWorker: true, isStandalone: false };
    expect(pushSupport({ ...env, nav: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" } })).toBe("ios-needs-install");
    expect(pushSupport({ ...env, hasPushManager: true, hasNotification: true, isStandalone: true, nav: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } })).toBe("supported");
  });
  it("names a device plainly", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128 Safari/537.36")).toBe("Chrome · Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17 Safari/605.1")).toBe("Safari · macOS");
  });
});
