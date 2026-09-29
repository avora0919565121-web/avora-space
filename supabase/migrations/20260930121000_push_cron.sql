-- AVORA-46 · send-push every minute. The header secret lives in Vault (avora_push_cron_secret),
-- never in this file; the same value is the Edge Function secret PUSH_CRON_SECRET.
create or replace function private.call_send_push()
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function private.call_send_push() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'avora_send_push') then perform cron.unschedule('avora_send_push'); end if;
  perform cron.schedule('avora_send_push', '* * * * *', 'select private.call_send_push()');
end $$;
