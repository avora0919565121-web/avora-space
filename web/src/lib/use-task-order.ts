import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_VIEW_ORDER,
  SHARED_ORDER_STORAGE_KEY,
  VIEW_ORDER_STORAGE_KEY,
  normalizeViewOrder,
  readStoredJson,
  reorderIds,
  writeStoredJson,
} from "@/lib/task-order";
import type { TaskViewMode } from "@/lib/tasks";

/**
 * The order of the three view tabs, remembered between visits.
 *
 * Reading happens after the first paint on purpose: the stored value belongs to the browser,
 * not to the render, and touching it during render would make the first frame depend on
 * something the server could never produce.
 */
export function useViewOrder(): {
  order: readonly TaskViewMode[];
  isReady: boolean;
  reorder: (movedId: TaskViewMode, targetId: TaskViewMode) => void;
} {
  const [order, setOrder] = useState<readonly TaskViewMode[]>(DEFAULT_VIEW_ORDER);
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    setOrder(normalizeViewOrder(readStoredJson(VIEW_ORDER_STORAGE_KEY)));
    setIsReady(true);
  }, []);

  const reorder = useCallback((movedId: TaskViewMode, targetId: TaskViewMode): void => {
    setOrder((current) => {
      const next = normalizeViewOrder(reorderIds(current, current, movedId, targetId));
      writeStoredJson(VIEW_ORDER_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { order, isReady, reorder };
}

/**
 * A private display order for shared tasks. It changes where a row sits on this person's
 * screen and nothing else — the task itself, and what the other side sees, are untouched.
 */
export function useSharedTaskOrder(): {
  order: readonly string[];
  reorder: (visibleIds: readonly string[], movedId: string, targetId: string) => void;
} {
  const [order, setOrder] = useState<readonly string[]>([]);

  useEffect(() => {
    const stored = readStoredJson(SHARED_ORDER_STORAGE_KEY);
    if (!Array.isArray(stored)) return;
    setOrder(stored.filter((entry): entry is string => typeof entry === "string"));
  }, []);

  const reorder = useCallback(
    (visibleIds: readonly string[], movedId: string, targetId: string): void => {
      setOrder((current) => {
        const next = reorderIds(visibleIds, current, movedId, targetId);
        writeStoredJson(SHARED_ORDER_STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  return { order, reorder };
}
