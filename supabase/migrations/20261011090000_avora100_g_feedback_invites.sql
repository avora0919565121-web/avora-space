-- AVORA-100 · PHẦN G (KHỐI 3B) — Góp ý trong app · /gop-y ngoài app · mã mời theo nước / đối tác.
--
-- One list of Avora's own team: app_config.ops_user_ids (jsonb array of uuids). Nobody outside it
-- reads feedback that is not theirs or touches invite codes. Writes go through RPCs only.
-- invite_required stays false (VMT); when it is turned on, only accounts created after that
-- moment without a redeemed code are blocked — by session_allowed, so app and API alike.

-- ============================================================ team list
insert into public.app_config (key, value) values
  ('ops_user_ids', '[]'::jsonb),
  ('invite_required', 'false'::jsonb)
on conflict (key) do nothing;

-- The team list is not something every account needs to read.
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated using (key <> 'ops_user_ids');

create or replace function private.is_ops(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and coalesce(
    (select c.value ? p_uid::text from public.app_config c where c.key = 'ops_user_ids' and jsonb_typeof(c.value) = 'array'),
    false)
$$;
revoke execute on function private.is_ops(uuid) from public, anon;
-- Policies call it as the caller; the private schema is not reachable over the API.
grant execute on function private.is_ops(uuid) to authenticated;

/** Whether the signed-in account is on Avora's team (shows the team screen; the data is guarded anyway). */
create or replace function public.am_i_ops()
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_ops(auth.uid())
$$;
revoke execute on function public.am_i_ops() from public, anon;
grant execute on function public.am_i_ops() to authenticated;

-- ============================================================ G.1 feedback
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete set null,
  kind text not null check (kind in ('loi', 'y_tuong', 'kho_dung')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  page text null check (page is null or char_length(page) <= 300),
  app_version text null check (app_version is null or char_length(app_version) <= 60),
  device text null check (device is null or char_length(device) <= 300),
  screen text null check (screen is null or char_length(screen) <= 40),
  locale text null check (locale is null or char_length(locale) <= 20),
  attachment_path text null check (attachment_path is null or char_length(attachment_path) <= 300),
  email text null check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  source text not null default 'app' check (source in ('app', 'web')),
  status text not null default 'moi' check (status in ('moi', 'dang_xem', 'da_lam', 'khong_lam')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_user_created on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_created on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon;
revoke insert, update, delete on public.feedback from authenticated;
grant select on public.feedback to authenticated;

drop policy if exists feedback_read_own_or_ops on public.feedback;
create policy feedback_read_own_or_ops on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ops(auth.uid())));

-- One private bucket; a screenshot sits in the sender's own folder. 5 MB, pictures only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-shots', 'feedback-shots', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_shots_write_own on storage.objects;
create policy feedback_shots_write_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-shots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not private.attachment_blocked(name, coalesce(metadata ->> 'mimetype', ''))
);
drop policy if exists feedback_shots_read_own_or_ops on storage.objects;
create policy feedback_shots_read_own_or_ops on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-shots'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_ops(auth.uid())))
);
drop policy if exists feedback_shots_delete_own on storage.objects;
create policy feedback_shots_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'feedback-shots' and (storage.foldername(name))[1] = (select auth.uid())::text);

/**
 * In-app feedback. What the device says about itself is kept short; the screenshot must be the
 * sender's own object in `feedback-shots` (checked against storage, not the device's word).
 */
create or replace function public.submit_feedback(
  p_kind text,
  p_body text,
  p_page text default null,
  p_app_version text default null,
  p_device text default null,
  p_screen text default null,
  p_locale text default null,
  p_attachment_path text default null
)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_obj storage.objects%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(v_uid, 'feedback', 10, interval '10 minutes');
  if p_attachment_path is not null then
    if p_attachment_path not like (v_uid::text || '/%') or p_attachment_path like '%..%' then
      raise exception 'avora_attachment_path_invalid';
    end if;
    select * into v_obj from storage.objects o where o.bucket_id = 'feedback-shots' and o.name = p_attachment_path;
    if v_obj.id is null or v_obj.owner_id is distinct from v_uid::text then raise exception 'avora_attachment_path_invalid'; end if;
    if coalesce((v_obj.metadata ->> 'size')::bigint, 0) > 5242880 then raise exception 'avora_attachment_too_large'; end if;
    if coalesce(v_obj.metadata ->> 'mimetype', '') not like 'image/%' then raise exception 'avora_attachment_blocked'; end if;
  end if;
  insert into public.feedback (user_id, kind, body, page, app_version, device, screen, locale, attachment_path, source)
  values (v_uid, p_kind, btrim(p_body), left(p_page, 300), left(p_app_version, 60), left(p_device, 300), left(p_screen, 40), left(p_locale, 20), p_attachment_path, 'app')
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.submit_feedback(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text, text, text, text) to authenticated;

/**
 * /gop-y, no sign-in. A hidden field catches form-filling bots (a person never sees it): when it
 * is filled the call answers as if all went well and keeps nothing. 30 calls a minute for the
 * whole system; no picture.
 */
create or replace function public.submit_public_feedback(
  p_kind text,
  p_body text,
  p_email text default null,
  p_trap text default null,
  p_page text default null,
  p_app_version text default null,
  p_device text default null,
  p_screen text default null,
  p_locale text default null
)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_trap), '') <> '' then return true; end if;
  perform private.rate_take('00000000-0000-0000-0000-000000000000'::uuid, 'public_feedback', 30, interval '1 minute');
  insert into public.feedback (user_id, kind, body, email, page, app_version, device, screen, locale, source)
  values (auth.uid(), p_kind, btrim(p_body), nullif(btrim(lower(p_email)), ''), left(p_page, 300), left(p_app_version, 60), left(p_device, 300), left(p_screen, 40), left(p_locale, 20), 'web');
  return true;
end $$;
revoke execute on function public.submit_public_feedback(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_feedback(text, text, text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.set_feedback_status(p_id uuid, p_status text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  if p_status not in ('moi', 'dang_xem', 'da_lam', 'khong_lam') then raise exception 'avora_bad_status'; end if;
  update public.feedback set status = p_status where id = p_id;
end $$;
revoke execute on function public.set_feedback_status(uuid, text) from public, anon;
grant execute on function public.set_feedback_status(uuid, text) to authenticated;

-- ============================================================ G.3 invite codes
create table if not exists public.invite_code (
  code text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  country text not null check (country in ('VN', 'US', 'CA', 'AU', 'NZ', 'DE', 'FI')),
  partner text null check (partner is null or char_length(partner) <= 80),
  wave smallint not null default 0 check (wave between 0 and 2),
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  max_uses int not null default 50 check (max_uses between 1 and 100000),
  used int not null default 0 check (used >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.invite_code enable row level security;
revoke all on public.invite_code from anon;
revoke insert, update, delete on public.invite_code from authenticated;
grant select on public.invite_code to authenticated;
drop policy if exists invite_code_ops_read on public.invite_code;
create policy invite_code_ops_read on public.invite_code for select to authenticated using ((select private.is_ops(auth.uid())));

alter table public.profiles add column if not exists invite_code text null references public.invite_code (code) on update cascade on delete set null;
alter table public.profiles add column if not exists country text null check (country is null or country in ('VN', 'US', 'CA', 'AU', 'NZ', 'DE', 'FI'));

-- A profile cannot give itself a code or a country: those come only from redeem.
create or replace function private.profiles_keep_invite()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and (new.invite_code is distinct from old.invite_code or new.country is distinct from old.country)
     and coalesce(current_setting('avora.redeeming', true), '') <> 'on' then
    new.invite_code := old.invite_code;
    new.country := old.country;
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_invite on public.profiles;
create trigger profiles_keep_invite before update on public.profiles for each row execute function private.profiles_keep_invite();

/** Ops: create a code (upper-cased). */
create or replace function public.create_invite_code(
  p_code text, p_country text, p_partner text default null, p_wave int default 0, p_locale text default 'vi', p_max_uses int default 50
)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  insert into public.invite_code (code, country, partner, wave, locale, max_uses)
  values (upper(btrim(p_code)), upper(btrim(p_country)), nullif(btrim(p_partner), ''), p_wave, p_locale, p_max_uses);
end $$;
revoke execute on function public.create_invite_code(text, text, text, int, text, int) from public, anon;
grant execute on function public.create_invite_code(text, text, text, int, text, int) to authenticated;

create or replace function public.set_invite_code_active(p_code text, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  update public.invite_code set active = p_active where code = upper(btrim(p_code));
end $$;
revoke execute on function public.set_invite_code_active(text, boolean) from public, anon;
grant execute on function public.set_invite_code_active(text, boolean) to authenticated;

/** Turning the requirement on remembers the moment; only accounts created after it are held. */
create or replace function public.set_invite_required(p_on boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  insert into public.app_config (key, value) values ('invite_required', to_jsonb(p_on))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke execute on function public.set_invite_required(boolean) from public, anon;
grant execute on function public.set_invite_required(boolean) to authenticated;

create or replace function private.app_config_invite_since()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.key = 'invite_required' and new.value = 'true'::jsonb
     and (tg_op = 'INSERT' or old.value is distinct from new.value) then
    insert into public.app_config (key, value) values ('invite_required_since', to_jsonb(now()))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists app_config_invite_since on public.app_config;
create trigger app_config_invite_since after insert or update on public.app_config
  for each row when (new.key = 'invite_required') execute function private.app_config_invite_since();

/** Public: is a code required at sign-up right now. */
create or replace function public.invite_required()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'invite_required'), false)
$$;
revoke execute on function public.invite_required() from public;
grant execute on function public.invite_required() to anon, authenticated;

/**
 * Before sign-up: does the code work. Answers only what the form needs (country, language).
 * Rate-limited per account, or for all signed-out callers together.
 */
create or replace function public.check_invite(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.invite_code%rowtype;
begin
  perform private.rate_take(coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), 'check_invite', 60, interval '1 minute');
  select * into v_row from public.invite_code where code = upper(btrim(coalesce(p_code, '')));
  if v_row.code is null or not v_row.active then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.used >= v_row.max_uses then return jsonb_build_object('ok', false, 'reason', 'used_up'); end if;
  return jsonb_build_object('ok', true, 'country', v_row.country, 'locale', v_row.locale);
end $$;
revoke execute on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;

create or replace function private.redeem_invite_for(p_uid uuid, p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.invite_code%rowtype;
  v_current text;
begin
  select invite_code into v_current from public.profiles where id = p_uid;
  if v_current is not null then
    if v_current = upper(btrim(p_code)) then return jsonb_build_object('ok', true); end if;
    raise exception 'avora_invite_already';
  end if;
  select * into v_row from public.invite_code where code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_row.code is null or not v_row.active then raise exception 'avora_invite_not_found'; end if;
  if v_row.used >= v_row.max_uses then raise exception 'avora_invite_used_up'; end if;
  update public.invite_code set used = used + 1 where code = v_row.code;
  perform set_config('avora.redeeming', 'on', true);
  update public.profiles
     set invite_code = v_row.code,
         country = v_row.country,
         prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('locale', v_row.locale)
   where id = p_uid;
  perform set_config('avora.redeeming', '', true);
  return jsonb_build_object('ok', true, 'country', v_row.country, 'locale', v_row.locale);
end $$;
revoke execute on function private.redeem_invite_for(uuid, text) from public, anon, authenticated;

/** After the account exists (or from the gate screen): use the code once. */
create or replace function public.redeem_invite(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(v_uid, 'redeem_invite', 10, interval '10 minutes');
  return private.redeem_invite_for(v_uid, p_code);
end $$;
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- A code typed at sign-up travels in the account's metadata and is used as the account is made
-- (an emailed confirmation has no session yet). A bad code is not an error here: the gate asks.
create or replace function private.redeem_invite_on_signup()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
begin
  if v_code is not null then
    begin
      perform private.redeem_invite_for(new.id, v_code);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_invite on auth.users;
create trigger on_auth_user_created_invite after insert on auth.users for each row execute function private.redeem_invite_on_signup();

-- ============================================================ G.3 gate
create or replace function private.invite_blocks(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'invite_required'), false)
     and exists (
       select 1 from public.profiles p
        where p.id = p_uid and p.invite_code is null
          and p.created_at >= coalesce(
            (select (c.value #>> '{}')::timestamptz from public.app_config c where c.key = 'invite_required_since'),
            'infinity'::timestamptz))
$$;
revoke execute on function private.invite_blocks(uuid) from public, anon, authenticated;

/** What the app asks to decide whether to show `Nhập mã mời để vào Avora`. Works while held. */
create or replace function public.my_invite_gate()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('blocked', private.invite_blocks(auth.uid()))
$$;
revoke execute on function public.my_invite_gate() from public, anon;
grant execute on function public.my_invite_gate() to authenticated;

create or replace function private.session_allowed()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_sid uuid;
  v_dev public.account_devices%rowtype;
  v_lock public.account_device_lock%rowtype;
begin
  if v_uid is null then
    -- No user: only the system itself (cron, service_role, migrations) — never anon (S12).
    return v_role = 'service_role' or (v_role = '' and session_user not in ('authenticator', 'anon', 'authenticated'));
  end if;
  -- AVORA-100 · G.3: an account made after the code became required, without one, sees nothing.
  if private.invite_blocks(v_uid) then
    return false;
  end if;
  v_sid := private.current_session_id();
  if v_sid is not null and exists (select 1 from private.blocked_sessions where session_id = v_sid) then
    return false;
  end if;
  if v_sid is not null then
    select * into v_dev from public.account_devices where user_id = v_uid and session_id = v_sid limit 1;
  end if;
  if v_dev.id is not null and (v_dev.revoked_at is not null or v_dev.lost_status in ('pending', 'confirmed')) then
    return false;
  end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_lock.user_id is null then
    return true; -- Not locked: an unbound session still works (nobody breaks on rollout day).
  end if;
  if v_dev.id is null then return false; end if;
  if v_lock.locked_rank = 1 then return v_dev.rank = 1; end if;
  return v_dev.rank in (1, 2);
end $function$;

-- ============================================================ blocked sessions see nothing (S12)
drop policy if exists avora_session_allowed on public.feedback;
create policy avora_session_allowed on public.feedback as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
drop policy if exists avora_session_allowed on public.invite_code;
create policy avora_session_allowed on public.invite_code as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));

-- Advisors: the uid is read once per statement; the code column is indexed for its foreign key.
create index if not exists profiles_invite_code on public.profiles (invite_code) where invite_code is not null;
drop policy if exists invite_code_ops_read on public.invite_code;
create policy invite_code_ops_read on public.invite_code for select to authenticated using ((select private.is_ops((select auth.uid()))));
drop policy if exists feedback_read_own_or_ops on public.feedback;
create policy feedback_read_own_or_ops on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ops((select auth.uid()))));
