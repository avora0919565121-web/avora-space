import { userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { TaskViewTabs } from "@/components/tasks/TaskViewTabs";
import { DEFAULT_VIEW_ORDER, defaultViewMode, moveBefore } from "@/lib/task-order";
import type { TaskViewMode } from "@/lib/tasks";

/** A phone-width column, so every assertion is about what fits on a 375px screen. */
function Phone({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 375 }}>{children}</div>;
}

/** Mirrors the page: the strip owns no state, the screen around it remembers the order. */
function Harness({ onOrderChange }: { onOrderChange?: (order: readonly TaskViewMode[]) => void }) {
  const [order, setOrder] = useState<readonly TaskViewMode[]>(DEFAULT_VIEW_ORDER);
  const [mode, setMode] = useState<TaskViewMode>("deadline");
  return (
    <Phone>
      <TaskViewTabs
        mode={mode}
        order={order}
        onChange={setMode}
        onReorder={(moved, target) => {
          setOrder((current) => {
            const next = moveBefore(current, moved, target);
            onOrderChange?.(next);
            return next;
          });
        }}
      />
    </Phone>
  );
}

function tabLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim() ?? "");
}

/** The HTML5 drag a mouse would perform, start to finish. */
async function dragOnto(source: Element, target: Element): Promise<void> {
  const dataTransfer = new DataTransfer();
  source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}

test("the three readings are named in Vietnamese, with the relationship one by subject", async () => {
  const screen = await render(<Harness />);
  // "Theo đối tượng", not "Theo người": this view groups by conversation, and a group
  // is not a person.
  expect(tabLabels(screen.container)).toEqual(["Theo hạn", "Theo đối tượng", "Khẩn cấp"]);
});

test("dragging a tab to the front makes it the reading that opens next time", async () => {
  const orders: (readonly TaskViewMode[])[] = [];
  const screen = await render(<Harness onOrderChange={(order) => orders.push(order)} />);

  const tabs = [...screen.container.querySelectorAll('[role="tab"]')];
  const urgent = tabs[2];
  const first = tabs[0];
  if (!urgent || !first) throw new Error("the strip is missing its tabs");

  await dragOnto(urgent, first);

  expect(tabLabels(screen.container)).toEqual(["Khẩn cấp", "Theo hạn", "Theo đối tượng"]);
  const latest = orders[orders.length - 1];
  expect(latest).toBeDefined();
  expect(defaultViewMode(latest ?? [])).toBe("important");
});

test("the same move is available from the keyboard", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("tab", { name: "Khẩn cấp" }));
  await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");

  expect(tabLabels(screen.container)).toEqual(["Theo hạn", "Khẩn cấp", "Theo đối tượng"]);
});

test("choosing a tab selects it without disturbing the order", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("tab", { name: "Khẩn cấp" }));

  await expect.element(screen.getByRole("tab", { name: "Khẩn cấp" })).toHaveAttribute("aria-selected", "true");
  expect(tabLabels(screen.container)).toEqual(["Theo hạn", "Theo đối tượng", "Khẩn cấp"]);
});

test("on a 375px screen every tab is thumb-sized and nothing overflows", async () => {
  const screen = await render(<Harness />);

  const strip = screen.container.querySelector('[role="tablist"]');
  if (!strip) throw new Error("the strip is missing");

  for (const tab of strip.querySelectorAll('[role="tab"]')) {
    expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  }
  // Nothing may spill sideways out of a phone-width column.
  expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth + 1);
});
