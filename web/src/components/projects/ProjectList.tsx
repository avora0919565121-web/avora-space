import { ChevronRight, FolderKanban, RotateCcw, Table2 } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { TablePeekSheet } from "@/components/projects/TablePeekSheet";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/lib/auth";
import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { projectChatLink, projectStatusLabel, type Project } from "@/lib/projects";
import { recordsOf, subTablesOf, TABLE_LAYERS, tablesByLayer, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { TYPE } from "@/lib/type-scale";
import { groupProjectsOnly, useDeletedProjects, useProjectActions } from "@/lib/use-projects";
import { useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { matchesSearch } from "@/lib/normalize-search";
import { cn } from "@/lib/utils";

type SectionKey = "tables" | "groups" | "trash";

function BranchHeader({
  open,
  onToggle,
  emoji,
  label,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  emoji: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="press flex min-h-11 w-full items-center gap-2.5 px-2 py-3 text-left"
    >
      <ChevronRight
        aria-hidden="true"
        strokeWidth={2.2}
        className={cn("h-4 w-4 shrink-0 text-muted-foreground", open && "rotate-90")}
      />
      <span aria-hidden="true" className="text-[15px] leading-none">
        {emoji}
      </span>
      <span className="text-[13.5px] font-semibold text-foreground">{label}</span>
      <span className="tabular text-[12px] text-muted-foreground">{count}</span>
    </button>
  );
}

/**
 * One folder in the "Bảng của tôi" tree: a table that unfolds into its Hạng mục in place, and
 * each Hạng mục into the sub-tables grown from it. "Xem bảng" opens a quick look on top of this
 * tab — Hạng mục and their tasks can be added and edited there without leaving.
 */
function TableNode({
  table,
  tables,
  records,
  subtitle,
  level,
  onPeek,
}: {
  table: ThinkTable;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  subtitle: string | null;
  level: number;
  onPeek: (table: ThinkTable) => void;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const items = useMemo(() => (isOpen ? recordsOf(records, table.id) : []), [isOpen, records, table.id]);
  const count = useMemo(() => recordsOf(records, table.id).length, [records, table.id]);

  return (
    <li>
      <div className="flex items-center gap-1 rounded-lg pr-2 transition-colors hover:bg-accent/30" style={{ paddingLeft: `${level * 16}px` }}>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          className="press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={2.2}
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", isOpen && "rotate-90")}
          />
          <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className={cn(TYPE.body, "block truncate text-[14px] font-medium")}>{table.name}</span>
            {subtitle !== null ? <span className={cn(TYPE.meta, "block truncate")}>{subtitle}</span> : null}
          </span>
          <span className={cn(TYPE.meta, "tabular shrink-0")}>{count}</span>
        </button>
        <button
          type="button"
          onClick={() => onPeek(table)}
          aria-label={`Xem bảng ${table.name}`}
          className="press shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          Xem bảng
        </button>
      </div>

      {isOpen ? (
        items.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-foreground" style={{ paddingLeft: `${level * 16 + 44}px` }}>
            Chưa có Hạng mục nào.
          </p>
        ) : (
          <ul>
            {items.map((record) => {
              const children = subTablesOf(tables, record.id);
              return (
                <li key={record.id}>
                  <p
                    className="flex min-h-9 items-center gap-2 py-1.5 pr-3 text-[13.5px] text-foreground"
                    style={{ paddingLeft: `${level * 16 + 44}px` }}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                    <span className="min-w-0 flex-1 truncate">{record.title}</span>
                  </p>
                  {children.length > 0 ? (
                    <ul>
                      {children.map((child) => (
                        <TableNode
                          key={child.id}
                          table={child}
                          tables={tables}
                          records={records}
                          subtitle={null}
                          level={level + 2}
                          onPeek={onPeek}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </li>
  );
}

/**
 * The Dự án tab.
 *
 * AVORA-52 · E, Kết nối first: "Trò chuyện dự án" lists each project's chat (projects only ever
 * live in a group, ADR-002), then "Danh sách Bảng" holds the four shelves named as everywhere
 * else in AVORA: Bảng của tôi · Bảng 1-1 · Bảng nhóm · Bảng dự án.
 */
export function ProjectList({
  projects,
  conversations,
  activeProjectId,
  isPending,
  query = "",
}: {
  projects: readonly Project[];
  conversations: readonly ConversationSummary[];
  activeProjectId: string | undefined;
  isPending: boolean;
  /** The tab's search box: narrows the projects by name, accent-free (AVORA-44 · việc 5). */
  query?: string;
}) {
  const { user } = useAuth();
  const tablesQuery = useThinkTables();
  const recordsQuery = useThinkRecords();
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(new Set(["trash"]));
  const deletedQuery = useDeletedProjects();
  const { restore } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const deleted = deletedQuery.data ?? [];

  const conversationById = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const item of conversations) map.set(item.conversationId, item);
    return map;
  }, [conversations]);

  const allTables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  const layers = useMemo(
    () => tablesByLayer(allTables, user?.id, (id) => conversationById.get(id)?.kind),
    [allTables, user?.id, conversationById],
  );
  const mineCount = layers.personal.length + layers.direct.length + layers.group.length;
  /** Bảng dự án: the root tables of projects the viewer can see (RLS already narrowed them). */
  const projectTables = useMemo(
    () => allTables.filter((table) => table.projectId !== null && table.parentRecordId === null),
    [allTables],
  );
  const projectTitleById = useMemo(() => new Map(projects.map((project) => [project.id, project.title] as const)), [projects]);
  const [peeking, setPeeking] = useState<ThinkTable | null>(null);
  const peekConversation =
    peeking?.conversationId == null ? undefined : conversationById.get(peeking.conversationId);

  const groupProjects = useMemo(
    () =>
      groupProjectsOnly(projects, (id) => conversationById.get(id)?.kind).filter((project) =>
        matchesSearch(query, [project.title, conversationById.get(project.conversationId)?.groupName ?? null]),
      ),
    [projects, conversationById, query],
  );

  const toggle = (key: SectionKey): void =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isPending || tablesQuery.isPending) {
    return (
      <ul className="space-y-1 px-3 pt-1" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-3 py-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-secondary" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3.5 w-2/5 animate-pulse rounded bg-secondary" />
              <span className="block h-3 w-3/5 animate-pulse rounded bg-secondary/70" />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const tablesOpen = !closed.has("tables");
  const trashOpen = !closed.has("trash");
  const groupsOpen = !closed.has("groups");

  return (
    <div className="px-1 pb-6">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Dự án</h2>
      </div>
      <section className="mt-1">
        <BranchHeader
          open={groupsOpen}
          onToggle={() => toggle("groups")}
          emoji="💬"
          label="Trò chuyện dự án"
          count={groupProjects.length}
        />
        {groupsOpen ? (
          groupProjects.length === 0 ? (
            <p className="px-9 pb-3 text-[12.5px] leading-relaxed text-muted-foreground">
              Chưa có dự án nào. Chạm “Tạo dự án” ngay trong một nhóm để bắt đầu.
            </p>
          ) : (
            <ul>
              {groupProjects.map((project) => {
                const conversation = conversationById.get(project.conversationId);
                const isActive = project.id === activeProjectId;
                return (
                  <li key={project.id}>
                    <Link
                      to={projectChatLink(project)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                        isActive ? "bg-accent/70" : "hover:bg-accent/35",
                      )}
                    >
                      <InitialsAvatar name={conversation ? conversationTitle(conversation) : "Dự án"} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14.5px] font-semibold text-foreground">{project.title}</span>
                          {projectStatusLabel(project.status) !== null ? (
                            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {projectStatusLabel(project.status)}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">
                          {conversation?.lastMessageContent ?? (conversation ? conversationTitle(conversation) : "Nhóm")}
                        </span>
                      </span>
                      {conversation !== undefined && conversation.unreadCount > 0 ? (
                        <span
                          aria-label={`${conversation.unreadCount} tin nhắn chưa đọc`}
                          className="tabular inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                        >
                          {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                        </span>
                      ) : (
                        <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>

      <section className="mt-1">
        <BranchHeader open={tablesOpen} onToggle={() => toggle("tables")} emoji="📊" label="Danh sách Bảng" count={mineCount + projectTables.length} />
        {tablesOpen ? (
          tablesQuery.isError ? (
            // AVORA-49 · 1.8: a failed load says so; it never passes for an empty list.
            <p className="flex items-center gap-2 px-9 pb-3 text-[12.5px] text-muted-foreground">
              Không tải được
              <button type="button" onClick={() => void tablesQuery.refetch()} className="press rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-accent/40">
                Thử lại
              </button>
            </p>
          ) : mineCount + projectTables.length === 0 ? (
            <p className={cn(TYPE.blockDescription, "px-9 pb-3 text-[12.5px]")}>
              Chưa có bảng nào. Mở Kế hoạch để dựng bảng đầu tiên.
            </p>
          ) : (
            // AVORA-52 · E: the four shelves, named the same way as in Kế hoạch.
            <div className="space-y-1 pb-1">
              {TABLE_LAYERS.map((layer) => {
                const list = layers[layer.id];
                return (
                  <div key={layer.id} role="group" aria-label={layer.label}>
                    <p className="flex items-center gap-2 px-9 pb-0.5 pt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {layer.label}
                      <span className="tabular font-medium normal-case tracking-normal text-muted-foreground/80">{list.length}</span>
                    </p>
                    {list.length === 0 ? (
                      <p className={cn(TYPE.meta, "px-9 pb-1.5")}>{layer.empty}</p>
                    ) : (
                      <ul>
                        {list.map((table) => {
                          const conversation = table.conversationId === null ? undefined : conversationById.get(table.conversationId);
                          return (
                            <TableNode
                              key={table.id}
                              table={table}
                              tables={allTables}
                              records={records}
                              subtitle={
                                conversation === undefined
                                  ? "Chỉ mình bạn"
                                  : conversation.kind === "group"
                                    ? conversationTitle(conversation)
                                    : `1-1 với ${conversationTitle(conversation)}`
                              }
                              level={1}
                              onPeek={setPeeking}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
              <div role="group" aria-label="Bảng dự án">
                <p className="flex items-center gap-2 px-9 pb-0.5 pt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Bảng dự án
                  <span className="tabular font-medium normal-case tracking-normal text-muted-foreground/80">{projectTables.length}</span>
                </p>
                {projectTables.length === 0 ? (
                  <p className={cn(TYPE.meta, "px-9 pb-1.5")}>Chưa có bảng nào trong dự án.</p>
                ) : (
                  <ul>
                    {projectTables.map((table) => (
                      <TableNode
                        key={table.id}
                        table={table}
                        tables={allTables}
                        records={records}
                        subtitle={projectTitleById.get(table.projectId ?? "") ?? "Dự án"}
                        level={1}
                        onPeek={setPeeking}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )
        ) : null}
      </section>

      {deleted.length > 0 ? (
        <section className="mt-1">
          <BranchHeader open={trashOpen} onToggle={() => toggle("trash")} emoji="🗑️" label="Dự án đã xoá" count={deleted.length} />
          {trashOpen ? (
            <ul>
              <li className="px-9 pb-2 text-[12px] leading-relaxed text-muted-foreground">
                Chỉ Owner nhóm gốc thấy mục này. Khôi phục đưa dự án, nhóm và bảng của nó trở lại.
              </li>
              {deleted.map((project) => (
                <li key={project.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-foreground">{project.title}</span>
                    {project.deleteReason !== null ? (
                      <span className="block truncate text-[12px] text-muted-foreground">Lý do: {project.deleteReason}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      void guard(async () => {
                        try {
                          await restore(project.id);
                          toast.success(`Đã khôi phục "${project.title}".`);
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Không khôi phục được.");
                        }
                      })
                    }
                    className="press inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                    Khôi phục
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <TablePeekSheet
        table={peeking}
        conversation={peekConversation}
        onOpenChange={(open) => {
          if (!open) setPeeking(null);
        }}
      />
    </div>
  );
}
