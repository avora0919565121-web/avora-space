import { describe, expect, it } from "vitest";

import { carryReturn, hereFrom, isSafeReturnPath, readReturn, stripReturn, withReturn } from "@/lib/return-to";

const params = (query: string) => new URLSearchParams(query);

describe("readReturn", () => {
  it("accepts an in-app path with its label", () => {
    expect(readReturn(params(`tu=${encodeURIComponent("/tin-nhan/abc")}&tu_ten=Nh%C3%B3m`))).toEqual({
      path: "/tin-nhan/abc",
      label: "Nhóm",
    });
  });

  it.each(["//evil.com", "https://evil.com", "javascript:alert(1)", "/\\evil.com", "tin-nhan", "/x?y=https://evil.com", ""])(
    "refuses %s",
    (raw) => {
      expect(readReturn(params(`tu=${encodeURIComponent(raw)}&tu_ten=x`))).toBeNull();
      expect(isSafeReturnPath(raw)).toBe(false);
    },
  );

  it("falls back to a neutral label", () => {
    expect(readReturn(params("tu=%2Fke-hoach"))?.label).toBe("Quay lại");
  });
});

describe("withReturn / stripReturn", () => {
  it("adds tu and tu_ten, keeping existing params", () => {
    const href = withReturn("/nhiem-vu?muc=viec&mo=t1", { path: "/tong-quan", label: "Avora Space" });
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/nhiem-vu");
    expect(url.searchParams.get("mo")).toBe("t1");
    expect(readReturn(url.searchParams)).toEqual({ path: "/tong-quan", label: "Avora Space" });
  });

  it("never stacks an older way back inside the new one", () => {
    const from = hereFrom({ pathname: "/ke-hoach", search: "?bang=b1&tu=%2Ftin-nhan%2Fc1&tu_ten=A" }, "Kế hoạch");
    expect(from.path).toBe("/ke-hoach?bang=b1");
    expect(stripReturn("/a?tu=%2Fb&tu_ten=B")).toBe("/a");
  });

  it("drops an unsafe origin", () => {
    expect(withReturn("/nhiem-vu", { path: "//evil.com", label: "x" })).toBe("/nhiem-vu");
  });

  it("carries the way back onto freshly built params", () => {
    const next = carryReturn(params("tu=%2Ftong-quan&tu_ten=Avora%20Space"), new URLSearchParams("muc=lich"));
    expect(next.get("tu")).toBe("/tong-quan");
    expect(next.get("muc")).toBe("lich");
  });
});
