import type { ConversationSummary } from "@/lib/chat-cache";

/**
 * The Nhóm tab as a folder tree: a group unfolds into its sub-groups, and a project sits at the
 * level its own sub-group sits — under the root group, or under the sub-group it was opened in.
 *
 * Built only from what already exists (`parent_group_id` on each group, and which sub-group is a
 * project's chat). Nothing is stored for the tree itself.
 */
export type GroupNodeKind = "group" | "subgroup" | "project";

export type GroupTreeNode = {
  conversation: ConversationSummary;
  kind: GroupNodeKind;
  /** Set when this sub-group is a project's own chat. */
  projectId: string | null;
  children: GroupTreeNode[];
  /** Unread across this node and everything under it. */
  unreadTotal: number;
  /** The newest activity in this node or anywhere under it — what the branch is sorted by. */
  latestAt: string;
};

/**
 * Arranges the viewer's groups into a tree.
 *
 * A group whose parent the viewer is not in (or whose parent was deleted) stands at the root
 * rather than disappearing: membership never flows down the tree (ADR-014), so being in a
 * sub-group without its parent is normal. Branches are ordered by their newest activity, so a
 * conversation with a fresh message lifts its whole branch to the top.
 */
export function buildGroupTree(
  groups: readonly ConversationSummary[],
  parentOf: ReadonlyMap<string, string | null>,
  projectIdOfConversation: ReadonlyMap<string, string>,
): GroupTreeNode[] {
  const ids = new Set(groups.map((group) => group.conversationId));
  const childrenOf = new Map<string, ConversationSummary[]>();
  const roots: ConversationSummary[] = [];

  for (const group of groups) {
    const parent = parentOf.get(group.conversationId) ?? null;
    if (parent !== null && ids.has(parent) && parent !== group.conversationId) {
      const list = childrenOf.get(parent) ?? [];
      list.push(group);
      childrenOf.set(parent, list);
    } else {
      roots.push(group);
    }
  }

  const build = (conversation: ConversationSummary, isRoot: boolean, seen: Set<string>): GroupTreeNode => {
    const next = new Set(seen).add(conversation.conversationId);
    const children = (childrenOf.get(conversation.conversationId) ?? [])
      .filter((child) => !next.has(child.conversationId))
      .map((child) => build(child, false, next));
    sortNodes(children);
    const projectId = projectIdOfConversation.get(conversation.conversationId) ?? null;
    return {
      conversation,
      kind: projectId !== null ? "project" : isRoot ? "group" : "subgroup",
      projectId,
      children,
      unreadTotal: conversation.unreadCount + children.reduce((sum, child) => sum + child.unreadTotal, 0),
      latestAt: children.reduce(
        (latest, child) => (child.latestAt > latest ? child.latestAt : latest),
        conversation.sortAt,
      ),
    };
  };

  const tree = roots.map((root) => build(root, true, new Set()));
  sortNodes(tree);
  return tree;
}

function sortNodes(nodes: GroupTreeNode[]): void {
  nodes.sort((left, right) => right.latestAt.localeCompare(left.latestAt));
}

/**
 * What a folded branch still shows: only the children with something unread somewhere under
 * them, so a new message is never hidden behind a closed folder.
 */
export function visibleChildren(node: GroupTreeNode, isOpen: boolean): GroupTreeNode[] {
  return isOpen ? node.children : node.children.filter((child) => child.unreadTotal > 0);
}
