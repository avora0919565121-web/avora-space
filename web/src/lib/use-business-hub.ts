import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/lib/auth";
import {
  addBusinessColumn,
  businessHubKeys,
  createBusinessRecord,
  createBusinessTable,
  deleteBusinessRecord,
  deleteBusinessTable,
  ensureDefaultTable,
  fetchBusinessRecords,
  fetchBusinessTables,
  recordsOf,
  renameBusinessTable,
  restoreBusinessRecord,
  restoreBusinessTable,
  updateBusinessRecord,
  visibleTables,
  type BusinessRecord,
  type BusinessTable,
  type ColumnType,
  type NewRecordInput,
  type RecordPatch,
} from "@/lib/business-hub";

/**
 * Every table the viewer owns, in one query.
 *
 * Read whole rather than one at a time, like the address book and the opportunity list: the
 * tab strip needs all of them on every screen of the HUB, and a query per table would turn
 * switching tabs into a request per tab.
 */
export function useBusinessTables(): UseQueryResult<BusinessTable[], Error> {
  const { user } = useAuth();

  return useQuery<BusinessTable[], Error>({
    queryKey: businessHubKeys.tables,
    queryFn: fetchBusinessTables,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/**
 * Every record the viewer owns, across every table.
 *
 * One query for the whole HUB rather than one per table: the overview counts what is due
 * across all tables at once, and the ceiling warning needs the count of a table before
 * anybody opens it.
 */
export function useBusinessRecords(): UseQueryResult<BusinessRecord[], Error> {
  const { user } = useAuth();

  return useQuery<BusinessRecord[], Error>({
    queryKey: businessHubKeys.records,
    queryFn: fetchBusinessRecords,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/**
 * The HUB as a screen needs it: the tables to show, and the default one made if there are none.
 *
 * The default table is created by the server, which is also where "are there none" is decided —
 * two tabs opening the HUB at the same moment both see an empty list, and only the lock inside
 * `ensure_default_business_hub_table` stops that from leaving two empty tables behind.
 */
export function useBusinessHub(): {
  tables: BusinessTable[];
  records: BusinessRecord[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const tablesQuery = useBusinessTables();
  const recordsQuery = useBusinessRecords();
  const queryClient = useQueryClient();

  const tables = useMemo(() => visibleTables(tablesQuery.data ?? []), [tablesQuery.data]);

  const ensureMutation = useMutation({
    mutationFn: ensureDefaultTable,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: businessHubKeys.tables });
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
    if (!tablesQuery.isSuccess || tables.length > 0) return;
    if (askedRef.current) return;
    askedRef.current = true;
    ensure();
  }, [tablesQuery.isSuccess, tables.length, ensure]);

  return {
    tables,
    records: recordsQuery.data ?? [],
    isPending: tablesQuery.isPending || recordsQuery.isPending || ensureMutation.isPending,
    isError: tablesQuery.isError || recordsQuery.isError,
    error: tablesQuery.error ?? recordsQuery.error,
  };
}

/** The live records of one table, newest first. */
export function useTableRecords(tableId: string | undefined): BusinessRecord[] {
  const query = useBusinessRecords();
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
export function useBusinessHubActions(): {
  createTable: (name: string) => Promise<BusinessTable>;
  renameTable: (tableId: string, name: string) => Promise<BusinessTable>;
  removeTable: (tableId: string) => Promise<BusinessTable>;
  restoreTable: (tableId: string) => Promise<BusinessTable>;
  addColumn: (input: {
    tableId: string;
    label: string;
    type: ColumnType;
    options?: readonly string[];
  }) => Promise<BusinessTable>;
  createRecord: (input: NewRecordInput) => Promise<BusinessRecord>;
  updateRecord: (recordId: string, patch: RecordPatch) => Promise<BusinessRecord>;
  removeRecord: (recordId: string) => Promise<BusinessRecord>;
  restoreRecord: (recordId: string) => Promise<BusinessRecord>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: businessHubKeys.all });
  }, [queryClient]);

  const createTableMutation = useMutation({
    mutationFn: (name: string) => createBusinessTable(name),
    onSuccess: invalidate,
  });

  const renameTableMutation = useMutation({
    mutationFn: ({ tableId, name }: { tableId: string; name: string }) =>
      renameBusinessTable(tableId, name),
    onSuccess: invalidate,
  });

  const removeTableMutation = useMutation({
    mutationFn: (tableId: string) => deleteBusinessTable(tableId),
    onSuccess: invalidate,
  });

  const restoreTableMutation = useMutation({
    mutationFn: (tableId: string) => restoreBusinessTable(tableId),
    onSuccess: invalidate,
  });

  const addColumnMutation = useMutation({
    mutationFn: (input: {
      tableId: string;
      label: string;
      type: ColumnType;
      options?: readonly string[];
    }) => addBusinessColumn(input),
    onSuccess: invalidate,
  });

  const createRecordMutation = useMutation({
    mutationFn: (input: NewRecordInput) => createBusinessRecord(input),
    onSuccess: invalidate,
  });

  const updateRecordMutation = useMutation({
    mutationFn: ({ recordId, patch }: { recordId: string; patch: RecordPatch }) =>
      updateBusinessRecord(recordId, patch),
    onSuccess: invalidate,
  });

  const removeRecordMutation = useMutation({
    mutationFn: (recordId: string) => deleteBusinessRecord(recordId),
    onSuccess: invalidate,
  });

  const restoreRecordMutation = useMutation({
    mutationFn: (recordId: string) => restoreBusinessRecord(recordId),
    onSuccess: invalidate,
  });

  return {
    createTable: useCallback(
      (name: string) => createTableMutation.mutateAsync(name),
      [createTableMutation],
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
