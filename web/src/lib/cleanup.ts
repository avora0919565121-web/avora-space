import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { recordFromRow, thinkHubKeys, type ThinkRecord } from "@/lib/think-hub";

/**
 * AVORA-100 · V·3 / V·4 (ADR-063) — dọn dẹp chỉ gợi ý. The server picks only boards I own and do not
 * share; nothing runs until the person ticks and taps. The one automatic thing is the 30-day bin.
 */
export type CleanupKind = "dusty_board" | "done_records" | "empty_board";
export type CleanupSuggestion = { kind: CleanupKind; tableId: string; tableName: string; itemCount: number; lastTouch: string };

export const cleanupKeys = {
  suggestions: (userId: string | undefined) => ["cleanup", "suggestions", userId ?? "none"] as const,
  archived: (tableId: string) => ["cleanup", "archived", tableId] as const,
  usage: (userId: string | undefined) => ["storage-usage", userId ?? "none"] as const,
};

function isKind(value: unknown): value is CleanupKind {
  return value === "dusty_board" || value === "done_records" || value === "empty_board";
}

export function useCleanupSuggestions(enabled: boolean = true): UseQueryResult<CleanupSuggestion[], Error> {
  const { user } = useAuth();
  return useQuery<CleanupSuggestion[], Error>({
    queryKey: cleanupKeys.suggestions(user?.id),
    enabled: enabled && Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("think_hub_cleanup_suggestions");
      if (error) throw new Error("Chưa tải được gợi ý dọn kệ.");
      return (data ?? []).flatMap((row) =>
        isKind(row.kind) ? [{ kind: row.kind, tableId: row.table_id, tableName: row.table_name, itemCount: Number(row.item_count ?? 0), lastTouch: row.last_touch }] : [],
      );
    },
  });
}

export type CleanupResult = { count: number; archivedTables: string[]; archivedRecords: string[]; trashedTables: string[] };

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Applies what was ticked; returns what it did so `Hoàn tác` can put each thing back. */
export function useCleanupApply() {
  const queryClient = useQueryClient();
  return useMutation<CleanupResult, Error, { kind: CleanupKind; tableId: string }[]>({
    mutationFn: async (items) => {
      const { data, error } = await supabase.rpc("think_hub_cleanup_apply", { p_items: items.map((item) => ({ kind: item.kind, table_id: item.tableId })) });
      if (error) throw new Error("Chưa dọn được. Thử lại sau.");
      const out = (data ?? {}) as Record<string, unknown>;
      return { count: Number(out.count ?? 0), archivedTables: ids(out.archived_tables), archivedRecords: ids(out.archived_records), trashedTables: ids(out.trashed_tables) };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["cleanup"] });
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
    },
  });
}

/** Undo of a cleanup: each step goes back through the same server rules a person would use. */
export async function undoCleanup(result: CleanupResult): Promise<void> {
  for (const tableId of result.archivedTables) {
    const { error } = await supabase.rpc("set_think_hub_table_archived", { p_table_id: tableId, p_archived: false });
    if (error) throw new Error("Chưa hoàn tác được.");
  }
  if (result.archivedRecords.length > 0) await setRecordsArchived(result.archivedRecords, false);
  for (const tableId of result.trashedTables) {
    const { error } = await supabase.rpc("restore_think_hub_table", { p_table_id: tableId });
    if (error) throw new Error("Chưa hoàn tác được.");
  }
}

export async function setRecordsArchived(recordIds: readonly string[], archived: boolean): Promise<number> {
  const { data, error } = await supabase.rpc("set_think_hub_records_archived", { p_record_ids: [...recordIds], p_archived: archived });
  if (error) throw new Error(archived ? "Chưa cất được." : "Chưa lấy ra được.");
  return Number(data ?? 0);
}

/** The put-away Hạng mục of one board (`Đã cất n mục · Xem`). */
export function useArchivedRecords(tableId: string | null): UseQueryResult<ThinkRecord[], Error> {
  return useQuery<ThinkRecord[], Error>({
    queryKey: cleanupKeys.archived(tableId ?? "none"),
    enabled: tableId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("think_hub_archived_records", { p_table_id: tableId as string });
      if (error) throw new Error("Chưa tải được mục đã cất.");
      return (data ?? []).map((row) => recordFromRow(row));
    },
  });
}

export function useSetRecordsArchived() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, { ids: readonly string[]; archived: boolean }>({
    mutationFn: ({ ids: recordIds, archived }) => setRecordsArchived(recordIds, archived),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["cleanup"] });
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.records });
    },
  });
}

/** Monday-based week of the year, `2026-W41`: the cleanup card shows at most once a week. */
export function isoWeek(date: Date = new Date()): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Days a thing still sits in a 30-day bin before it is gone for good (never below 0). */
export function daysLeft(deletedAt: string, now: Date = new Date(), keepDays: number = 30): number {
  const gone = new Date(deletedAt).getTime() + keepDays * 86_400_000;
  return Math.max(0, Math.ceil((gone - now.getTime()) / 86_400_000));
}

// ------------------------------------------------------------------ V·4 · Cài đặt › Dung lượng

export type StoragePlace = "chat" | "journal" | "boards" | "vault" | "other";
export type StorageFile = { place: StoragePlace; bucket: string; path: string; ref: string; fileName: string; size: number; createdAt: string };
export type StorageUsage = {
  totalBytes: number;
  byPlace: Partial<Record<StoragePlace, { bytes: number; files: number }>>;
  boards: number;
  records: number;
  largest: StorageFile[];
};

function isPlace(value: unknown): value is StoragePlace {
  return value === "chat" || value === "journal" || value === "boards" || value === "vault" || value === "other";
}

export function parseStorageUsage(raw: unknown): StorageUsage {
  const row = (raw ?? {}) as Record<string, unknown>;
  const byPlace: StorageUsage["byPlace"] = {};
  const places = (row.by_place ?? {}) as Record<string, { bytes?: unknown; files?: unknown }>;
  for (const [key, value] of Object.entries(places)) {
    if (isPlace(key)) byPlace[key] = { bytes: Number(value?.bytes ?? 0), files: Number(value?.files ?? 0) };
  }
  const largest = Array.isArray(row.largest) ? row.largest : [];
  return {
    totalBytes: Number(row.total_bytes ?? 0),
    byPlace,
    boards: Number(row.boards ?? 0),
    records: Number(row.records ?? 0),
    largest: largest.flatMap((item) => {
      const file = item as Record<string, unknown>;
      if (!isPlace(file.place) || typeof file.path !== "string" || typeof file.bucket !== "string") return [];
      return [{ place: file.place, bucket: file.bucket, path: file.path, ref: String(file.ref ?? ""), fileName: String(file.file_name ?? ""), size: Number(file.size ?? 0), createdAt: String(file.created_at ?? "") }];
    }),
  };
}

export function useStorageUsage(): UseQueryResult<StorageUsage, Error> {
  const { user } = useAuth();
  return useQuery<StorageUsage, Error>({
    queryKey: cleanupKeys.usage(user?.id),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_storage_usage");
      if (error) throw new Error("Chưa tải được dung lượng.");
      return parseStorageUsage(data);
    },
  });
}

/** KB / MB / GB, one decimal (V·4.4). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded.replace(".", ",")} ${units[unit]}`;
}

/** The data this device keeps for reading offline (books, translations, cached files) — never the device key. */
export const DEVICE_CACHE_DATABASES: readonly string[] = ["avora-books", "avora-book-translations"];

export async function deviceStorageEstimate(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || navigator.storage?.estimate === undefined) return null;
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? null;
  } catch {
    return null;
  }
}

/** Clears only this device's caches (Cache Storage + the reading databases). Nothing on the server changes. */
export async function clearDeviceCache(): Promise<void> {
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if (typeof indexedDB !== "undefined") {
    await Promise.all(
      DEVICE_CACHE_DATABASES.map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
          }),
      ),
    );
  }
}
