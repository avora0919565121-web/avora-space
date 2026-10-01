-- AVORA-54 · C — "Đăng xuất mọi thiết bị khác" (Profile › Bảo mật).
-- After `supabase.auth.signOut({ scope: 'others' })` the client calls this once: the owner gets the
-- alarm email (vault-mail, action 'signout') and every device with notifications gets one `security`
-- push — the same shape as private.vault_alarm (AVORA-51 · 7), which no mute may block.

create or replace function private.security_signout_notice()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_tz text;
  v_when text;
  v_text text;
  v_email text;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'avora_no_session';
  end if;

  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from profiles where id = v_user;
  v_when := to_char(now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY');
  v_text := 'Tài khoản của bạn vừa được đăng xuất trên mọi thiết bị khác lúc ' || v_when || '.';
  insert into push_outbox (user_id, kind, payload)
  values (v_user, 'security', jsonb_build_object('text', v_text));

  select email into v_email from auth.users where id = v_user;
  if v_email is not null then
    perform private.vault_send_mail(
      jsonb_build_object('kind', 'alarm', 'action', 'signout', 'email', v_email, 'when', v_when)
    );
  end if;
end;
$$;

revoke all on function private.security_signout_notice() from public, anon, authenticated;
grant execute on function private.security_signout_notice() to authenticated;
