import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("KT-08 · QA05-04 — nhãn tin đang chờ dễ đọc", () => {
  const messages = readFileSync(new URL("../pages/Messages.tsx", import.meta.url), "utf8");
  it("cả hai chỗ hiện trạng thái chờ đều dùng PendingLabel (12px, đậm vừa, có biểu tượng, không mờ)", () => {
    expect(messages.match(/<PendingLabel state=\{message\.outboxState\} \/>/g)).toHaveLength(2);
    expect(messages).toMatch(/function PendingLabel[\s\S]{0,700}text-\[12px\] font-medium[\s\S]{0,300}"Đang chờ mạng" : "Chờ gửi…"/);
    expect(messages).toMatch(/message\.pending \? "opacity-100" : "opacity-70"/);
  });
});
