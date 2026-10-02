-- S7 (VMT 02/10): Argon2id timings measured on real devices, used to pick the vault KDF cost.
-- Rows are anonymous on purpose: device kind + browser + timings only, never an account.
create table if not exists private.argon_bench (
  id          bigint generated always as identity primary key,
  device_kind text not null check (device_kind in ('iphone','ipad','android','mac','windows','linux','other')),
  browser     text not null check (char_length(browser) between 1 and 40),
  standalone  boolean not null default false,
  profile     text not null check (profile in ('64m3','32m4')),
  runs_ms     integer[] not null check (cardinality(runs_ms) between 0 and 3),
  error       text check (error is null or char_length(error) <= 120),
  created_at  timestamptz not null default now()
);
revoke all on private.argon_bench from public, anon, authenticated;

create or replace function public.record_argon_bench(
  p_device_kind text, p_browser text, p_standalone boolean, p_profile text, p_runs_ms integer[], p_error text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  -- A page refresh loop must not flood the table: 20 rows a minute is far above any honest run.
  if (select count(*) from private.argon_bench where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'avora_rate_limited';
  end if;
  insert into private.argon_bench (device_kind, browser, standalone, profile, runs_ms, error)
  values (p_device_kind, left(p_browser, 40), coalesce(p_standalone, false), p_profile,
          coalesce(p_runs_ms, '{}'), left(p_error, 120));
end $$;
revoke execute on function public.record_argon_bench(text, text, boolean, text, integer[], text) from public, anon;
grant execute on function public.record_argon_bench(text, text, boolean, text, integer[], text) to authenticated;
