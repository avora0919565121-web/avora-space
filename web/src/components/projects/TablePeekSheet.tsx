import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, Pencil, Plus, Table2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { QuickTaskDialog } from "@/components/think-hub/QuickTaskDialog";
import { RecordDialog } from "@/components/think-hub/RecordDialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { MOTION_EASING, currentRhythm, motionFor } from "@/lib/motion";
import type { Project } from "@/lib/projects";
import {
  isTableFull,
  RECORD_LIMIT,
  recordsOf,
  scopeOfTable,
  subTablesOf,
  type RecordPatch,
  type ThinkRecord,
  type ThinkTable,
} from "@/lib/think-hub";
import { deadlineLabel, taskStatusLabel, todayIso, type TaskItem } from "@/lib/tasks";
import { TYPE } from "@/lib/type-scale";
import { useTaskProjectLinks } from "@/lib/use-projects";
import { useTasks } from "@/lib/use-tasks";
import { useRecordTaskLinks, useThinkHubActions, useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

/**
 * "Xem bảng": a quick look at one table without leaving the Dự án tab.
 *
 * The Hạng mục and the tasks under each can be added and edited right here — the same forms
 * Kế hoạch uses, so nothing behaves differently — and "Mở bảng đầy đủ" goes to Kế hoạch for
 * columns, views and everything else. A bottom sheet on a phone, the same sheet centred on a
 * computer; it fades rather than slides, as the motion tokens allow.
 */
export function TablePeekSheet({
  table,
  conversation,
  project,
  onOpenChange,
}: {
  /** The table being looked at; null keeps the sheet closed. */
  table: ThinkTable | null;
  /** The conversation the table lives in, for the "1-1 với …" / group line and task routing. */
  conversation: ConversationSummary | undefined;
  /** Set for a project's table: its tasks go through the project, and a closed project is read-only. */
  project?: Project;
  onOpenChange: (open: boolean) => void;
}) {
  const motion = motionFor(currentRhythm());
  const animation = { animationDuration: `${motion.durationMs}ms`, animationTimingFunction: MOTION_EASING };

  return (
    <DialogPrimitive.Root open={table !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={animation}
          className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          style={animation}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-[600px] flex-col rounded-t-[20px] border border-b-0 border-border bg-background shadow-lg outline-none",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        >
          {table !== null ? (
            <PeekBody table={table} conversation={conversation} project={project} onClose={() => onOpenChange(false)} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PeekBody({
  table,
  conversation,
  project,
  onClose,
}: {
  table: ThinkTable;
  conversation: ConversationSummary | undefined;
  project: Project | undefined;
  onClose: () => void;
}) {
  // A closed project's tables stay readable and stop taking changes; the server enforces the same.
  const isReadOnly: boolean = project !== undefined && project.status !== "active";
  const today = useMemo(() => todayIso(), []);
  const tablesQuery = useThinkTables();
  const recordsQuery = useThinkRecords();
  const recordTaskLinksQuery = useRecordTaskLinks();
  const projectTaskLinks = useTaskProjectLinks();
  const tasksQuery = useTasks();
  const actions = useThinkHubActions();
  const { isSubmitting, guard } = useSubmitGuard();

  const [newTitle, setNewTitle] = useState<string>("");
  const [editing, setEditing] = useState<ThinkRecord | null>(null);
  const [quickTaskRecord, setQuickTaskRecord] = useState<ThinkRecord | null>(null);

  const allTables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const allRecords = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);
  // Oldest first, the way a list someone is building reads.
  const items = useMemo(() => recordsOf(allRecords, table.id).reverse(), [allRecords, table.id]);

  const tasksById = useMemo(() => new Map((tasksQuery.data ?? []).map((task) => [task.id, task] as const)), [tasksQuery.data]);

  /** Every task hanging under a Hạng mục — the everywhere-else links and project links together. */
  const tasksByRecord = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    const push = (recordId: string, taskId: string): void => {
      const task = tasksById.get(taskId);
      if (task === undefined) return;
      const list = map.get(recordId) ?? [];
      if (!list.some((existing) => existing.id === task.id)) list.push(task);
      map.set(recordId, list);
    };
    for (const link of recordTaskLinksQuery.data ?? []) push(link.recordId, link.taskId);
    for (const link of projectTaskLinks.values()) if (link.recordId !== null) push(link.recordId, link.taskId);
    return map;
  }, [recordTaskLinksQuery.data, projectTaskLinks, tasksById]);

  const knownStatuses = useMemo(() => [...new Set(items.map((record) => record.status))], [items]);
  const place =
    conversation === undefined
      ? "Chỉ mình bạn"
      : conversation.kind === "group"
        ? `Nhóm ${conversationTitle(conversation)}`
        : `1-1 với ${conversationTitle(conversation)}`;
  const conversationKind: "direct" | "group" | null =
    conversation?.kind === "group" ? "group" : conversation?.kind === "direct" ? "direct" : null;

  const addRecord = useCallback(async (): Promise<void> => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    if (isTableFull(allRecords, table.id)) {
      toast.error(`Bảng đã đầy ${RECORD_LIMIT.toLocaleString("vi-VN")} Hạng mục, hãy dọn bớt trước khi thêm.`);
      return;
    }
    await guard(async () => {
      try {
        await actions.createRecord({ tableId: table.id, scope: scopeOfTable(table), title });
        setNewTitle("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không thêm được Hạng mục.");
      }
    });
  }, [newTitle, allRecords, table, guard, actions]);

  const saveRecord = useCallback(
    async (patch: RecordPatch): Promise<void> => {
      if (editing === null) return;
      await actions.updateRecord(editing.id, patch);
      toast.success("Đã lưu.");
    },
    [editing, actions],
  );

  return (
    <>
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
      <div className="flex items-start gap-3 px-5 pb-3 pt-3">
        <Table2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className={cn(TYPE.blockTitle, "truncate text-[16px]")}>{table.name}</DialogPrimitive.Title>
          <p className={TYPE.blockDescription}>
            {place} · {items.length} Hạng mục
          </p>
        </div>
        <DialogPrimitive.Close
          aria-label="Đóng"
          className="press -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-5 pb-4 pt-3">
        {items.length === 0 ? (
          <p className={cn(TYPE.blockDescription, "py-3")}>Chưa có Hạng mục nào. Thêm cái đầu tiên ngay bên dưới.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((record) => (
              <PeekRecord
                key={record.id}
                record={record}
                tasks={tasksByRecord.get(record.id) ?? []}
                subTables={subTablesOf(allTables, record.id)}
                today={today}
                onEdit={isReadOnly ? undefined : () => setEditing(record)}
                onAddTask={isReadOnly ? undefined : () => setQuickTaskRecord(record)}
              />
            ))}
          </ul>
        )}

        {isReadOnly ? (
          <p className={cn(TYPE.meta, "mt-3")}>Dự án đã đóng — bảng chỉ còn để đọc.</p>
        ) : (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newTitle}
            maxLength={200}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addRecord();
            }}
            placeholder="Hạng mục mới…"
            aria-label="Tên Hạng mục mới"
            className="h-10 w-full rounded-md border border-border bg-card px-3.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
          <Button
            className="press h-10 shrink-0 px-4"
            disabled={newTitle.trim().length === 0 || isSubmitting}
            onClick={() => void addRecord()}
          >
            Thêm
          </Button>
        </div>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border px-5 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <Link
          to={`/ke-hoach?bang=${encodeURIComponent(table.id)}`}
          onClick={onClose}
          className="press inline-flex min-h-10 items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Mở bảng đầy đủ
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
        </Link>
      </div>

      <RecordDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        columns={table.columns}
        record={editing}
        knownStatuses={knownStatuses}
        onSave={saveRecord}
        isWorking={actions.isWorking}
        subTables={editing === null ? undefined : subTablesOf(allTables, editing.id)}
        onQuickTask={
          editing === null
            ? undefined
            : () => {
                const record = editing;
                setEditing(null);
                setQuickTaskRecord(record);
              }
        }
      />

      <QuickTaskDialog
        record={quickTaskRecord}
        table={quickTaskRecord === null ? undefined : table}
        project={project}
        conversationKind={conversationKind}
        conversationName={conversation === undefined ? (project?.title ?? "") : conversationTitle(conversation)}
        onOpenChange={(open) => {
          if (!open) setQuickTaskRecord(null);
        }}
      />
    </>
  );
}

function PeekRecord({
  record,
  tasks,
  subTables,
  today,
  onEdit,
  onAddTask,
}: {
  record: ThinkRecord;
  tasks: readonly TaskItem[];
  subTables: readonly ThinkTable[];
  today: string;
  /** Absent when the table is read-only. */
  onEdit?: () => void;
  onAddTask?: () => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className={cn(TYPE.body, "block font-medium")}>{record.title}</span>
          <span className={cn(TYPE.meta, "mt-0.5 block")}>
            {record.status}
            {record.nextActionDate !== null ? ` · ${deadlineLabel(record.nextActionDate, today) ?? record.nextActionDate}` : ""}
            {subTables.length > 0 ? ` · ${subTables.length} bảng con` : ""}
          </span>
        </span>
        {onEdit === undefined ? null : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Sửa Hạng mục "${record.title}"`}
          title="Sửa Hạng mục"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.8} />
        </button>
        )}
      </div>

      {tasks.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", task.status === "done" ? "bg-primary" : "bg-muted-foreground/40")}
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{task.title}</span>
              <span className={cn(TYPE.meta, "shrink-0")}>
                {task.deadline !== null ? `${deadlineLabel(task.deadline, today) ?? task.deadline} · ` : ""}
                {taskStatusLabel(task.status)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {onAddTask === undefined ? null : (
      <button
        type="button"
        onClick={onAddTask}
        className="press mt-2 inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        Thêm việc
      </button>
      )}
    </li>
  );
}
