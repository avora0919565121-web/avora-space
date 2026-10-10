import { Check, ChevronDown, ChevronRight, FileText, ListChecks, Sparkles, Table2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { branchSlice, isTaskDone, nodeKey, pathTo, readOpenNodes, tallyLabel, writeOpenNodes, type Tree, type TreeNode } from "@/lib/project-tree";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/**
 * Toàn cảnh · Cây (AVORA-104 · PHẦN 4 · 4.2): Dự án › Bảng › Hạng mục › Bảng con › … › Việc, each
 * with `xong/tổng` summed up. Branches open/close (remembered on this device); a big tree shows 50
 * rows per branch first. Tasks under a Hạng mục come from the task cache when it is opened.
 */
export const OverviewTree = memo(function OverviewTree({
  tree,
  activeBoardId,
  selectedKey,
  selectedTaskId,
  onlyOpen,
  onToggleOnlyOpen,
  tasksOf,
  onOpenBoard,
  onOpenRecord,
  onOpenTask,
}: {
  tree: Tree;
  activeBoardId: string;
  selectedKey: string | null;
  selectedTaskId: string | null;
  onlyOpen: boolean;
  onToggleOnlyOpen: () => void;
  tasksOf: (key: string) => readonly TaskItem[];
  onOpenBoard: (boardId: string) => void;
  onOpenRecord: (node: TreeNode) => void;
  onOpenTask: (node: TreeNode, task: TaskItem) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => readOpenNodes());
  const [shown, setShown] = useState<Record<string, number>>({});

  // The way to what is open now is always unfolded.
  const wanted = useMemo(() => {
    const keys = new Set<string>();
    for (const node of pathTo(tree, activeBoardId)) keys.add(nodeKey(node));
    if (selectedKey !== null) for (const node of pathTo(tree, selectedKey)) keys.add(nodeKey(node));
    if (selectedKey !== null && selectedTaskId !== null) keys.add(selectedKey);
    return keys;
  }, [tree, activeBoardId, selectedKey, selectedTaskId]);
  useEffect(() => {
    setOpen((current) => {
      let changed = false;
      const next = new Set(current);
      for (const key of wanted) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      if (changed) writeOpenNodes(next);
      return changed ? next : current;
    });
  }, [wanted]);

  const toggle = useCallback((key: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeOpenNodes(next);
      return next;
    });
  }, []);

  const renderTasks = (node: TreeNode, level: number): ReactNode => {
    const tasks = tasksOf(nodeKey(node));
    if (tasks.length === 0) return null;
    return tasks.map((task) => {
      const isDone = isTaskDone(task);
      return (
        <li key={`t:${task.id}`}>
          <button
            type="button"
            data-tree-task={task.id}
            aria-current={selectedTaskId === task.id ? "true" : undefined}
            onClick={() => onOpenTask(node, task)}
            style={{ paddingLeft: 8 + level * 14 + 18 }}
            className={cn("press flex min-h-[34px] w-full items-center gap-2 rounded-md pr-2 text-left text-[13.5px] hover:bg-accent/40", selectedTaskId === task.id && "bg-personal/10")}
          >
            <span aria-hidden="true" className={cn("flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px]", isDone ? "border-personal bg-personal text-personal-foreground" : "border-muted-foreground/50")}>
              {isDone ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>
            <span className={cn("min-w-0 flex-1 truncate", isDone ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</span>
          </button>
        </li>
      );
    });
  };

  const renderNode = (node: TreeNode, level: number): ReactNode => {
    const key = nodeKey(node);
    const children = node.kind === "unlinked" ? [] : tree.childrenOf(node.id).filter((child) => child.kind !== "unlinked");
    const hasTasks = (node.kind === "record" && node.ownTotal > 0) || node.kind === "unlinked";
    const canOpen = children.length > 0 || hasTasks;
    const isOpen = open.has(key);
    const isSelected = node.kind === "record" || node.kind === "unlinked" ? selectedKey === key && selectedTaskId === null : (node.kind === "table" || node.kind === "project") && node.id === activeBoardId && selectedKey === null;
    const isBoard = node.kind === "table" || node.kind === "project";
    const Icon = node.kind === "project" ? Sparkles : node.kind === "table" ? Table2 : node.kind === "unlinked" ? ListChecks : FileText;
    const { rows, more } = branchSlice(children, tree, shown[key]);
    return (
      <li key={key} data-tree-node={key} data-tree-kind={node.kind}>
        <div
          className={cn("group flex min-h-[34px] items-center rounded-md pr-2 transition-colors hover:bg-accent/40", isSelected && "bg-personal/10 hover:bg-personal/15")}
          style={{ paddingLeft: 4 + level * 14 }}
        >
          {canOpen ? (
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Thu" : "Mở"} ${node.title}`}
              className="press flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => (isBoard ? onOpenBoard(node.id) : onOpenRecord(node))}
            aria-current={isSelected ? "true" : undefined}
            className="press flex min-h-[34px] min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            <span className={cn("min-w-0 flex-1 truncate text-[13.5px] text-foreground", (isBoard || node.kind === "unlinked") && "font-semibold")}>
              {node.kind === "table" && node.depth > 0 ? <span className="font-normal text-muted-foreground">Bảng con · </span> : null}
              {node.title}
            </span>
            <span className="tabular shrink-0 text-[12px] text-muted-foreground" data-tree-tally="">
              {tallyLabel(node, onlyOpen)}
            </span>
          </button>
        </div>
        {canOpen && isOpen ? (
          <ul>
            {node.kind === "record" || node.kind === "unlinked" ? renderTasks(node, level + 1) : null}
            {rows.map((child) => renderNode(child, level + 1))}
            {more > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setShown((current) => ({ ...current, [key]: (current[key] ?? 50) + 50 }))}
                  style={{ paddingLeft: 8 + (level + 1) * 14 + 18 }}
                  className="press min-h-[34px] text-[12.5px] font-medium text-personal"
                >
                  Xem thêm {more.toLocaleString("vi-VN")}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const root = tree.root;
  const unlinked = root === null ? undefined : tree.childrenOf(root.id).find((child) => child.kind === "unlinked");
  return (
    <nav aria-label="Toàn cảnh" data-overview-tree="" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Toàn cảnh</span>
        <button
          type="button"
          role="switch"
          aria-checked={onlyOpen}
          onClick={onToggleOnlyOpen}
          data-only-open=""
          className={cn("press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium", onlyOpen ? "bg-personal/15 text-personal" : "text-muted-foreground hover:text-foreground")}
        >
          Chỉ việc chưa xong
          <span aria-hidden="true" className={cn("h-3 w-3 rounded-full border", onlyOpen ? "border-personal bg-personal" : "border-muted-foreground/60")} />
        </button>
      </div>
      {root === null ? (
        <p className="px-2 text-[13px] text-muted-foreground">Không có gì để hiện.</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto">
          {renderNode(root, 0)}
          {unlinked !== undefined ? renderNode(unlinked, 1) : null}
        </ul>
      )}
    </nav>
  );
});
