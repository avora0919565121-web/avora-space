-- AVORA-51 · vault_status also says whether the Két sắt already holds something (only to its owner),
-- so a person with data sees the "khoá cửa, chưa phải két mã hoá" note once before choosing a code.
create or replace function public.vault_status()
returns jsonb language plpgsql stable security definer set search_path = private, pg_temp as $$
declare v_uid uuid := auth.uid(); v_exp timestamptz; v_failed integer;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select expires_at into v_exp from private.vault_unlocks
    where user_id = v_uid and session_id = private.vault_session_id() and expires_at > now();
  select failed_count into v_failed from private.vault_attempts where user_id = v_uid;
  return jsonb_build_object(
    'has_code', exists (select 1 from private.vault_secrets where user_id = v_uid),
    'has_data', exists (select 1 from public.accounts where user_id = v_uid) or exists (select 1 from public.transactions where user_id = v_uid),
    'unlocked', v_exp is not null,
    'expires_at', v_exp,
    'locked_until', private.vault_wait_until(v_uid),
    'remaining', 5 - coalesce(v_failed, 0));
end $$;
revoke all on function public.vault_status() from public, anon;
grant execute on function public.vault_status() to authenticated;
