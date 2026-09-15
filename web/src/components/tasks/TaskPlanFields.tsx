import { Flag, Link2, Play, Square, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { dependenciesOf, dependencyCandidates } from "@/lib/task-dependencies";
import { useDependencyActions, useDependencyList } from "@/lib/use-task-dependencies";
import {
  canStartTask,
  formatProgress,
  isSharedTask,
  isStartedFor,
  parseProgressInput,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskFlagIndex, useTaskStart } from "@/lib/use-task-flags";
import { useTaskActions, useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "rounded-[10px] border border-input bg-card px-3 text-[14px] text-foreground outline-none focus:border-muted-foreground";

/**
 * The depth a task only has if somebody wants it: a flag, a percentage, and what it waits on.
 *
 * Every field here is empty by default and stays empty unless asked for. Most work needs none
 * of it — a plan where everything is a milestone has no milestones in it, and a percentage
 * nobody maintains is worse than no percentage at all. So this block stays quiet: nothing is
 * required, nothing is counted, and leaving all of it alone is the ordinary outcome.
 */
export function TaskPlanFields({ task }: { task: TaskItem }) {
  const { editPlan } = useTaskActions();
  const shared = isSharedTask(task);

  const save = (patch: { isMilestone?: boolean; progressPercent?: number | null }): void => {
    void editPlan.mutateAsync({ taskId: task.id, isShared: shared, patch }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Không lưu được. Thử lại nhé.");
    });
  };

  return (
    <div className="space-y-3 rounded-[10px] border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Kế hoạch (không bắt buộc)
      </p>

      <MilestoneToggle
        checked={task.isMilestone}
        disabled={editPlan.isPending}
        onChange={(next) => save({ isMilestone: next })}
      />

      <ProgressField
        taskId={task.id}
        value={task.progressPercent}
        disabled={editPlan.isPending}
        onCommit={(next) => save({ progressPercent: next })}
      />

      <DependencyField task={task} />
    </div>
  );
}

/** Whether finishing this is an event worth marking. Off is the ordinary answer. */
function MilestoneToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        "press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-60",
        checked
          ? "border-foreground/25 bg-accent text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent/40",
      )}
    >
      <Flag className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      Cột mốc
    </button>
  );
}

/**
 * How far along the work is.
 *
 * Empty and 0% are deliberately different: a task nobody has estimated is not a task reported
 * as untouched. Written on blur rather than on every keystroke, so typing "70" does not pass
 * through 7% on its way there.
 */
function ProgressField({
  taskId,
  value,
  disabled,
  onCommit,
}: {
  taskId: string;
  value: number | null;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  const shown = formatProgress(value);

  const commit = (): void => {
    const trimmed = draft.trim();
    const next = parseProgressInput(trimmed);
    if (trimmed !== "" && next === null) {
      toast.error("Tiến độ phải nằm trong khoảng 0 đến 100.");
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (next === value) return;
    onCommit(next);
  };

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`plan-progress-${taskId}`}
        className="block text-[12px] font-medium text-muted-foreground"
      >
        Tiến độ
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`plan-progress-${taskId}`}
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          value={draft}
          placeholder="—"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          className={cn(CONTROL_CLASS, "tabular h-9 w-[86px] disabled:opacity-60")}
        />
        <span className="text-[12px] text-muted-foreground">%</span>
        {value !== null ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onCommit(null);
            }}
            disabled={disabled}
            className="press flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Bỏ
          </button>
        ) : null}
      </div>
      {shown !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-500 ease-out"
            style={{ width: `${value ?? 0}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What this task waits on.
 *
 * Stated, never enforced: recording that one thing waits on another is a note about reality,
 * and turning it into a lock would mean the app deciding somebody may not start their own
 * work. Tasks already finished stay offerable, because "this waited on that, which is done"
 * is exactly the history worth keeping.
 */
function DependencyField({ task }: { task: TaskItem }) {
  const { data: tasks } = useTasks();
  const links = useDependencyList();
  const { link, unlink, isWorking } = useDependencyActions();
  const [picking, setPicking] = useState<boolean>(false);

  const all = useMemo(() => tasks ?? [], [tasks]);
  const mine = useMemo(() => dependenciesOf(links, task.id), [links, task.id]);
  const candidates = useMemo(() => dependencyCandidates(all, links, task.id), [all, links, task.id]);

  const titleOf = (taskId: string): string =>
    all.find((item) => item.id === taskId)?.title ?? "Nhiệm vụ khác";

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-muted-foreground">Chờ việc khác</p>

      {mine.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Không chờ việc nào.</p>
      ) : (
        <ul className="space-y-1">
          {mine.map((dependency) => (
            <li
              key={dependency.dependsOnTaskId}
              className="flex items-center gap-2 rounded-[8px] border border-border bg-secondary/30 px-2.5 py-1.5"
            >
              <Link2
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                {titleOf(dependency.dependsOnTaskId)}
              </span>
              <button
                type="button"
                onClick={() => {
                  void unlink(task.id, dependency.dependsOnTaskId).catch((error: unknown) => {
                    toast.error(error instanceof Error ? error.message : "Không gỡ được liên kết.");
                  });
                }}
                disabled={isWorking}
                aria-label={`Gỡ phụ thuộc ${titleOf(dependency.dependsOnTaskId)}`}
                className="press shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <select
          aria-label="Chọn việc cần chờ"
          defaultValue=""
          disabled={isWorking}
          onChange={(event) => {
            const chosen = event.target.value;
            if (chosen === "") return;
            setPicking(false);
            void link(task.id, chosen).catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : "Không gắn được liên kết.");
            });
          }}
          className={cn(CONTROL_CLASS, "h-9 w-full disabled:opacity-60")}
        >
          <option value="">Chọn một việc…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          disabled={candidates.length === 0}
          className="press flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
        >
          <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Gắn phụ thuộc
        </button>
      )}
    </div>
  );
}

/**
 * Picking the work up, and putting it back down.
 *
 * Private to the person who pressed it. On a shared task the other side is told nothing: two
 * people carrying the same work start at different moments, and one of them starting says
 * nothing about the other. It also changes no status and mutes nothing — it is a note to
 * yourself about where your day currently is.
 */
export function StartButton({ task }: { task: TaskItem }) {
  const flags = useTaskFlagIndex();
  const { start, stop, isWorking } = useTaskStart();
  const started = isStartedFor(flags, task.id);

  if (!canStartTask(task)) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => (started ? stop(task.id) : start(task.id))}
        disabled={isWorking}
        className={cn(
          "press flex h-11 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium transition-colors disabled:opacity-60",
          started
            ? "border-foreground/25 bg-accent text-foreground"
            : "border-border text-foreground hover:bg-secondary",
        )}
      >
        {started ? (
          <Square className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        )}
        {started ? "Dừng làm" : "Bắt đầu làm"}
      </button>

      {started ? (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/60" aria-hidden="true" />
          Đang làm · chỉ bạn thấy
        </span>
      ) : null}
    </div>
  );
}
