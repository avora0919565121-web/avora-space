import { afterEach, beforeEach, expect, test } from "vitest";

import { freshDevice } from "@/test/reliability/record";
import { TwoPeople, until } from "@/test/reliability/two-people";

/** 112-A · 2 — the harness itself: two independent app copies, one server, messages both ways. */
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const D = "dddddddd-0000-4000-8000-0000000000d1";

let world: TwoPeople;

beforeEach(async () => {
  await freshDevice();
  world = new TwoPeople();
  world.server.addConversation(D, "direct", [A, B]);
});

afterEach(async () => {
  await world.dispose();
});

test("harness · two app copies are independent and meet only through the server", async () => {
  const lan = await world.open(A, "Lan", { conversationId: D });
  const minh = await world.open(B, "Minh", { conversationId: D });
  await until(() => lan.api.isLive() && minh.api.isLive(), 5_000, "both live");
  expect(lan.client).not.toBe(minh.client);
  expect(lan.api.queryClient).not.toBe(minh.api.queryClient);

  await lan.api.send(D, "chào Minh");
  await until(() => minh.api.thread(D).some((message) => message.content === "chào Minh"), 5_000, "B receives");
  await minh.api.send(D, "chào Lan");
  await until(() => lan.api.thread(D).some((message) => message.content === "chào Lan"), 5_000, "A receives");
  expect(world.server.thread(D).map((row) => [row.sender_id, row.content])).toEqual([[A, "chào Minh"], [B, "chào Lan"]]);
});
