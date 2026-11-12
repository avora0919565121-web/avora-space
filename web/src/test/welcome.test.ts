import { describe, expect, it } from "vitest";

import { isRecentAccount, readWelcome, saveWelcome, startSteps } from "@/lib/welcome";
import { nextStudyPart, studyPartOf } from "@/lib/room";

describe("Nhà mới · màn chào", () => {
  it("không chọn gì → ba bước quen thuộc, PIN đứng cuối khi còn thiếu", () => {
    expect(startSteps([], true)).toEqual(["journal", "task", "friend", "pin"]);
    expect(startSteps([], false)).toEqual(["journal", "task", "friend"]);
  });

  it("mỗi lựa chọn có một bước trước, không lặp, tối đa bốn", () => {
    expect(startSteps(["spend", "talk"], false)).toEqual(["journal", "spend", "friend"]);
    expect(startSteps(["talk", "self", "spend"], true)).toEqual(["journal", "habit", "spend", "pin"]);
    expect(startSteps(["porch", "promise", "self", "keep", "spend"], true)).toEqual(["task", "habit", "vault", "pin"]);
  });

  it("chỉ lưu trên máy này; bản ghi hỏng coi như chưa thấy", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readWelcome("u1", storage)).toEqual({ seen: false, choices: [] });
    saveWelcome("u1", ["keep", "lạ" as never], storage);
    expect(readWelcome("u1", storage)).toEqual({ seen: true, choices: ["keep"] });
    store.set("avora.welcome:u2", "{hỏng");
    expect(readWelcome("u2", storage)).toEqual({ seen: false, choices: [] });
  });
});

describe("Nhà mới · màn chào chỉ cho tài khoản mới", () => {
  it("≤ 14 ngày là mới; không rõ ngày tạo thì không hỏi", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(isRecentAccount("2026-11-10T10:00:00Z", now)).toBe(true);
    expect(isRecentAccount("2026-10-01T10:00:00Z", now)).toBe(false);
    expect(isRecentAccount(undefined, now)).toBe(false);
    expect(isRecentAccount("", now)).toBe(false);
  });
});

describe("Nhà mới · Thư phòng ba phần", () => {
  it("kệ 5 là Đọc, thêm phan=ghi là Ghi chép, kệ khác là Kế hoạch; link cũ ke=nhat-ky vẫn vào Ghi chép", () => {
    expect(studyPartOf(5, new URLSearchParams("ke=5"))).toBe("doc");
    expect(studyPartOf(5, new URLSearchParams("ke=5&phan=ghi"))).toBe("ghi");
    expect(studyPartOf(5, new URLSearchParams("ke=nhat-ky"))).toBe("ghi");
    expect(studyPartOf(6, new URLSearchParams("ke=6"))).toBe("ke");
    expect(studyPartOf(2, new URLSearchParams())).toBe("ke");
  });

  it("vuốt ngang đi từng phần, dừng ở hai đầu", () => {
    expect(nextStudyPart("doc", "right")).toBe("ghi");
    expect(nextStudyPart("ghi", "right")).toBe("ke");
    expect(nextStudyPart("ke", "right")).toBeNull();
    expect(nextStudyPart("doc", "left")).toBeNull();
    expect(nextStudyPart("ghi", "up")).toBeNull();
  });
});
