import { ChevronRight, FolderKanban, MessagesSquare, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { UserAvatar } from "@/components/UserAvatar";
import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { projectChatLink, projectStatusLabel, type Project } from "@/lib/projects";
import { groupProjectsOnly, useDeletedProjects, useProjectActions } from "@/lib/use-projects";
import { matchesSearch } from "@/lib/normalize-search";
import { cn } from "@/lib/utils";

type SectionKey = "groups" | "trash";

function BranchHeader({
  open,
  onToggle,
  icon: Icon,
  label,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  /** CC-16: the house's line icons, not emoji. */
  icon: LucideIcon;
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
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
      <span className="text-[13.5px] font-semibold text-foreground">{label}</span>
      <span className="tabular text-[12px] text-muted-foreground">{count}</span>
    </button>
  );
}

/**
 * The Dự án tab.
 *
 * AVORA-52 · E: "Trò chuyện dự án" lists each project's chat (projects only ever live in a group,
 * ADR-002). KT-07b (CEO 12/11 · 4, QA-02 CC-33): this tab shows projects only — the boards
 * ("Danh sách bảng", Kệ sách…) live in Thư phòng › Kế hoạch, not inside Kết nối.
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
          icon={MessagesSquare}
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
                      <UserAvatar name={conversation ? conversationTitle(conversation) : "Dự án"} size="md" />
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

      {deleted.length > 0 ? (
        <section className="mt-1">
          <BranchHeader open={trashOpen} onToggle={() => toggle("trash")} icon={Trash2} label="Dự án đã xoá" count={deleted.length} />
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
    </div>
  );
}
