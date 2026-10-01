-- AVORA-51 · B3: Hồ sơ › "Hiện đầy đủ" asks for the account password again. Checked here against the
-- bcrypt hash GoTrue keeps, so the app never has to sign in a second time (that would open a new
-- session and drop the Két sắt unlock). 5 tries per 15 minutes; the hash never leaves the database.
create table if not exists private.password_checks (
  user_id uuid not null references auth.users (id) on delete cascade,
  checked_at timestamptz not null default now()
);
create index if not exists password_checks_user on private.password_checks (user_id, checked_at desc);
alter table private.password_checks enable row level security;
revoke all on private.password_checks from public, anon, authenticated;

create or replace function public.verify_account_password(p_password text)
returns boolean language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from private.password_checks where checked_at < now() - interval '1 day';
  if (select count(*) from private.password_checks where user_id = v_uid and checked_at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_password_check_rate';
  end if;
  insert into private.password_checks (user_id) values (v_uid);
  select encrypted_password into v_hash from auth.users where id = v_uid;
  return coalesce(v_hash, '') <> '' and length(coalesce(p_password, '')) between 1 and 200
    and extensions.crypt(p_password, v_hash) = v_hash;
end $$;
revoke all on function public.verify_account_password(text) from public, anon;
grant execute on function public.verify_account_password(text) to authenticated;
