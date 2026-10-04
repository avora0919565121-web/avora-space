import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { roomFromPref, type RoomShelf } from "@/lib/room";
import type { ThinkTable } from "@/lib/think-hub";
import { isTemplateAudience, type TemplateAudience } from "@/lib/think-hub-shelf";
import { useProfilePrefs } from "@/lib/use-default-boards";

/** AVORA-89 · PHẦN 2 — room data: open questions (kệ 2), remembered shelf, template audiences. */

export type OpenQuestion = { emptyCells: number; hasConclusion: boolean; othersChangedAt: string | null };

/** `think_hub_open_questions()` — per board I can see: empty cells, a conclusion yet, others' last change. */
export function useOpenQuestions(): ReadonlyMap<string, OpenQuestion> {
  const { user } = useAuth();
  const query = useQuery<Map<string, OpenQuestion>, Error>({
    queryKey: ["think-hub", "open-questions", user?.id ?? "none"],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("think_hub_open_questions");
      if (error) throw new Error("Không tải được điều còn hở.");
      return new Map(
        (data ?? []).map((row) => [row.table_id, { emptyCells: Number(row.empty_cells ?? 0), hasConclusion: row.has_conclusion === true, othersChangedAt: row.others_changed_at }] as const),
      );
    },
  });
  return useMemo(() => query.data ?? new Map<string, OpenQuestion>(), [query.data]);
}

export function useRoomPrefs(): {
  savedRoom: RoomShelf | null;
  saveRoom: (shelf: RoomShelf) => void;
  audiences: TemplateAudience[];
  audiencesAsked: boolean;
  saveAudiences: (next: TemplateAudience[]) => void;
} {
  const { prefs, setPref } = useProfilePrefs();
  const savedRoom = roomFromPref(prefs.think_hub_room);
  const audiences = useMemo(() => (Array.isArray(prefs.template_audiences) ? prefs.template_audiences.filter(isTemplateAudience) : []), [prefs.template_audiences]);
  const audiencesAsked = prefs.template_audiences_asked === true;
  const saveRoom = useCallback(
    (shelf: RoomShelf) => {
      if (prefs.think_hub_room === shelf) return;
      void setPref("think_hub_room", shelf).catch(() => undefined);
    },
    [prefs.think_hub_room, setPref],
  );
  const saveAudiences = useCallback(
    (next: TemplateAudience[]) => {
      // Only used to order templates — never shown on a profile, never shared (2.4b · C).
      void setPref("template_audiences", next)
        .then(() => setPref("template_audiences_asked", true))
        .catch(() => undefined);
    },
    [setPref],
  );
  return { savedRoom, saveRoom, audiences, audiencesAsked, saveAudiences };
}

/** Which templates I used, and when last: from the boards' `source_template_key`. */
export function templateUsage(tables: readonly ThinkTable[]): { usedAt: Map<string, string>; count: Map<string, number> } {
  const usedAt = new Map<string, string>();
  const count = new Map<string, number>();
  for (const table of tables) {
    const key = table.sourceTemplateKey;
    if (key === null || table.parentRecordId !== null) continue;
    count.set(key, (count.get(key) ?? 0) + 1);
    if ((usedAt.get(key) ?? "") < table.createdAt) usedAt.set(key, table.createdAt);
  }
  return { usedAt, count };
}
