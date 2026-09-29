// AVORA-46 · send-push — runs every minute (pg_cron + pg_net). Takes a batch from push_claim_batch(),
// sends Web Push (VAPID, RFC 8291/8292), reports back: sent / failed (retried up to 3) / gone (404/410 → the
// subscription is removed). The notification carries only what push_claim_batch() decided to show.
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

type Sub = { endpoint: string; p256dh: string; auth: string };
type Item = { ids: string[]; subscriptions: Sub[]; notification: { title: string; body: string; tag: string; url: string } };

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const vapidJson = Deno.env.get("AVORA_VAPID_KEYS") ?? "";
const contact = Deno.env.get("AVORA_VAPID_CONTACT") ?? "mailto:hotro@avora.app";

let appServer: webpush.ApplicationServer | null = null;
async function server(): Promise<webpush.ApplicationServer> {
  if (appServer === null) {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJson));
    appServer = await webpush.ApplicationServer.new({ contactInformation: contact, vapidKeys });
  }
  return appServer;
}

Deno.serve(async (req) => {
  if (cronSecret === "" || req.headers.get("x-avora-cron") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }
  if (vapidJson === "") return new Response(JSON.stringify({ error: "vapid_missing" }), { status: 500 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("push_claim_batch");
  if (error) {
    console.error("[send-push] claim", error.code);
    return new Response(JSON.stringify({ error: "claim_failed" }), { status: 500 });
  }
  const items = (data ?? []) as Item[];
  const sent: string[] = [];
  const failed: string[] = [];
  const gone: string[] = [];
  const ok: string[] = [];
  const as = items.length > 0 ? await server() : null;
  for (const item of items) {
    let delivered = false;
    let retry = false;
    for (const sub of item.subscriptions ?? []) {
      try {
        const subscriber = as!.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
        await subscriber.pushTextMessage(JSON.stringify(item.notification), { ttl: 3600, topic: item.notification.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) });
        delivered = true;
        ok.push(sub.endpoint);
      } catch (err) {
        const status = err instanceof webpush.PushMessageError ? err.response.status : 0;
        if (status === 404 || status === 410) gone.push(sub.endpoint);
        else retry = true;
        console.error("[send-push] push", status || "network");
      }
    }
    if (delivered) sent.push(...item.ids);
    else if (retry) failed.push(...item.ids);
    else sent.push(...item.ids); // every device gone: nothing left to retry
  }
  const { error: reportError } = await db.rpc("push_report", { p_sent: sent, p_failed: failed, p_gone: gone, p_ok_endpoints: ok });
  if (reportError) console.error("[send-push] report", reportError.code);
  return new Response(JSON.stringify({ items: items.length, sent: sent.length, failed: failed.length, gone: gone.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
