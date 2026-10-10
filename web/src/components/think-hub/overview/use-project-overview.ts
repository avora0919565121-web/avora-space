import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { OverviewAddress } from "@/components/think-hub/overview/OverviewColumns";
import type { TaskTally } from "@/components/think-hub/TableView";
import { useMediaQuery } from "@/hooks/use-media-query";
import { isPreviousEntry } from "@/lib/nav-history";
import {
  UNLINKED_KEY,
  columnsFor,
  readOnlyOpen,
  readOverviewMode,
  readTaskColumnHidden,
  taskListOf,
  treeKeys,
  useThinkHubTree,
  writeOnlyOpen,
  writeOverviewMode,
  writeTaskColumnHidden,
  type OverviewColumn,
  type OverviewMode,
  type Tree,
  type TreeNode,
} from "@/lib/project-tree";
import type { ProjectTaskLink } from "@/lib/projects";
import { carryReturn } from "@/lib/return-to";
import { ROOM_PARAM } from "@/lib/room";
import { tableAncestry, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import type { TaskItem } from "@/lib/tasks";

/** `?muc=` — the Hạng mục whose tasks Toàn cảnh shows (`hm` already opens the Hạng mục itself). */
export const OVERVIEW_RECORD_PARAM = "muc";
/** `?viec=` — the task open in Toàn cảnh's last column. */
export const OVERVIEW_TASK_PARAM = "viec";

export type ProjectOverview = {
  /** `Toàn cảnh` is chosen for this board and there is a tree to show. */
  isOn: boolean;
  mode: OverviewMode;
  setMode: (mode: OverviewMode) => void;
  isWide: boolean;
  isTwoUp: boolean;
  tree: Tree | null;
  columns: OverviewColumn[];
  recordKey: string | null;
  taskId: string | null;
  selectedNode: TreeNode | null;
  onlyOpen: boolean;
  toggleOnlyOpen: () => void;
  tasksOf: (key: string) => readonly TaskItem[];
  taskById: (id: string) => TaskItem | undefined;
  go: (address: OverviewAddress, how: "push" | "replace") => void;
  back: (address: OverviewAddress | null) => void;
  taskTally: TaskTally | undefined;
  isTaskColumnHidden: boolean;
  showTaskColumn: () => void;
};

/**
 * Toàn cảnh dự án (AVORA-104 · PHẦN 4): everything the Kế hoạch page needs — the choice per board,
 * the tree, the phone columns from `?bang=&muc=&viec=`, task lists from the cache, and the moves
 * (deeper = push, swapping a row from the pull-out = replace, `‹` = one step back).
 */
export function useProjectOverview({
  active,
  tables,
  records,
  tasks,
  tasksByRecord,
  projectTaskLinks,
  recordLinkedTaskIds,
  isEnabled,
  setActiveId,
}: {
  active: ThinkTable | null;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  tasks: readonly TaskItem[];
  tasksByRecord: ReadonlyMap<string, readonly TaskItem[]>;
  projectTaskLinks: ReadonlyMap<string, ProjectTaskLink>;
  recordLinkedTaskIds: ReadonlySet<string>;
  isEnabled: boolean;
  setActiveId: (id: string) => void;
}): ProjectOverview {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isWide = useMediaQuery("(min-width: 1024px)");
  const isTwoUp = useMediaQuery("(min-width: 600px) and (max-width: 1023px) and (orientation: landscape)");

  const rootTable: ThinkTable | null = useMemo(() => {
    if (active === null) return null;
    return tableAncestry(tables, records, active.id)[0]?.table ?? active;
  }, [active, tables, records]);
  const hasSubBoards = useMemo(() => {
    if (active === null) return false;
    const mine = new Set(records.filter((record) => record.tableId === active.id).map((record) => record.id));
    return tables.some((table) => table.deletedAt === null && table.parentRecordId !== null && mine.has(table.parentRecordId));
  }, [active, tables, records]);

  const [modeVersion, setModeVersion] = useState<number>(0);
  const mode: OverviewMode = useMemo(
    () => (active === null ? "board" : readOverviewMode(active.id, active.projectId !== null || active.parentRecordId !== null || hasSubBoards)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modeVersion re-reads the stored choice
    [active, hasSubBoards, modeVersion],
  );
  const setMode = useCallback(
    (next: OverviewMode): void => {
      if (active === null) return;
      writeOverviewMode(active.id, next);
      setModeVersion((value) => value + 1);
    },
    [active],
  );

  const wantsTree = isEnabled && active !== null && mode === "overview" && active.kind !== "bookshelf";
  const treeQuery = useThinkHubTree(wantsTree ? (rootTable?.id ?? null) : null);
  const tree: Tree | null = treeQuery.data !== undefined && treeQuery.data.root !== null ? treeQuery.data : null;
  const isOn = wantsTree && tree !== null;

  // Tasks made / ticked / linked elsewhere: the counts follow with the next read (no new realtime).
  const freshness = `${tasks.length}:${tasks.filter((task) => task.status === "done").length}:${recordLinkedTaskIds.size}:${projectTaskLinks.size}:${records.length}`;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: treeKeys.all });
  }, [freshness, queryClient]);

  const [onlyOpen, setOnlyOpen] = useState<boolean>(() => readOnlyOpen());
  const toggleOnlyOpen = useCallback((): void => {
    setOnlyOpen((value) => {
      writeOnlyOpen(!value);
      return !value;
    });
  }, []);

  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task] as const)), [tasks]);
  const unlinked: TaskItem[] = useMemo(() => {
    if (rootTable === null) return [];
    const linkedToRecord = (taskId: string): boolean => recordLinkedTaskIds.has(taskId) || (projectTaskLinks.get(taskId)?.recordId ?? null) !== null;
    if (rootTable.projectId !== null) {
      const out: TaskItem[] = [];
      for (const link of projectTaskLinks.values()) {
        if (link.projectId !== rootTable.projectId || linkedToRecord(link.taskId)) continue;
        const task = taskMap.get(link.taskId);
        if (task !== undefined) out.push(task);
      }
      return out;
    }
    if (rootTable.conversationId === null) return [];
    return tasks.filter((task) => task.type !== "personal" && task.conversationId === rootTable.conversationId && !linkedToRecord(task.id));
  }, [rootTable, projectTaskLinks, recordLinkedTaskIds, taskMap, tasks]);

  const tasksOf = useCallback(
    (key: string): readonly TaskItem[] => taskListOf(key === UNLINKED_KEY ? unlinked : (tasksByRecord.get(key) ?? []), onlyOpen),
    [unlinked, tasksByRecord, onlyOpen],
  );
  const taskById = useCallback((id: string): TaskItem | undefined => taskMap.get(id), [taskMap]);

  const recordKey = searchParams.get(OVERVIEW_RECORD_PARAM);
  const taskId = searchParams.get(OVERVIEW_TASK_PARAM);
  const columns: OverviewColumn[] = useMemo(
    () => (tree === null || active === null ? [] : columnsFor(tree, active.id, recordKey, taskId)),
    [tree, active, recordKey, taskId],
  );
  const selectedNode: TreeNode | null = tree === null || recordKey === null ? null : (tree.byId.get(recordKey) ?? null);

  const paramsFor = useCallback(
    (address: OverviewAddress): URLSearchParams => {
      const next = carryReturn(searchParams, new URLSearchParams());
      const room = searchParams.get(ROOM_PARAM);
      if (room !== null) next.set(ROOM_PARAM, room);
      next.set("bang", address.board);
      if (address.record !== null) next.set(OVERVIEW_RECORD_PARAM, address.record);
      if (address.task !== null) next.set(OVERVIEW_TASK_PARAM, address.task);
      return next;
    },
    [searchParams],
  );
  const go = useCallback(
    (address: OverviewAddress, how: "push" | "replace"): void => {
      if (address.board === "") return;
      if (address.board !== active?.id) setActiveId(address.board);
      setSearchParams(paramsFor(address), { replace: how === "replace" });
    },
    [active, paramsFor, setActiveId, setSearchParams],
  );
  const back = useCallback(
    (address: OverviewAddress | null): void => {
      if (address === null) return;
      const query = paramsFor(address).toString();
      if (isPreviousEntry(`${location.pathname}?${query}`)) {
        navigate(-1);
        return;
      }
      go(address, "replace");
    },
    [paramsFor, location.pathname, navigate, go],
  );

  const [isTaskColumnHidden, setTaskColumnHidden] = useState<boolean>(() => readTaskColumnHidden());
  const showTaskColumn = useCallback((): void => {
    writeTaskColumnHidden(false);
    setTaskColumnHidden(false);
  }, []);
  const taskTally: TaskTally | undefined = useMemo(() => {
    if (!isOn || !isWide || isTaskColumnHidden || tree === null) return undefined;
    return {
      of: (recordId) => {
        const node = tree.byId.get(recordId);
        return node === undefined ? null : { done: node.done, total: node.total };
      },
      onOpen: (record) => go({ board: record.tableId, record: record.id, task: null }, "push"),
      selectedId: recordKey,
      onHide: () => {
        writeTaskColumnHidden(true);
        setTaskColumnHidden(true);
      },
    };
  }, [isOn, isWide, isTaskColumnHidden, tree, go, recordKey]);

  return {
    isOn,
    mode,
    setMode,
    isWide,
    isTwoUp,
    tree,
    columns,
    recordKey,
    taskId,
    selectedNode,
    onlyOpen,
    toggleOnlyOpen,
    tasksOf,
    taskById,
    go,
    back,
    taskTally,
    isTaskColumnHidden,
    showTaskColumn,
  };
}
