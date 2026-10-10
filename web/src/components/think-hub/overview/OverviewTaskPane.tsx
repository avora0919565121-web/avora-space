import { X } from "lucide-react";
import { memo } from "react";

import { TaskRows } from "@/components/think-hub/overview/TaskRows";
import { TaskCard } from "@/components/tasks/TaskCard";
import type { TreeNode } from "@/lib/project-tree";
import type { TaskItem } from "@/lib/tasks";

/**
 * Toàn cảnh · cột phải (AVORA-104 · PHẦN 4 · 4.2): the tasks of the Hạng mục picked in the tree or
 * from the `Việc` cell; a task opens as the card in this same column, `‹` back to the list. The
 * board in the middle never changes.
 */
export const OverviewTaskPane = memo(function OverviewTaskPane({
  node,
  tasks,
  task,
  taskMissing,
  canEdit,
  onOpenTask,
  onCloseTask,
  onClose,
  onAdd,
  onLink,
}: {
  node: TreeNode | null;
  tasks: readonly TaskItem[];
  task: TaskItem | null;
  taskMissing: boolean;
  canEdit: boolean;
  onOpenTask: (task: TaskItem) => void;
  onCloseTask: () => void;
  onClose: () => void;
  onAdd: () => void;
  onLink: () => void;
}) {
  if (node === null) {
    return (
      <div data-overview-pane="empty" className="px-5 py-8 text-[13.5px] text-muted-foreground">
        Chạm một Hạng mục trong Cây hoặc ô <span className="font-semibold text-foreground">Việc</span> của một dòng để xem việc ở đây.
      </div>
    );
  }
  if (task !== null) {
    return (
      <div data-overview-pane="task" className="h-full min-h-0">
        <TaskCard task={task} open embedded backLabel={node.title} onOpenChange={(open) => !open && onCloseTask()} />
      </div>
    );
  }
  return (
    <div data-overview-pane="list" className="flex min-h-0 flex-col">
      <div className="flex min-h-[52px] items-center gap-2 border-b border-border/60 pl-5 pr-2">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {node.title} · {tasks.length} việc
        </h3>
        <button type="button" onClick={onClose} aria-label="Đóng danh sách việc" className="press flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {taskMissing ? <p className="px-5 pt-3 text-[13px] text-muted-foreground">Việc đã mở không còn ở đây.</p> : null}
      <TaskRows
        tasks={tasks}
        onOpen={onOpenTask}
        onAdd={node.kind === "record" && canEdit ? onAdd : undefined}
        onLink={node.kind === "record" && canEdit ? onLink : undefined}
      />
    </div>
  );
});
