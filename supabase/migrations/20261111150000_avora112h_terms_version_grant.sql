-- 112-H · LOI-15: 111-B tạo private.terms_version() nhưng không thu quyền mặc định của PUBLIC,
-- nên anon gọi được. Hàm chỉ trả chuỗi phiên bản (vô hại), nhưng mọi hàm private theo AGENTS.md
-- phải REVOKE public/anon. handle_new_user (SECURITY DEFINER, chạy bằng quyền chủ hàm) không bị ảnh hưởng.
revoke execute on function private.terms_version() from public, anon;
grant execute on function private.terms_version() to authenticated, service_role;
