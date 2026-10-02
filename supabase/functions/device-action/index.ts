// AVORA-67 · device-action — the page /xac-nhan-thiet-bi behind the email links.
// GET-like `info` only describes the link (mail scanners open links on their own); a state change needs a
// POST with `choice`, i.e. a real button press. No sign-in: the one-use token is the authority.
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const CHOICES = new Set(["confirm", "reject", "found", "not_me_rank", "cancel_escape"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_json" });
  }
  const token = typeof body.token === "string" && /^[0-9a-f]{64}$/.test(body.token) ? body.token : null;
  if (token === null) return json(400, { error: "avora_device_token" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (body.op === "info") {
    const { data, error } = await db.rpc("device_action_info", { p_token: token });
    if (error) return json(400, { error: "info_failed" });
    return json(200, data);
  }
  const choice = typeof body.choice === "string" && CHOICES.has(body.choice) ? body.choice : null;
  if (choice === null) return json(400, { error: "avora_device_choice" });
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : null;
  const { data, error } = await db.rpc("device_action", { p_token: token, p_choice: choice, p_password: password });
  if (error) {
    const code = /avora_[a-z_]+/.exec(error.message)?.[0] ?? "action_failed";
    return json(400, { error: code });
  }
  return json(200, data);
});
