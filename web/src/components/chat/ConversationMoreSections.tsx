import { Ban, BookLock, ChevronRight, Flag, FolderKanban, Plus, Table2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { newTableLink, tableLink, useTablesHere } from "@/components/projects/TableStrip";
import { hereFrom } from "@/lib/return-to";
import { NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import { projectChatLink, projectStatusLabel, type Project } from "@/lib/projects";
import { useOnline } from "@/lib/use-online";

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
  placeLabel,
  kind,
  projects,
  showProjects,
  canCreateProjectReason,
  onNewProject,
  onOpenDecisions,
  onNavigate,
  safety,
}: {
  conversationId: string;
  /** The name of this conversation, as the way back from Kế hoạch shows it. */
  placeLabel: string;
  kind: "direct" | "group";
  projects: readonly Project[];
  /** False in a project's own chat: that chat is already the project. */
  showProjects: boolean;
  /** Why the viewer may not open a project here; null when they may. */
  canCreateProjectReason: string | null;
  onNewProject: () => void;
  onOpenDecisions: () => void;
  onNavigate: () => void;
  /** 1-1 only: Chặn / Báo cáo at the foot of the panel (AVORA-37). Omitted until the peer is known. */
  safety?: {
    peerName: string;
    isBlocked: boolean;
    onBlock: () => void;
    onUnblock: () => void;
    onReport: () => void;
    isWorking: boolean;
  };
}) {
  const tables = useTablesHere(conversationId);
  const isOnline = useOnline();
  const location = useLocation();
  const here = hereFrom(location, placeLabel);

  return (
    <div className="space-y-5 px-3 pb-5">
      <section aria-label="Bảng" className="px-3">
        <SectionTitle icon={<Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}>
          Bảng <span className="tabular font-medium normal-case">({tables.length})</span>
        </SectionTitle>
        <ul className="mt-1.5 space-y-0.5">
          {tables.map((table) => (
            <li key={table.id}>
              <Link to={tableLink(table.id, here)} onClick={onNavigate} className={rowClass}>
                <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{table.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link to={newTableLink(conversationId, here)} onClick={onNavigate} className={rowClass}>
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

      {kind === "direct" && safety !== undefined ? (
        <section aria-label="Chặn và báo cáo" className="mx-3 border-t border-border px-0 pt-3">
          {isOnline ? (
            <ul className="space-y-0.5">
              <li>
                <button
                  type="button"
                  disabled={safety.isWorking}
                  onClick={safety.isBlocked ? safety.onUnblock : safety.onBlock}
                  className={`${rowClass} disabled:opacity-50`}
                >
                  {safety.isBlocked ? (
                    <Undo2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <Ban className="h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.8} aria-hidden="true" />
                  )}
                  <span className={`min-w-0 flex-1 truncate text-[14px] ${safety.isBlocked ? "text-foreground" : "text-destructive"}`}>
                    {safety.isBlocked ? `Bỏ chặn ${safety.peerName}` : `Chặn ${safety.peerName}`}
                  </span>
                </button>
              </li>
              <li>
                <button type="button" onClick={safety.onReport} className={rowClass}>
                  <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">Báo cáo {safety.peerName}</span>
                </button>
              </li>
            </ul>
          ) : (
            <p className="px-2 py-2 text-[13px] text-muted-foreground">
              Chặn / Báo cáo — {NEEDS_NETWORK_MESSAGE}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
