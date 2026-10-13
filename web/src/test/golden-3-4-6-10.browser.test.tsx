import { afterEach, beforeEach, expect, test } from "vitest";

import type { StagedAttachment } from "@/lib/attachments";
import type { ConversationSummary } from "@/lib/chat-cache";
import { filterContacts, type Contact } from "@/lib/contacts";
import type { TaskItem } from "@/lib/tasks";
import { LONG_NAMES } from "@/test/fixtures/long-data";
import { freshDevice, recordMeasure } from "@/test/reliability/record";
import { percentile, TwoPeople, until } from "@/test/reliability/two-people";

/**
 * 112-A · Luồng 3, 4, 6, 10 (phần có người thứ hai / thiết bị thứ hai) — ĐO, không sửa.
 * Số đo ghi vào docs/reliability/do-112a/*.json.
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

function summary(conversationId: string, unread: number): ConversationSummary {
  return {
    conversationId,
    kind: "direct",
    peerId: null,
    peerName: "Minh",
    peerEmail: null,
    groupName: null,
    memberCount: 2,
    lastMessageContent: "…",
    lastMessageAt: new Date().toISOString(),
    lastMessageSenderId: null,
    unreadCount: unread,
    sortAt: new Date().toISOString(),
  };
}

test("L3.4 + L10.5 · đọc ở máy thứ hai → số chưa đọc ở máy thứ nhất về 0 (cùng tài khoản, hai thiết bị)", { timeout: 30_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const phone = await world.open(a, "Lan · điện thoại", { conversationId: null, inbox: [summary(room, 0)] });
  const laptop = await world.open(a, "Lan · máy tính", { conversationId: null, inbox: [summary(room, 0)] });
  const minh = await world.open(b, "Minh", { conversationId: room });
  await until(() => phone.api.isLive() && laptop.api.isLive() && minh.api.isLive(), 5_000, "live");
  for (let index = 0; index < 3; index += 1) await minh.api.send(room, `chưa đọc ${index}`);
  await until(() => phone.api.inbox()[0]?.unreadCount === 3 && laptop.api.inbox()[0]?.unreadCount === 3, 5_000, "3 unread on both").catch(() => 0);
  const before = { phone: phone.api.inbox()[0]?.unreadCount, laptop: laptop.api.inbox()[0]?.unreadCount };
  const started = performance.now();
  await laptop.api.markRead(room);
  const cleared = await until(() => phone.api.inbox()[0]?.unreadCount === 0, 5_000, "phone cleared").catch(() => -1);
  await recordMeasure("L3.4-chua-doc-hai-may", {
    threshold: "100% khớp sau khi đọc ở máy khác",
    unreadBefore: before,
    phoneUnreadAfter: phone.api.inbox()[0]?.unreadCount,
    laptopUnreadAfter: laptop.api.inbox()[0]?.unreadCount,
    phoneClearedAfterMs: cleared < 0 ? null : Math.round(performance.now() - started),
  });
  expect(before.phone).toBeDefined();
});

function task(id: string, creator: string, assignee: string, conversationId: string, status = "pending_confirmation"): Record<string, unknown> & { id: string; creator_id: string; assignee_id: string } {
  const now = new Date().toISOString();
  return {
    id,
    type: "shared",
    creator_id: creator,
    assignee_id: assignee,
    context_snapshot: null,
    conversation_id: conversationId,
    title: `Việc ${id.slice(0, 4)}`,
    description: "",
    status,
    confirmed_at: null,
    done_at: null,
    completed_confirmed_at: null,
    skipped_at: null,
    skipped_silently: false,
    deadline_date: "2026-10-14",
    deadline_time: null,
    deadline_tz: "Asia/Ho_Chi_Minh",
    task_category_id: null,
    is_important: false,
    is_milestone: false,
    progress_percent: null,
    output_value: null,
    recurrence: null,
    recurrence_pattern: null,
    recurrence_spawned_at: null,
    deleted_by_creator: false,
    deleted_by_peer: false,
    created_at: now,
  };
}

test("L4.1 + L4.2 · giao 30 việc A → B (4G mô phỏng): B thấy việc, p95; đổi trạng thái / hạn / người làm đồng bộ hai phía", { timeout: 60_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const lan = await world.open(a, "Lan", { conversationId: null, tasks: [] as TaskItem[] });
  const minh = await world.open(b, "Minh", { conversationId: null, tasks: [] as TaskItem[] });
  await until(() => lan.api.isLive() && minh.api.isLive(), 5_000, "live");
  lan.net.slow({ latencyMs: 30, jitterMs: 60 });
  minh.net.slow({ latencyMs: 30, jitterMs: 60 });
  const samples: number[] = [];
  let seen = 0;
  for (let index = 0; index < 30; index += 1) {
    const id = crypto.randomUUID();
    const started = performance.now();
    // The real create goes through an RPC; the delivery path under test is the server's change → B's screen.
    await lan.net.delay();
    world.server.upsertTask(task(id, a, b, room));
    const ok = await until(() => minh.api.tasks().some((entry) => entry.id === id), 5_000, "B sees task").then(() => true, () => false);
    if (ok) {
      seen += 1;
      samples.push(performance.now() - started);
    }
  }
  const target = minh.api.tasks()[0];
  world.server.upsertTask({ ...task(target.id, a, b, room, "confirmed"), deadline_date: "2026-10-20" });
  const synced = await until(
    () => lan.api.tasks().find((entry) => entry.id === target.id)?.status === "confirmed" && minh.api.tasks().find((entry) => entry.id === target.id)?.deadline === "2026-10-20",
    5_000,
    "status + deadline both sides",
  ).then(() => true, () => false);
  await recordMeasure("L4.1-giao-viec-p95", {
    threshold: "p95 ≤ 2000 ms, 100% thấy; đồng bộ hai phía 100%",
    assigned: 30,
    seenByAssignee: seen,
    p50Ms: Math.round(percentile(samples, 50)),
    p95Ms: Math.round(percentile(samples, 95)),
    statusAndDeadlineSyncedBothSides: synced,
    note: "Đường đi: thay đổi bảng tasks → postgres_changes (RLS) → realtime.tsx handleTaskChange → danh sách việc. Bài đo chỉ có ý nghĩa khi danh sách việc đã nằm trong bộ nhớ đệm (màn Việc đã mở).",
  });
  expect(seen).toBeGreaterThan(0);
});

function stagedFile(name: string, bytes: number): StagedAttachment {
  return {
    localId: crypto.randomUUID(),
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    kind: "file",
    fileName: name,
    mimeType: "application/pdf",
    byteSize: bytes,
    width: null,
    height: null,
    durationSeconds: null,
    permission: "forward",
    captureSource: null,
    previewUrl: null,
  };
}

test("L6.3 · tệp mồ côi: tải lên xong rồi tin bị từ chối / người gửi bấm Bỏ → tệp còn nằm trong kho?", { timeout: 40_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const lan = await world.open(a, "Lan", { conversationId: room });
  await until(() => lan.api.isLive(), 5_000, "live");

  // (1) Tệp lên kho, rồi máy chủ từ chối tin (người kia vừa chặn) → bong bóng lỗi → bấm Bỏ.
  world.server.refuse = (_user, name) => (name === "send_message" ? { message: "avora_not_a_participant", code: "42501" } : null);
  const first = await lan.api.send(room, "", { files: [stagedFile("hop-dong.pdf", 2048)] });
  await until(async () => (await lan.api.outbox()).some((item) => item.id === first && item.state === "failed"), 10_000, "failed").catch(() => 0);
  world.server.refuse = null;
  await lan.api.drop(first);

  // (2) Tệp lên kho, mạng rớt trước khi gửi tin → chờ mạng → người gửi bấm Bỏ.
  let uploads = 0;
  world.server.refuse = (_user, name) => (name === "send_message" ? null : null);
  const watcher = window.setInterval(() => {
    uploads = world.server.calls.filter((call) => call.name.startsWith("storage.upload")).length;
    if (uploads >= 2) lan.net.offline();
  }, 1);
  const second = await lan.api.send(room, "kèm tệp", { files: [stagedFile("bao-gia.pdf", 4096)] });
  await until(async () => (await lan.api.outbox()).some((item) => item.id === second && item.state === "waiting_network"), 10_000, "waiting").catch(() => 0);
  window.clearInterval(watcher);
  await lan.api.drop(second);
  lan.net.online();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const orphans = world.server.orphans("chat-attachments");
  await recordMeasure("L6.3-tep-mo-coi", {
    threshold: "0 tệp mồ côi",
    orphanFiles: orphans.length,
    orphanPaths: orphans.map((path) => path.split("/").slice(-1)[0]),
    note: "use-outbox.ts · drop() chỉ xoá mục trong hàng chờ; tệp đã tải lên (storagePath) không bị xoá khỏi kho.",
  });
  expect(Array.isArray(orphans)).toBe(true);
});

test("L10.1 · cuộc trò chuyện 5.000 tin: mở → 30 tin mới nhất hiện (4G mô phỏng)", { timeout: 60_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const base = Date.now() - 5_000 * 1_000;
  for (let index = 0; index < 5_000; index += 1) {
    world.server.table("messages").push({
      id: crypto.randomUUID(),
      conversation_id: room,
      sender_id: index % 2 === 0 ? a : b,
      content: `Tin số ${index} — ${LONG_NAMES[index % LONG_NAMES.length]}`,
      created_at: new Date(base + index * 1_000).toISOString(),
      edited_at: null,
      deleted_at: null,
      trashed_at: null,
      reply_to_message_id: null,
      mentioned_user_ids: [],
      origin_group_id: null,
      attachment_count: 0,
      origin_content_id: null,
      origin_sender_id: null,
      system_kind: null,
    });
  }
  const runs: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    const person = await world.open(b, `Minh ${run}`, { conversationId: null });
    person.net.slow({ latencyMs: 30, jitterMs: 60 });
    person.api.open(room);
    await until(() => person.container.querySelectorAll('[data-testid="bubble"]').length >= 30, 10_000, "30 bubbles");
    runs.push(performance.now() - started);
    person.close();
  }
  await recordMeasure("L10.1-5000-tin", {
    threshold: "≤ 1500 ms",
    messagesInConversation: 5_000,
    runsMs: runs.map((value) => Math.round(value)),
    worstMs: Math.round(Math.max(...runs)),
    note: "Từ lúc mở bản app đến khi 30 bong bóng mới nhất có trên màn hình (gồm khởi động app). Máy chủ thật đọc theo chỉ mục (k3_speed.sql); máy thật đo tay.",
  });
  expect(runs.length).toBe(3);
});

test("L10.2 · danh bạ 1.000 người (tên dài, nhiều ngôn ngữ): tìm không dấu → p95 thời gian lọc", async () => {
  const contacts: Contact[] = Array.from({ length: 1_000 }, (_, index) => ({
    id: `c${index}`,
    contactType: "individual",
    name: `${LONG_NAMES[index % LONG_NAMES.length]} ${index}`,
    phone: `09${String(10_000_000 + index).slice(0, 8)}`,
    email: index % 3 === 0 ? `nguoi${index}@vi-du.vn` : null,
  })) as unknown as Contact[];
  const queries = ["nguyen", "đạt", "tran thi", "0912", "phương", "le", "hoang", "vi-du", "zzz", "ngô nhật"];
  const samples: number[] = [];
  for (let round = 0; round < 5; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      filterContacts(contacts, query);
      samples.push(performance.now() - started);
    }
  }
  await recordMeasure("L10.2-danh-ba-1000", {
    threshold: "tìm ≤ 300 ms · cuộn ≥ 50 khung hình/giây",
    contacts: 1_000,
    searches: samples.length,
    p95FilterMs: Math.round(percentile(samples, 95) * 10) / 10,
    maxFilterMs: Math.round(Math.max(...samples) * 10) / 10,
    scrolling: "thử tay (khung hình/giây không đo được trong trình duyệt không màn hình)",
  });
  expect(samples.length).toBe(50);
});

test("L10.3 · mạng 3G chậm + chập chờn (400 ms mỗi chiều, 10% rớt): 50 tin → không treo, không mất", { timeout: 120_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const lan = await world.open(a, "Lan", { conversationId: room });
  const minh = await world.open(b, "Minh", { conversationId: room });
  await until(() => lan.api.isLive() && minh.api.isLive(), 5_000, "live");
  lan.net.slow({ latencyMs: 400, jitterMs: 200 });
  lan.net.chaos({ dropRequest: 0.05, dropResponse: 0.05, seed: 3 });
  const started = performance.now();
  const sendStarts: number[] = [];
  for (let index = 0; index < 50; index += 1) {
    const before = performance.now();
    await lan.api.send(room, `3G ${index}`);
    sendStarts.push(performance.now() - before);
  }
  const drained = await until(async () => (await lan.api.outbox()).length === 0, 110_000, "drained").then(() => true, () => false);
  const onServer = world.server.thread(room).map((row) => String(row.content));
  await recordMeasure("L10.3-3g-chap-chon", {
    threshold: "0 treo, 0 mất",
    sent: 50,
    drained,
    onServer: onServer.length,
    duplicates: onServer.length - new Set(onServer).size,
    longestTapToBubbleMs: Math.round(Math.max(...sendStarts)),
    totalMs: Math.round(performance.now() - started),
    network: lan.net.stats,
    note: "'Không treo' = bấm Gửi trả lời ngay (bong bóng hiện) dù mạng chậm; tin đi dần sau.",
  });
  expect(onServer.length).toBeGreaterThan(0);
});

test("L10.5 · hai tab cùng tài khoản: tab 1 mất mạng xếp 5 tin, tab 2 gửi tiếp → không trùng, đúng thứ tự", { timeout: 30_000 }, async () => {
  const a = uid("a");
  const b = uid("b");
  const room = uid("d");
  world.server.addConversation(room, "direct", [a, b]);
  const tab1 = await world.open(a, "Lan · tab 1", { conversationId: room });
  const tab2 = await world.open(a, "Lan · tab 2", { conversationId: room });
  await until(() => tab1.api.isLive() && tab2.api.isLive(), 5_000, "live");
  tab1.net.offline();
  for (let index = 0; index < 5; index += 1) await tab1.api.send(room, `tab1 ${index}`);
  await tab2.api.send(room, "tab2 0");
  await until(() => world.server.thread(room).length >= 6, 5_000, "tab2 carried all").catch(() => 0);
  tab1.net.online();
  await until(async () => (await tab1.api.outbox()).length === 0, 10_000, "tab1 drained").catch(() => 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const onServer = world.server.thread(room).map((row) => String(row.content));
  await recordMeasure("L10.5-hai-tab", {
    threshold: "0 lỗi xung đột",
    onServer,
    duplicates: onServer.length - new Set(onServer).size,
    orderAsWritten: onServer.join("|") === ["tab1 0", "tab1 1", "tab1 2", "tab1 3", "tab1 4", "tab2 0"].join("|"),
    tab1Equals2: tab1.api.thread(room).filter((m) => m.pending !== true).map((m) => m.id).join() === tab2.api.thread(room).filter((m) => m.pending !== true).map((m) => m.id).join(),
    note: "Hai tab dùng chung IndexedDB của trình duyệt (như máy thật): tab 2 thấy và gửi luôn hàng chờ của tab 1; máy chủ chặn trùng nhờ id tin.",
  });
  expect(onServer.length).toBeGreaterThan(0);
});
