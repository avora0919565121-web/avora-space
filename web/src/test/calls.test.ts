import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  callHref,
  callInviteMessage,
  internationalDigits,
  isCallLink,
  newCallRoomLink,
  peerPhone,
  scheduleProblem,
  splitLinks,
} from "@/lib/calls";
import type { ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

const contact = { id: "c1", linkedUserId: "u-peer", phone: "+84 912 345 678" } as Contact;
const noPhone = { id: "c2", linkedUserId: "u-other", phone: null } as Contact;
const channel = { contactId: "c2", kind: "phone", value: "0987 654 321" } as ContactChannel;

describe("calling a 1-1 (AVORA 31)", () => {
  it("reads the number only from the viewer's own contact linked to that person", () => {
    expect(peerPhone("u-peer", [contact], [])?.phone).toBe("+84 912 345 678");
    expect(peerPhone("u-other", [contact, noPhone], [channel])?.phone).toBe("0987 654 321");
    expect(peerPhone("u-stranger", [contact], [])).toBeNull();
    expect(peerPhone(null, [contact], [])).toBeNull();
  });

  it("hands the number to the chosen app", () => {
    expect(callHref("phone", "+84 912 345 678")).toBe("tel:0912345678");
    expect(callHref("zalo", "+84 912 345 678")).toBe("https://zalo.me/0912345678");
    expect(callHref("whatsapp", "0912 345 678")).toBe("https://wa.me/84912345678");
    expect(internationalDigits("0912345678")).toBe("84912345678");
  });
});

describe("scheduling a group call (AVORA 31)", () => {
  const now = new Date("2026-09-25T10:00:00");

  it("makes a fresh https room each time", () => {
    const link = newCallRoomLink(() => 0);
    expect(link).toBe("https://meet.jit.si/avora-aaaaaaaaaaaa");
    expect(isCallLink(link)).toBe(true);
    expect(isCallLink("javascript:alert(1)")).toBe(false);
  });

  it("refuses a missing, past or far-off time and a non-web link", () => {
    const link = "https://meet.jit.si/x";
    expect(scheduleProblem({ at: null, link }, now)).toMatch(/ngày và giờ/);
    expect(scheduleProblem({ at: new Date("2026-09-25T09:00:00"), link }, now)).toMatch(/đã qua/);
    expect(scheduleProblem({ at: new Date("2028-01-01T09:00:00"), link }, now)).toMatch(/một năm/);
    expect(scheduleProblem({ at: new Date("2026-09-26T09:00:00"), link: "zoom" }, now)).toMatch(/https/);
    expect(scheduleProblem({ at: new Date("2026-09-26T09:00:00"), link }, now)).toBeNull();
  });

  it("writes the invitation as plain words: topic, time, link", () => {
    const text = callInviteMessage({ topic: " Chốt tuần ", at: new Date("2026-09-26T14:30:00"), link: "https://meet.jit.si/x" });
    expect(text).toBe("📞 Lịch gọi nhóm: Chốt tuần\n🕒 Thứ bảy, 26/09/2026 lúc 14:30\n🔗 https://meet.jit.si/x");
  });

  it("finds links in a message, leaving the sentence's punctuation outside", () => {
    expect(splitLinks("Vào https://meet.jit.si/x. nhé")).toEqual([
      { text: "Vào ", href: null },
      { text: "https://meet.jit.si/x", href: "https://meet.jit.si/x" },
      { text: ". nhé", href: null },
    ]);
    expect(splitLinks("không có link")).toEqual([{ text: "không có link", href: null }]);
  });
});
