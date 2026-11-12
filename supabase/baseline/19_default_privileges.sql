-- Quyền mặc định của production cho đối tượng do `postgres` tạo trong schema public (đọc từ pg_default_acl
-- trên live 12/11/2026). Project Supabase mới cấp ALL cho anon/authenticated theo mặc định; production đã
-- siết lại. Thiếu file này, mọi bảng/hàm tạo bởi migration sau trên một project dựng lại sẽ rộng quyền hơn
-- production (đã gặp trên staging: account_deletion_requests cấp INSERT/UPDATE/DELETE cho authenticated).
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;
