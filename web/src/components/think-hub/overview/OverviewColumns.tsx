import { ChevronLeft, ChevronRight, FileText, ListChecks, Plus, Sparkles, Table2 } from "lucide-react";
export type { OverviewAddress } from "@/lib/project-tree";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

import { TaskRows } from "@/components/think-hub/overview/TaskRows";
import { TaskCard } from "@/components/tasks/TaskCard";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useLongPress } from "@/hooks/use-long-press";
import {
  UNLINKED_KEY,
  addressOf,
  branchSlice,
  handleLabel,
  nodeKey,
  tallyLabel,
  type OverviewAddress,
  type OverviewColumn,
  type Tree,
  type TreeNode,
} from "@/lib/project-tree";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** The row in column `index` that the next column was opened from (lit in the pull-out). */
function pickedIn(columns: readonly OverviewColumn[], index: number): string | null {
  const next = columns[index + 1];
  if (next === undefined) return null;
  return next.kind === "task" ? next.taskId : nodeKey(next.node);
}

const SLIDE_MS = 220;

/**
 * Toàn cảnh on a phone / upright tablet (AVORA-104 · PHẦN 4 · 4.3): one column at a time (two on a
 * landscape tablet). Going deeper slides the parent off to the left, leaving a 22 px handle at the
 * edge; tapping or swiping it pulls the parent back over the screen to pick another row, which
 * replaces the current column (no column added). `‹` steps back one column; holding it leaves.
 */
export const OverviewColumns = memo(function OverviewColumns({
  tree,
  columns,
  isTwoUp,
  onlyOpen,
  onToggleOnlyOpen,
  tasksOf,
  taskById,
  canEdit,
  onGo,
  onBack,
  onHome,
  onShowBoard,
  onAddRecord,
  onAddTask,
  onLinkTask,
  onRecordDetails,
}: {
  tree: Tree;
  columns: readonly OverviewColumn[];
  isTwoUp: boolean;
  onlyOpen: boolean;
  onToggleOnlyOpen: () => void;
  tasksOf: (key: string) => readonly TaskItem[];
  taskById: (id: string) => TaskItem | undefined;
  canEdit: boolean;
  /** `push` going deeper; `replace` when the pull-out swaps the current column. */
  onGo: (address: OverviewAddress, how: "push" | "replace") => void;
  onBack: (address: OverviewAddress | null) => void;
  onHome: () => void;
  onShowBoard: () => void;
  onAddRecord: (boardId: string) => void;
  onAddTask: (recordId: string) => void;
  onLinkTask: (recordId: string) => void;
  onRecordDetails: (recordId: string) => void;
}) {
  const [isPullOpen, setIsPullOpen] = useState<boolean>(false);
  const [shown, setShown] = useState<Record<string, number>>({});
  const visible = Math.min(columns.length, isTwoUp ? 2 : 1);
  const firstShown = columns.length - visible;
  const hiddenIndex = firstShown - 1;
  const hidden = hiddenIndex >= 0 ? columns[hiddenIndex] : undefined;
  const current = columns[columns.length - 1];

  // Deeper → the new column comes in from the right; back → from the left. Reduced motion: no slide.
  const depthRef = useRef<number>(columns.length);
  const [direction, setDirection] = useState<"in" | "back" | null>(null);
  useEffect(() => {
    const was = depthRef.current;
    depthRef.current = columns.length;
    if (was === columns.length) return;
    setDirection(columns.length > was ? "in" : "back");
    const timer = window.setTimeout(() => setDirection(null), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [columns.length]);

  const back = (): void => {
    if (columns.length <= 1) {
      onHome();
      return;
    }
    onBack(addressOf(columns, columns.length - 2, tree));
  };
  const hold = useLongPress({ onTap: back, onHold: onHome });

  // Swipe right from the handle pulls the column out; a swipe left on the pulled-out column puts it back.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = (onSwipe: (dx: number) => void) => ({
    onPointerDown: (event: React.PointerEvent) => {
      swipe.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: React.PointerEvent) => {
      const start = swipe.current;
      swipe.current = null;
      if (start === null) return;
      const dx = event.clientX - start.x;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(event.clientY - start.y)) onSwipe(dx);
    },
    onPointerCancel: () => {
      swipe.current = null;
    },
  });

  if (current === undefined) return null;

  const pathLine = columns
    .slice(Math.max(0, columns.length - 3), columns.length - 1)
    .map((column) => (column.kind === "task" ? "Việc" : column.node.title))
    .join(" › ");
  const currentTitle = current.kind === "task" ? (taskById(current.taskId)?.title ?? "Việc") : current.kind === "record" && columns.length > 1 ? current.node.title : current.node.title;

  const renderBody = (column: OverviewColumn, index: number, pick: (address: OverviewAddress) => void, isPull: boolean): ReactNode => {
    const picked = pickedIn(columns, index);
    const rowClass = (isPicked: boolean): string =>
      cn("press flex min-h-[52px] w-full items-center gap-3 border-b border-border/60 px-4 text-left transition-colors hover:bg-accent/30", isPicked && "bg-personal/10");
    const tally = (node: TreeNode): ReactNode => (
      <span className="tabular shrink-0 text-[12.5px] text-muted-foreground" data-column-tally="">
        {tallyLabel(node, onlyOpen)}
      </span>
    );
    const label = (text: string): ReactNode => (
      <p className="px-4 pb-1.5 pt-4 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{text}</p>
    );

    if (column.kind === "task") {
      const task = taskById(column.taskId);
      if (task === undefined) return <p className="px-4 py-6 text-[14px] text-muted-foreground">Không thấy việc này nữa.</p>;
      const parent = columns[index - 1];
      return (
        <div className="h-full min-h-[70dvh]">
          <TaskCard task={task} open embedded backLabel={parent === undefined || parent.kind === "task" ? "Việc" : parent.node.title} onOpenChange={(open) => !open && back()} />
        </div>
      );
    }

    if (column.kind === "board") {
      const records = tree.childrenOf(column.node.id).filter((child) => child.kind === "record");
      const { rows, more } = branchSlice(records, tree, shown[column.node.id]);
      const unlinked = column.node.id === tree.root?.id ? tree.childrenOf(column.node.id).find((child) => child.kind === "unlinked") : undefined;
      return (
        <>
          {label(column.node.kind === "project" ? "Hạng mục của dự án" : "Hạng mục")}
          {records.length === 0 ? <p className="px-4 py-2 text-[13.5px] text-muted-foreground">Chưa có Hạng mục nào.</p> : null}
          {rows.map((node) => (
            <button key={node.id} type="button" data-column-row={node.id} onClick={() => pick({ board: column.node.id, record: node.id, task: null })} className={rowClass(picked === node.id)}>
              <FileText className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{node.title}</span>
              {tally(node)}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
          {more > 0 ? (
            <button type="button" onClick={() => setShown((value) => ({ ...value, [column.node.id]: (value[column.node.id] ?? 50) + 50 }))} className="press min-h-11 px-4 text-[13.5px] font-semibold text-personal">
              Xem thêm {more.toLocaleString("vi-VN")}
            </button>
          ) : null}
          {unlinked !== undefined ? (
            <>
              {label("Khác")}
              <button type="button" data-column-row={UNLINKED_KEY} onClick={() => pick({ board: column.node.id, record: UNLINKED_KEY, task: null })} className={rowClass(picked === UNLINKED_KEY)}>
                <ListChecks className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{unlinked.title}</span>
                {tally(unlinked)}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </>
          ) : null}
          {!isPull ? (
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              {canEdit ? (
                <button type="button" onClick={() => onAddRecord(column.node.id)} className="press inline-flex min-h-11 items-center gap-1 text-[13.5px] font-semibold text-personal">
                  <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" /> Hạng mục
                </button>
              ) : (
                <span />
              )}
              <OnlyOpenSwitch onlyOpen={onlyOpen} onToggle={onToggleOnlyOpen} />
            </div>
          ) : null}
        </>
      );
    }

    const tasks = tasksOf(nodeKey(column.node));
    const subs = column.kind === "record" ? tree.childrenOf(column.node.id).filter((child) => child.kind === "table") : [];
    const recordAddress = column.kind === "record" ? { board: column.node.parentId ?? "", record: column.node.id } : { board: tree.root?.id ?? "", record: UNLINKED_KEY };
    return (
      <>
        {subs.length > 0 ? (
          <>
            {label("Bảng con")}
            {subs.map((node) => (
              <button key={node.id} type="button" data-column-row={node.id} onClick={() => pick({ board: node.id, record: null, task: null })} className={rowClass(picked === node.id)}>
                <Table2 className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{node.title}</span>
                {tally(node)}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </>
        ) : null}
        {label("Việc")}
        <TaskRows
          tasks={tasks}
          selectedId={picked}
          onOpen={(task) => pick({ ...recordAddress, task: task.id })}
          onAdd={column.kind === "record" && canEdit && !isPull ? () => onAddTask(column.node.id) : undefined}
          onLink={column.kind === "record" && canEdit && !isPull ? () => onLinkTask(column.node.id) : undefined}
        />
        {column.kind === "record" && !isPull ? (
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <button type="button" onClick={() => onRecordDetails(column.node.id)} className="press inline-flex min-h-11 items-center text-[13.5px] font-medium text-muted-foreground hover:text-foreground">
              Mở Hạng mục
            </button>
            <OnlyOpenSwitch onlyOpen={onlyOpen} onToggle={onToggleOnlyOpen} />
          </div>
        ) : null}
      </>
    );
  };

  const shownColumns = columns.slice(firstShown);
  return (
    <div data-overview-columns="" data-column-count={columns.length} data-visible={visible} className="relative -mx-4 sm:-mx-6">
      {/* Head: `‹` · a short path over the current column's name · `Chỉ bảng`. */}
      <div className="flex min-h-[56px] items-center gap-1 border-b border-border/60 px-2">
        <button type="button" {...hold} aria-label="Lùi một cột (giữ để về đầu Kế hoạch)" data-column-back="" className="press no-callout flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent/40">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-muted-foreground" data-column-path="">
            {pathLine === "" ? "Kế hoạch › Toàn cảnh" : pathLine}
          </p>
          <h2 className="truncate text-[18px] font-semibold tracking-tight text-foreground" data-column-title="">
            {current.kind === "board" && current.node.kind === "project" ? <Sparkles className="mr-1.5 inline h-4 w-4 -translate-y-px text-muted-foreground" aria-hidden="true" /> : null}
            {currentTitle}
          </h2>
        </div>
        <button type="button" onClick={onShowBoard} className="press min-h-9 shrink-0 rounded-full border border-border px-3 text-[12.5px] font-medium text-foreground">
          Chỉ bảng
        </button>
      </div>

      <div className={cn("grid min-h-[60dvh]", visible === 2 ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border/60" : "grid-cols-[minmax(0,1fr)]", hidden !== undefined && "pl-[14px]")}>
        {shownColumns.map((column, offset) => {
          const index = firstShown + offset;
          const isLast = index === columns.length - 1;
          return (
            <section
              key={`${index}:${column.kind === "task" ? column.taskId : nodeKey(column.node)}`}
              aria-label={column.kind === "task" ? (taskById(column.taskId)?.title ?? "Việc") : column.node.title}
              data-overview-column={column.kind}
              className={cn(
                "min-w-0",
                isLast && direction === "in" && "motion-safe:duration-200 motion-safe:animate-in motion-safe:slide-in-from-right-1/3",
                isLast && direction === "back" && "motion-safe:duration-200 motion-safe:animate-in motion-safe:slide-in-from-left-1/3",
              )}
            >
              {renderBody(column, index, (address) => onGo(address, "push"), false)}
            </section>
          );
        })}
      </div>

      {/* Which column this is — not a control. */}
      <div aria-hidden="true" data-column-dots="" className="sticky bottom-3 flex justify-center gap-1.5 py-3">
        {columns.map((column, index) => (
          <span key={index} className={cn("h-1.5 rounded-full transition-all", index >= firstShown ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/40")} />
        ))}
      </div>

      {hidden !== undefined ? (
        <button
          type="button"
          data-h-scroll=""
          data-column-handle=""
          aria-label={`Hiện lại ${handleLabel(hidden, columns[hiddenIndex + 1], tree)}`}
          onClick={() => setIsPullOpen(true)}
          {...swipeHandlers((dx) => dx > 0 && setIsPullOpen(true))}
          className="press fixed left-0 top-1/2 z-30 flex h-[200px] w-[22px] -translate-y-1/2 touch-none flex-col items-center justify-center gap-1 rounded-r-lg border border-l-0 border-border bg-card text-personal shadow-sm"
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
          <span className="min-h-0 overflow-hidden whitespace-nowrap text-[11px] font-semibold [writing-mode:vertical-rl] rotate-180">
            {handleLabel(hidden, columns[hiddenIndex + 1], tree)}
          </span>
        </button>
      ) : null}

      <Sheet open={isPullOpen && hidden !== undefined} onOpenChange={setIsPullOpen}>
        <SheetContent
          side="left"
          data-column-pull=""
          {...swipeHandlers((dx) => dx < 0 && setIsPullOpen(false))}
          className="flex w-[82%] max-w-none flex-col gap-0 bg-background p-0 pt-[env(safe-area-inset-top)] sm:max-w-none [&>button.absolute]:hidden"
        >
          <SheetTitle className="sr-only">{hidden === undefined ? "" : handleLabel(hidden, columns[hiddenIndex + 1], tree)}</SheetTitle>
          <SheetDescription className="sr-only">Chọn một dòng khác; cột đang xem đổi theo.</SheetDescription>
          {hidden !== undefined ? (
            <>
              <div className="flex min-h-[56px] items-center border-b border-border/60 px-4">
                <div className="min-w-0">
                  <p className="text-[12px] text-muted-foreground">Chọn {hidden.kind === "board" ? "hạng mục" : "dòng"} khác</p>
                  <p className="truncate text-[18px] font-semibold tracking-tight text-foreground">{hidden.kind === "task" ? "Việc" : hidden.node.title}</p>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {renderBody(hidden, hiddenIndex, (address) => {
                  setIsPullOpen(false);
                  onGo(address, "replace");
                }, true)}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
});

function OnlyOpenSwitch({ onlyOpen, onToggle }: { onlyOpen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={onlyOpen}
      onClick={onToggle}
      data-only-open=""
      className={cn("press inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-[12.5px]", onlyOpen ? "text-personal" : "text-muted-foreground")}
    >
      Chỉ việc chưa xong
      <span aria-hidden="true" className={cn("h-3.5 w-3.5 rounded-full border", onlyOpen ? "border-personal bg-personal" : "border-muted-foreground/60")} />
    </button>
  );
}
