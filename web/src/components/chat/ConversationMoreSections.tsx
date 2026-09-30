import { Ban, BookLock, CalendarClock, ChevronRight, Flag, FolderKanban, ListTodo, Plus, Search, Table2, Trash2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { newTableLink, tableLink, useTablesHere } from "@/components/projects/TableStrip";
import { hereFrom, withReturn } from "@/lib/return-to";
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

/** One row that opens something: icon · name · count · ›. */
function OpenRow({ icon, label, count, onClick }: { icon: ReactNode; label: string; count?: number | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={rowClass}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{label}</span>
      {count !== undefined && count !== null ? <span className="tabular text-[12.5px] text-muted-foreground">{count}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

const iconClass = "h-4 w-4 shrink-0 text-muted-foreground";

/**
 * The "⋯" panel of a thread — one frame for 1-1, Nhóm and Nhật ký (AVORA-49 · 4.1, 44b · C), in
 * the order people think: ④ Nhiệm vụ · Bảng · Dự án · Sổ quyết định, ⑤ Tìm · Lên lịch cuộc gọi,
 * ⑥ (1-1) Chặn · Báo cáo in red at the very end. A group's roster and Rời nhóm are drawn around
 * this by the sheet. `onNavigate` closes the panel when a row leaves the thread.
 */
export function ConversationMoreSections({
  conversationId,
  placeLabel,
  kind,
  projects = [],
  showProjects = false,
  canCreateProjectReason = null,
  onNewProject,
  onOpenDecisions,
  onOpenTasks,
  taskCount = null,
  onSearch,
  onScheduleCall,
  trash,
  onNavigate,
  safety,
}: {
  /** Null for Nhật ký: its tables belong to no conversation. */
  conversationId: string | null;
  /** The name of this conversation, as the way back from Kế hoạch shows it. */
  placeLabel: string;
  kind: "personal" | "direct" | "group";
  projects?: readonly Project[];
  /** False in a project's own chat: that chat is already the project. */
  showProjects?: boolean;
  /** Why the viewer may not open a project here; null when they may. */
  canCreateProjectReason?: string | null;
  onNewProject?: () => void;
  onOpenDecisions?: () => void;
  /** Nhóm: "Nhiệm vụ của nhóm" (the whole room's list). */
  onOpenTasks?: () => void;
  taskCount?: number | null;
  onSearch?: () => void;
  onScheduleCall?: () => void;
  /** Nhật ký: its Thùng rác (AVORA-44 · việc 8). */
  trash?: { count: number | null; onOpen: () => void };
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
      {onOpenTasks !== undefined ? (
        <section aria-label="Nhiệm vụ" className="px-3">
          <OpenRow
            icon={<ListTodo className={iconClass} strokeWidth={1.8} aria-hidden="true" />}
            label={kind === "group" ? "Nhiệm vụ của nhóm" : "Nhiệm vụ"}
            count={taskCount}
            onClick={onOpenTasks}
          />
        </section>
      ) : null}

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
                {kind === "direct" ? "Bảng chung mới với người này" : kind === "group" ? "Bảng mới của nhóm" : "Bảng mới"}
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
                <Link to={withReturn(projectChatLink(project), here)} onClick={onNavigate} className={rowClass}>
                  <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{project.title}</span>
                  {projectStatusLabel(project.status) !== null ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">{projectStatusLabel(project.status)}</span>
                  ) : null}
                </Link>
              </li>
            ))}
            {onNewProject !== undefined ? (
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
            ) : null}
          </ul>
        </section>
      ) : null}

      {kind === "group" && onOpenDecisions !== undefined ? (
        <section aria-label="Sổ quyết định" className="px-3">
          <OpenRow icon={<BookLock className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Sổ quyết định" onClick={onOpenDecisions} />
        </section>
      ) : null}

      {onSearch !== undefined || onScheduleCall !== undefined || trash !== undefined ? (
        <section aria-label="Khác" className="space-y-0.5 px-3">
          {onSearch !== undefined ? (
            <OpenRow icon={<Search className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Tìm trong cuộc này" onClick={onSearch} />
          ) : null}
          {onScheduleCall !== undefined ? (
            <OpenRow icon={<CalendarClock className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Lên lịch cuộc gọi" onClick={onScheduleCall} />
          ) : null}
          {trash !== undefined ? (
            <OpenRow icon={<Trash2 className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Thùng rác" count={trash.count} onClick={trash.onOpen} />
          ) : null}
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
                  <Flag className="h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-destructive">Báo cáo {safety.peerName}</span>
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
