import { describe, expect, it } from "vitest";

import { hasNotesAsk, NOTES_ASK_PARAMS, takeNotesAsk } from "@/lib/notes-ask";

/** 112-G · lưu ý 2: yêu cầu Ghi chép từ sách đọc một lần, rồi rời khỏi địa chỉ. */
describe("takeNotesAsk", () => {
  it("đọc yêu cầu sách và trả địa chỉ đã gỡ đủ 6 tham số, giữ tham số khác", () => {
    const p = new URLSearchParams("xem=ghi-chep&sach=b1&ten=T%C3%A1m&trich=Th%E1%BB%9Di&cho=Ch.1&o=3:120&ve=%2Fke-hoach");
    const { ask, rest } = takeNotesAsk(p);
    expect(ask).toEqual({ book: { recordId: "b1", title: "Tám", excerpt: { text: "Thời", where: "Ch.1", locator: "3:120" } } });
    for (const key of NOTES_ASK_PARAMS) expect(rest.has(key)).toBe(false);
    expect(rest.get("ve")).toBe("/ke-hoach");
    expect(rest.get("xem")).toBe("ghi-chep");
    expect(hasNotesAsk(rest)).toBe(false);
  });

  it("ghi-chep=<id> mở ghi chép; vị trí lạ bị bỏ; trích rỗng không thành đoạn trích", () => {
    expect(takeNotesAsk(new URLSearchParams("ghi-chep=n1&sach=b1")).ask).toEqual({ noteId: "n1" });
    const { ask } = takeNotesAsk(new URLSearchParams("sach=b1&trich=%20&o=abc"));
    expect(ask).toEqual({ book: { recordId: "b1", title: "Sách", excerpt: undefined } });
  });

  it("chỉ còn mảnh thừa (ten=, trich=) vẫn bị gỡ, không tạo yêu cầu", () => {
    const p = new URLSearchParams("ten=x&trich=y");
    expect(hasNotesAsk(p)).toBe(true);
    const { ask, rest } = takeNotesAsk(p);
    expect(ask).toBeNull();
    expect(rest.toString()).toBe("");
  });
});
