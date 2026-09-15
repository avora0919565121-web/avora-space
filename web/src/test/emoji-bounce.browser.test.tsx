import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ReactionPicker } from "@/components/chat/MessageReactions";
import { EMOJI_BOUNCE_MS } from "@/lib/emoji-bounce";
import { MORE_REACTIONS, QUICK_REACTIONS } from "@/lib/reactions";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Harness({ onPick = () => {} }: { onPick?: (emoji: string) => void }) {
  return (
    <div style={{ width: 375, padding: 16 }}>
      <ReactionPicker onPick={onPick} label="tin nhắn của Minh" />
    </div>
  );
}

function bouncingCount(): number {
  return document.querySelectorAll(".animate-emoji-bounce").length;
}

test("every emoji in the quick bar bounces when pressed, not only the heart", async () => {
  const screen = await render(<Harness />);

  for (const entry of QUICK_REACTIONS) {
    await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
    await userEvent.click(screen.getByRole("button", { name: entry.label }));

    const pressed = document.querySelector(".animate-emoji-bounce");
    expect(pressed, `${entry.emoji} should bounce`).not.toBeNull();
    expect(pressed?.textContent).toBe(entry.emoji);

    // Let the sheet close on its own before reaching for the next feeling.
    await sleep(EMOJI_BOUNCE_MS + 220);
  }
});

test("an emoji from the fuller set bounces too", async () => {
  const emoji = MORE_REACTIONS[0];
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Thêm cảm xúc khác" }));
  await userEvent.click(screen.getByRole("button", { name: `Thả ${emoji}` }));

  expect(document.querySelector(".animate-emoji-bounce")?.textContent).toBe(emoji);
});

test("only the pressed emoji moves, so which one took the tap is unambiguous", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Cười" }));

  expect(bouncingCount()).toBe(1);
});

test("the reaction is saved on press, without waiting for the animation", async () => {
  const picked: string[] = [];
  const screen = await render(<Harness onPick={(emoji) => picked.push(emoji)} />);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Thương" }));

  // Pressed and already sent — the wait belongs to the animation, never to the data.
  expect(picked).toEqual(["❤️"]);
});

test("the picker stays open just long enough to show the bounce, then closes", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Cảm ơn" }));

  // Still there while it plays: closing on the same frame would throw the feedback away.
  expect(bouncingCount()).toBe(1);

  await sleep(EMOJI_BOUNCE_MS + 220);
  expect(bouncingCount()).toBe(0);
  await expect.element(screen.getByRole("button", { name: /Thả cảm xúc/ })).toBeInTheDocument();
});

test("pressing a second feeling sends that one too", async () => {
  const picked: string[] = [];
  const screen = await render(<Harness onPick={(emoji) => picked.push(emoji)} />);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Buồn" }));
  await sleep(EMOJI_BOUNCE_MS + 220);

  await userEvent.click(screen.getByRole("button", { name: /Thả cảm xúc/ }));
  await userEvent.click(screen.getByRole("button", { name: "Nhất trí" }));

  expect(picked).toEqual(["😢", "🤝"]);
});
