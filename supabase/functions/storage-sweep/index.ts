// AVORA-106 · K6 · storage-sweep — runs hourly (pg_cron + pg_net, same cron secret as send-push).
// Takes a batch from storage_sweep_batch(): chat uploads no message points at after 24 hours, and the
// files of Nhật ký entries past 30 days in Thùng rác. Deletes them through the Storage API (the
// database refuses direct deletes from storage.objects), then clears them from the queue.
// Đợt A: nothing a person can still see is ever deleted here.
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";

type Row = { bucket: string; path: string; reason: string };

Deno.serve(async (req) => {
  if (cronSecret === "" || req.headers.get("x-avora-cron") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("storage_sweep_batch", { p_limit: 500 });
  if (error) {
    console.error("[storage-sweep] batch", error.code);
    return new Response(JSON.stringify({ error: "batch_failed" }), { status: 500 });
  }
  const rows = (data ?? []) as Row[];
  const byBucket = new Map<string, string[]>();
  for (const row of rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path]);
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: removeError } = await db.storage.from(bucket).remove(chunk);
      if (removeError) {
        console.error("[storage-sweep] remove", bucket, removeError.message.slice(0, 80));
        continue;
      }
      await db.rpc("storage_sweep_done", { p_bucket: bucket, p_paths: chunk });
      removed += chunk.length;
    }
  }
  return new Response(JSON.stringify({ queued: rows.length, removed }), { headers: { "Content-Type": "application/json" } });
});
