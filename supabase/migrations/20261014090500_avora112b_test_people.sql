-- AVORA-112-B · VMT 14/10 (quyết định 1): bài kiểm SQL không dùng tài khoản người thật. Người thử phụ (C, O…)
-- được tạo NGAY TRONG giao dịch của bài kiểm — mọi bài đều kết thúc bằng raise → rollback, nên không tài khoản
-- nào tồn tại sau bài kiểm. Email dùng miền `.invalid` (RFC 2606, không bao giờ là địa chỉ của ai). Chỉ vai trò
-- chủ CSDL gọi được; không lộ qua API.
create or replace function private.test_ephemeral_user(p_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
          'tester' || lower(p_label) || '+' || replace(v_id::text, '-', '') || '@avora-test.invalid',
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', 'Tester ' || upper(p_label)),
          now(), now(), now());
  return v_id;
end $$;
revoke execute on function private.test_ephemeral_user(text) from public, anon, authenticated;
