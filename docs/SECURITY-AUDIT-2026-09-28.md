# Rà quyền database — 28/09/2026 (AVORA-37 / D1)

Chạy trên database thật (project `myrubjdysllgucgafqjy`), dưới vai `postgres` (không phải superuser), đọc
`pg_class`, `pg_policies`, `information_schema.role_table_grants`, `pg_proc`, `pg_default_acl`, `storage.buckets`.

Migration sửa phần cơ học: `supabase/migrations/20260927150000_security_audit_mechanical_fixes.sql`
(đã áp và ghi vào lịch sử migration).

## Kết quả 7 mục

1. **Bảng trong `public` chưa bật RLS** — không có. Cả 52 bảng đều bật RLS. *(Chỉ báo — không cần sửa.)*
2. **Bảng cấp quyền cho `anon` hoặc `PUBLIC`** — không có. *(Chỉ báo.)*
3. **Quyền `TRUNCATE` cho `authenticated`/`anon`/`PUBLIC`** — không có bảng nào. **Đã thêm** một lượt
   `REVOKE TRUNCATE` trên mọi bảng `public` làm hàng rào, để một lệnh GRANT cũ bị chạy lại không đưa quyền này về.
4. **Policy áp cho vai `public`** — **63 policy** (60 trong `public`, 3 trong `storage.objects` của bucket
   `chat-attachments`). **Đã đổi** sang `authenticated` bằng `ALTER POLICY … TO authenticated`, điều kiện
   USING/WITH CHECK giữ nguyên (bản gốc được chép vào comment của migration). Gồm cả các policy cũ của
   `message_reactions` và `family_relations`. Trước đó chưa lộ gì vì `anon` không có quyền trên các bảng này.
   Bảng bị ảnh hưởng: `contact`, `contact_channel`, `contact_invite`, `context_task_list_settings`,
   `conversation_groups`, `crm_opportunity`, `dismissed_guidance`, `family_relations`, `group_invite_links`,
   `group_removal_requests`, `meeting_note_details`, `message_attachments`, `message_pins`, `message_reactions`,
   `messages` (policy xoá Nhật ký), `mute_settings`, `profiles`, `project_tasks`, `task_celebration_views`,
   `task_celebrations`, `task_dependencies`, `task_flags`, `task_lists`, `storage.objects`.
5. **Hàm `SECURITY DEFINER` chưa pin `search_path`** — không có. *(Chỉ báo.)* Ghi chú: `create_shared_task` và
   `create_task_suggestion` pin `search_path = public` (không có `pg_temp`); vẫn an toàn vì `pg_temp` luôn được
   tìm sau khi đã chỉ định rõ, nhưng nên thống nhất thành `public, pg_temp` ở lần sửa kế tiếp.
6. **Hàm trong `public` mà `anon`/`PUBLIC` còn `EXECUTE`** — 1 hàm: `forward_blocked_note()` (trả một câu
   thông báo cố định, chỉ được gọi bên trong `forward_messages`). **Đã thu** quyền của `anon`/`PUBLIC`, giữ cho
   `authenticated`. **Không giữ hàm nào mở cho `anon`**: đăng nhập và đặt lại mật khẩu đi qua Supabase Auth
   (GoTrue), không qua hàm nào trong `public`.
7. **Storage bucket `public = true`** — không có. `chat-attachments`, `meeting-files`, `receipts` đều private;
   tệp được mở bằng signed URL có hạn (giữ nguyên). *(Chỉ báo.)*

## Chỉ báo — cần VMT duyệt

- **DEFAULT PRIVILEGES (AGENTS.md §3).** Với bảng do `supabase_admin` tạo trong `public`, mặc định của Supabase
  vẫn cấp `arwdDxtm` (gồm TRUNCATE) cho `anon` và `authenticated`. Bảng do `postgres` tạo (mọi migration của
  AVORA) thì không nhận quyền này. Hiện chưa gây hại vì không có bảng nào của `supabase_admin` trong `public`.
  Đề xuất: không sửa quyền mặc định của `supabase_admin` (do nền tảng quản lý); giữ quy tắc "migration luôn
  chạy dưới `postgres` và GRANT tường minh".
- **`conversation_participants.last_read_at` (AVORA-37 / C2).** Policy SELECT
  (`private.is_conversation_participant(conversation_id, auth.uid())`) cho mọi thành viên đọc `last_read_at` của
  **người khác** trong cùng cuộc trò chuyện — đã thử: A đọc được của B. Bảng còn nằm trong publication realtime,
  nên thay đổi `last_read_at` của B cũng được gửi tới A. Giao diện đã không còn dùng, nhưng dữ liệu vẫn đọc được
  qua API. Các cách đề xuất (không làm đợt này, không đổi cấu trúc bảng):
  1. **Quyền theo cột:** `REVOKE SELECT` rồi `GRANT SELECT (conversation_id, user_id, joined_at, role)` cho
     `authenticated`. Rủi ro: realtime `postgres_changes` trên bảng này có thể lỗi khi thiếu quyền cột; badge đa
     thiết bị đang dựa vào sự kiện đó → cần đổi sang cách khác (ví dụ tải lại `list_my_conversations`).
  2. **Tách policy:** giữ SELECT cho mọi thành viên nhưng qua một view/RPC trả `last_read_at` chỉ cho dòng của
     chính mình. `list_my_conversations` và `mark_conversation_read` đã là SECURITY DEFINER nên không bị ảnh hưởng.
  3. (Về lâu dài) chuyển mốc đã đọc sang một bảng riêng chỉ chủ sở hữu đọc được — là thay đổi cấu trúc, để sau.
  Đề xuất: phương án 1, kèm việc bỏ `conversation_participants` khỏi realtime và dùng broadcast riêng cho mốc đọc
  của chính mình.
