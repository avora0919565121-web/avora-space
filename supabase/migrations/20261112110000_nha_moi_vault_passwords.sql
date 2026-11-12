-- Nhà mới (VMT 12/11) · Két sắt › Mật khẩu làm thật; Avora AI chuyển "Sắp có".
--
-- Mật khẩu là ngăn thứ tư của Két sắt, mã hoá đầu cuối như Chứng chỉ / Tài liệu / Tài sản (AVORA-68, ADR-041):
-- máy chủ chỉ giữ bản mã, khoá ngăn bọc bằng khoá chính. Keyring tạo trước bản này chưa có khoá ngăn
-- 'passwords': máy tự tạo khi mở ngăn lần đầu và gửi bản đã bọc qua vault_add_section_key (chỉ thêm, không
-- bao giờ ghi đè khoá đã có — ghi đè sẽ làm mất mọi mục cũ).

alter table public.vault_items drop constraint if exists vault_items_section_check;
alter table public.vault_items add constraint vault_items_section_check
  check (section in ('certificates', 'documents', 'assets', 'passwords'));

create or replace function public.vault_add_section_key(p_section text, p_wrapped text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_added int;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  perform private.vault_assert_unlocked();
  if p_section not in ('passwords') then raise exception 'avora_vault_section_invalid'; end if;
  if p_wrapped is null or length(p_wrapped) < 40 or length(p_wrapped) > 400 then raise exception 'avora_vault_ring_invalid'; end if;
  update public.vault_keyring
     set section_keys = section_keys || jsonb_build_object(p_section, p_wrapped)
   where user_id = v_uid and not (section_keys ? p_section);
  get diagnostics v_added = row_count;
  return v_added = 1;
end $$;
revoke all on function public.vault_add_section_key(text, text) from public, anon;
grant execute on function public.vault_add_section_key(text, text) to authenticated;

-- Avora AI chưa có gì bên trong: hiện "Sắp có" thay vì một màn trống (VMT 12/11).
update public.app_features set status = 'soon', updated_at = now() where key = 'avora_ai' and status <> 'soon';
