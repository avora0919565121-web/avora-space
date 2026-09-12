import { userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { TimeField } from "@/components/tasks/TimeField";

/** Mirrors how a composer drives the field: the form owns the value. */
function Harness({ initial = "", onChange }: { initial?: string; onChange?: (next: string) => void }) {
  const [value, setValue] = useState<string>(initial);
  return (
    <div style={{ width: 375, padding: 16 }}>
      <TimeField
        id="t"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <p data-testid="value">{value}</p>
    </div>
  );
}

function minuteLabels(): string[] {
  return [...document.querySelectorAll("button")]
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => label.endsWith(" phút"))
    .map((label) => label.replace(" phút", ""));
}

test("the browser's own minute-by-minute time control is gone", async () => {
  const screen = await render(<Harness />);
  expect(screen.container.querySelector('input[type="time"]')).toBeNull();
  // What is left is one clock to press.
  await expect.element(screen.getByRole("button", { name: "Chọn giờ" })).toBeVisible();
});

test("the picker offers only five-minute marks", async () => {
  const screen = await render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Chọn giờ" }));

  expect(minuteLabels()).toEqual([
    "00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55",
  ]);
  // Nothing in between is offered at all.
  for (const forbidden of ["01", "07", "23", "44", "59"]) {
    expect(minuteLabels()).not.toContain(forbidden);
  }
});

test("choosing an hour and a minute writes a tidy value and closes the grid", async () => {
  const chosen: string[] = [];
  const screen = await render(<Harness onChange={(next) => chosen.push(next)} />);

  await userEvent.click(screen.getByRole("button", { name: "Chọn giờ" }));
  await userEvent.click(screen.getByRole("button", { name: "16 giờ" }));
  await userEvent.click(screen.getByRole("button", { name: "05 phút" }));

  await expect.element(screen.getByTestId("value")).toHaveTextContent("16:05");
  expect(chosen[chosen.length - 1]).toBe("16:05");
});

test("the chosen time is shown beside the clock, with no box to type digits into", async () => {
  const screen = await render(<Harness initial="09:30" />);

  await expect.element(screen.getByRole("button", { name: "Giờ đã chọn 09:30" })).toBeVisible();
  // No free-text entry anywhere in the field.
  expect(screen.container.querySelector("input")).toBeNull();
});

test("an hour on its own is already an answer, defaulting to the o'clock mark", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("button", { name: "Chọn giờ" }));
  await userEvent.click(screen.getByRole("button", { name: "08 giờ" }));

  await expect.element(screen.getByTestId("value")).toHaveTextContent("08:00");
});

test("the time can be taken back off, because it was never required", async () => {
  const screen = await render(<Harness initial="14:15" />);

  await userEvent.click(screen.getByRole("button", { name: "Bỏ giờ" }));

  await expect.element(screen.getByRole("button", { name: "Chọn giờ" })).toBeVisible();
  expect(screen.getByTestId("value").element().textContent).toBe("");
});

test("a time stored off the grid still highlights a mark the picker shows", async () => {
  const screen = await render(<Harness initial="16:07" />);
  await userEvent.click(screen.getByRole("button", { name: "Giờ đã chọn 16:07" }));

  // 16:07 predates the five-minute rule; the grid points at 05 rather than at nothing.
  const pressed = [...document.querySelectorAll('[aria-pressed="true"]')].map(
    (node) => node.getAttribute("aria-label") ?? "",
  );
  expect(pressed).toContain("16 giờ");
  expect(pressed).toContain("05 phút");
});
