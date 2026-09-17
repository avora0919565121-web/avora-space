import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { MessageTaskDot } from "@/components/chat/MessageTaskDot";
import type { MessageTaskSummary } from "@/lib/message-tasks";

function summary(overrides: Partial<MessageTaskSummary> = {}): MessageTaskSummary {
  return {
    tone: "others",
    count: 1,
    taskId: "t1",
    suggestionId: "s1",
    ...overrides,
  };
}

function Dot({
  mark,
  onOpen,
}: {
  mark: MessageTaskSummary;
  onOpen?: () => void;
}) {
  return (
    <div style={{ width: 375, padding: 16 }}>
      <MessageTaskDot summary={mark} onOpen={onOpen ?? (() => {})} />
    </div>
  );
}

test("the mark is a real button, not a 7px target nobody can hit", async () => {
  const screen = await render(<Dot mark={summary()} />);

  const button = screen.container.querySelector("button");
  expect(button).not.toBeNull();
  const box = button!.getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.width).toBeGreaterThanOrEqual(24);
});

test("pressing it opens the work that came out of the message", async () => {
  let opened = 0;
  const screen = await render(<Dot mark={summary()} onOpen={() => (opened += 1)} />);

  await userEvent.click(screen.getByRole("button"));

  expect(opened).toBe(1);
});

/**
 * The only distinction the dot makes at this size, and it uses the two colours the app
 * already speaks: orange for the reader's own promise, green for somebody else's.
 */
test("the reader's own work is marked in the app's own accent", async () => {
  const screen = await render(<Dot mark={summary({ tone: "mine" })} />);

  const dot = screen.container.querySelector("button span[aria-hidden]");
  expect(dot?.className).toContain("bg-primary");
});

test("somebody else's work is marked apart from the reader's", async () => {
  const screen = await render(<Dot mark={summary({ tone: "others" })} />);

  const dot = screen.container.querySelector("button span[aria-hidden]");
  expect(dot?.className).toContain("bg-money-in");
  expect(dot?.className).not.toContain("bg-primary");
});

test("it says what it is, for anybody not looking at the colour", async () => {
  const screen = await render(<Dot mark={summary({ tone: "mine" })} />);

  await expect
    .element(screen.getByRole("button", { name: /nhiệm vụ của bạn/ }))
    .toBeVisible();
});

test("one message that produced several pieces of work stays one mark", async () => {
  const screen = await render(<Dot mark={summary({ count: 3 })} />);

  // One dot, with the number beside it rather than three dots in a row.
  expect(screen.container.querySelectorAll("button")).toHaveLength(1);
  await expect.element(screen.getByText("3")).toBeVisible();
});

test("the usual single piece of work shows no number at all", async () => {
  const screen = await render(<Dot mark={summary({ count: 1 })} />);

  expect(screen.container.textContent?.trim()).toBe("");
});
