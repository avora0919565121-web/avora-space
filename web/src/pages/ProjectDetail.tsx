import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  FolderKanban,
  Link2,
  MessageSquare,
  Plus,
  Target,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectProgressBar } from "@/components/projects/ProjectProgressBar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import {
  canConfirmDeliverable,
  deliverableProgress,
  deliverablesOf,
  objectiveProgress,
  projectProgress,
  taskIdsOf,
  type Deliverable,
  type Objective,
  type ProjectTree,
} from "@/lib/projects";
import { contextLink } from "@/lib/task-context";
import { taskStatusLabel, type TaskItem } from "@/lib/tasks";
import { useConversations } from "@/lib/use-conversations";
import { useProjectActions, useProjectTree } from "@/lib/use-projects";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

/** The four charter questions, read back in the order they were asked. */
const CHARTER_ROWS: readonly { readonly key: keyof ProjectTree["project"]; readonly label: string }[] =
  [
    { key: "purpose", label: "Mục đích" },
    { key: "scope", label: "Phạm vi" },
    { key: "successCriteria", label: "Tiêu chí thành công" },
    { key: "assumptions", label: "Giả định" },
  ];

/** A single-field inline composer — used for both new objectives and new deliverables. */
function InlineAdd({
  placeholder,
  buttonLabel,
  onSubmit,
  isWorking,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (value: string) => Promise<void>;
  isWorking: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [value, setValue] = useState<string>("");

  const submit = useCallback(async (): Promise<void> => {
    const clean = value.trim();
    if (clean.length === 0) return;
    try {
      await onSubmit(clean);
      setValue("");
      setIsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được, thử lại nhé.");
    }
  }, [value, onSubmit]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="press flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        {buttonLabel}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        autoFocus
        maxLength={200}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") {
            setValue("");
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
      />
      <Button
        className="press h-10 shrink-0 px-4"
        disabled={value.trim().length === 0 || isWorking}
        onClick={() => void submit()}
      >
        Thêm
      </Button>
    </div>
  );
}

/** One deliverable: its progress, its tasks, and the sign-off the project's owner can give. */
function DeliverableCard({
  deliverable,
  tree,
  tasksById,
  taskStatusById,
  isOwner,
  isWorking,
  onConfirm,
}: {
  deliverable: Deliverable;
  tree: ProjectTree;
  tasksById: ReadonlyMap<string, TaskItem>;
  taskStatusById: ReadonlyMap<string, string>;
  isOwner: boolean;
  isWorking: boolean;
  onConfirm: (deliverableId: string) => Promise<void>;
}) {
  const percent = deliverableProgress(deliverable, tree.links, taskStatusById);
  const taskIds = taskIdsOf(tree, deliverable.id);
  const isConfirmed = deliverable.confirmedAt !== null;

  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-medium text-foreground">
              {deliverable.title}
            </span>
            {isConfirmed ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <BadgeCheck className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                Đã nghiệm thu
              </span>
            ) : null}
          </span>
          <span className="mt-2 block">
            <ProjectProgressBar percent={percent} label={deliverable.title} size="sm" />
          </span>
        </span>
      </div>

      {taskIds.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
          {taskIds.map((taskId) => {
            const task = tasksById.get(taskId);
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
                  {task?.title ?? "Nhiệm vụ không còn hiển thị"}
                </span>
                {task ? (
                  <>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {taskStatusLabel(task.status)}
                    </span>
                    {task.conversationId !== null ? (
                      /* Confirm, Return and Hoàn thành all stay in the chat the task was made
                         in — this screen reads the work, it does not decide it. */
                      <Link
                        to={contextLink(task.conversationId, task.id)}
                        aria-label={`Mở "${task.title}" trong cuộc trò chuyện`}
                        title="Mở trong cuộc trò chuyện"
                        className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                      >
                        <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">
          Chưa có nhiệm vụ nào. Nối một nhiệm vụ từ Nhật ký hoặc từ cuộc trò chuyện.
        </p>
      )}

      {isOwner && !isConfirmed ? (
        <button
          type="button"
          disabled={isWorking}
          onClick={() => void onConfirm(deliverable.id)}
          className="press mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
        >
          <BadgeCheck className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
          Xác nhận đã đạt
        </button>
      ) : null}
    </li>
  );
}

/** One objective and the deliverables under it. */
function ObjectiveSection({
  objective,
  tree,
  tasksById,
  taskStatusById,
  isOwner,
  isWorking,
  onAddDeliverable,
  onConfirm,
}: {
  objective: Objective;
  tree: ProjectTree;
  tasksById: ReadonlyMap<string, TaskItem>;
  taskStatusById: ReadonlyMap<string, string>;
  isOwner: boolean;
  isWorking: boolean;
  onAddDeliverable: (objectiveId: string, title: string) => Promise<void>;
  onConfirm: (deliverableId: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const deliverables = deliverablesOf(tree, objective.id);
  const percent = objectiveProgress(objective, tree, taskStatusById);

  return (
    <section className="rounded-xl border border-border bg-card/60 px-4 py-4">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="press flex w-full items-start gap-2.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.2}
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />
        <Target
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">{objective.title}</span>
          <span className="mt-2 block max-w-md">
            <ProjectProgressBar percent={percent} label={objective.title} size="sm" />
          </span>
        </span>
      </button>

      {isOpen ? (
        <div className="mt-3.5 pl-7">
          {deliverables.length > 0 ? (
            <ul className="space-y-2">
              {deliverables.map((deliverable) => (
                <DeliverableCard
                  key={deliverable.id}
                  deliverable={deliverable}
                  tree={tree}
                  tasksById={tasksById}
                  taskStatusById={taskStatusById}
                  isOwner={isOwner}
                  isWorking={isWorking}
                  onConfirm={onConfirm}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Chưa có kết quả cần giao nào cho mục tiêu này.
            </p>
          )}
          <div className="mt-3">
            <InlineAdd
              placeholder="Kết quả cần giao là gì?"
              buttonLabel="Thêm kết quả"
              isWorking={isWorking}
              onSubmit={(value) => onAddDeliverable(objective.id, value)}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * One project, read top to bottom: charter, then Objective → Deliverable → Task.
 *
 * Every percentage on this page is computed from the tasks themselves, never stored. A saved
 * number would have to be kept in step by a trigger on `tasks`, and would disagree with the
 * checklist the moment anything moved.
 */
const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const treeQuery = useProjectTree(projectId);
  const tasksQuery = useTasks();
  const conversationsQuery = useConversations();
  const actions = useProjectActions();

  const tasksById = useMemo(() => {
    const map = new Map<string, TaskItem>();
    for (const task of tasksQuery.data ?? []) map.set(task.id, task);
    return map;
  }, [tasksQuery.data]);

  const taskStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasksQuery.data ?? []) map.set(task.id, task.status);
    return map;
  }, [tasksQuery.data]);

  const tree = treeQuery.data ?? null;

  const conversationLabel: string = useMemo(() => {
    if (tree === null) return "";
    const found = (conversationsQuery.data ?? []).find(
      (item) => item.conversationId === tree.project.conversationId,
    );
    return found ? conversationTitle(found) : "Cuộc trò chuyện";
  }, [tree, conversationsQuery.data]);

  const handleConfirm = useCallback(
    async (deliverableId: string): Promise<void> => {
      if (projectId === undefined) return;
      try {
        await actions.confirm(projectId, deliverableId);
        toast.success("Đã xác nhận kết quả này.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không xác nhận được.");
      }
    },
    [projectId, actions],
  );

  const handleAddObjective = useCallback(
    async (title: string): Promise<void> => {
      if (projectId === undefined) return;
      await actions.addObjective(projectId, title);
    },
    [projectId, actions],
  );

  const handleAddDeliverable = useCallback(
    async (objectiveId: string, title: string): Promise<void> => {
      if (projectId === undefined) return;
      await actions.addDeliverable(projectId, objectiveId, title);
    },
    [projectId, actions],
  );

  if (treeQuery.isPending) {
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

  if (treeQuery.isError) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center md:px-10">
          <p className="text-[15px] text-muted-foreground">{treeQuery.error.message}</p>
          <Button variant="outline" className="press mt-5" onClick={() => void treeQuery.refetch()}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (tree === null) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center md:px-10">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Không mở được dự án
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Dự án này không còn nữa hoặc bạn không có quyền xem.
          </p>
          <Button className="press mt-6" onClick={() => navigate("/tin-nhan")}>
            Về Tin nhắn
          </Button>
        </div>
      </div>
    );
  }

  const isOwner = canConfirmDeliverable(tree.project, user?.id);
  const percent = projectProgress(tree, taskStatusById);
  const charter = CHARTER_ROWS.filter((row) => {
    const value = tree.project[row.key];
    return typeof value === "string" && value.trim().length > 0;
  });

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
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
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground">
                {tree.project.title}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">{conversationLabel}</p>
            </div>
          </div>
          <div className="mt-5 max-w-md">
            <ProjectProgressBar percent={percent} label="Tiến độ dự án" />
          </div>
        </header>

        {charter.length > 0 ? (
          <section className="mt-7 rounded-xl border border-border bg-card px-5 py-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hiến chương
            </h2>
            <dl className="mt-3 space-y-3">
              {charter.map((row) => (
                <div key={row.key}>
                  <dt className="text-[12.5px] font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                    {String(tree.project[row.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="mt-7">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold tracking-tight text-foreground">Mục tiêu</h2>
            {!isOwner ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                Chỉ người mở dự án xác nhận kết quả
              </p>
            ) : null}
          </div>

          {tree.objectives.length > 0 ? (
            <div className="mt-4 space-y-3">
              {tree.objectives.map((objective) => (
                <ObjectiveSection
                  key={objective.id}
                  objective={objective}
                  tree={tree}
                  tasksById={tasksById}
                  taskStatusById={taskStatusById}
                  isOwner={isOwner}
                  isWorking={actions.isWorking}
                  onAddDeliverable={handleAddDeliverable}
                  onConfirm={handleConfirm}
                />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-muted-foreground">Chưa có mục tiêu nào.</p>
          )}

          <div className="mt-4">
            <InlineAdd
              placeholder="Mục tiêu tiếp theo là gì?"
              buttonLabel="Thêm mục tiêu"
              isWorking={actions.isWorking}
              onSubmit={handleAddObjective}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default ProjectDetail;
