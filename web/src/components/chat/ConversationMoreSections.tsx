import { Ban, BookLock, CalendarClock, ChevronDown, ChevronRight, Flag, FolderKanban, ListTodo, Pin, Plus, Table2, Trash2, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
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

const PROJECT_FOLD_KEY = "avora.info.projects-open";

/** AVORA-71 · C luật 2: `Dự án của nhóm` starts folded to one line; opened state is kept per device. */
function useProjectFold(): [boolean, () => void] {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PROJECT_FOLD_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = (): void =>
    setIsOpen((current) => {
      try {
        window.localStorage.setItem(PROJECT_FOLD_KEY, current ? "0" : "1");
      } catch {
        // Remembering is a courtesy.
      }
      return !current;
    });
  return [isOpen, toggle];
}

/**
 * The "⋯" panel of a thread — one frame for Nhật ký · 1-1 · Nhóm · Dự án, in the one order of
 * `CONVERSATION_MENU_ORDER` (AVORA-71 · C): ① Nhiệm vụ · Bảng · Nhật ký trò chuyện, ② (Nhóm)
 * Thành viên · Liên kết mời · Dự án · Sổ quyết định, ③ Tìm · Lên lịch cuộc gọi · Thùng rác,
 * ④ Hạn chế in red at the very end. `onNavigate` closes the panel when a row leaves the thread.
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
  pinned,
  onProposeDeleteGroup,
  onScheduleCall,
  trash,
  onNavigate,
  safety,
  roomSlot = null,
  diaryRow = null,
}: {
  /** AVORA-71 · C ②: a group's Thành viên + Liên kết mời, drawn after ① Làm việc (folded by default). */
  roomSlot?: ReactNode;
  /** ① Nhật ký trò chuyện, right after Bảng. */
  diaryRow?: ReactNode;
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
  /** Kept for callers; search now lives only in the quick row at the top of `⋯` (AVORA-71). */
  onSearch?: () => void;
  /** `Tin đã ghim (N)` — opens the pinned list over `⋯`. Omitted when nothing is pinned. */
  pinned?: { count: number; onOpen: () => void };
  /** Nhóm: `Đề nghị xoá nhóm` in the restricted group at the very end (ADR-031). */
  onProposeDeleteGroup?: () => void;
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
  const [isProjectsOpen, toggleProjects] = useProjectFold();

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

      {diaryRow !== null ? <section aria-label="Nhật ký trò chuyện" className="px-3">{diaryRow}</section> : null}

      {pinned !== undefined && pinned.count > 0 ? (
        <section aria-label="Tin đã ghim" className="px-3" data-pinned-row="">
          <OpenRow icon={<Pin className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Tin đã ghim" count={pinned.count} onClick={pinned.onOpen} />
        </section>
      ) : null}

      {roomSlot !== null ? <div data-room-slot="">{roomSlot}</div> : null}

      {kind === "group" && showProjects ? (
        <section aria-label="Dự án của nhóm" className="px-3" data-fold="projects">
          <button type="button" onClick={toggleProjects} aria-expanded={isProjectsOpen} className={rowClass}>
            <FolderKanban className={iconClass} strokeWidth={1.8} aria-hidden="true" />
            <span className="text-[14px] text-foreground">Dự án của nhóm</span>
            <span className="tabular text-[12.5px] text-muted-foreground">({projects.length})</span>
            <span className="ml-auto min-w-0 truncate text-[12.5px] text-muted-foreground">
              {projects.slice(0, 2).map((project) => project.title).join(" · ")}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isProjectsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {isProjectsOpen ? (
          <ul className="mt-1 space-y-0.5 pl-4">
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
          ) : null}
        </section>
      ) : null}

      {kind === "group" && onOpenDecisions !== undefined ? (
        <section aria-label="Sổ quyết định" className="px-3">
          <OpenRow icon={<BookLock className={iconClass} strokeWidth={1.8} aria-hidden="true" />} label="Sổ quyết định" onClick={onOpenDecisions} />
        </section>
      ) : null}

      {onScheduleCall !== undefined || trash !== undefined ? (
        <section aria-label="Khác" className="space-y-0.5 px-3">
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

      {kind === "group" && onProposeDeleteGroup !== undefined ? (
        <section aria-label="Hạn chế" className="mx-3 border-t border-border pt-3">
          <button type="button" onClick={onProposeDeleteGroup} disabled={!isOnline} className={`${rowClass} disabled:opacity-50`} data-propose-delete-group="">
            <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.8} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-destructive">Đề nghị xoá nhóm</span>
          </button>
        </section>
      ) : null}
    </div>
  );
}
