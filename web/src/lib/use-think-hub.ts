import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/lib/auth";
import {
  addThinkColumn,
  thinkHubKeys,
  createThinkRecord,
  createThinkSubTable,
  createThinkTable,
  deleteThinkRecord,
  deleteThinkTable,
  ensureDefaultTable,
  fetchThinkRecords,
  fetchThinkTables,
  recordsOf,
  fetchRecordTaskLinks,
  renameThinkColumn,
  renameThinkTable,
  setThinkColumnHidden,
  setThinkColumnWidth,
  restoreThinkRecord,
  restoreThinkTable,
  rootTables,
  setThinkTablePurpose,
  updateThinkRecord,
  visibleTables,
  type ThinkRecord,
  type ThinkTable,
  type ColumnType,
  type NewRecordInput,
  type RecordPatch,
  type RecordTaskLink,
} from "@/lib/think-hub";

/**
 * Every table the viewer can read, in one query.
 *
 * Read whole rather than one at a time, like the address book and the opportunity list: the
 * tab strip needs all of them on every screen of the HUB, and a query per table would turn
 * switching tabs into a request per tab.
 */
export function useThinkTables(): UseQueryResult<ThinkTable[], Error> {
  const { user } = useAuth();

  return useQuery<ThinkTable[], Error>({
    queryKey: thinkHubKeys.tables,
    queryFn: fetchThinkTables,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/**
 * Every record the viewer can read, across every table.
 *
 * One query for the whole HUB rather than one per table: the overview counts what is due
 * across all tables at once, and the ceiling warning needs the count of a table before
 * anybody opens it.
 */
export function useThinkRecords(): UseQueryResult<ThinkRecord[], Error> {
  const { user } = useAuth();

  return useQuery<ThinkRecord[], Error>({
    queryKey: thinkHubKeys.records,
    queryFn: fetchThinkRecords,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** Task ↔ Hạng mục links for tables outside a project (project tables use project_tasks). */
export function useRecordTaskLinks(): UseQueryResult<RecordTaskLink[], Error> {
  const { user } = useAuth();
  return useQuery<RecordTaskLink[], Error>({
    queryKey: thinkHubKeys.recordTasks,
    queryFn: fetchRecordTaskLinks,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
}

/**
 * The HUB as a screen needs it: the tables to show, and the default one made if there are none.
 *
 * The default table is created by the server, which is also where "are there none" is decided —
 * two tabs opening the HUB at the same moment both see an empty list, and only the lock inside
 * `ensure_default_think_hub_table` stops that from leaving two empty tables behind.
 */
export function useThinkHub(): {
  tables: ThinkTable[];
  records: ThinkRecord[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const tablesQuery = useThinkTables();
  const recordsQuery = useThinkRecords();
  const queryClient = useQueryClient();

  const { user } = useAuth();
  const tables = useMemo(() => visibleTables(tablesQuery.data ?? []), [tablesQuery.data]);
  // Only a personal root table counts: a group's or a project's tables are not the viewer's own,
  // and somebody with only shared tables still needs a place of their own to start.
  const hasPersonalRoot = useMemo(
    () =>
      rootTables(tables).some(
        (table) =>
          table.projectId === null && table.conversationId === null && table.ownerUserId === user?.id,
      ),
    [tables, user?.id],
  );

  const ensureMutation = useMutation({
    mutationFn: ensureDefaultTable,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.tables });
    },
  });

  // Asked for at most once per mount, whatever React does with renders. Without the ref, a
  // failed call (offline, expired session) would be retried on every re-render — a request
  // loop against a server that is already saying no.
  const askedRef = useRef<boolean>(false);
  const { mutate: ensure } = ensureMutation;

  useEffect(() => {
    // Only once the list has actually come back empty. Firing while it is still loading
    // would create a second table for somebody who already has one.
    if (!tablesQuery.isSuccess || hasPersonalRoot) return;
    if (askedRef.current) return;
    askedRef.current = true;
    ensure();
  }, [tablesQuery.isSuccess, hasPersonalRoot, ensure]);

  return {
    tables,
    records: recordsQuery.data ?? [],
    isPending: tablesQuery.isPending || recordsQuery.isPending || ensureMutation.isPending,
    isError: tablesQuery.isError || recordsQuery.isError,
    error: tablesQuery.error ?? recordsQuery.error,
  };
}

/** The live records of one table, newest first. */
export function useTableRecords(tableId: string | undefined): ThinkRecord[] {
  const query = useThinkRecords();
  return useMemo(
    () => (tableId === undefined ? [] : recordsOf(query.data ?? [], tableId)),
    [query.data, tableId],
  );
}

/**
 * Creating, renaming and putting away tables, columns and records.
 *
 * Every one of them invalidates the whole HUB: adding a column changes what a record's row
 * shows, and adding a record changes what the overview counts, so keeping two caches in step
 * by hand would be a bug waiting for the first screen somebody forgot.
 */
export function useThinkHubActions(): {
  createTable: (input: {
    name: string;
    purpose?: string | null;
    conversationId?: string | null;
  }) => Promise<ThinkTable>;
  createSubTable: (input: { recordId: string; name?: string; purpose?: string }) => Promise<ThinkTable>;
  setPurpose: (tableId: string, purpose: string) => Promise<ThinkTable>;
  renameColumn: (input: { tableId: string; columnId: string; label: string }) => Promise<ThinkTable>;
  setColumnWidth: (input: { tableId: string; columnId: string; width: number | null }) => Promise<ThinkTable>;
  setColumnHidden: (input: { tableId: string; columnId: string; hidden: boolean }) => Promise<ThinkTable>;
  renameTable: (tableId: string, name: string) => Promise<ThinkTable>;
  removeTable: (tableId: string) => Promise<ThinkTable>;
  restoreTable: (tableId: string) => Promise<ThinkTable>;
  addColumn: (input: {
    tableId: string;
    label: string;
    type: ColumnType;
    options?: readonly string[];
  }) => Promise<ThinkTable>;
  createRecord: (input: NewRecordInput) => Promise<ThinkRecord>;
  updateRecord: (recordId: string, patch: RecordPatch) => Promise<ThinkRecord>;
  removeRecord: (recordId: string) => Promise<ThinkRecord>;
  restoreRecord: (recordId: string) => Promise<ThinkRecord>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
  }, [queryClient]);

  const createTableMutation = useMutation({
    mutationFn: (input: { name: string; purpose?: string | null; conversationId?: string | null }) =>
      createThinkTable(input),
    onSuccess: invalidate,
  });

  const createSubTableMutation = useMutation({
    mutationFn: (input: { recordId: string; name?: string; purpose?: string }) => createThinkSubTable(input),
    onSuccess: invalidate,
  });

  const purposeMutation = useMutation({
    mutationFn: ({ tableId, purpose }: { tableId: string; purpose: string }) =>
      setThinkTablePurpose(tableId, purpose),
    onSuccess: invalidate,
  });

  const widthMutation = useMutation({
    mutationFn: (input: { tableId: string; columnId: string; width: number | null }) => setThinkColumnWidth(input),
    onSuccess: invalidate,
  });

  const hiddenMutation = useMutation({
    mutationFn: (input: { tableId: string; columnId: string; hidden: boolean }) => setThinkColumnHidden(input),
    onSuccess: invalidate,
  });

  const renameColumnMutation = useMutation({
    mutationFn: (input: { tableId: string; columnId: string; label: string }) => renameThinkColumn(input),
    onSuccess: invalidate,
  });

  const renameTableMutation = useMutation({
    mutationFn: ({ tableId, name }: { tableId: string; name: string }) =>
      renameThinkTable(tableId, name),
    onSuccess: invalidate,
  });

  const removeTableMutation = useMutation({
    mutationFn: (tableId: string) => deleteThinkTable(tableId),
    onSuccess: invalidate,
  });

  const restoreTableMutation = useMutation({
    mutationFn: (tableId: string) => restoreThinkTable(tableId),
    onSuccess: invalidate,
  });

  const addColumnMutation = useMutation({
    mutationFn: (input: {
      tableId: string;
      label: string;
      type: ColumnType;
      options?: readonly string[];
    }) => addThinkColumn(input),
    onSuccess: invalidate,
  });

  const createRecordMutation = useMutation({
    mutationFn: (input: NewRecordInput) => createThinkRecord(input),
    onSuccess: invalidate,
  });

  const updateRecordMutation = useMutation({
    mutationFn: ({ recordId, patch }: { recordId: string; patch: RecordPatch }) =>
      updateThinkRecord(recordId, patch),
    onSuccess: invalidate,
  });

  const removeRecordMutation = useMutation({
    mutationFn: (recordId: string) => deleteThinkRecord(recordId),
    onSuccess: invalidate,
  });

  const restoreRecordMutation = useMutation({
    mutationFn: (recordId: string) => restoreThinkRecord(recordId),
    onSuccess: invalidate,
  });

  return {
    createTable: useCallback(
      (input: { name: string; purpose?: string | null; conversationId?: string | null }) =>
        createTableMutation.mutateAsync(input),
      [createTableMutation],
    ),
    createSubTable: useCallback(
      (input: { recordId: string; name?: string; purpose?: string }) =>
        createSubTableMutation.mutateAsync(input),
      [createSubTableMutation],
    ),
    setPurpose: useCallback(
      (tableId: string, purpose: string) => purposeMutation.mutateAsync({ tableId, purpose }),
      [purposeMutation],
    ),
    setColumnWidth: useCallback(
      (input: { tableId: string; columnId: string; width: number | null }) => widthMutation.mutateAsync(input),
      [widthMutation],
    ),
    setColumnHidden: useCallback(
      (input: { tableId: string; columnId: string; hidden: boolean }) => hiddenMutation.mutateAsync(input),
      [hiddenMutation],
    ),
    renameColumn: useCallback(
      (input: { tableId: string; columnId: string; label: string }) => renameColumnMutation.mutateAsync(input),
      [renameColumnMutation],
    ),
    renameTable: useCallback(
      (tableId: string, name: string) => renameTableMutation.mutateAsync({ tableId, name }),
      [renameTableMutation],
    ),
    removeTable: useCallback(
      (tableId: string) => removeTableMutation.mutateAsync(tableId),
      [removeTableMutation],
    ),
    restoreTable: useCallback(
      (tableId: string) => restoreTableMutation.mutateAsync(tableId),
      [restoreTableMutation],
    ),
    addColumn: useCallback(
      (input: { tableId: string; label: string; type: ColumnType; options?: readonly string[] }) =>
        addColumnMutation.mutateAsync(input),
      [addColumnMutation],
    ),
    createRecord: useCallback(
      (input: NewRecordInput) => createRecordMutation.mutateAsync(input),
      [createRecordMutation],
    ),
    updateRecord: useCallback(
      (recordId: string, patch: RecordPatch) =>
        updateRecordMutation.mutateAsync({ recordId, patch }),
      [updateRecordMutation],
    ),
    removeRecord: useCallback(
      (recordId: string) => removeRecordMutation.mutateAsync(recordId),
      [removeRecordMutation],
    ),
    restoreRecord: useCallback(
      (recordId: string) => restoreRecordMutation.mutateAsync(recordId),
      [restoreRecordMutation],
    ),
    isWorking:
      createTableMutation.isPending ||
      createSubTableMutation.isPending ||
      purposeMutation.isPending ||
      renameColumnMutation.isPending ||
      hiddenMutation.isPending ||
      renameTableMutation.isPending ||
      removeTableMutation.isPending ||
      restoreTableMutation.isPending ||
      addColumnMutation.isPending ||
      createRecordMutation.isPending ||
      updateRecordMutation.isPending ||
      removeRecordMutation.isPending ||
      restoreRecordMutation.isPending,
  };
}
