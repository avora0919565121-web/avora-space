import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
  MessageSquare,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectProgressBar } from "@/components/projects/ProjectProgressBar";
import { ProjectTaskDialog } from "@/components/projects/ProjectTaskDialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import { decisionKeys, fetchGroupDecisions } from "@/lib/decisions";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import {
  canClose,
  closeBlockers,
  closeBlockerSentence,
  isCriterionRecorded,
  isProjectOwner,
  projectProgress,
  taskIdsOf,
  taskProgress,
  type MeasurementType,
  type ProjectDetail as ProjectDetailData,
  type SuccessCriterion,
} from "@/lib/projects";
import { contextLink } from "@/lib/task-context";
import { taskStatusLabel, type TaskItem } from "@/lib/tasks";
import { recordsOf, subTablesOf, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useProjectActions, useProjectDetail } from "@/lib/use-projects";
import { useTasks } from "@/lib/use-tasks";
import { useThinkHubActions, useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-10 w-full rounded-md border border-border bg-card px-3.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60";

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

// ------------------------------------------------------------------ tasks

function TaskLine({ taskId, task }: { taskId: string; task: TaskItem | undefined }) {
  return (
    <li key={taskId} className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          task?.status === "done" ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
        {task?.title ?? "Nhiệm vụ không còn hiển thị với bạn"}
      </span>
      {task ? (
        <>
          <span className="shrink-0 text-[12px] text-muted-foreground">
            {task.deadline !== null ? `${formatDay(task.deadline)} · ` : ""}
            {taskStatusLabel(task.status)}
          </span>
          {task.conversationId !== null ? (
            /* Confirm, return and finish stay in the chat the task lives in — this screen reads
               the work, it does not decide it (ADR-013). */
            <Link
              to={contextLink(task.conversationId, task.id)}
              aria-label={`Mở "${task.title}" trong nhóm`}
              title="Mở trong nhóm"
              className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
            </Link>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function RecordCard({
  record,
  taskIds,
  tasksById,
  statusById,
  subTables,
  canAssign,
  onAssign,
}: {
  record: ThinkRecord;
  taskIds: readonly string[];
  tasksById: ReadonlyMap<string, TaskItem>;
  statusById: ReadonlyMap<string, string>;
  subTables: readonly ThinkTable[];
  canAssign: boolean;
  onAssign: (recordId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const percent = taskProgress(taskIds, statusById);

  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3.5">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="press flex w-full items-start gap-2.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.2}
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground", isOpen && "rotate-90")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-foreground">{record.title}</span>
          <span className="mt-2 block max-w-md">
            <ProjectProgressBar percent={percent} label={record.title} size="sm" />
          </span>
        </span>
        <span className="tabular shrink-0 text-[12px] text-muted-foreground">{taskIds.length} việc</span>
      </button>

      {isOpen ? (
        <div className="mt-3 border-t border-border pl-6 pt-3">
          {taskIds.length > 0 ? (
            <ul className="space-y-1.5">
              {taskIds.map((taskId) => (
                <TaskLine key={taskId} taskId={taskId} task={tasksById.get(taskId)} />
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Chưa có việc nào dưới Hạng mục này.</p>
          )}

          {subTables.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {subTables.map((table) => (
                <li key={table.id}>
                  <Link
                    to={`/ke-hoach?bang=${encodeURIComponent(table.id)}`}
                    className="press inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    Bảng con: {table.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {canAssign ? (
            <button
              type="button"
              onClick={() => onAssign(record.id)}
              className="press mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              Giao việc cho Hạng mục này
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------ success criteria

function CriterionRow({
  criterion,
  isOwner,
  isOpen,
  meetingNotes,
  isWorking,
  onRecord,
  onDelete,
}: {
  criterion: SuccessCriterion;
  isOwner: boolean;
  isOpen: boolean;
  meetingNotes: readonly { id: string; title: string }[];
  isWorking: boolean;
  onRecord: (input: { criterionId: string; actualPercent?: number | null; meetingNoteId?: string | null }) => Promise<void>;
  onDelete: (criterionId: string) => Promise<void>;
}) {
  const [value, setValue] = useState<string>(
    criterion.measurementType === "percentage"
      ? criterion.actualPercent === null
        ? ""
        : String(criterion.actualPercent)
      : (criterion.meetingNoteId ?? ""),
  );
  const recorded = isCriterionRecorded(criterion);
  const noteTitle = meetingNotes.find((note) => note.id === criterion.meetingNoteId)?.title;

  const save = useCallback(async (): Promise<void> => {
    if (criterion.measurementType === "percentage") {
      const trimmed = value.trim().replace(",", ".");
      const parsed = trimmed.length === 0 ? null : Number(trimmed);
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
        toast.error("Hãy nhập một con số từ 0 trở lên.");
        return;
      }
      await onRecord({ criterionId: criterion.id, actualPercent: parsed });
    } else {
      await onRecord({ criterionId: criterion.id, meetingNoteId: value.length === 0 ? null : value });
    }
  }, [criterion, value, onRecord]);

  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-2.5">
        <CheckCircle2
          aria-hidden="true"
          strokeWidth={1.9}
          className={cn("mt-0.5 h-4 w-4 shrink-0", recorded ? "text-primary" : "text-muted-foreground/50")}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-foreground">{criterion.description}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {criterion.measurementType === "percentage"
              ? `Đo bằng %${criterion.targetPercent !== null ? ` · mục tiêu ${criterion.targetPercent}%` : ""}${
                  criterion.actualPercent !== null ? ` · đạt ${criterion.actualPercent}%` : " · chưa ghi kết quả"
                }`
              : noteTitle !== undefined
                ? `Xác nhận qua họp · ${noteTitle}`
                : criterion.meetingNoteId !== null
                  ? "Xác nhận qua họp · đã gắn biên bản"
                  : "Xác nhận qua họp · chưa gắn biên bản"}
          </p>
        </div>
        {isOwner && isOpen ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void onDelete(criterion.id)}
            aria-label={`Bỏ tiêu chí "${criterion.description}"`}
            title="Bỏ tiêu chí"
            className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {isOwner && isOpen ? (
        <div className="mt-2.5 flex items-center gap-2 pl-6">
          {criterion.measurementType === "percentage" ? (
            <input
              value={value}
              inputMode="decimal"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Kết quả đạt được (%)"
              aria-label={`Kết quả đạt được cho "${criterion.description}"`}
              className={cn(fieldClass, "max-w-[200px]")}
            />
          ) : (
            <select
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label={`Biên bản họp cho "${criterion.description}"`}
              className={cn(fieldClass, "max-w-[280px]")}
            >
              <option value="">Chọn biên bản họp đã chốt</option>
              {meetingNotes.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" className="press h-10 shrink-0 px-4" disabled={isWorking} onClick={() => void save()}>
            Ghi kết quả
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function AddCriterionForm({
  isWorking,
  onAdd,
}: {
  isWorking: boolean;
  onAdd: (input: { description: string; measurementType: MeasurementType; targetPercent: number | null }) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [description, setDescription] = useState<string>("");
  const [type, setType] = useState<MeasurementType>("percentage");
  const [target, setTarget] = useState<string>("100");

  const submit = useCallback(async (): Promise<void> => {
    const parsed = type === "percentage" && target.trim().length > 0 ? Number(target.replace(",", ".")) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error("Mục tiêu % phải là một con số lớn hơn 0.");
      return;
    }
    try {
      await onAdd({ description, measurementType: type, targetPercent: parsed });
      setDescription("");
      setIsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thêm được tiêu chí.");
    }
  }, [description, type, target, onAdd]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="press mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        Thêm tiêu chí
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-dashed border-border p-3.5">
      <input
        value={description}
        autoFocus
        maxLength={500}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Nhìn vào đâu để biết dự án đã thành công?"
        aria-label="Mô tả tiêu chí"
        className={fieldClass}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(event) => setType(event.target.value === "meeting_confirmation" ? "meeting_confirmation" : "percentage")}
          aria-label="Cách đo"
          className={cn(fieldClass, "max-w-[220px]")}
        >
          <option value="percentage">Đo bằng %</option>
          <option value="meeting_confirmation">Xác nhận qua họp</option>
        </select>
        {type === "percentage" ? (
          <input
            value={target}
            inputMode="decimal"
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Mục tiêu %"
            aria-label="Mục tiêu phần trăm"
            className={cn(fieldClass, "max-w-[140px]")}
          />
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" className="press h-10" onClick={() => setIsOpen(false)}>
          Để sau
        </Button>
        <Button className="press h-10" disabled={isWorking || description.trim().length === 0} onClick={() => void submit()}>
          Thêm
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

/**
 * One project, read top to bottom: charter, success criteria, Hạng mục with their tasks,
 * ad-hoc tasks, and — for the person who opened it — the close.
 *
 * Every percentage is computed from the tasks themselves, never stored.
 */
const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const detailQuery = useProjectDetail(projectId);
  const tasksQuery = useTasks();
  const conversationsQuery = useConversations();
  const tablesQuery = useThinkTables();
  const recordsQuery = useThinkRecords();
  const actions = useProjectActions();
  const hubActions = useThinkHubActions();

  const [taskTarget, setTaskTarget] = useState<{ recordId: string | null } | null>(null);
  const [newRecordTitle, setNewRecordTitle] = useState<string>("");

  const detail: ProjectDetailData | null = detailQuery.data ?? null;
  const conversationId = detail?.project.conversationId;

  const membersQuery = useQuery({
    queryKey: groupKeys.members(conversationId ?? ""),
    queryFn: () => fetchGroupMembers(conversationId as string),
    enabled: conversationId !== undefined,
  });

  const decisionsQuery = useQuery({
    queryKey: decisionKeys.list(conversationId ?? ""),
    queryFn: () => fetchGroupDecisions(conversationId as string, user?.id),
    enabled: conversationId !== undefined,
  });

  const meetingNotes = useMemo(
    () =>
      (decisionsQuery.data ?? [])
        .filter((entry) => entry.kind === "meeting_note" && entry.status === "finalized")
        .map((entry) => ({ id: entry.id, title: entry.title })),
    [decisionsQuery.data],
  );

  const tasksById = useMemo(() => {
    const map = new Map<string, TaskItem>();
    for (const task of tasksQuery.data ?? []) map.set(task.id, task);
    return map;
  }, [tasksQuery.data]);

  const statusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasksQuery.data ?? []) map.set(task.id, task.status);
    return map;
  }, [tasksQuery.data]);

  const rootTable: ThinkTable | undefined = useMemo(
    () =>
      (tablesQuery.data ?? []).find(
        (table) => table.projectId === projectId && table.parentRecordId === null && table.deletedAt === null,
      ),
    [tablesQuery.data, projectId],
  );

  const records: ThinkRecord[] = useMemo(
    () => (rootTable === undefined ? [] : recordsOf(recordsQuery.data ?? [], rootTable.id).reverse()),
    [rootTable, recordsQuery.data],
  );

  const groupName: string = useMemo(() => {
    const found = (conversationsQuery.data ?? []).find((item) => item.conversationId === conversationId);
    return found ? conversationTitle(found) : "Nhóm";
  }, [conversationsQuery.data, conversationId]);

  const handleAddRecord = useCallback(async (): Promise<void> => {
    if (rootTable === undefined || projectId === undefined) return;
    const title = newRecordTitle.trim();
    if (title.length === 0) return;
    try {
      await hubActions.createRecord({
        tableId: rootTable.id,
        scope: { conversationId: null, projectId },
        title,
      });
      setNewRecordTitle("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thêm được Hạng mục.");
    }
  }, [rootTable, projectId, newRecordTitle, hubActions]);

  const handleClose = useCallback(async (): Promise<void> => {
    if (projectId === undefined) return;
    try {
      await actions.close(projectId);
      toast.success("Đã đóng dự án.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa đóng được dự án.");
    }
  }, [projectId, actions]);

  const runSafely = useCallback(async (work: () => Promise<void>, fallback: string): Promise<void> => {
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  }, []);

  if (detailQuery.isPending) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10 md:px-10" aria-hidden="true">
          <span className="block h-7 w-2/5 animate-pulse rounded bg-secondary" />
          <span className="mt-4 block h-3 w-3/5 animate-pulse rounded bg-secondary/70" />
          <span className="mt-8 block h-24 w-full animate-pulse rounded-xl bg-secondary/60" />
        </div>
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center md:px-10">
          <p className="text-[15px] text-muted-foreground">{detailQuery.error.message}</p>
          <Button variant="outline" className="press mt-5" onClick={() => void detailQuery.refetch()}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center md:px-10">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Không mở được dự án</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">Dự án này không còn nữa hoặc bạn không có quyền xem.</p>
          <Button className="press mt-6" onClick={() => navigate("/tin-nhan?tab=du-an")}>
            Về Dự án
          </Button>
        </div>
      </div>
    );
  }

  const { project } = detail;
  const isOwner = isProjectOwner(project, user?.id);
  const isOpen = project.status === "active";
  const percent = projectProgress(detail.links, statusById);
  const adHocIds = taskIdsOf(detail.links, null);
  const blockers = closeBlockers(
    detail,
    new Map(
      [...tasksById.values()].map((task) => [task.id, { status: task.status, deadline: task.deadline }] as const),
    ),
  );
  const blockerSentence = closeBlockerSentence(blockers);

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <Link
          to="/tin-nhan?tab=du-an"
          className="press inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
          Dự án
        </Link>

        <header className="mt-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <FolderKanban className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground">{project.title}</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {groupName} · {formatDay(project.startDate)} → {formatDay(project.targetEndDate)}
                {project.status === "done" ? " · Đã đóng" : ""}
              </p>
            </div>
          </div>
          <div className="mt-5 max-w-md">
            <ProjectProgressBar percent={percent} label="Tiến độ dự án" />
          </div>
        </header>

        <section className="mt-7 rounded-xl border border-border bg-card px-5 py-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Hiến chương</h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-[12.5px] font-medium text-muted-foreground">Kim chỉ nam</dt>
              <dd className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                {project.valueOrientation}
              </dd>
            </div>
            <div>
              <dt className="text-[12.5px] font-medium text-muted-foreground">Mục tiêu</dt>
              <dd className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{project.objective}</dd>
            </div>
            {project.scope !== null ? (
              <div>
                <dt className="text-[12.5px] font-medium text-muted-foreground">Phạm vi</dt>
                <dd className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{project.scope}</dd>
              </div>
            ) : null}
            {project.assumptions !== null ? (
              <div>
                <dt className="text-[12.5px] font-medium text-muted-foreground">Giả định</dt>
                <dd className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                  {project.assumptions}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="mt-7">
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">Tiêu chí thành công</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {isOwner
              ? "Thêm dần khi nhóm rõ thế nào là xong. Kết quả do bạn tự ghi."
              : "Người mở dự án thêm và ghi kết quả cho từng tiêu chí."}
          </p>
          {detail.criteria.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {detail.criteria.map((criterion) => (
                <CriterionRow
                  key={criterion.id}
                  criterion={criterion}
                  isOwner={isOwner}
                  isOpen={isOpen}
                  meetingNotes={meetingNotes}
                  isWorking={actions.isWorking}
                  onRecord={(input) =>
                    runSafely(async () => {
                      await actions.recordCriterion(project.id, input);
                      toast.success("Đã ghi kết quả.");
                    }, "Không ghi được kết quả.")
                  }
                  onDelete={(criterionId) =>
                    runSafely(() => actions.deleteCriterion(project.id, criterionId), "Không bỏ được tiêu chí.")
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted-foreground">Chưa có tiêu chí nào.</p>
          )}
          {isOwner && isOpen ? (
            <AddCriterionForm
              isWorking={actions.isWorking}
              onAdd={(input) => actions.addCriterion({ projectId: project.id, ...input })}
            />
          ) : null}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold tracking-tight text-foreground">Hạng mục</h2>
            {rootTable !== undefined ? (
              <Link
                to={`/ke-hoach?bang=${encodeURIComponent(rootTable.id)}`}
                className="press inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                Mở bảng đầy đủ
              </Link>
            ) : null}
          </div>

          {records.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {records.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  taskIds={taskIdsOf(detail.links, record.id)}
                  tasksById={tasksById}
                  statusById={statusById}
                  subTables={subTablesOf(tablesQuery.data ?? [], record.id)}
                  canAssign={isOpen}
                  onAssign={(recordId) => setTaskTarget({ recordId })}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted-foreground">
              Chưa có Hạng mục nào. Chia dự án thành vài phần lớn để giao việc cho từng phần.
            </p>
          )}

          {isOpen && rootTable !== undefined ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                value={newRecordTitle}
                maxLength={200}
                onChange={(event) => setNewRecordTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleAddRecord();
                }}
                placeholder="Hạng mục mới, ví dụ: Nhập khẩu thiết bị"
                aria-label="Tên Hạng mục mới"
                className={fieldClass}
              />
              <Button
                className="press h-10 shrink-0 px-4"
                disabled={newRecordTitle.trim().length === 0 || hubActions.isWorking}
                onClick={() => void handleAddRecord()}
              >
                Thêm
              </Button>
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold tracking-tight text-foreground">Việc phát sinh</h2>
            {isOpen ? (
              <button
                type="button"
                onClick={() => setTaskTarget({ recordId: null })}
                className="press inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                Giao việc
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Việc của dự án không thuộc Hạng mục nào.</p>
          {adHocIds.length > 0 ? (
            <ul className="mt-3 space-y-1.5 rounded-lg border border-border bg-card px-4 py-3">
              {adHocIds.map((taskId) => (
                <TaskLine key={taskId} taskId={taskId} task={tasksById.get(taskId)} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted-foreground">Chưa có việc phát sinh.</p>
          )}
        </section>

        {isOwner && isOpen ? (
          <section className="mt-10 border-t border-border pt-6">
            <Button
              variant="outline"
              className="press h-11 px-5"
              disabled={!canClose(blockers) || actions.isWorking}
              onClick={() => void handleClose()}
            >
              Đóng dự án
            </Button>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {blockerSentence ?? "Mọi tiêu chí đã có kết quả và không còn việc nào trễ hạn kết thúc."}
            </p>
          </section>
        ) : null}
      </div>

      {taskTarget !== null ? (
        <ProjectTaskDialog
          open
          onOpenChange={(next) => {
            if (!next) setTaskTarget(null);
          }}
          project={project}
          groupName={groupName}
          members={membersQuery.data ?? []}
          selfId={user?.id}
          records={records}
          initialRecordId={taskTarget.recordId}
        />
      ) : null}
    </div>
  );
};

export default ProjectDetail;
