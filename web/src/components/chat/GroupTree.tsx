import { ChevronRight, FolderKanban, GitBranch, MessageSquare, Users } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { TablePeekSheet } from "@/components/projects/TablePeekSheet";
import { conversationTitle, formatInboxTime, formatUnreadBadge, type ConversationSummary } from "@/lib/chat";
import { visibleChildren, type GroupTreeNode } from "@/lib/group-tree";
import { projectLink, type Project } from "@/lib/projects";
import { rootTables, type ThinkTable } from "@/lib/think-hub";
import { TYPE } from "@/lib/type-scale";
import { useThinkTables } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

type Peek = { table: ThinkTable; conversation: ConversationSummary | undefined; project: Project | undefined };

/**
 * The Nhóm tab as a folder tree: Nhóm → Sub-group → Project, each at the level it really sits.
 *
 * A root group opens its chat when tapped, as the list always did. A sub-group or project row
 * carries a Chat icon (straight into that conversation) and, where it has a table, "Xem bảng";
 * tapping a project's name opens the project itself. A folded branch still shows any child with
 * an unread message, so nothing new hides behind a closed folder.
 */
export function GroupTree({
  tree,
  activeConversationId,
  userId,
  projectById,
}: {
  tree: readonly GroupTreeNode[];
  activeConversationId: string | undefined;
  userId: string | undefined;
  projectById: ReadonlyMap<string, Project>;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [peek, setPeek] = useState<Peek | null>(null);
  const tablesQuery = useThinkTables();

  /** Each place's first root table, for "Xem bảng": a project's own table, or a sub-group's. */
  const tableOf = useMemo(() => {
    const byProject = new Map<string, ThinkTable>();
    const byConversation = new Map<string, ThinkTable>();
    for (const table of rootTables(tablesQuery.data ?? [])) {
      if (table.projectId !== null) {
        if (!byProject.has(table.projectId)) byProject.set(table.projectId, table);
      } else if (table.conversationId !== null && !byConversation.has(table.conversationId)) {
        byConversation.set(table.conversationId, table);
      }
    }
    return { byProject, byConversation };
  }, [tablesQuery.data]);

  const toggle = useCallback((id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openPeek = useCallback(
    (node: GroupTreeNode): void => {
      const project = node.projectId === null ? undefined : projectById.get(node.projectId);
      const table =
        node.projectId !== null
          ? tableOf.byProject.get(node.projectId)
          : tableOf.byConversation.get(node.conversation.conversationId);
      if (table === undefined) return;
      setPeek({ table, conversation: node.projectId === null ? node.conversation : undefined, project });
    },
    [projectById, tableOf],
  );

  const hasTable = useCallback(
    (node: GroupTreeNode): boolean =>
      node.projectId !== null
        ? tableOf.byProject.has(node.projectId)
        : tableOf.byConversation.has(node.conversation.conversationId),
    [tableOf],
  );

  return (
    <>
      <ul role="tree" aria-label="Nhóm, nhóm con và dự án">
        {tree.map((node) => (
          <TreeRow
            key={node.conversation.conversationId}
            node={node}
            level={0}
            openIds={openIds}
            activeConversationId={activeConversationId}
            userId={userId}
            onToggle={toggle}
            onPeek={openPeek}
            hasTable={hasTable}
          />
        ))}
      </ul>
      <TablePeekSheet
        table={peek?.table ?? null}
        conversation={peek?.conversation}
        project={peek?.project}
        onOpenChange={(open) => {
          if (!open) setPeek(null);
        }}
      />
    </>
  );
}

const TreeRow = memo(function TreeRow({
  node,
  level,
  openIds,
  activeConversationId,
  userId,
  onToggle,
  onPeek,
  hasTable,
}: {
  node: GroupTreeNode;
  level: number;
  openIds: ReadonlySet<string>;
  activeConversationId: string | undefined;
  userId: string | undefined;
  onToggle: (id: string) => void;
  onPeek: (node: GroupTreeNode) => void;
  hasTable: (node: GroupTreeNode) => boolean;
}) {
  const { conversation, kind } = node;
  const id = conversation.conversationId;
  const isOpen = openIds.has(id);
  const shown = visibleChildren(node, isOpen);
  const hasChildren = node.children.length > 0;
  const isActive = id === activeConversationId;
  const isUnread = conversation.unreadCount > 0;
  // A folded branch says how much is waiting under it, beside its own count.
  const hiddenUnread = isOpen ? 0 : node.unreadTotal - conversation.unreadCount;
  const title = conversationTitle(conversation);
  const chatHref = `/tin-nhan/${id}`;
  const mainHref = kind === "project" && node.projectId !== null ? projectLink(node.projectId) : chatHref;
  const preview =
    conversation.lastMessageContent === null
      ? "Chưa có tin nhắn nào"
      : `${conversation.lastMessageSenderId === userId ? "Bạn: " : ""}${conversation.lastMessageContent}`;
  const KindIcon = kind === "project" ? FolderKanban : kind === "subgroup" ? GitBranch : Users;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isActive}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg pr-1.5 transition-colors",
          isActive ? "bg-accent/70" : "hover:bg-accent/35",
        )}
        style={{ paddingLeft: `${level * 18}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(id)}
            aria-label={isOpen ? `Thu gọn ${title}` : `Mở ${title}`}
            className="press flex h-11 w-7 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden="true" />
        )}

        <Link to={mainHref} aria-current={isActive ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-2.5">
          {kind === "group" ? (
            <InitialsAvatar name={title} />
          ) : (
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                kind === "project" ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground",
              )}
            >
              <KindIcon className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn(TYPE.body, "truncate font-semibold", kind === "group" ? "text-[15px]" : "text-[14px]")}>
                {title}
              </span>
              <span className={cn("tabular shrink-0 text-[12px]", isUnread ? "font-medium text-foreground" : "text-muted-foreground")}>
                {formatInboxTime(conversation.lastMessageAt)}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  conversation.lastMessageContent === null
                    ? "italic text-muted-foreground/70"
                    : isUnread
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {kind === "project" ? `Dự án · ${preview}` : preview}
              </span>
              {isUnread ? (
                <span
                  aria-label={`${conversation.unreadCount} tin nhắn chưa đọc`}
                  className="tabular inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                >
                  {formatUnreadBadge(conversation.unreadCount)}
                </span>
              ) : hiddenUnread > 0 ? (
                <span
                  aria-label={`${hiddenUnread} tin chưa đọc trong nhánh này`}
                  className="h-2 w-2 shrink-0 rounded-full bg-primary"
                />
              ) : null}
            </span>
          </span>
        </Link>

        {kind === "group" ? null : (
          <>
            {/* Only a project needs it: its name opens the project page, a sub-group's name already opens its chat. */}
            {kind === "project" ? (
              <Link
                to={chatHref}
                aria-label={`Mở trò chuyện ${title}`}
                title="Mở trò chuyện"
                className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <MessageSquare className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </Link>
            ) : null}
            {hasTable(node) ? (
              <button
                type="button"
                onClick={() => onPeek(node)}
                aria-label={`Xem bảng của ${title}`}
                className="press shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                Xem bảng
              </button>
            ) : null}
          </>
        )}
      </div>

      {shown.length > 0 ? (
        <ul role="group">
          {shown.map((child) => (
            <TreeRow
              key={child.conversation.conversationId}
              node={child}
              level={level + 1}
              openIds={openIds}
              activeConversationId={activeConversationId}
              userId={userId}
              onToggle={onToggle}
              onPeek={onPeek}
              hasTable={hasTable}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
});
