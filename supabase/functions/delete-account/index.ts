// 111-A · delete-account — chạy phút 37 hằng giờ (pg_cron → private.call_delete_account, cùng secret với send-push).
// Thứ tự cho mỗi tài khoản đến hạn:
//   1. Xoá Storage theo `<uid>/…` ở 7 bucket riêng (API Storage; SQL không xoá file trực tiếp).
//   2. account_deletion_execute: chuyển chủ nhóm, giữ tin chung ("Người dùng đã xoá"), đưa tệp chung vào
//      private.storage_delete_queue, rời/xoá cuộc, dọn cột không khoá ngoại, ghi nhật ký (không dữ liệu cá nhân), thư cuối.
//   3. auth.admin.deleteUser → CASCADE phần còn lại; PIN vào private.retired_pins qua trigger.
// Chạy lại an toàn: mọi bước lặp lại được; dòng 'done' còn auth.users được lấy lại lần sau. Không ghi uid/email vào log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";

export const OWNER_BUCKETS = [
  "avatars",
  "feedback-shots",
  "keepsakes",
  "my-book-covers",
  "note-files",
  "receipts",
  "vault-files",
] as const;

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

async function listAll(db: Db, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [prefix];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`list ${bucket}`);
      const items = data ?? [];
      for (const item of items) {
        const path = `${dir}/${item.name}`;
        // Thư mục trong Storage không có id.
        if (item.id === null) stack.push(path);
        else out.push(path);
      }
      if (items.length < 1000) break;
    }
  }
  return out;
}

async function purgeStorage(db: Db, uid: string): Promise<number> {
  let removed = 0;
  for (const bucket of OWNER_BUCKETS) {
    const paths = await listAll(db, bucket, uid);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await db.storage.from(bucket).remove(chunk);
      if (error) throw new Error(`remove ${bucket}`);
      removed += chunk.length;
    }
  }
  return removed;
}

Deno.serve(async (req) => {
  if (cronSecret === "" || req.headers.get("x-avora-cron") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("account_deletion_batch", { p_limit: 20 });
  if (error) {
    console.error("[delete-account] batch", error.code);
    return new Response(JSON.stringify({ error: "batch_failed" }), { status: 500 });
  }
  const rows = (data ?? []) as { user_id: string; status: string }[];
  let done = 0;
  let failed = 0;
  let files = 0;
  for (const row of rows) {
    try {
      files += await purgeStorage(db, row.user_id);
      const { error: execError } = await db.rpc("account_deletion_execute", { p_user: row.user_id, p_reason: "self" });
      if (execError) throw new Error(`execute ${execError.code ?? ""}`);
      const { error: authError } = await db.auth.admin.deleteUser(row.user_id);
      if (authError && authError.status !== 404) throw new Error(`auth ${authError.status ?? ""}`);
      done += 1;
    } catch (e) {
      failed += 1;
      console.error("[delete-account] step", e instanceof Error ? e.message.slice(0, 60) : "unknown");
    }
  }
  return new Response(JSON.stringify({ batch: rows.length, done, failed, files }), {
    headers: { "Content-Type": "application/json" },
  });
});
