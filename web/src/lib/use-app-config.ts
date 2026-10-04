import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { MtEngine } from "@/lib/reader-settings";

/** AVORA-93 · PHẦN 3 · 0 — switches only VMT flips: paid translation (off) and approved chapter engines (none). */
export function useTranslationConfig(): { paidEnabled: boolean; chapterEngines: readonly MtEngine[] } {
  const query = useQuery<{ paidEnabled: boolean; chapterEngines: MtEngine[] }, Error>({
    queryKey: ["app-config", "translation"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("app_config").select("key, value").in("key", ["translation_paid_enabled", "chapter_mt_engines"]);
      if (error) throw new Error("Không đọc được cấu hình.");
      const byKey = new Map((data ?? []).map((row) => [row.key, row.value] as const));
      const engines = byKey.get("chapter_mt_engines");
      return {
        paidEnabled: byKey.get("translation_paid_enabled") === true,
        chapterEngines: Array.isArray(engines) ? engines.filter((item): item is MtEngine => item === "chrome_translator" || item === "bergamot") : [],
      };
    },
  });
  // Until read (or on error) everything stays off: no paid path, no whole-chapter machine translation.
  return { paidEnabled: query.data?.paidEnabled ?? false, chapterEngines: query.data?.chapterEngines ?? [] };
}
