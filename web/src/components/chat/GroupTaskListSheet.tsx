import { ChevronRight, ListTodo, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import {
  assigneeChips,
  buildTaskListEntries,
  countByKind,
  entryAssigneeKey,
  isSettledEntry,
  type TaskListEntry,
} from "@/lib/group-task-list";
import type { GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import { hereFrom, withReturn } from "@/lib/return-to";
import { contextLink } from "@/lib/task-context";
import { PROJECT_TASK_KIND_LABELS, type ProjectTaskKind } from "@/lib/task-scope";
import { recordLink, recordPath } from "@/lib/think-hub";
import {
  deadlineLabel,
  isOpenTask,
  partitionByBin,
  sortTasksByPriority,
  taskStatusLabel,
  todayIso,
  type TaskItem,
} from "@/lib/tasks";
import { useConversations } from "@/lib/use-conversations";
import { useTaskProjectLinks } from "@/lib/use-projects";
import { useTaskSuggestions } from "@/lib/use-task-suggestions";
import { useRecordTaskLinks, useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

type GroupTaskListSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  groupName: string;
  members: readonly GroupMember[];
  /** Set in a project's own chat: the list becomes "Nhiệm vụ dự án" and reads the project's links too. */
  projectId?: string | null;
  /** A task raised in this very chat: close the sheet and point at it here, no navigation. */
  onFocusTask: (taskId: string) => void;
  /** A suggestion still waiting: close the sheet and unfold the suggestion panel onto it. */
  onFocusSuggestion: (suggestionId: string) => void;
};

type KindFilter = "all" | ProjectTaskKind;

const KIND_ORDER: readonly ProjectTaskKind[] = ["planned", "adhoc", "pending"];

const chipClass = (active: boolean): string =>
  cn(
    "press flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors",
    active ? "border-foreground/25 bg-accent text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent/40",
  );

/**
 * The whole room's work — or, in a project's chat, the whole project's (AVORA-39 / Phần 1 · Nhóm D).
 *
 * Three sources, one list: work agreed here, work linked to the project (even when agreed in the
 * parent group), and suggestions still waiting to be taken. Split into Theo kế hoạch (filed under a
 * Hạng mục), Phát sinh (everything else) and Chờ nhận. It reads and leads; the buttons that move a
 * task along stay where the task lives (ADR-013). Offline it shows what was last synced.
 */
export function GroupTaskListSheet({
  open,
  onOpenChange,
  conversationId,
  groupName,
  members,
  projectId = null,
  onFocusTask,
  onFocusSuggestion,
}: GroupTaskListSheetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: tasks } = useTasks();
  const { data: suggestions } = useTaskSuggestions();
  const projectLinks = useTaskProjectLinks();
  const recordTaskLinksQuery = useRecordTaskLinks();
  const { data: tables } = useThinkTables();
  const { data: records } = useThinkRecords();
  const { data: conversations } = useConversations();
  const userId: string | undefined = user?.id;
  const today = todayIso();
  const isProject = projectId !== null;

  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  // Closing forgets the picks, so reopening reads everything again.
  useEffect(() => {
    if (!open) {
      setPickedKey(null);
      setKindFilter("all");
    }
  }, [open]);

  const entries: TaskListEntry[] = useMemo(() => {
    const kept = partitionByBin(tasks ?? [], userId).kept;
    return buildTaskListEntries({
      conversationId,
      projectId,
      tasks: sortTasksByPriority(kept, today, userId),
      projectLinks: [...projectLinks.values()],
      recordTaskLinks: recordTaskLinksQuery.data ?? [],
      suggestions: suggestions ?? [],
    });
  }, [tasks, userId, today, conversationId, projectId, projectLinks, recordTaskLinksQuery.data, suggestions]);

  const counts = countByKind(entries);
  const openCount = entries.filter((entry) => entry.kind !== "pending" && isOpenTask(entry.task, userId)).length;
  const taskCount = counts.planned + counts.adhoc;

  const byKind = useMemo(
    () => (kindFilter === "all" ? entries : entries.filter((entry) => entry.kind === kindFilter)),
    [entries, kindFilter],
  );
  const chips = useMemo(() => assigneeChips(byKind, members, userId), [byKind, members, userId]);
  const visible = useMemo(
    () => (pickedKey === null ? byKind : byKind.filter((entry) => entryAssigneeKey(entry, members) === pickedKey)),
    [byKind, pickedKey, members],
  );

  const conversationName = (id: string | null): string | null => {
    if (id === null) return null;
    const found = (conversations ?? []).find((entry) => entry.conversationId === id);
    return found === undefined ? null : conversationTitle(found);
  };
  const assigneeName = (id: string | null): string => {
    if (id !== null && id === userId) return "bạn";
    const member = members.find((entry) => entry.userId === id);
    return member === undefined ? "chưa rõ" : memberLabel(member);
  };

  const here = hereFrom(location, groupName);

  /** Tapping a line goes to the one place that holds it (D4). */
  const openEntry = (entry: TaskListEntry): void => {
    onOpenChange(false);
    if (entry.kind === "pending") {
      onFocusSuggestion(entry.suggestion.id);
      return;
    }
    if (entry.kind === "planned") {
      const path = recordPath(tables ?? [], records ?? [], entry.recordId);
      if (path !== null) {
        navigate(withReturn(recordLink(path.tableId, entry.recordId, entry.task.id), here));
        return;
      }
    }
    const where = entry.task.contextSnapshot?.conversationId ?? entry.task.conversationId;
    if (where === null || where === conversationId) {
      onFocusTask(entry.task.id);
      return;
    }
    navigate(withReturn(contextLink(where, entry.task.id), here));
  };

  const sections: { kind: ProjectTaskKind; content: ReactNode }[] = KIND_ORDER.filter(
    (kind) => kindFilter === "all" || kindFilter === kind,
  )
    .map((kind): { kind: ProjectTaskKind; content: ReactNode } | null => {
      const inKind = visible.filter((entry) => entry.kind === kind);
      if (inKind.length === 0) return null;
      return {
        kind,
        content:
          kind === "planned" ? (
            <PlannedGroups
              entries={inKind}
              pathOf={(recordId) => recordPath(tables ?? [], records ?? [], recordId)}
              onOpenRecord={(tableId, recordId) => {
                onOpenChange(false);
                navigate(withReturn(recordLink(tableId, recordId), here));
              }}
              renderRow={(entry) => (
                <EntryRow key={entry.id} entry={entry} today={today} assignee={assigneeName} onOpen={openEntry} />
              )}
            />
          ) : (
            <SettledSplit
              entries={inKind}
              renderRow={(entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  today={today}
                  assignee={assigneeName}
                  onOpen={openEntry}
                  originNote={
                    entry.kind === "adhoc" && entry.task.conversationId !== conversationId
                      ? conversationName(entry.task.conversationId)
                      : null
                  }
                />
              )}
            />
          ),
      };
    })
    .filter((section): section is { kind: ProjectTaskKind; content: ReactNode } => section !== null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md">
        <div className="border-b border-border px-5 py-5">
          <SheetTitle className="text-[20px] font-semibold tracking-tight text-foreground">
            {isProject ? "Nhiệm vụ dự án" : "Danh sách nhiệm vụ nhóm"}
          </SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
            {entries.length === 0
              ? `Chưa có nhiệm vụ nào trong ${groupName}`
              : `${taskCount} việc · ${openCount} đang mở${counts.pending > 0 ? ` · ${counts.pending} chờ nhận` : ""}`}
          </SheetDescription>
        </div>

        {entries.length > 0 ? (
          <div className="space-y-2 border-b border-border px-5 py-3">
            <div role="group" aria-label="Loại việc" className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setKindFilter("all")} aria-pressed={kindFilter === "all"} className={chipClass(kindFilter === "all")}>
                Tất cả
                <span className="tabular text-[11px] text-muted-foreground/80">{entries.length}</span>
              </button>
              {KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kindFilter === kind ? "all" : kind)}
                  aria-pressed={kindFilter === kind}
                  className={chipClass(kindFilter === kind)}
                >
                  {PROJECT_TASK_KIND_LABELS[kind]}
                  <span className="tabular text-[11px] text-muted-foreground/80">{counts[kind]}</span>
                </button>
              ))}
            </div>
            {chips.length > 1 ? (
              <div role="group" aria-label="Người đảm trách" className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => {
                  const active = pickedKey === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setPickedKey(active ? null : chip.key)}
                      aria-pressed={active}
                      className={chipClass(active)}
                    >
                      {chip.name}
                      <span className="tabular text-[11px] text-muted-foreground/80">{chip.count}</span>
                    </button>
                  );
                })}
                {pickedKey !== null ? (
                  <button
                    type="button"
                    onClick={() => setPickedKey(null)}
                    aria-label="Bỏ lọc theo người đảm trách"
                    className="press flex min-h-9 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    Bỏ lọc
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <div className="py-16 text-center">
              <ListTodo className="mx-auto h-10 w-10 text-muted-foreground/60" strokeWidth={1.3} aria-hidden="true" />
              <p className="mt-4 text-[14px] text-muted-foreground">
                Nhiệm vụ được tạo từ trong cuộc trò chuyện — mở một tin nhắn và chọn “Tạo task từ tin nhắn này”.
              </p>
            </div>
          ) : sections.length === 0 ? (
            <p className="py-16 text-center text-[14px] text-muted-foreground">
              Không có việc nào khớp lựa chọn này — bấm “Tất cả” để xem lại.
            </p>
          ) : (
            <div className="space-y-7">
              {sections.map((section) => (
                <section key={section.kind} aria-label={PROJECT_TASK_KIND_LABELS[section.kind]}>
                  <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {PROJECT_TASK_KIND_LABELS[section.kind]}
                  </h3>
                  {section.content}
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Open work first, then `Đã xong (n)` folded at the foot. */
function SettledSplit({
  entries,
  renderRow,
}: {
  entries: readonly TaskListEntry[];
  renderRow: (entry: TaskListEntry) => ReactNode;
}) {
  const [showDone, setShowDone] = useState<boolean>(false);
  const active = entries.filter((entry) => !isSettledEntry(entry));
  const settled = entries.filter(isSettledEntry);
  return (
    <>
      <ul className="space-y-1">{active.map(renderRow)}</ul>
      {settled.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setShowDone((current) => !current)}
            aria-expanded={showDone}
            className="press mt-1.5 flex min-h-10 items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("h-3.5 w-3.5", showDone && "rotate-90")} strokeWidth={2.2} aria-hidden="true" />
            Đã xong ({settled.length})
          </button>
          {showDone ? <ul className="space-y-1">{settled.map(renderRow)}</ul> : null}
        </>
      ) : null}
    </>
  );
}

/** Theo kế hoạch, grouped under "Bảng › Hạng mục"; the heading opens that Hạng mục. */
function PlannedGroups({
  entries,
  pathOf,
  onOpenRecord,
  renderRow,
}: {
  entries: readonly TaskListEntry[];
  pathOf: (recordId: string) => { label: string; tableId: string } | null;
  onOpenRecord: (tableId: string, recordId: string) => void;
  renderRow: (entry: TaskListEntry) => ReactNode;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, TaskListEntry[]>();
    for (const entry of entries) {
      if (entry.kind !== "planned") continue;
      const list = map.get(entry.recordId) ?? [];
      list.push(entry);
      map.set(entry.recordId, list);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <div className="space-y-4">
      {groups.map(([recordId, list]) => {
        const path = pathOf(recordId);
        return (
          <div key={recordId}>
            {path !== null ? (
              <button
                type="button"
                onClick={() => onOpenRecord(path.tableId, recordId)}
                title={path.label}
                className="press mb-1 flex min-h-9 w-full items-center gap-1 text-left text-[13px] font-semibold text-foreground hover:text-primary"
              >
                <span className="min-w-0 flex-1 truncate">{path.label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              <p className="mb-1 text-[13px] font-semibold text-muted-foreground">Hạng mục</p>
            )}
            <SettledSplit entries={list} renderRow={renderRow} />
          </div>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  today,
  assignee,
  onOpen,
  originNote = null,
}: {
  entry: TaskListEntry;
  today: string;
  assignee: (id: string | null) => string;
  onOpen: (entry: TaskListEntry) => void;
  originNote?: string | null;
}) {
  if (entry.kind === "pending") {
    const deadline = deadlineLabel(entry.suggestion.deadline, today);
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="press flex w-full items-start gap-3 rounded-[10px] border border-dashed border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
        >
          <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] leading-5 text-muted-foreground">{entry.suggestion.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground/80">
              <span>Chờ {assignee(entry.suggestion.assigneeId)} nhận</span>
              {deadline !== null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{deadline}</span>
                </>
              ) : null}
            </span>
          </span>
        </button>
      </li>
    );
  }
  const task: TaskItem = entry.task;
  const deadline = deadlineLabel(task.deadline, today);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="press flex w-full items-start gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
      >
        <TaskBubble state={SHARED_BUBBLE_STATE[task.status]} label={taskStatusLabel(task.status)} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[14px] font-medium leading-5",
              task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {task.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>{assignee(task.assigneeId)}</span>
            <span aria-hidden="true">·</span>
            <span>{taskStatusLabel(task.status)}</span>
            {deadline !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{deadline}</span>
              </>
            ) : null}
            {originNote !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Từ {originNote}</span>
              </>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
