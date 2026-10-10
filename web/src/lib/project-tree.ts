import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { TaskItem } from "@/lib/tasks";

/**
 * Toàn cảnh dự án (AVORA-104 · PHẦN 4 · ADR-076). One read for the tree around a board — Dự án ›
 * Hạng mục › Bảng con › Hạng mục › … — with done/total tasks summed up every level. Task lists are
 * not part of it: they come from the task cache when a Hạng mục is opened.
 */
export type TreeNodeKind = "project" | "table" | "record" | "unlinked";

export type TreeNode = {
  kind: TreeNodeKind;
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  order: number;
  done: number;
  total: number;
  /** Tasks hung directly on this Hạng mục (not its sub-boards). */
  ownTotal: number;
};

export type Tree = {
  root: TreeNode | null;
  byId: ReadonlyMap<string, TreeNode>;
  childrenOf: (id: string) => readonly TreeNode[];
  /** Hạng mục count, for the "> 500 → 50 per branch" rule. */
  recordCount: number;
};

/** The `Việc chưa gắn Hạng mục` node shares the root's id; its key in maps and URLs is this. */
export const UNLINKED_KEY = "chua-gan";
/** More than this many Hạng mục in the tree → each branch shows {@link BRANCH_PAGE} rows first. */
export const BIG_TREE = 500;
export const BRANCH_PAGE = 50;

type TreeRow = {
  node_kind: string;
  node_id: string;
  parent_id: string | null;
  title: string;
  depth: number;
  sort_order: number;
  done: number;
  total: number;
  own_total: number;
};

function isKind(value: string): value is TreeNodeKind {
  return value === "project" || value === "table" || value === "record" || value === "unlinked";
}

/** Node key: the unlinked node's id is its root's, so it gets its own. */
export function nodeKey(node: Pick<TreeNode, "kind" | "id">): string {
  return node.kind === "unlinked" ? UNLINKED_KEY : node.id;
}

/** Reads the RPC rows into a walkable tree. Pure. */
export function buildTree(rows: readonly TreeRow[]): Tree {
  const byId = new Map<string, TreeNode>();
  const children = new Map<string, TreeNode[]>();
  let root: TreeNode | null = null;
  let recordCount = 0;
  for (const row of rows) {
    if (!isKind(row.node_kind)) continue;
    const node: TreeNode = {
      kind: row.node_kind,
      id: row.node_id,
      parentId: row.parent_id,
      title: row.title,
      depth: row.depth,
      order: row.sort_order,
      done: row.done,
      total: row.total,
      ownTotal: row.own_total,
    };
    byId.set(nodeKey(node), node);
    if (node.kind === "record") recordCount += 1;
    if (node.parentId === null) {
      if (node.kind !== "unlinked") root = node;
      continue;
    }
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "vi"));
  return { root, byId, childrenOf: (id) => children.get(id) ?? [], recordCount };
}

export const treeKeys = {
  all: ["think-hub-tree"] as const,
  of: (rootTableId: string) => ["think-hub-tree", rootTableId] as const,
};

export async function fetchThinkHubTree(rootTableId: string): Promise<Tree> {
  const { data, error } = await supabase.rpc("think_hub_tree" as never, { p_root_table_id: rootTableId } as never);
  if (error !== null) throw new Error("Không tải được Toàn cảnh. Thử lại sau.");
  return buildTree((data ?? []) as unknown as TreeRow[]);
}

/** The tree around a board (the server walks up to the project / the top board). */
export function useThinkHubTree(tableId: string | null): UseQueryResult<Tree, Error> {
  const { user } = useAuth();
  return useQuery<Tree, Error>({
    queryKey: treeKeys.of(tableId ?? "none"),
    queryFn: () => fetchThinkHubTree(tableId ?? ""),
    enabled: Boolean(user?.id) && tableId !== null,
    staleTime: 15_000,
  });
}

/** From the root down to this node (both included). */
export function pathTo(tree: Tree, key: string): TreeNode[] {
  const out: TreeNode[] = [];
  let current = tree.byId.get(key);
  for (let guard = 0; current !== undefined && guard < 40; guard += 1) {
    out.unshift(current);
    if (current.kind === "unlinked") {
      current = tree.root ?? undefined;
      continue;
    }
    current = current.parentId === null ? undefined : tree.byId.get(current.parentId);
  }
  return out;
}

/** `xong/tổng`, or only what is left when `Chỉ việc chưa xong` is on. */
export function tallyLabel(node: Pick<TreeNode, "done" | "total">, onlyOpen: boolean): string {
  return onlyOpen ? String(node.total - node.done) : `${node.done}/${node.total}`;
}

/** The children a branch shows now: everything, or the first page in a big tree. */
export function branchSlice<T>(list: readonly T[], tree: Pick<Tree, "recordCount">, shown: number | undefined): { rows: readonly T[]; more: number } {
  if (tree.recordCount <= BIG_TREE) return { rows: list, more: 0 };
  const limit = shown ?? BRANCH_PAGE;
  return { rows: list.slice(0, limit), more: Math.max(0, list.length - limit) };
}

export function isTaskDone(task: Pick<TaskItem, "status">): boolean {
  return task.status === "done" || task.status === "done_pending_review";
}

/** Tasks shown in a list: live ones, open first by date; done ones last (or hidden). */
export function taskListOf(tasks: readonly TaskItem[], onlyOpen: boolean): TaskItem[] {
  return tasks
    .filter((task) => task.status !== "skipped" && !task.deletedByCreator && !task.deletedByPeer)
    .filter((task) => !onlyOpen || !isTaskDone(task))
    .sort((left, right) => {
      const doneDiff = Number(isTaskDone(left)) - Number(isTaskDone(right));
      if (doneDiff !== 0) return doneDiff;
      return (left.deadline ?? "9999").localeCompare(right.deadline ?? "9999") || left.createdAt.localeCompare(right.createdAt);
    });
}

// ------------------------------------------------------------------ prefs (this device)

const MODE_KEY = "avora-overview-mode";
const OPEN_KEY = "avora-overview-open";
const ONLY_OPEN_KEY = "avora-overview-only-open";
const TASK_COLUMN_KEY = "avora-overview-task-column-hidden";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the choice lasts this visit only.
  }
}

export type OverviewMode = "overview" | "board";

/** `Toàn cảnh · Chỉ bảng`, remembered per board; default Toàn cảnh for a project board or one with sub-boards. */
export function readOverviewMode(tableId: string, isDefaultOverview: boolean): OverviewMode {
  const saved = readJson<Record<string, OverviewMode>>(MODE_KEY, {})[tableId];
  if (saved === "overview" || saved === "board") return saved;
  return isDefaultOverview ? "overview" : "board";
}
export function writeOverviewMode(tableId: string, mode: OverviewMode): void {
  const all = readJson<Record<string, OverviewMode>>(MODE_KEY, {});
  all[tableId] = mode;
  writeJson(MODE_KEY, all);
}

/** Tree branches I opened (this device). */
export function readOpenNodes(): Set<string> {
  const list = readJson<string[]>(OPEN_KEY, []);
  return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
}
export function writeOpenNodes(open: ReadonlySet<string>): void {
  writeJson(OPEN_KEY, [...open].slice(-400));
}

export function readOnlyOpen(): boolean {
  return readJson<boolean>(ONLY_OPEN_KEY, false) === true;
}
export function writeOnlyOpen(value: boolean): void {
  writeJson(ONLY_OPEN_KEY, value);
}

export function readTaskColumnHidden(): boolean {
  return readJson<boolean>(TASK_COLUMN_KEY, false) === true;
}
export function writeTaskColumnHidden(value: boolean): void {
  writeJson(TASK_COLUMN_KEY, value);
}

// ------------------------------------------------------------------ phone columns

/** One column on a phone: a board (its Hạng mục), a Hạng mục (sub-boards + tasks), the unlinked list, or one task. */
export type OverviewColumn =
  | { kind: "board"; node: TreeNode }
  | { kind: "record"; node: TreeNode }
  | { kind: "unlinked"; node: TreeNode }
  | { kind: "task"; taskId: string };

/**
 * The columns for `?bang=&hm=&viec=`: the path from the root to the open board (with the Hạng mục
 * between boards), then the open Hạng mục, then the open task. Pure.
 */
export function columnsFor(tree: Tree, boardId: string, recordKey: string | null, taskId: string | null): OverviewColumn[] {
  const columns: OverviewColumn[] = [];
  for (const node of pathTo(tree, boardId)) {
    if (node.kind === "record") columns.push({ kind: "record", node });
    else if (node.kind === "table" || node.kind === "project") columns.push({ kind: "board", node });
  }
  if (columns.length === 0 && tree.root !== null) columns.push({ kind: "board", node: tree.root });
  if (recordKey !== null) {
    const node = tree.byId.get(recordKey);
    if (node !== undefined && node.kind === "record") columns.push({ kind: "record", node });
    else if (node !== undefined && node.kind === "unlinked") columns.push({ kind: "unlinked", node });
  }
  if (taskId !== null && columns.length > 0 && columns[columns.length - 1].kind !== "board") columns.push({ kind: "task", taskId });
  return columns;
}

/** What a column is called (its `aria-label`, its title, the pull-out handle's words). */
export function columnTitle(column: OverviewColumn, taskTitle?: string): string {
  if (column.kind === "task") return taskTitle ?? "Việc";
  return column.node.title;
}

/** Where a column lives in the address: `?bang=&muc=&viec=`. */
export type OverviewAddress = { board: string; record: string | null; task: string | null };

/** The address that shows this column last. Pure. */
export function addressOf(columns: readonly OverviewColumn[], index: number, tree: Tree): OverviewAddress {
  const column = columns[index];
  if (column === undefined) return { board: tree.root?.id ?? "", record: null, task: null };
  if (column.kind === "board") return { board: column.node.id, record: null, task: null };
  if (column.kind === "record") return { board: column.node.parentId ?? tree.root?.id ?? "", record: column.node.id, task: null };
  if (column.kind === "unlinked") return { board: tree.root?.id ?? "", record: UNLINKED_KEY, task: null };
  return { ...addressOf(columns, index - 1, tree), task: column.taskId };
}

/** The pull-out handle's words: `Hoiana · 3 hạng mục`, `Việc · Đèn panel`. */
export function handleLabel(column: OverviewColumn, next: OverviewColumn | undefined, tree: Tree): string {
  if (column.kind === "task") return "Việc";
  if (column.kind === "board") {
    const count = tree.childrenOf(column.node.id).filter((child) => child.kind === "record").length;
    return `${column.node.title} · ${count} hạng mục`;
  }
  if (next?.kind === "task") return `Việc · ${column.node.title}`;
  return column.node.title;
}

