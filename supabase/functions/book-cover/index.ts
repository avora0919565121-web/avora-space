// AVORA-103 · C — book-cover: fetches a public-domain book's cover ONCE, shrinks it to WebP (long
// side 400 px) and keeps it in the public bucket `book-covers`, shared by everyone. A reader's
// browser only ever loads covers from Avora: Gutenberg / Open Library never learn who has which book,
// and Open Library's cover API is never hammered (by OLID, ≥ 1 s apart through book_fetch_slot()).
// • a signed-in person: { source, source_id } — at most 60 covers an hour each;
// • pg_cron (x-avora-cron): { backfill: true } — a small slow round of books not yet checked.
// A blank cover (one colour, or < 2 KB) is dropped: the app draws its own cover instead.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import encodeWebp, { init as initWebp } from "npm:@jsquash/webp@1.4.0/encode.js";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";

const UA = "AvoraReader/1.0 (https://avorachat.com; public-domain covers; reply@avorachat.com)";
const BUCKET = "book-covers";
const HOURLY_LIMIT = 60;
const BACKFILL_ROUND = 25;
const LONG_SIDE = 400;
const WEBP_WASM = "https://cdn.jsdelivr.net/npm/@jsquash/webp@1.4.0/codec/enc/webp_enc.wasm";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Db = any;
type Row = { source: string; source_id: string; cover_path: string | null; cover_checked_at: string | null; pd_status: string; access: string };

let webpReady: Promise<void> | null = null;
function ensureWebp(): Promise<void> {
  webpReady ??= (async () => {
    const bytes = await (await fetch(WEBP_WASM)).arrayBuffer();
    await initWebp(await WebAssembly.compile(bytes));
  })();
  return webpReady;
}

function sourceUrl(row: Row): string | null {
  if (row.source === "gutenberg" && /^\d{1,7}$/.test(row.source_id)) {
    return `https://gutenberg.pglaf.org/cache/epub/${row.source_id}/pg${row.source_id}.cover.medium.jpg`;
  }
  if (row.source === "openlibrary" && /^OL\d{1,10}M$/.test(row.source_id)) {
    // By OLID (never ISBN); default=false answers 404 instead of a blank placeholder.
    return `https://covers.openlibrary.org/b/olid/${row.source_id}-L.jpg?default=false`;
  }
  return null;
}

/** One colour (or nearly): every sampled pixel close to the first. */
function isBlank(image: Image): boolean {
  const first = image.getPixelAt(1, 1);
  const [r0, g0, b0] = Image.colorToRGB(first);
  let far = 0;
  for (let y = 1; y <= image.height; y += Math.max(1, Math.floor(image.height / 24))) {
    for (let x = 1; x <= image.width; x += Math.max(1, Math.floor(image.width / 16))) {
      const [r, g, b] = Image.colorToRGB(image.getPixelAt(x, y));
      if (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) > 36) far += 1;
    }
  }
  return far < 6;
}

async function waitSlot(db: Db): Promise<void> {
  const { data } = await db.rpc("book_fetch_slot");
  const ms = typeof data === "number" ? Math.min(data, 20_000) : 1000;
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches, checks, shrinks and keeps one cover. Returns the stored path, or null (none / blank). */
async function fetchCover(db: Db, row: Row): Promise<string | null> {
  const from = sourceUrl(row);
  if (from === null) return null;
  await waitSlot(db);
  const response = await fetch(from, { headers: { "User-Agent": UA } });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 2048) return null;
  const image = (await Image.decode(bytes)) as Image;
  if (isBlank(image)) return null;
  const scale = LONG_SIDE / Math.max(image.width, image.height);
  if (scale < 1) image.resize(Math.round(image.width * scale), Math.round(image.height * scale));
  await ensureWebp();
  const webp = await encodeWebp({ data: new Uint8ClampedArray(image.bitmap.buffer), width: image.width, height: image.height, colorSpace: "srgb" } as ImageData, { quality: 72 });
  const path = `${row.source}/${row.source_id}.webp`;
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([webp], { type: "image/webp" }), { upsert: true, contentType: "image/webp", cacheControl: "31536000" });
  if (error) throw new Error(`upload ${error.message}`);
  return path;
}

async function settle(db: Db, row: Row): Promise<string | null> {
  let path: string | null = null;
  try {
    path = await fetchCover(db, row);
  } catch (caught) {
    console.error("book-cover failed", row.source, row.source_id, caught instanceof Error ? caught.message : String(caught));
    // A network error is tried again on a later round; a broken image is marked as checked.
    if (caught instanceof TypeError) return null;
  }
  const { error } = await db.rpc("set_book_cover", { p_source: row.source, p_source_id: row.source_id, p_path: path });
  if (error) console.error("book-cover record failed", row.source, row.source_id, error.message);
  return path;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: { source?: unknown; source_id?: unknown; backfill?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "body" });
  }

  // ------------------------------------------------------------ slow backfill (cron only)
  if (body.backfill === true) {
    if (cronSecret === "" || req.headers.get("x-avora-cron") !== cronSecret) return json(401, { error: "auth" });
    // Books someone already has first (Open Library, then Gutenberg's early numbers — its classics).
    const { data } = await db
      .from("book_catalog")
      .select("source, source_id, cover_path, cover_checked_at, pd_status, access")
      .is("cover_checked_at", null)
      .eq("pd_status", "ok")
      .neq("source", "wikisource")
      .order("source", { ascending: false })
      .limit(400);
    const rows = ((data ?? []) as Row[]).sort((a, b) => (a.source === b.source ? (a.source === "gutenberg" ? Number(a.source_id) - Number(b.source_id) : 0) : a.source === "openlibrary" ? -1 : 1)).slice(0, BACKFILL_ROUND);
    let kept = 0;
    const started = Date.now();
    for (const row of rows) {
      if (Date.now() - started > 45_000) break;
      if ((await settle(db, row)) !== null) kept += 1;
    }
    return json(200, { checked: rows.length, kept });
  }

  // ------------------------------------------------------------ one cover, asked by a reader's app
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt === "") return json(401, { error: "auth" });
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || userData.user === null) return json(401, { error: "auth" });
  const source = body.source;
  const sourceId = typeof body.source_id === "string" ? body.source_id.trim() : "";
  if ((source !== "gutenberg" && source !== "openlibrary") || sourceId === "" || sourceId.length > 20) return json(400, { error: "body" });

  const { data: found, error: rowError } = await asUser
    .from("book_catalog")
    .select("source, source_id, cover_path, cover_checked_at, pd_status, access")
    .eq("source", source)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (rowError) return json(403, { error: "session" });
  if (found === null) return json(404, { error: "not_in_catalog" });
  const row = found as Row;
  if (row.cover_checked_at !== null) return json(200, { cover_path: row.cover_path });
  if (row.pd_status !== "ok") return json(200, { cover_path: null });

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.from("book_text_hits").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).eq("kind", "cover").gte("at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return json(429, { error: "rate_limited" });
  await db.from("book_text_hits").insert({ user_id: userData.user.id, kind: "cover" });
  return json(200, { cover_path: await settle(db, row) });
});
