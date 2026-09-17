import { userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { AssigneePicker } from "@/components/chat/AssigneePicker";
import type { GroupMember } from "@/lib/groups";

function member(userId: string, displayName: string, email: string): GroupMember {
  return { userId, displayName, email, role: "member", joinedAt: "2026-01-01T00:00:00Z" };
}

const MEMBERS: GroupMember[] = [
  member("u-hoa", "Nguyễn Thị Hoà", "hoa@avora.vn"),
  member("u-dung", "Trần Dũng", "dung@avora.vn"),
  member("u-dat", "Đặng Văn Đạt", "dat@avora.vn"),
  member("u-me", "Chính tôi", "me@avora.vn"),
];

function Harness({
  onChange,
  allowSelf = false,
}: {
  onChange?: (ids: string[]) => void;
  allowSelf?: boolean;
}) {
  const [selected, setSelected] = useState<GroupMember[]>([]);
  return (
    <div style={{ width: 375, padding: 16 }}>
      <AssigneePicker
        id="assignee"
        members={MEMBERS}
        selected={selected}
        selfId="u-me"
        allowSelf={allowSelf}
        onChange={(next) => {
          setSelected(next);
          onChange?.(next.map((entry) => entry.userId));
        }}
      />
    </div>
  );
}

function optionNames(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map(
    (node) => node.querySelector("[data-member-name]")?.textContent?.trim() ?? "",
  );
}

test("it is a box you type into, not a dropdown to read through", async () => {
  const screen = await render(<Harness />);
  expect(screen.container.querySelector("select")).toBeNull();
  await expect.element(screen.getByRole("combobox")).toBeVisible();
});

test("typing without diacritics still finds the person", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("hoa");

  expect(optionNames()).toEqual(["Nguyễn Thị Hoà"]);
});

test("đ is folded too, so 'dat' finds Đạt", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("dat");

  expect(optionNames()).toEqual(["Đặng Văn Đạt"]);
});

test("in a 1-1 the author is never offered their own task", async () => {
  const screen = await render(<Harness />);
  await userEvent.click(screen.getByRole("combobox"));

  expect(optionNames()).not.toContain("Chính tôi");
  expect(optionNames()).toHaveLength(3);
});

/**
 * A group is the one room where naming yourself means something: taking work on in front of
 * everybody, with nobody left to ask.
 */
test("a group lets somebody take the work on themselves", async () => {
  const screen = await render(<Harness allowSelf />);
  await userEvent.click(screen.getByRole("combobox"));

  expect(optionNames()).toHaveLength(4);
  // And says which one is them, because choosing it behaves differently.
  await expect.element(screen.getByRole("option", { name: /Chính tôi \(bạn\)/ })).toBeVisible();
});

test("choosing yourself works like choosing anybody else", async () => {
  const picked: string[][] = [];
  const screen = await render(<Harness allowSelf onChange={(ids) => picked.push(ids)} />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: /Chính tôi/ }));

  expect(picked[picked.length - 1]).toEqual(["u-me"]);
});

test("several people can be chosen, each becoming a chip", async () => {
  const picked: string[][] = [];
  const screen = await render(<Harness onChange={(ids) => picked.push(ids)} />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("hoa");
  await userEvent.click(screen.getByRole("option", { name: /Hoà/ }));

  await userEvent.keyboard("dung");
  await userEvent.click(screen.getByRole("option", { name: /Dũng/ }));

  await userEvent.keyboard("dat");
  await userEvent.click(screen.getByRole("option", { name: /Đạt/ }));

  expect(picked[picked.length - 1]).toEqual(["u-hoa", "u-dung", "u-dat"]);
  // And the intent is spelled out rather than assumed.
  await expect
    .element(screen.getByText("Giao cho 3 người — tạo 3 nhiệm vụ riêng"))
    .toBeVisible();
});

test("someone chosen is no longer offered, so nobody is picked twice", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("hoa");
  await userEvent.click(screen.getByRole("option", { name: /Hoà/ }));

  expect(optionNames()).not.toContain("Nguyễn Thị Hoà");
});

test("a chip can be taken back off before the task is created", async () => {
  const picked: string[][] = [];
  const screen = await render(<Harness onChange={(ids) => picked.push(ids)} />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("hoa");
  await userEvent.click(screen.getByRole("option", { name: /Hoà/ }));
  await userEvent.keyboard("dung");
  await userEvent.click(screen.getByRole("option", { name: /Dũng/ }));

  await userEvent.click(screen.getByRole("button", { name: "Bỏ Nguyễn Thị Hoà khỏi danh sách" }));

  expect(picked[picked.length - 1]).toEqual(["u-dung"]);
});

test("a name nobody answers to says so instead of showing everyone", async () => {
  const screen = await render(<Harness />);

  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("khanh");

  expect(optionNames()).toEqual([]);
  await expect.element(screen.getByText(/Không có ai khớp/)).toBeVisible();
});
