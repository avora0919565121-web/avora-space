import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { APP_ORIGIN, hostRoleOf, movedUrl } from "@/lib/app-origin";
import { confirmationRedirect } from "@/lib/auth";
import { connectLink } from "@/lib/connections";

describe("KHỐI 0 · one address", () => {
  it("APP_ORIGIN is the primary address", () => {
    expect(APP_ORIGIN).toBe("https://avorachat.com");
  });

  it("only the primary runs the app; old addresses and strangers are retired", () => {
    expect(hostRoleOf("avorachat.com")).toBe("primary");
    expect(hostRoleOf("www.avorachat.com")).toBe("alias");
    expect(hostRoleOf("avoraspace.rork.app")).toBe("retired");
    expect(hostRoleOf("myavora.rork.app")).toBe("retired");
    expect(hostRoleOf("evil.rork.app")).toBe("retired");
    expect(hostRoleOf("9gn7yyx8sbtban1pcozwb-web.rork.live")).toBe("dev");
    expect(hostRoleOf("localhost")).toBe("dev");
  });

  it("the move keeps path, query and hash", () => {
    expect(movedUrl({ pathname: "/tin-nhan/abc", search: "?x=1", hash: "#m" })).toBe("https://avorachat.com/tin-nhan/abc?x=1#m");
  });

  it("emails and links never use the address the person has open", () => {
    expect(confirmationRedirect(undefined)).toBe("https://avorachat.com");
    expect(confirmationRedirect("/loi-moi/t")).toBe("https://avorachat.com/loi-moi/t");
    expect(connectLink("A-AVR22VMT")).toContain("https://avorachat.com/");
  });
});
