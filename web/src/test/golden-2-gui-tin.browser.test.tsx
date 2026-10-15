import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, test } from "vitest";

import { recordMeasure, freshDevice } from "@/test/reliability/record";
import { percentile, TwoPeople, until, type Person } from "@/test/reliability/two-people";

/**
 * 112-A · Luồng 2 (Gửi tin, hai người) — ĐO, không sửa. Mỗi test ghi số đo vào
 * docs/reliability/do-112a/*.json; test chỉ đỏ khi chính cái khung hỏng. Kết luận đạt / không đạt
 * được so với ngưỡng trong docs/specs/Chuan-On-Dinh-2026-10-12.md và ghi vào bảng đo.
 *
 * Each test uses fresh user ids: the device storage (IndexedDB) is shared by every app copy on the
 * page, and an outbox only ever reads its own user's items.
 */
let world: TwoPeople;

const uid = (tag: string): string => `${crypto.randomUUID().slice(0, 8)}-0000-4000-8000-${tag.padStart(12, "0")}`;

beforeEach(async () => {
  await freshDevice();
  world = new TwoPeople();
});

afterEach(async () => {
  await world.dispose();
});

async function pair(conversations: number): Promise<{ lan: Person; minh: Person; rooms: string[] }> {
  const a = uid("a");
  const b = uid("b");
  const rooms = Array.from({ length: conversations }, (_, index) => uid(`c${index}`));
  rooms.forEach((room, index) => world.server.addConversation(room, index === 0 ? "direct" : "group", [a, b]));
  const lan = await world.open(a, "Lan", { conversationId: rooms[0] });
  const minh = await world.open(b, "Minh", { conversationId: rooms[0] });
  await until(() => lan.api.isLive() && minh.api.isLive(), 5_000, "both live");
  return { lan, minh, rooms };
}

const ids = (rows: readonly { id?: unknown }[]): string[] => rows.map((row) => String(row.id));

test(
  "L2.1 · 1.000 tin, chèn lỗi mạng ngẫu nhiên phía người gửi (mất yêu cầu, mất trả lời, rớt mạng) → 0 mất, 0 trùng, đúng thứ tự",
  { timeout: 240_000 },
  async () => {
    const { lan, minh, rooms } = await pair(4);
    lan.net.slow({ latencyMs: 1, jitterMs: 4 });
    lan.net.chaos({ dropRequest: 0.03, dropResponse: 0.03, seed: 112 });
    const total = 1000;
    const written: Map<string, string[]> = new Map(rooms.map((room) => [room, []]));
    const started = performance.now();
    // Rớt mạng hẳn 300 ms, mỗi 2 giây, suốt lúc gửi.
    const flap = window.setInterval(() => {
      lan.net.offline();
      window.setTimeout(() => lan.net.online(), 300);
    }, 2_000);
    for (let index = 0; index < total; index += 1) {
      const room = rooms[index % rooms.length];
      const text = `tin ${String(index).padStart(4, "0")}`;
      written.get(room)?.push(text);
      await lan.api.send(room, text);
    }
    await until(async () => (await lan.api.outbox()).length === 0, 220_000, "outbox drained");
    window.clearInterval(flap);
    lan.net.online();
    const elapsed = performance.now() - started;

    const serverRows = world.server.table("messages");
    const lost: string[] = [];
    const duplicated: string[] = [];
    let orderOk = true;
    for (const room of rooms) {
      const onServer = world.server.thread(room).map((row) => String(row.content));
      const wanted = written.get(room) ?? [];
      for (const text of wanted) {
        const count = onServer.filter((entry) => entry === text).length;
        if (count === 0) lost.push(text);
        if (count > 1) duplicated.push(text);
      }
      if (onServer.join("|") !== wanted.join("|")) orderOk = false;
    }
    // Both people's open thread (room 0) must equal the server's, in the same order.
    await until(() => minh.api.thread(rooms[0]).filter((message) => message.pending !== true).length >= (written.get(rooms[0]) ?? []).length, 20_000, "B has room 0");
    const serverOrder = ids(world.server.thread(rooms[0]));
    const lanOrder = ids(lan.api.thread(rooms[0]).filter((message) => message.pending !== true));
    const minhOrder = ids(minh.api.thread(rooms[0]));
    const serverRoom = world.server.thread(rooms[0]);
    const msOf = (id: string): number => new Date(String(serverRoom.find((row) => row.id === id)?.created_at)).getTime();
    // The thread is a window (newest page + whatever was scrolled back): it must be an unbroken tail of the server's thread.
    const tail = serverOrder.slice(-lanOrder.length);
    const senderMisplaced = tail.filter((id, index) => lanOrder[index] !== id);
    const senderOnlySameMs = tail.every((id, index) => lanOrder[index] === id || msOf(id) === msOf(lanOrder[index]));
    const result = {
      threshold: "0 mất · 0 trùng · thứ tự 100%",
      sent: total,
      onServer: serverRows.length,
      lost: lost.length,
      duplicated: duplicated.length,
      orderSameAsWritten: orderOk,
      senderViewLength: lanOrder.length,
      senderViewIsUnbrokenTailOfServer: senderMisplaced.length === 0,
      receiverViewEqualsServer: minhOrder.slice(-serverOrder.length).join() === serverOrder.join(),
      senderPositionsDifferentFromServer: senderMisplaced.length,
      senderDifferencesOnlyWithinSameMillisecond: senderOnlySameMs,
      network: lan.net.stats,
      elapsedMs: Math.round(elapsed),
      seed: 112,
    };
    await recordMeasure("L2.1-1000-tin", result);
    expect(result.onServer).toBeGreaterThan(0);
  },
);

test("L2.1b · người nhận rớt mạng trong lúc người kia gửi 120 tin → khung chat đang mở của người nhận có đủ 120 tin sau khi nối lại?", { timeout: 60_000 }, async () => {
  const { lan, minh, rooms } = await pair(1);
  const room = rooms[0];
  minh.net.offline();
  for (let index = 0; index < 120; index += 1) await lan.api.send(room, `lỡ ${index}`);
  await until(async () => (await lan.api.outbox()).length === 0, 30_000, "sent");
  minh.net.online();
  // Nối lại → realtime.tsx tải bù (invalidate ["messages"]). Chờ cho yên.
  await until(() => minh.api.isLive(), 5_000, "B live again");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const serverIds = ids(world.server.thread(room));
  const shownIds = minh.api.thread(room).map((message) => message.id);
  const isTail = serverIds.slice(-shownIds.length).join() === shownIds.join();
  // Scroll up as the reader would, page by page, until nothing older comes.
  let pages = 0;
  while ((await minh.api.loadOlder(room)) > 0 && pages < 10) pages += 1;
  const finalIds = minh.api.thread(room).map((message) => message.id);
  await recordMeasure("L2.1b-nguoi-nhan-rot-mang", {
    threshold: "0 tin mất trên màn hình người nhận",
    sentWhileReceiverOffline: 120,
    shownRightAfterReconnect: shownIds.length,
    shownIsUnbrokenNewestTail: isTail,
    pagesScrolledBack: pages,
    afterScrollingBackEqualsServer: finalIds.join() === serverIds.join(),
    note: "Nối lại → tải bù trang mới nhất (50 tin, không lỗ hổng); tin cũ hơn đến khi kéo lên như mọi cuộc dài.",
  });
  expect(shownIds.length).toBeGreaterThan(0);
});

test("L2.2 · bấm Gửi hai lần liền (dblclick thật trên MessageComposer) và Gửi lại hai lần → số tin trên máy chủ", { timeout: 30_000 }, async () => {
  const { lan, rooms } = await pair(1);
  const room = rooms[0];
  const box = lan.container.querySelector("textarea") as HTMLTextAreaElement;
  await userEvent.fill(box, "một lần thôi");
  const sendButton = [...lan.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Gửi" || button.textContent?.trim() === "Gửi") as HTMLButtonElement;
  await userEvent.dblClick(sendButton);
  await until(() => world.server.thread(room).length >= 1, 5_000, "sent");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterDouble = world.server.thread(room).filter((row) => row.content === "một lần thôi").length;

  // Gửi lại hai lần liền một tin đang lỗi (máy chủ đã nhận nhưng câu trả lời bị mất).
  lan.net.chaos({ dropRequest: 0, dropResponse: 1, seed: 2 });
  const id = await lan.api.send(room, "trả lời bị mất");
  await until(() => world.server.thread(room).some((row) => row.id === id), 5_000, "applied");
  lan.net.chaos(null);
  await Promise.all([lan.api.retry(id), lan.api.retry(id)]);
  await until(async () => (await lan.api.outbox()).length === 0, 15_000, "drained");
  const afterRetry = world.server.thread(room).filter((row) => row.content === "trả lời bị mất").length;
  const bubbles = lan.api.thread(room).filter((message) => message.content === "trả lời bị mất").length;
  await recordMeasure("L2.2-bam-hai-lan", { threshold: "0 tin trùng", doubleTapMessages: afterDouble, retryTwiceMessages: afterRetry, retryTwiceBubbles: bubbles });
  expect(afterDouble).toBeGreaterThan(0);
});

test("L2.3 · hai người gửi xen kẽ cùng lúc 2×60 tin → hai bên thấy cùng một thứ tự", { timeout: 60_000 }, async () => {
  const { lan, minh, rooms } = await pair(1);
  const room = rooms[0];
  lan.net.slow({ latencyMs: 2, jitterMs: 20 });
  minh.net.slow({ latencyMs: 2, jitterMs: 20 });
  await Promise.all([
    (async () => {
      for (let index = 0; index < 60; index += 1) await lan.api.send(room, `L${index}`);
    })(),
    (async () => {
      for (let index = 0; index < 60; index += 1) await minh.api.send(room, `M${index}`);
    })(),
  ]);
  await until(async () => (await lan.api.outbox()).length === 0 && (await minh.api.outbox()).length === 0, 30_000, "drained");
  await until(() => lan.api.thread(room).filter((m) => m.pending !== true).length >= 120 && minh.api.thread(room).filter((m) => m.pending !== true).length >= 120, 15_000, "both have 120");
  const serverRows = world.server.thread(room);
  const server = ids(serverRows);
  const lanView = ids(lan.api.thread(room));
  const minhView = ids(minh.api.thread(room));
  const ms = (id: string): number => new Date(String(serverRows.find((row) => row.id === id)?.created_at)).getTime();
  const misplaced = server.map((id, index) => ({ id, index })).filter(({ id, index }) => lanView[index] !== id);
  // Every misplaced message shares its millisecond with the one it swapped with (ties broken by id).
  const onlySameMillisecond = misplaced.every(({ id, index }) => ms(id) === ms(lanView[index]));
  await recordMeasure("L2.3-thu-tu-hai-nguoi", {
    threshold: "100% cùng thứ tự giữa hai người",
    messages: server.length,
    personAEqualsPersonB: lanView.join() === minhView.join(),
    clientEqualsServerOrder: lanView.join() === server.join(),
    positionsDifferentFromServer: misplaced.length,
    differencesOnlyWithinSameMillisecond: onlySameMillisecond,
    note: "Máy chủ xếp (created_at µs, id); app xếp theo mili-giây rồi id (chat-cache.ts compareMessages). Hai người luôn cùng thứ tự với nhau; chỉ tin trong cùng 1 ms có thể lệch so với máy chủ.",
  });
  expect(server.length).toBe(120);
});

test("L2.4 · trạng thái bong bóng: Chờ gửi… → Đang chờ mạng (mất mạng) → Đã gửi; lỗi vĩnh viễn → Chưa gửi được · Gửi lại", { timeout: 45_000 }, async () => {
  const { lan, rooms } = await pair(1);
  const room = rooms[0];
  const seen: string[] = [];
  const watch = (id: string): (() => void) => {
    const timer = window.setInterval(() => {
      const label = lan.container.querySelector(`[data-id="${id}"] [data-testid="bubble-label"]`)?.textContent ?? null;
      if (label !== null && seen[seen.length - 1] !== label) seen.push(label);
    }, 5);
    return () => window.clearInterval(timer);
  };
  lan.net.slow({ latencyMs: 150 });
  lan.net.offline();
  const id = await lan.api.send(room, "trạng thái");
  const stop = watch(id);
  await until(() => seen.includes("Đang chờ mạng"), 5_000, "waiting label");
  lan.net.online();
  await until(() => seen.includes("Đã gửi"), 5_000, "sent label");
  stop();

  // Lỗi vĩnh viễn: người kia đã chặn (máy chủ trả avora_contact_unavailable).
  world.server.refuse = (_user, name) => (name === "send_message" ? { message: "avora_contact_unavailable", code: "P0001" } : null);
  const failedSeen: string[] = [];
  const failStarted = performance.now();
  const id2 = await lan.api.send(room, "người kia đã chặn");
  const msToFailed = await until(() => {
    const label = lan.container.querySelector(`[data-id="${id2}"] [data-testid="bubble-label"]`)?.textContent ?? "";
    if (failedSeen[failedSeen.length - 1] !== label) failedSeen.push(label);
    return label === "Chưa gửi được · Gửi lại";
  }, 25_000, "failed label").catch(() => -1);
  const serverAttempts = world.server.calls.filter((call) => call.name === "send_message" && (call.args as { p_id?: string }).p_id === id2).length;
  void failStarted;
  world.server.refuse = null;
  await recordMeasure("L2.4-trang-thai", {
    threshold: "100% có trạng thái rõ: đang gửi, đã gửi, gửi lỗi (kèm nút thử lại)",
    networkPath: seen,
    permanentFailurePath: failedSeen,
    blockedSendMsUntilFailedLabel: Math.round(msToFailed),
    blockedSendServerAttempts: serverAttempts,
    before112C: { blockedSendMsUntilFailedLabel: 16590, blockedSendServerAttempts: 5 },
    note: "Nhãn đọc từ bong bóng của khung đo, cùng quy tắc chọn chữ với Messages.tsx. 112-C: lỗi vĩnh viễn dừng ở lần thử đầu.",
  });
  expect(seen.length).toBeGreaterThan(0);
  // 112-C · LOI-01: bị chặn → "Chưa gửi được" ở lần thử đầu, không thử lại 5 lần.
  expect(serverAttempts).toBe(1);
  expect(msToFailed).toBeGreaterThanOrEqual(0);
  expect(msToFailed).toBeLessThan(2_000);
});


test("L2.5 · tin chờ gửi còn nguyên sau khi tải lại và sau khi tắt hẳn app (đang gửi dở)", { timeout: 30_000 }, async () => {
  const { lan, minh, rooms } = await pair(1);
  const room = rooms[0];
  lan.net.offline();
  const waiting = [await lan.api.send(room, "chờ 1"), await lan.api.send(room, "chờ 2"), await lan.api.send(room, "chờ 3")];
  await lan.reload();
  const afterReload = (await lan.api.outbox()).map((item) => item.id);
  const bubblesAfterMs = await until(() => lan.api.thread(room).filter((message) => message.pending === true).length === 3, 3_000, "bubbles back").catch(() => -1);
  const shownAfterReload = lan.api.thread(room).filter((message) => message.pending === true).length;
  // Tắt hẳn giữa lúc gửi: mạng chậm, đóng app khi yêu cầu đang trên đường đi.
  lan.net.slow({ latencyMs: 200 });
  lan.net.online();
  await new Promise((resolve) => setTimeout(resolve, 50));
  lan.close();
  await new Promise((resolve) => setTimeout(resolve, 600));
  lan.net.slow({ latencyMs: 0 });
  await lan.open();
  await until(async () => (await lan.api.outbox()).length === 0, 10_000, "drained after reopen");
  await until(() => minh.api.thread(room).filter((m) => m.content.startsWith("chờ")).length >= 3, 5_000, "B has 3").catch(() => 0);
  const onServer = world.server.thread(room).map((row) => String(row.content));
  await recordMeasure("L2.5-tai-lai-tat-app", {
    threshold: "100% tin chờ còn nguyên",
    queued: waiting.length,
    keptAfterReload: waiting.filter((id) => afterReload.includes(id)).length,
    bubblesShownAfterReload: shownAfterReload,
    bubblesBackWithinMs: Math.round(bubblesAfterMs),
    onServerAfterKillAndReopen: onServer.filter((text) => text.startsWith("chờ")).length,
    duplicatesOnServer: onServer.length - new Set(onServer).size,
    receiverGot: minh.api.thread(room).filter((m) => m.content.startsWith("chờ")).length,
  });
  expect(afterReload.length).toBeGreaterThanOrEqual(0);
});

test("L2.6 · nháp riêng từng cuộc: viết dở ở cuộc 1, chuyển sang cuộc 2 rồi gửi → tin đi đúng cuộc 2, nháp cuộc 1 còn", { timeout: 30_000 }, async () => {
  const { lan, rooms } = await pair(2);
  const [first, second] = rooms;
  await userEvent.fill(lan.container.querySelector("textarea") as HTMLTextAreaElement, "nháp của cuộc một");
  lan.api.open(second);
  await until(() => (lan.container.querySelector("textarea") as HTMLTextAreaElement | null)?.value === "", 3_000, "second box empty");
  await userEvent.fill(lan.container.querySelector("textarea") as HTMLTextAreaElement, "gửi cuộc hai");
  const sendButton = [...lan.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Gửi" || button.textContent?.trim() === "Gửi") as HTMLButtonElement;
  await userEvent.click(sendButton);
  await until(() => world.server.thread(second).length === 1, 5_000, "sent to second");
  lan.api.open(first);
  await until(() => (lan.container.querySelector("textarea") as HTMLTextAreaElement | null)?.value === "nháp của cuộc một", 3_000, "first draft back").catch(() => 0);
  await lan.reload();
  lan.api.open(first);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const draftAfterReload = (lan.container.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? null;
  await recordMeasure("L2.6-nhap-rieng-tung-cuoc", {
    threshold: "0 gửi nhầm cuộc",
    wrongConversation: world.server.thread(first).length,
    sentToSecond: world.server.thread(second).map((row) => row.content),
    firstDraftAfterReload: draftAfterReload,
  });
  expect(world.server.thread(second).length).toBe(1);
});

test("L2.7 · thời gian tới người nhận (cả hai đang mở app), mạng 4G mô phỏng 30–90 ms mỗi chiều → p95", { timeout: 60_000 }, async () => {
  const { lan, minh, rooms } = await pair(1);
  const room = rooms[0];
  lan.net.slow({ latencyMs: 30, jitterMs: 60 });
  minh.net.slow({ latencyMs: 30, jitterMs: 60 });
  const samples: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const text = `đo ${index}`;
    const started = performance.now();
    await lan.api.send(room, text);
    await until(() => minh.api.thread(room).some((message) => message.content === text), 5_000, text);
    samples.push(performance.now() - started);
  }
  const p95 = percentile(samples, 95);
  await recordMeasure("L2.7-p95-toi-nguoi-nhan", {
    threshold: "p95 ≤ 2000 ms",
    samples: samples.length,
    p50Ms: Math.round(percentile(samples, 50)),
    p95Ms: Math.round(p95),
    maxMs: Math.round(Math.max(...samples)),
    note: "Mạng mô phỏng trong trình duyệt; đo phần app (outbox → máy chủ → broadcast → khung chat). Độ trễ Realtime thật đo lại ở 112-D và trên máy thật.",
  });
  expect(samples.length).toBe(60);
});

test("L2.8 · sửa, thu hồi, trả lời, chuyển tiếp → kết quả đúng ở cả hai phía", { timeout: 30_000 }, async () => {
  const { lan, minh, rooms } = await pair(2);
  const [room, other] = rooms;
  const original = await lan.api.send(room, "bản gốc");
  await until(() => minh.api.thread(room).some((m) => m.id === original && m.pending !== true), 5_000, "B has original");
  await lan.api.edit(original, "bản đã sửa");
  await until(() => minh.api.thread(room).find((m) => m.id === original)?.content === "bản đã sửa", 5_000, "B sees edit").catch(() => 0);
  const editBothSides = lan.api.thread(room).find((m) => m.id === original)?.content === "bản đã sửa" && minh.api.thread(room).find((m) => m.id === original)?.content === "bản đã sửa";

  const reply = await minh.api.send(room, "trả lời đây", { replyTo: original });
  await until(() => lan.api.thread(room).some((m) => m.id === reply && m.pending !== true), 5_000, "A has reply");
  const replyBothSides = lan.api.thread(room).find((m) => m.id === reply)?.replyToMessageId === original && minh.api.thread(room).find((m) => m.id === reply)?.replyToMessageId === original;

  const forwarded = await lan.api.forward([original], other);
  const copy = world.server.thread(other)[0];
  const forwardOk = forwarded === 1 && copy?.content === "bản đã sửa" && copy?.origin_content_id === original;

  const toRecall = await lan.api.send(room, "sẽ thu hồi");
  await until(() => minh.api.thread(room).some((m) => m.id === toRecall && m.pending !== true), 5_000, "B has recall target");
  await lan.api.recall(toRecall);
  await until(() => minh.api.thread(room).find((m) => m.id === toRecall)?.deletedAt != null, 5_000, "B sees recall").catch(() => 0);
  const recallBothSides =
    lan.api.thread(room).find((m) => m.id === toRecall)?.deletedAt != null &&
    minh.api.thread(room).find((m) => m.id === toRecall)?.deletedAt != null &&
    minh.api.thread(room).find((m) => m.id === toRecall)?.content === "";
  await recordMeasure("L2.8-sua-thu-hoi-tra-loi-chuyen-tiep", {
    threshold: "100% đúng hai phía",
    editBothSides,
    replyBothSides,
    forwardOk,
    recallBothSides,
    note: "Bên gửi tự cập nhật bằng broadcast message_update (Messages.tsx còn vá cache ngay từ câu trả lời RPC).",
  });
  expect(typeof editBothSides).toBe("boolean");
});

test("L2.9 · phiên hết hạn giữa lúc gửi (máy chủ trả JWT expired 3 giây, rồi phiên được làm mới) → tin không mất, không trùng", { timeout: 40_000 }, async () => {
  const { lan, minh, rooms } = await pair(1);
  const room = rooms[0];
  lan.net.expireSession();
  const started = performance.now();
  const id = await lan.api.send(room, "gửi lúc phiên hết hạn");
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const labelWhileExpired = lan.container.querySelector(`[data-id="${id}"] [data-testid="bubble-label"]`)?.textContent ?? null;
  lan.net.renewSession();
  const delivered = await until(() => minh.api.thread(room).some((message) => message.id === id), 30_000, "delivered after renew").then(() => true, () => false);
  await recordMeasure("L2.9-phien-het-han", {
    threshold: "0 mất · 0 trùng",
    labelWhileExpired,
    deliveredAfterRenew: delivered,
    msUntilDelivered: Math.round(performance.now() - started),
    copiesOnServer: world.server.thread(room).filter((row) => row.id === id).length,
    expiredReplies: lan.net.stats.expiredReplies,
    note: "JWT expired → câu 'Có lỗi xảy ra' → hàng chờ coi là lỗi tạm, thử lại 1/2/4/8 s; quá 5 lần thì 'Chưa gửi được · Gửi lại'.",
  });
  expect(typeof delivered).toBe("boolean");
});
