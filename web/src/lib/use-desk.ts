import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { isArrangement, type Arrangement } from "@/lib/desk";
import { thinkHubKeys } from "@/lib/think-hub";
import { useProfilePrefs } from "@/lib/use-default-boards";

/** AVORA-81 · PHẦN 2 — my desk (at most 5) and the remembered arrangement. */
export const deskKeys = { desk: (userId: string | undefined) => ["think-desk", userId ?? "none"] as const };

export class DeskFullError extends Error {
  constructor() {
    super("Bàn đã đủ 5");
  }
}

export function useDesk() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery<{ tableId: string; placedAt: string }[], Error>({
    queryKey: deskKeys.desk(user?.id),
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("think_hub_desk").select("table_id, placed_at").order("placed_at", { ascending: true });
      if (error) throw new Error("Không tải được Bàn nghĩ.");
      return (data ?? []).map((row) => ({ tableId: row.table_id, placedAt: row.placed_at }));
    },
  });
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: deskKeys.desk(user?.id) });
    void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
  };
  const place = useMutation({
    mutationFn: async (tableId: string) => {
      const { error } = await supabase.rpc("place_on_desk", { p_table_id: tableId });
      if (error) {
        if (error.message.includes("avora_desk_full")) throw new DeskFullError();
        throw new Error("Chưa đặt lên bàn được.");
      }
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (tableId: string) => {
      const { error } = await supabase.rpc("remove_from_desk", { p_table_id: tableId });
      if (error) throw new Error("Chưa đặt xuống được.");
    },
    onSuccess: refresh,
  });
  const ids = useMemo(() => (query.data ?? []).map((item) => item.tableId), [query.data]);
  return { ids, isLoaded: query.data !== undefined, place, remove };
}

export function useArrangement(): { arrangement: Arrangement; setArrangement: (next: Arrangement) => void } {
  const { prefs, setPref } = useProfilePrefs();
  const arrangement: Arrangement = isArrangement(prefs.think_hub_arrangement) ? prefs.think_hub_arrangement : "noi";
  const setArrangement = useCallback((next: Arrangement) => void setPref("think_hub_arrangement", next).catch(() => undefined), [setPref]);
  return { arrangement, setArrangement };
}

/** Anywhere a board is put on the desk (⋯ `Đặt lên bàn`, ▾ Đang suy nghĩ) and the desk is full. */
export const DESK_FULL_EVENT = "avora:desk-full";

export function announceDeskFull(tableId: string): void {
  window.dispatchEvent(new CustomEvent<string>(DESK_FULL_EVENT, { detail: tableId }));
}
