import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { FinancePage, StatCard } from "@/components/finance/primitives";

const book = (isSample: boolean) => ({ isSample, canShowSample: true, setBook: () => undefined, hideSample: () => undefined });

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`KT-08 · QA05-06 (${width}): thẻ số của sổ mẫu tự ghi "Mẫu"; sổ của tôi thì không`, async () => {
    await page.viewport(width, height);
    const screen = await render(
      <FinancePage book={book(true)}>
        <StatCard label="Tổng tài sản" value="122.130.000 ₫" />
        <StatCard label="Thu tháng này" value="30.000.000 ₫" />
      </FinancePage>,
    );
    const cards = document.querySelectorAll("[data-stat-sample]");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.textContent).toContain("Mẫu");
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    }
    await screen.rerender(
      <FinancePage book={book(false)}>
        <StatCard label="Tổng tài sản" value="−45.000 ₫" />
      </FinancePage>,
    );
    expect(document.querySelectorAll("[data-stat-sample]")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Mẫu");
  });
}
