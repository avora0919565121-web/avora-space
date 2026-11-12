import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("KT-08 · QA05-04 — nhãn tin đang chờ dễ đọc", () => {
  const messages = readFileSync(new URL("../pages/Messages.tsx", import.meta.url), "utf8");
  it("tin chờ gửi hiện nhãn DƯỚI bong bóng (12px, đậm vừa, xám đọc được, có biểu tượng), không nằm trong bong bóng mờ", () => {
    expect(messages.match(/<PendingLabel state=\{message\.outboxState\} \/>/g)).toHaveLength(1);
    expect(messages).toMatch(/const metaInside = showsMeta && rendersTextBubble && message\.failed !== true && message\.pending !== true;/);
    expect(messages).toMatch(/function PendingLabel[\s\S]{0,700}text-\[12px\] font-medium[\s\S]{0,300}"Đang chờ mạng" : "Chờ gửi…"/);
  });
});
