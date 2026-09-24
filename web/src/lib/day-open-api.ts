import { supabase } from "@/integrations/supabase/client";

/** Reads and writes the one date the new-day rule in `day-open.ts` depends on. */
export async function fetchLastOpenedDate(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("last_opened_date")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error(`[day-open] ${error.code ?? "unknown"}: ${error.message}`);
    throw new Error("Không đọc được ngày mở gần nhất.");
  }
  return data?.last_opened_date ?? null;
}

export async function recordOpenedDate(userId: string, today: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ last_opened_date: today })
    .eq("id", userId);
  if (error) console.error(`[day-open] ${error.code ?? "unknown"}: ${error.message}`);
}
