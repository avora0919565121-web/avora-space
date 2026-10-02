// AVORA-67 · device-prove — a browser proves it is the device it claims to be.
// The caller signs the server's nonce with its non-exportable ECDSA P-256 key; we check the signature
// with Deno's WebCrypto (Postgres cannot verify ECDSA), then bind the device to this session.
// The session comes from the caller's own JWT, never from the body.
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  device_id: string;
  public_key: JsonWebKey;
  nonce: string;
  signature: string;
  label: string;
  kind: string;
  guest: boolean;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function sessionIdOf(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

function isBody(v: unknown): v is Body {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.device_id === "string" && /^[0-9a-f-]{36}$/i.test(b.device_id) &&
    typeof b.public_key === "object" && b.public_key !== null &&
    typeof b.nonce === "string" && b.nonce.length <= 64 &&
    typeof b.signature === "string" && b.signature.length <= 200 &&
    typeof b.label === "string" && typeof b.kind === "string" && typeof b.guest === "boolean"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (jwt === "") return json(401, { error: "auth" });

  // Who is calling — verified by Supabase Auth, not trusted from the token body.
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || userData.user === null) return json(401, { error: "auth" });
  const userId = userData.user.id;
  const sessionId = sessionIdOf(jwt);
  if (sessionId === null) return json(400, { error: "session" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  if (!isBody(body)) return json(400, { error: "bad_body" });
  const jwk = body.public_key;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || "d" in jwk) {
    return json(400, { error: "bad_key" });
  }
  const publicJwk = JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  // A known device must keep the key it registered with.
  const { data: stored } = await db.rpc("device_key_for", { p_user: userId, p_device_id: body.device_id });
  if (typeof stored === "string" && stored !== publicJwk) return json(409, { error: "key_mismatch" });

  try {
    const key = await crypto.subtle.importKey("jwk", JSON.parse(publicJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64ToBytes(body.signature),
      new TextEncoder().encode(`avora-device-v1:${userId}:${body.device_id}:${body.nonce}`),
    );
    if (!ok) return json(403, { error: "signature" });
  } catch {
    return json(400, { error: "signature" });
  }

  const { data, error } = await db.rpc("device_bind", {
    p_user: userId,
    p_session: sessionId,
    p_device_id: body.device_id,
    p_public_key: publicJwk,
    p_nonce: body.nonce,
    p_label: body.label.slice(0, 60),
    p_kind: body.kind,
    p_guest: body.guest,
  });
  if (error) {
    console.error("[device-prove] bind", error.message.slice(0, 60));
    const code = /avora_[a-z_]+/.exec(error.message)?.[0] ?? "bind_failed";
    return json(400, { error: code });
  }
  return json(200, data);
});
