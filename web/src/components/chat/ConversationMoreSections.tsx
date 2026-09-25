import { BookLock, ChevronRight, FolderKanban, Plus, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { newTableLink, useTablesHere } from "@/components/projects/TableStrip";
import { projectChatLink, projectStatusLabel, type Project } from "@/lib/projects";

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h3>
  );
}

const rowClass =
  "press flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/40";

/**
 * What used to sit in strips above a 1-1 or group thread, gathered into the "Thêm" panel
 * (AVORA 32): the tables kept here, the group's projects, and its Sổ quyết định. The thread
 * itself keeps only the conversation. `onNavigate` closes the panel when a row leaves the thread.
 */
export function ConversationMoreSections({
  conversationId,
  kind,
  projects,
  showProjects,
  canCreateProjectReason,
  onNewProject,
  onOpenDecisions,
  onNavigate,
}: {
  conversationId: string;
  kind: "direct" | "group";
  projects: readonly Project[];
  /** False in a project's own chat: that chat is already the project. */
  showProjects: boolean;
  /** Why the viewer may not open a project here; null when they may. */
  canCreateProjectReason: string | null;
  onNewProject: () => void;
  onOpenDecisions: () => void;
  onNavigate: () => void;
}) {
  const tables = useTablesHere(conversationId);

  return (
    <div className="space-y-5 px-3 pb-5">
      <section aria-label="Bảng" className="px-3">
        <SectionTitle icon={<Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}>
          Bảng <span className="tabular font-medium normal-case">({tables.length})</span>
        </SectionTitle>
        <ul className="mt-1.5 space-y-0.5">
          {tables.map((table) => (
            <li key={table.id}>
              <Link to={`/ke-hoach?bang=${encodeURIComponent(table.id)}`} onClick={onNavigate} className={rowClass}>
                <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{table.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link to={newTableLink(conversationId)} onClick={onNavigate} className={rowClass}>
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden="true" />
              <span className="text-[14px] text-muted-foreground">
                {kind === "direct" ? "Bảng chung mới với người này" : "Bảng mới của nhóm"}
              </span>
            </Link>
          </li>
        </ul>
      </section>

      {kind === "group" && showProjects ? (
        <section aria-label="Dự án của nhóm" className="px-3">
          <SectionTitle icon={<FolderKanban className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}>
            Dự án <span className="tabular font-medium normal-case">({projects.length})</span>
          </SectionTitle>
          <ul className="mt-1.5 space-y-0.5">
            {projects.map((project) => (
              <li key={project.id}>
                <Link to={projectChatLink(project)} onClick={onNavigate} className={rowClass}>
                  <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{project.title}</span>
                  {projectStatusLabel(project.status) !== null ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">{projectStatusLabel(project.status)}</span>
                  ) : null}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={onNewProject}
                disabled={canCreateProjectReason !== null}
                title={canCreateProjectReason ?? undefined}
                className={`${rowClass} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden="true" />
                <span className="text-[14px] text-muted-foreground">
                  Tạo dự án{canCreateProjectReason !== null ? ` — ${canCreateProjectReason}` : " (mở kèm một nhóm con riêng)"}
                </span>
              </button>
            </li>
          </ul>
        </section>
      ) : null}

      {kind === "group" ? (
        <section aria-label="Sổ quyết định" className="px-3">
          <SectionTitle icon={<BookLock className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}>
            Sổ quyết định
          </SectionTitle>
          <button type="button" onClick={onOpenDecisions} className={`${rowClass} mt-1.5`}>
            <BookLock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[14px] text-foreground">Mở Sổ quyết định của nhóm</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </section>
      ) : null}
    </div>
  );
}
