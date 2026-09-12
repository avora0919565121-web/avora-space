import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { LONG_PRESS_MS, MessageTaskAffordance } from "@/components/chat/MessageTaskButton";

function Bubble({ text, onCreateTask }: { text: string; onCreateTask: () => void }) {
  return (
    <div style={{ width: 375, padding: 16 }}>
      <MessageTaskAffordance outgoing={false} messageLabel={text} onCreateTask={onCreateTask}>
        <div data-testid="bubble">{text}</div>
      </MessageTaskAffordance>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A finger, not a mouse — the long press is deliberately touch-only. */
function touch(node: Element, type: string, x = 10, y = 10): void {
  node.dispatchEvent(
    new PointerEvent(type, { pointerType: "touch", clientX: x, clientY: y, bubbles: true }),
  );
}

test("every message offers a way to become a task", async () => {
  const screen = await render(<Bubble text="Gửi mình báo giá nhé" onCreateTask={() => {}} />);

  await expect
    .element(screen.getByRole("button", { name: "Tạo task từ tin nhắn này: Gửi mình báo giá nhé" }))
    .toBeInTheDocument();
});

test("pressing it raises a task from that particular message", async () => {
  let raised = 0;
  const screen = await render(<Bubble text="Gửi mình báo giá nhé" onCreateTask={() => (raised += 1)} />);

  await userEvent.click(screen.getByRole("button", { name: /Tạo task từ tin nhắn này/ }));

  expect(raised).toBe(1);
});

test("holding a finger on the bubble opens the same thing, since touch has no hover", async () => {
  let raised = 0;
  const screen = await render(<Bubble text="Chốt lịch thứ sáu" onCreateTask={() => (raised += 1)} />);
  const bubble = screen.getByTestId("bubble").element();

  touch(bubble, "pointerdown");
  await sleep(LONG_PRESS_MS + 120);

  expect(raised).toBe(1);
});

test("a quick tap is reading, not commanding", async () => {
  let raised = 0;
  const screen = await render(<Bubble text="Chốt lịch thứ sáu" onCreateTask={() => (raised += 1)} />);
  const bubble = screen.getByTestId("bubble").element();

  touch(bubble, "pointerdown");
  await sleep(120);
  touch(bubble, "pointerup");
  await sleep(LONG_PRESS_MS);

  expect(raised).toBe(0);
});

test("scrolling the thread never fires it", async () => {
  let raised = 0;
  const screen = await render(<Bubble text="Chốt lịch thứ sáu" onCreateTask={() => (raised += 1)} />);
  const bubble = screen.getByTestId("bubble").element();

  touch(bubble, "pointerdown", 10, 10);
  // The finger travels, which is a scroll rather than a press.
  touch(bubble, "pointermove", 10, 90);
  await sleep(LONG_PRESS_MS + 120);

  expect(raised).toBe(0);
});
