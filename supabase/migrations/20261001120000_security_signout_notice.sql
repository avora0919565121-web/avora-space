-- AVORA-54 · C — "Đăng xuất mọi thiết bị khác" (Profile › Bảo mật).
-- After `supabase.auth.signOut({ scope: 'others' })` the client calls this once: the owner gets the
-- alarm email (vault-mail, action 'signout') and every device with notifications gets one `security`
-- push — the same shape as private.vault_alarm (AVORA-51 · 7), which no mute may block.
-- Lives in `public` so PostgREST exposes it; acts only on auth.uid(), and fires at most once a minute
-- so a looping client cannot flood the owner's inbox.

create or replace function public.security_signout_notice()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_when text;
  v_text text;
  v_email text;
begin
  if v_user is null then
    raise exception 'avora_no_session';
  end if;

  if exists (
    select 1 from push_outbox
    where user_id = v_user and kind = 'security' and dedupe_key like 'signout:%'
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from profiles where id = v_user;
  v_when := to_char(now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY');
  v_text := 'Tài khoản của bạn vừa được đăng xuất trên mọi thiết bị khác lúc ' || v_when
    || '. Không phải bạn? Đổi mật khẩu tài khoản ngay.';
  insert into push_outbox (user_id, kind, payload, dedupe_key)
  values (v_user, 'security', jsonb_build_object('text', v_text), 'signout:' || extract(epoch from now())::bigint);

  select email into v_email from auth.users where id = v_user;
  if v_email is not null then
    perform private.vault_send_mail(
      jsonb_build_object('kind', 'alarm', 'action', 'signout', 'email', v_email, 'when', v_when)
    );
  end if;
end;
$$;

revoke all on function public.security_signout_notice() from public, anon;
grant execute on function public.security_signout_notice() to authenticated;
