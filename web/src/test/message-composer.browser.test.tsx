import { userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { MessageComposer } from "@/components/chat/MessageComposer";

const LABEL = "Nhắn tin cho Minh";

/** Mirrors how Messages.tsx drives the composer: it owns the draft and clears it on send. */
function Harness({ onSend, isSending = false }: { onSend: (content: string) => void; isSending?: boolean }) {
  const [value, setValue] = useState<string>("");
  return (
    <MessageComposer
      value={value}
      onValueChange={setValue}
      onSend={(content) => {
        onSend(content);
        setValue("");
      }}
      placeholder="Nhắn tin cho Minh…"
      ariaLabel={LABEL}
      isSending={isSending}
    />
  );
}

function fieldOf(container: HTMLElement): HTMLTextAreaElement {
  const field = container.querySelector("textarea");
  if (!field) throw new Error("composer has no text field");
  return field;
}

test("Enter opens a new line and sends nothing", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("dòng một");
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("dòng hai");

  // The keystroke stayed in the draft instead of despatching it.
  expect(sent).toEqual([]);
  expect(fieldOf(screen.container).value).toBe("dòng một\ndòng hai");
});

test("Shift+Enter also only writes a line, exactly like Enter now does", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("trên{Shift>}{Enter}{/Shift}dưới");

  expect(sent).toEqual([]);
  expect(fieldOf(screen.container).value).toBe("trên\ndưới");
});

test("the Gửi button sends the written message and empties the box", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("hẹn gặp lúc 8h");
  await userEvent.click(screen.getByRole("button", { name: "Gửi" }));

  expect(sent).toEqual(["hẹn gặp lúc 8h"]);
  expect(fieldOf(screen.container).value).toBe("");
});

test("a message written across several lines is sent whole", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("việc 1{Enter}việc 2{Enter}việc 3");
  await userEvent.click(screen.getByRole("button", { name: "Gửi" }));

  expect(sent).toEqual(["việc 1\nviệc 2\nviệc 3"]);
});

test("the surrounding whitespace is trimmed off before sending", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("   chào   ");
  await userEvent.click(screen.getByRole("button", { name: "Gửi" }));

  expect(sent).toEqual(["chào"]);
});

test("Gửi is unavailable while there is nothing real to send", async () => {
  const sent: string[] = [];
  const screen = await render(<Harness onSend={(content) => sent.push(content)} />);
  const button = screen.getByRole("button", { name: "Gửi" });

  // Empty.
  await expect.element(button).toBeDisabled();

  // Whitespace only — spaces and a line break are still nothing to say.
  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("   {Enter}   ");
  await expect.element(button).toBeDisabled();

  // Clicking it in that state must not slip a blank message through.
  await userEvent.click(button, { force: true });
  expect(sent).toEqual([]);

  // Real text unlocks it.
  await userEvent.keyboard("xin chào");
  await expect.element(button).toBeEnabled();
});

test("Gửi is held shut while a send is already in flight", async () => {
  const screen = await render(<Harness onSend={() => {}} isSending />);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("tin nhắn");

  await expect.element(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
});

test("the box grows with the message instead of hiding earlier lines", async () => {
  const screen = await render(<Harness onSend={() => {}} />);
  const field = fieldOf(screen.container);

  await userEvent.click(screen.getByRole("textbox", { name: LABEL }));
  await userEvent.keyboard("một dòng");
  const oneLine = field.getBoundingClientRect().height;

  await userEvent.keyboard("{Enter}hai{Enter}ba{Enter}bốn");
  const manyLines = field.getBoundingClientRect().height;

  expect(oneLine).toBeGreaterThan(0);
  expect(manyLines).toBeGreaterThan(oneLine);
});
