import { render } from "vitest-browser-react";

import { SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";

/** Reads the on-screen geometry of a bubble, which is what "half" vs "full" actually means. */
function boxOf(element: Element): DOMRect {
  return element.getBoundingClientRect();
}

test("the review-pending circle is filled on its left half, not striped down the middle", async () => {
  const screen = await render(<TaskBubble state="half" label="Chờ xác nhận hoàn thành" />);
  const bubble = screen.container.querySelector('[data-bubble="half"]');
  const fill = screen.container.querySelector('[data-bubble-fill="half"]');

  expect(bubble).not.toBeNull();
  expect(fill).not.toBeNull();

  const ring = boxOf(bubble as Element);
  const filled = boxOf(fill as Element);

  // The fill is positioned against the ring's interior, so the hairline border has to be
  // discounted before comparing — measuring against the border box would be off by 1px a side.
  const style = getComputedStyle(bubble as Element);
  const borderLeft = Number.parseFloat(style.borderLeftWidth);
  const interiorWidth = ring.width - borderLeft - Number.parseFloat(style.borderRightWidth);
  const interiorHeight = ring.height - Number.parseFloat(style.borderTopWidth) - Number.parseFloat(style.borderBottomWidth);

  expect(ring.width).toBeGreaterThan(0);
  expect(borderLeft).toBeGreaterThan(0);
  // Half as wide as the circle's interior...
  expect(filled.width).toBeCloseTo(interiorWidth / 2, 1);
  // ...full height...
  expect(filled.height).toBeCloseTo(interiorHeight, 1);
  // ...and flush against the left edge, so it reads as ◐ rather than a centred bar.
  expect(filled.left).toBeCloseTo(ring.left + borderLeft, 1);
});

test("the half-filled circle stays unmarked while the checks belong to the accepted and finished states", async () => {
  const half = await render(<TaskBubble state="half" label="Chờ xác nhận hoàn thành" />);
  expect(half.container.querySelector("svg")).toBeNull();

  const box = await render(<TaskBubble state="box" label="Chờ nhận việc" />);
  expect(box.container.querySelector("svg")).toBeNull();

  const accepted = await render(<TaskBubble state="check" label="Đã nhận việc" />);
  expect(accepted.container.querySelector("svg")).not.toBeNull();

  const full = await render(<TaskBubble state="full" label="Đã hoàn thành" />);
  expect(full.container.querySelector('[data-bubble="full"]')).not.toBeNull();
  expect(full.container.querySelector("svg")).not.toBeNull();
});

test("the unaccepted square is visibly not a circle", async () => {
  const box = await render(<TaskBubble state="box" label="Chờ nhận việc" />);
  const shape = box.container.querySelector('[data-bubble="box"]');
  expect(shape).not.toBeNull();

  const radius = getComputedStyle(shape as Element).borderTopLeftRadius;
  const size = boxOf(shape as Element);
  // A square with soft corners, not a pill: its radius stays well under half its width.
  expect(Number.parseFloat(radius)).toBeGreaterThan(0);
  expect(Number.parseFloat(radius)).toBeLessThan(size.width / 2);
});

test("each shared status renders its own distinct shape", async () => {
  const seen = new Set<string>();
  for (const state of Object.values(SHARED_BUBBLE_STATE)) {
    const screen = await render(<TaskBubble state={state} label={state} />);
    const rendered = screen.container.querySelector("[data-bubble]");
    expect(rendered?.getAttribute("data-bubble")).toBe(state);
    seen.add(state);
  }
  // Five states, five shapes: a declined suggestion must not borrow the empty square (still
  // waiting for an answer) or the filled disc (work somebody actually did).
  expect(seen.size).toBe(5);
});

test("a declined suggestion is neither the unanswered square nor the finished disc", async () => {
  const skipped = await render(<TaskBubble state="skip" label="Đã bỏ qua" />);
  const shape = skipped.container.querySelector('[data-bubble="skip"]');
  expect(shape).not.toBeNull();
  expect(skipped.container.querySelector('[data-bubble="box"]')).toBeNull();
  expect(skipped.container.querySelector('[data-bubble="full"]')).toBeNull();

  // Dashed rather than solid: settled, but not by anyone doing the work.
  expect(getComputedStyle(shape as Element).borderTopStyle).toBe("dashed");
});

test("a shape is a button only when this person can act on it", async () => {
  const idle = await render(<TaskBubble state="half" label="Chờ người giao xác nhận hoàn thành" />);
  expect(idle.container.querySelector("button")).toBeNull();
  await expect
    .element(idle.getByRole("img", { name: "Chờ người giao xác nhận hoàn thành" }))
    .toBeInTheDocument();

  const actionable = await render(
    <TaskBubble state="half" label="Xác nhận hoàn thành" onClick={() => {}} />,
  );
  await expect.element(actionable.getByRole("button", { name: "Xác nhận hoàn thành" })).toBeInTheDocument();
});
