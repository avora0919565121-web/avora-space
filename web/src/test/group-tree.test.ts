import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/lib/chat-cache";
import { buildGroupTree, visibleChildren } from "@/lib/group-tree";

function group(id: string, sortAt: string, unreadCount = 0): ConversationSummary {
  return {
    conversationId: id,
    kind: "group",
    peerId: null,
    peerName: "",
    peerEmail: null,
    groupName: id.toUpperCase(),
    memberCount: 3,
    lastMessageContent: null,
    lastMessageAt: sortAt,
    lastMessageSenderId: null,
    unreadCount,
    peerLastReadAt: null,
    sortAt,
  } as ConversationSummary;
}

describe("Nhóm tab as a tree (AVORA 31)", () => {
  // A (root) → A1 (sub-group) → P2 (project in the sub-group); A → P1 (project in the root).
  const groups = [
    group("a", "2026-09-20T00:00:00Z"),
    group("a1", "2026-09-21T00:00:00Z"),
    group("p1", "2026-09-19T00:00:00Z"),
    group("p2", "2026-09-18T00:00:00Z", 2),
    group("b", "2026-09-22T00:00:00Z"),
  ];
  const parents = new Map<string, string | null>([
    ["a", null],
    ["a1", "a"],
    ["p1", "a"],
    ["p2", "a1"],
    ["b", null],
  ]);
  const projects = new Map([
    ["p1", "proj-1"],
    ["p2", "proj-2"],
  ]);

  it("puts each project at the level its own chat sits", () => {
    const tree = buildGroupTree(groups, parents, projects);
    const a = tree.find((node) => node.conversation.conversationId === "a");
    expect(a?.kind).toBe("group");
    expect(a?.children.map((child) => [child.conversation.conversationId, child.kind])).toEqual([
      ["a1", "subgroup"],
      ["p1", "project"],
    ]);
    const a1 = a?.children[0];
    expect(a1?.children.map((child) => [child.conversation.conversationId, child.kind, child.projectId])).toEqual([
      ["p2", "project", "proj-2"],
    ]);
  });

  it("lifts a branch by its newest activity anywhere inside it", () => {
    const fresh = groups.map((item) => (item.conversationId === "p2" ? { ...item, sortAt: "2026-09-25T00:00:00Z" } : item));
    const tree = buildGroupTree(fresh, parents, projects);
    expect(tree.map((node) => node.conversation.conversationId)).toEqual(["a", "b"]);
    expect(tree[0].children[0].conversation.conversationId).toBe("a1");
  });

  it("keeps an unread child visible under a folded branch, and counts it upward", () => {
    const tree = buildGroupTree(groups, parents, projects);
    const a = tree.find((node) => node.conversation.conversationId === "a");
    expect(a?.unreadTotal).toBe(2);
    expect(visibleChildren(a!, false).map((child) => child.conversation.conversationId)).toEqual(["a1"]);
    expect(visibleChildren(a!, true)).toHaveLength(2);
  });

  it("stands a sub-group at the root when the viewer is not in its parent", () => {
    const tree = buildGroupTree([group("a1", "2026-09-21T00:00:00Z")], parents, projects);
    expect(tree.map((node) => [node.conversation.conversationId, node.kind])).toEqual([["a1", "group"]]);
  });
});
