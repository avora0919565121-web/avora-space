import { ChevronRight, FolderKanban } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { projectLink, type Project } from "@/lib/projects";
import { groupProjects, type ProjectGroupKind } from "@/lib/use-projects";
import { cn } from "@/lib/utils";

/**
 * The three groups, in the order trust narrows: your own first, then the person you share it
 * with, then the room. Each keeps its emoji so the heading is recognisable before it is read.
 */
const GROUPS: readonly {
  readonly kind: ProjectGroupKind;
  readonly emoji: string;
  readonly label: string;
  readonly empty: string;
}[] = [
  {
    kind: "personal",
    emoji: "📌",
    label: "Cá nhân",
    empty: "Chưa có dự án riêng nào.",
  },
  {
    kind: "direct",
    emoji: "👥",
    label: "1-1",
    empty: "Chưa có dự án nào với một người.",
  },
  {
    kind: "group",
    emoji: "👨‍👩‍👧‍👦",
    label: "Nhóm",
    empty: "Chưa có dự án nhóm nào. Chạm “Tạo dự án” ngay trong nhóm để bắt đầu.",
  },
];

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
      className="press flex w-full items-center gap-2.5 px-2 py-3 text-left"
    >
      <ChevronRight
        aria-hidden="true"
        strokeWidth={2.2}
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
          open && "rotate-90",
        )}
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
 * Every project the viewer can see, under the heading that says who else can see it.
 *
 * The grouping comes from each project's conversation rather than from a field on the project,
 * because the conversation IS who it belongs to — a separate column could only ever disagree
 * with the permission that actually applies.
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
  const [closed, setClosed] = useState<ReadonlySet<ProjectGroupKind>>(new Set());

  const conversationById = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const item of conversations) map.set(item.conversationId, item);
    return map;
  }, [conversations]);

  const grouped = useMemo(
    () => groupProjects(projects, (id) => conversationById.get(id)?.kind),
    [projects, conversationById],
  );

  if (isPending) {
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

  return (
    <div className="px-1 pb-6">
      {/* Projects are opened only inside a group now; existing personal and 1-1 ones stay listed. */}
      <p className="mx-3 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        Dự án là việc của nhóm. Chạm một dự án để mở.
      </p>

      {GROUPS.map((group) => {
        const items = grouped[group.kind];
        const open = !closed.has(group.kind);
        return (
          <section key={group.kind} className="mt-1">
            <BranchHeader
              open={open}
              onToggle={() =>
                setClosed((current) => {
                  const next = new Set(current);
                  if (next.has(group.kind)) next.delete(group.kind);
                  else next.add(group.kind);
                  return next;
                })
              }
              emoji={group.emoji}
              label={group.label}
              count={items.length}
            />
            {open ? (
              items.length === 0 ? (
                <p className="px-9 pb-3 text-[12.5px] leading-relaxed text-muted-foreground">
                  {group.empty}
                </p>
              ) : (
                <ul>
                  {items.map((project) => {
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
                          {group.kind === "personal" ? (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                              <FolderKanban
                                className="h-[18px] w-[18px]"
                                strokeWidth={1.7}
                                aria-hidden="true"
                              />
                            </span>
                          ) : (
                            <InitialsAvatar
                              name={conversation ? conversationTitle(conversation) : "Dự án"}
                              size="md"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14.5px] font-semibold text-foreground">
                              {project.title}
                            </span>
                            <span className="block truncate text-[12.5px] text-muted-foreground">
                              {group.kind === "personal"
                                ? "Chỉ mình bạn"
                                : conversation
                                  ? conversationTitle(conversation)
                                  : "Cuộc trò chuyện"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
