import { ChevronRight, FolderKanban, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { useAuth } from "@/lib/auth";
import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { projectLink, type Project } from "@/lib/projects";
import { myTables, recordsOf, subTablesOf, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { groupProjectsOnly } from "@/lib/use-projects";
import { useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

type SectionKey = "tables" | "groups";

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
 * each Hạng mục into the sub-tables grown from it. Nothing here opens another screen except
 * the small "Mở bảng" link, for when the person actually wants to edit.
 */
function TableNode({
  table,
  tables,
  records,
  subtitle,
  level,
}: {
  table: ThinkTable;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  subtitle: string | null;
  level: number;
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
            <span className="block truncate text-[14px] font-medium text-foreground">{table.name}</span>
            {subtitle !== null ? (
              <span className="block truncate text-[12px] text-muted-foreground">{subtitle}</span>
            ) : null}
          </span>
          <span className="tabular shrink-0 text-[12px] text-muted-foreground">{count}</span>
        </button>
        <Link
          to={`/ke-hoach?bang=${encodeURIComponent(table.id)}`}
          className="press shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          Mở bảng
        </Link>
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
 * Two sections. "Bảng của tôi" is the person's own thinking — their Diary tables and the tables
 * they share one-to-one — as a folded tree that opens in place. "Nhóm" lists real projects,
 * which only ever live in a group (ADR-002). The old "Cá nhân" and "1-1" project sections are
 * gone: they could only ever be empty.
 */
export function ProjectList({
  projects,
  conversations,
  activeProjectId,
  isPending,
}: {
  projects: readonly Project[];
  conversations: readonly ConversationSummary[];
  activeProjectId: string | undefined;
  isPending: boolean;
}) {
  const { user } = useAuth();
  const tablesQuery = useThinkTables();
  const recordsQuery = useThinkRecords();
  const [closed, setClosed] = useState<ReadonlySet<SectionKey>>(new Set());

  const conversationById = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const item of conversations) map.set(item.conversationId, item);
    return map;
  }, [conversations]);

  const allTables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  const mine = useMemo(
    () => myTables(allTables, user?.id, (id) => conversationById.get(id)?.kind === "direct"),
    [allTables, user?.id, conversationById],
  );

  const groupProjects = useMemo(
    () => groupProjectsOnly(projects, (id) => conversationById.get(id)?.kind),
    [projects, conversationById],
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
  const groupsOpen = !closed.has("groups");

  return (
    <div className="px-1 pb-6">
      <section className="mt-1">
        <BranchHeader open={tablesOpen} onToggle={() => toggle("tables")} emoji="📊" label="Bảng của tôi" count={mine.length} />
        {tablesOpen ? (
          mine.length === 0 ? (
            <p className="px-9 pb-3 text-[12.5px] leading-relaxed text-muted-foreground">
              Chưa có bảng nào. Mở Kế hoạch để dựng bảng đầu tiên.
            </p>
          ) : (
            <ul>
              {mine.map((table) => {
                const conversation = table.conversationId === null ? undefined : conversationById.get(table.conversationId);
                return (
                  <TableNode
                    key={table.id}
                    table={table}
                    tables={allTables}
                    records={records}
                    subtitle={conversation === undefined ? "Chỉ mình bạn" : `1-1 với ${conversationTitle(conversation)}`}
                    level={0}
                  />
                );
              })}
            </ul>
          )
        ) : null}
      </section>

      <section className="mt-1">
        <BranchHeader
          open={groupsOpen}
          onToggle={() => toggle("groups")}
          emoji="👨‍👩‍👧‍👦"
          label="Nhóm"
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
                      to={projectLink(project.id)}
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
                          {project.status === "done" ? (
                            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Đã đóng
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">
                          {conversation ? conversationTitle(conversation) : "Nhóm"}
                        </span>
                      </span>
                      <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
