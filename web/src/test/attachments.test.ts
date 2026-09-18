import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  attachmentKindFor,
  attachmentRejectionReason,
  attachmentStoragePath,
  attachmentsByMessage,
  attachmentSummaryText,
  canExportAttachment,
  canForwardAttachment,
  formatDuration,
  formatFileSize,
  permissionLabel,
  safeStorageName,
  type MessageAttachment,
} from "@/lib/attachments";
import { canSendDraft, messageBodyText, quotePreview } from "@/lib/chat-cache";

function attachment(overrides: Partial<MessageAttachment> & { id: string }): MessageAttachment {
  return {
    messageId: "m-1",
    conversationId: "c-1",
    attachedBy: "u-1",
    kind: "file",
    storagePath: "c-1/u/report.pdf",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    byteSize: 2048,
    width: null,
    height: null,
    durationSeconds: null,
    permission: "export",
    originMessageId: null,
    createdAt: "2026-09-17T00:00:00Z",
    ...overrides,
  };
}

describe("attachmentKindFor", () => {
  it("treats any image type as an image", () => {
    expect(attachmentKindFor("image/png")).toBe("image");
    expect(attachmentKindFor("image/heic")).toBe("image");
  });

  it("calls a recording a voice note even though it is audio", () => {
    expect(attachmentKindFor("audio/webm", true)).toBe("voice");
  });

  it("treats an uploaded audio file as a file, not a voice note", () => {
    // A song someone attached is not a spoken remark, and should not get a voice player.
    expect(attachmentKindFor("audio/mpeg")).toBe("file");
  });

  it("falls back to file for anything else", () => {
    expect(attachmentKindFor("application/pdf")).toBe("file");
    expect(attachmentKindFor("")).toBe("file");
  });
});

describe("formatFileSize", () => {
  it("uses bytes, KB and MB as people read them", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(formatFileSize(24 * 1024 * 1024)).toBe("24 MB");
  });

  it("does not print a negative or nonsense size", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(-10)).toBe("0 KB");
    expect(formatFileSize(Number.NaN)).toBe("0 KB");
  });
});

describe("formatDuration", () => {
  it("reads as a clock", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(102)).toBe("1:42");
    expect(formatDuration(300)).toBe("5:00");
  });

  it("shows zero rather than blank when nothing was recorded", () => {
    expect(formatDuration(null)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("0:00");
  });
});

describe("attachmentRejectionReason", () => {
  it("lets an ordinary file through", () => {
    expect(attachmentRejectionReason({ size: 1024, type: "application/pdf" })).toBeNull();
  });

  it("refuses a file over 25MB, saying how big it actually is", () => {
    const reason = attachmentRejectionReason({ size: 30 * 1024 * 1024, type: "application/pdf" });
    expect(reason).toContain("30 MB");
    expect(reason).toContain("25MB");
  });

  it("does not refuse a large photo, because it is about to be shrunk", () => {
    // Telling someone their photo is too big while the app re-encodes it would be a lie.
    expect(attachmentRejectionReason({ size: 30 * 1024 * 1024, type: "image/jpeg" })).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(attachmentRejectionReason({ size: 0, type: "image/png" })).not.toBeNull();
  });
});

describe("safeStorageName", () => {
  it("keeps a normal name readable", () => {
    expect(safeStorageName("bao-cao-q3.pdf")).toBe("bao-cao-q3.pdf");
  });

  it("strips directory traversal, which is the part that decides access", () => {
    expect(safeStorageName("../../secrets.env")).toBe("secrets.env");
    expect(safeStorageName("/etc/passwd")).toBe("passwd");
    expect(safeStorageName("a\\b\\c.txt")).toBe("c.txt");
  });

  it("never returns an empty name", () => {
    expect(safeStorageName("")).toBe("tep");
    expect(safeStorageName("...")).toBe("tep");
  });

  it("folds spaces so a path cannot be broken by them", () => {
    expect(safeStorageName("bao cao cuoi nam.docx")).toBe("bao-cao-cuoi-nam.docx");
  });
});

describe("attachmentStoragePath", () => {
  it("puts the conversation first, because that is the whole access rule", () => {
    const path = attachmentStoragePath("11111111-2222-3333-4444-555555555555", "anh.png");
    expect(path.startsWith("11111111-2222-3333-4444-555555555555/")).toBe(true);
    expect(path.endsWith("/anh.png")).toBe(true);
  });

  it("cannot be steered out of its conversation folder by the file name", () => {
    const path = attachmentStoragePath("c-1", "../../../elsewhere.png");
    expect(path.startsWith("c-1/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("gives two uploads of the same name different paths", () => {
    const first = attachmentStoragePath("c-1", "anh.png");
    const second = attachmentStoragePath("c-1", "anh.png");
    expect(first).not.toBe(second);
  });
});

describe("permission ladder", () => {
  it("only lets forwarding happen at forward or above", () => {
    expect(canForwardAttachment("view")).toBe(false);
    expect(canForwardAttachment("forward")).toBe(true);
    expect(canForwardAttachment("export")).toBe(true);
  });

  it("only lets a file leave AVORA at export", () => {
    expect(canExportAttachment("view")).toBe(false);
    expect(canExportAttachment("forward")).toBe(false);
    expect(canExportAttachment("export")).toBe(true);
  });

  it("says what each rung means in words", () => {
    expect(permissionLabel("view")).toBe("Chỉ xem");
    expect(permissionLabel("forward")).toBe("Cho chuyển tiếp");
    expect(permissionLabel("export")).toBe("Cho tải về");
  });
});

describe("attachmentsByMessage", () => {
  it("groups files under the message that carries them", () => {
    const grouped = attachmentsByMessage([
      attachment({ id: "a" }),
      attachment({ id: "b", messageId: "m-2" }),
      attachment({ id: "c" }),
    ]);
    expect(grouped.get("m-1")?.map((item) => item.id)).toEqual(["a", "c"]);
    expect(grouped.get("m-2")?.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps the order the files were sent in", () => {
    const grouped = attachmentsByMessage([
      attachment({ id: "first", createdAt: "2026-09-17T00:00:00Z" }),
      attachment({ id: "second", createdAt: "2026-09-17T00:00:01Z" }),
    ]);
    expect(grouped.get("m-1")?.map((item) => item.id)).toEqual(["first", "second"]);
  });
});

describe("attachmentSummaryText", () => {
  it("names a single file by its own name", () => {
    expect(attachmentSummaryText([attachment({ id: "a", fileName: "hop-dong.pdf" })])).toBe(
      "hop-dong.pdf",
    );
  });

  it("says what a photo is rather than its storage name", () => {
    expect(attachmentSummaryText([attachment({ id: "a", kind: "image" })])).toBe("Hình ảnh");
  });

  it("gives a voice note its length, which is the useful part", () => {
    expect(
      attachmentSummaryText([attachment({ id: "a", kind: "voice", durationSeconds: 12 })]),
    ).toBe("Tin nhắn thoại 0:12");
  });

  it("counts once there is more than one", () => {
    expect(attachmentSummaryText([attachment({ id: "a" }), attachment({ id: "b" })])).toBe(
      "2 tệp đính kèm",
    );
  });
});

describe("a message carrying only files", () => {
  it("can be sent even with an empty text box", () => {
    expect(canSendDraft("", false, 1)).toBe(true);
    expect(canSendDraft("   ", false, 2)).toBe(true);
  });

  it("still cannot be sent when there is nothing at all", () => {
    expect(canSendDraft("", false, 0)).toBe(false);
    expect(canSendDraft("   ", false, 0)).toBe(false);
  });

  it("cannot be sent twice while the first send is in flight", () => {
    expect(canSendDraft("xin chào", true, 1)).toBe(false);
  });

  it("reads as its files where no bubble can be drawn", () => {
    expect(messageBodyText({ content: "", deletedAt: null, attachmentCount: 1 })).toBe(
      "Tệp đính kèm",
    );
    expect(messageBodyText({ content: "", deletedAt: null, attachmentCount: 3 })).toBe(
      "3 tệp đính kèm",
    );
  });

  it("prefers the words when there are any", () => {
    expect(messageBodyText({ content: "xem giúp nhé", deletedAt: null, attachmentCount: 1 })).toBe(
      "xem giúp nhé",
    );
  });

  it("says withdrawn even when it carried files", () => {
    expect(
      messageBodyText({ content: "", deletedAt: "2026-09-17T00:00:00Z", attachmentCount: 2 }),
    ).toBe("Tin nhắn đã được thu hồi.");
  });

  it("quotes as its files rather than as a blank line", () => {
    expect(quotePreview({ content: "", deletedAt: null, attachmentCount: 1 })).toBe("Tệp đính kèm");
  });
});
