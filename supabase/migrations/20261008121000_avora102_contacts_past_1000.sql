-- AVORA-102 · B — Danh bạ past 1 000.
-- PostgREST answers at most 1 000 rows per request; the app now pages its reads (fetchAllRows).
-- Here: matching an import against the WHOLE address book on the server, writing an import in
-- batches, finding contacts that are probably the same person, merging them (with undo) and
-- clearing review flags in batches. Nothing here merges on its own.

-- ------------------------------------------------------------------ helpers

-- Every reachable value of one owner's contacts: the contact's own phone / email + extra channels.
create or replace function private.contact_values(p_owner uuid)
returns table (contact_id uuid, kind text, value_normalized text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, 'phone', private.normalize_channel('phone', c.phone), c.created_at
    from public.contact c where c.owner_user_id = p_owner and nullif(btrim(coalesce(c.phone, '')), '') is not null
  union all
  select c.id, 'email', private.normalize_channel('email', c.email), c.created_at
    from public.contact c where c.owner_user_id = p_owner and nullif(btrim(coalesce(c.email, '')), '') is not null
  union all
  select ch.contact_id, ch.kind, ch.value_normalized, c.created_at
    from public.contact_channel ch join public.contact c on c.id = ch.contact_id
   where ch.owner_user_id = p_owner and c.owner_user_id = p_owner
$$;
revoke all on function private.contact_values(uuid) from public, anon, authenticated;

create index if not exists contact_owner_phone_norm on public.contact (owner_user_id, (private.normalize_channel('phone', phone))) where phone is not null;
create index if not exists contact_owner_email_norm on public.contact (owner_user_id, (private.normalize_channel('email', email))) where email is not null;

-- ------------------------------------------------------------------ B1.2 · match on the server

/**
 * Which of these phones / emails already belong to one of my contacts. At most 500 values per
 * call (the app batches). Returns one row per matched value — the oldest contact holding it.
 */
create or replace function public.contact_match_channels(p_phones text[], p_emails text[])
returns table (kind text, value_normalized text, contact_id uuid, contact_name text, contact_type text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_phones, 1), 0) + coalesce(array_length(p_emails, 1), 0) > 1000 then
    raise exception 'avora_contact_match_too_many';
  end if;
  return query
  with wanted as (
    select distinct 'phone'::text k, private.normalize_channel('phone', v) n from unnest(coalesce(p_phones, '{}')) v
    union
    select distinct 'email', private.normalize_channel('email', v) from unnest(coalesce(p_emails, '{}')) v
  ), cand as (
    select w.k, w.n, c.id contact_id, c.created_at from wanted w join public.contact c
      on c.owner_user_id = v_uid and w.k = 'phone' and c.phone is not null and private.normalize_channel('phone', c.phone) = w.n
    union all
    select w.k, w.n, c.id, c.created_at from wanted w join public.contact c
      on c.owner_user_id = v_uid and w.k = 'email' and c.email is not null and private.normalize_channel('email', c.email) = w.n
    union all
    select w.k, w.n, ch.contact_id, c.created_at from wanted w
      join public.contact_channel ch on ch.owner_user_id = v_uid and ch.kind = w.k and ch.value_normalized = w.n
      join public.contact c on c.id = ch.contact_id
  ), hits as (
    select distinct on (cand.k, cand.n) cand.k, cand.n, cand.contact_id from cand where cand.n <> ''
     order by cand.k, cand.n, cand.created_at, cand.contact_id
  )
  select h.k, h.n, c.id, c.name, c.contact_type from hits h join public.contact c on c.id = h.contact_id;
end $$;

-- The oldest of my contacts holding any of these normalized values — every branch hits an index.
create or replace function private.contact_holding(p_owner uuid, p_phones text[], p_emails text[])
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from (
    select c.id, c.created_at from public.contact c
     where c.owner_user_id = p_owner and c.phone is not null and private.normalize_channel('phone', c.phone) = any (p_phones)
    union all
    select c.id, c.created_at from public.contact c
     where c.owner_user_id = p_owner and c.email is not null and private.normalize_channel('email', c.email) = any (p_emails)
    union all
    select c.id, c.created_at from public.contact_channel ch join public.contact c on c.id = ch.contact_id
     where ch.owner_user_id = p_owner and ((ch.kind = 'phone' and ch.value_normalized = any (p_phones)) or (ch.kind = 'email' and ch.value_normalized = any (p_emails)))
  ) s order by created_at, id limit 1
$$;
revoke all on function private.contact_holding(uuid, text[], text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ B1.2 · write in batches

/**
 * Creates up to 500 contacts in one call. Each row: {type, name, phone, email, note, date_of_birth,
 * relationship_tag, tax_code, business_address, representative_name, representative_phone,
 * representative_email, industry, source, channels:[{kind,value,label,needs_review}]}.
 * A row whose phone / email already belongs to one of my contacts is NOT created (`exists`) —
 * re-importing the same file adds nobody. Per row: {i, status: created|exists|failed, id, error, channels}.
 */
create or replace function public.create_contacts_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_row jsonb; v_i int := -1; v_out jsonb := '[]'::jsonb;
  v_contact public.contact%rowtype; v_existing uuid; v_ch jsonb; v_added int; v_src text; v_saved public.contact_channel%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'avora_contact_bulk_shape'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'avora_contact_bulk_too_many'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_src := coalesce(v_row ->> 'source', 'import_csv');
    if v_src not in ('manual', 'import_csv', 'import_device', 'import_vcf') then v_src := 'import_csv'; end if;
    -- Already in the address book (any phone / email of the row): nothing new. Indexed lookups only.
    v_existing := private.contact_holding(v_uid,
      array(select private.normalize_channel('phone', x) from (select v_row ->> 'phone' x union all select c ->> 'value' from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) c where c ->> 'kind' = 'phone') s where nullif(btrim(coalesce(x, '')), '') is not null),
      array(select private.normalize_channel('email', x) from (select v_row ->> 'email' x union all select c ->> 'value' from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) c where c ->> 'kind' = 'email') s where nullif(btrim(coalesce(x, '')), '') is not null));
    if v_existing is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'exists', 'id', v_existing));
      continue;
    end if;
    begin
      v_contact := public.create_contact(
        coalesce(v_row ->> 'type', 'individual'), v_row ->> 'name', v_row ->> 'phone', v_row ->> 'email', v_row ->> 'note',
        nullif(v_row ->> 'date_of_birth', '')::date, v_row ->> 'relationship_tag', v_row ->> 'tax_code', v_row ->> 'business_address',
        v_row ->> 'representative_name', v_row ->> 'representative_phone', v_row ->> 'representative_email', v_row ->> 'industry');
      v_added := 0;
      for v_ch in select * from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) loop
        begin
          v_saved := public.add_contact_channel(v_contact.id, v_ch ->> 'kind', v_ch ->> 'value', v_src, v_ch ->> 'label', coalesce((v_ch ->> 'needs_review')::boolean, false));
          if v_saved.id is not null then v_added := v_added + 1; end if;
        exception when others then null; -- a spare number never undoes a good contact
        end;
      end loop;
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'created', 'id', v_contact.id, 'channels', v_added));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'failed', 'error', left(sqlerrm, 200)));
    end;
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------------ B1.3 · probably the same person

create table if not exists private.contact_not_duplicate (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  contact_a uuid not null,
  contact_b uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, contact_a, contact_b),
  check (contact_a < contact_b)
);

create table if not exists private.contact_merge_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  keep_id uuid not null,
  dropped jsonb not null,
  moved jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table private.contact_not_duplicate enable row level security;
alter table private.contact_merge_log enable row level security;

/** Pairs of my contacts sharing a normalized phone or email, older first. Not merged on their own. */
create or replace function public.contact_duplicate_pairs()
returns table (keep_id uuid, keep_name text, drop_id uuid, drop_name text, kind text, value_normalized text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return query
  with v as (select cv.contact_id, cv.kind, cv.value_normalized vn, cv.created_at from private.contact_values(v_uid) cv where cv.value_normalized <> ''),
  pairs as (
    select distinct on (least(a.contact_id, b.contact_id), greatest(a.contact_id, b.contact_id))
      case when a.created_at <= b.created_at then a.contact_id else b.contact_id end k,
      case when a.created_at <= b.created_at then b.contact_id else a.contact_id end d,
      a.kind ck_kind, a.vn
    from v a join v b on a.kind = b.kind and a.vn = b.vn and a.contact_id < b.contact_id
    order by least(a.contact_id, b.contact_id), greatest(a.contact_id, b.contact_id), a.kind desc
  )
  select p.k, ck.name, p.d, cd.name, p.ck_kind, p.vn
    from pairs p
    join public.contact ck on ck.id = p.k
    join public.contact cd on cd.id = p.d
   where ck.contact_type = cd.contact_type
     and not exists (select 1 from private.contact_not_duplicate n
                      where n.owner_user_id = v_uid and n.contact_a = least(p.k, p.d) and n.contact_b = greatest(p.k, p.d))
   order by ck.name, cd.name;
end $$;

create or replace function public.dismiss_contact_duplicate(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if (select count(*) from public.contact where id in (p_a, p_b) and owner_user_id = v_uid) <> 2 then raise exception 'avora_contact_not_found'; end if;
  insert into private.contact_not_duplicate (owner_user_id, contact_a, contact_b) values (v_uid, least(p_a, p_b), greatest(p_a, p_b))
  on conflict do nothing;
end $$;

/**
 * Merges `p_drop` into `p_keep` (both mine, same type): the dropped contact's phone / email /
 * extra channels become channels of the kept one; its opportunities (and their tasks, which hang
 * on the opportunity), transactions, invites and staff move over; empty fields of the kept one are
 * filled. The dropped row is kept in a log so `undo_contact_merge` puts everything back.
 */
create or replace function public.merge_contacts(p_keep uuid, p_drop uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_keep public.contact%rowtype; v_drop public.contact%rowtype; v_log uuid;
  v_channels uuid[]; v_added uuid[] := '{}'; v_opps uuid[]; v_tx uuid[]; v_inv uuid[]; v_staff uuid[]; v_ch public.contact_channel%rowtype;
  v_filled jsonb := '{}'::jsonb;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_keep = p_drop then raise exception 'avora_contact_merge_same'; end if;
  select * into v_keep from public.contact where id = p_keep and owner_user_id = v_uid for update;
  select * into v_drop from public.contact where id = p_drop and owner_user_id = v_uid for update;
  if v_keep.id is null or v_drop.id is null then raise exception 'avora_contact_not_found'; end if;
  if v_keep.contact_type <> v_drop.contact_type then raise exception 'avora_contact_merge_type'; end if;

  -- Channels of the dropped contact move (or, when the kept one already has the value, stay behind
  -- and are restored on undo with the row).
  select coalesce(array_agg(id), '{}') into v_channels from public.contact_channel ch
   where ch.contact_id = p_drop
     and not exists (select 1 from public.contact_channel k where k.contact_id = p_keep and k.kind = ch.kind and k.value_normalized = ch.value_normalized)
     and not (ch.kind = 'phone' and ch.value_normalized = private.normalize_channel('phone', v_keep.phone))
     and not (ch.kind = 'email' and ch.value_normalized = private.normalize_channel('email', v_keep.email));
  update public.contact_channel set contact_id = p_keep where id = any (v_channels);
  if nullif(btrim(coalesce(v_drop.phone, '')), '') is not null then
    if nullif(btrim(coalesce(v_keep.phone, '')), '') is null then
      update public.contact set phone = v_drop.phone where id = p_keep; v_filled := v_filled || jsonb_build_object('phone', true);
    else
      v_ch := public.add_contact_channel(p_keep, 'phone', v_drop.phone, 'manual', null, false);
      if v_ch.id is not null and v_ch.created_at > now() - interval '1 second' then v_added := v_added || v_ch.id; end if;
    end if;
  end if;
  if nullif(btrim(coalesce(v_drop.email, '')), '') is not null then
    if nullif(btrim(coalesce(v_keep.email, '')), '') is null then
      update public.contact set email = v_drop.email where id = p_keep; v_filled := v_filled || jsonb_build_object('email', true);
    else
      v_ch := public.add_contact_channel(p_keep, 'email', v_drop.email, 'manual', null, false);
      if v_ch.id is not null and v_ch.created_at > now() - interval '1 second' then v_added := v_added || v_ch.id; end if;
    end if;
  end if;
  if v_keep.note is null and v_drop.note is not null then update public.contact set note = v_drop.note where id = p_keep; v_filled := v_filled || jsonb_build_object('note', true); end if;
  if v_keep.date_of_birth is null and v_drop.date_of_birth is not null then update public.contact set date_of_birth = v_drop.date_of_birth where id = p_keep; v_filled := v_filled || jsonb_build_object('date_of_birth', true); end if;

  select coalesce(array_agg(id), '{}') into v_opps from public.crm_opportunity where contact_id = p_drop;
  update public.crm_opportunity set contact_id = p_keep where id = any (v_opps);
  select coalesce(array_agg(id), '{}') into v_tx from public.transactions where contact_id = p_drop;
  update public.transactions set contact_id = p_keep where id = any (v_tx);
  select coalesce(array_agg(id), '{}') into v_inv from public.contact_invite where contact_id = p_drop;
  update public.contact_invite set contact_id = p_keep where id = any (v_inv);
  select coalesce(array_agg(id), '{}') into v_staff from public.contact where employer_contact_id = p_drop;
  update public.contact set employer_contact_id = p_keep where id = any (v_staff);

  insert into private.contact_merge_log (owner_user_id, keep_id, dropped, moved)
  values (v_uid, p_keep, to_jsonb(v_drop), jsonb_build_object('channels', v_channels, 'added', v_added, 'opportunities', v_opps,
          'transactions', v_tx, 'invites', v_inv, 'staff', v_staff, 'filled', v_filled))
  returning id into v_log;
  delete from public.contact where id = p_drop;
  return v_log;
end $$;

create or replace function public.undo_contact_merge(p_merge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_log private.contact_merge_log%rowtype; v_drop public.contact%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_log from private.contact_merge_log where id = p_merge_id and owner_user_id = v_uid and undone_at is null for update;
  if v_log.id is null then raise exception 'avora_contact_merge_gone'; end if;
  v_drop := jsonb_populate_record(null::public.contact, v_log.dropped);
  insert into public.contact select v_drop.*;
  update public.contact_channel set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'channels') x) and owner_user_id = v_uid;
  delete from public.contact_channel where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'added') x) and owner_user_id = v_uid;
  update public.crm_opportunity set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'opportunities') x);
  update public.transactions set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'transactions') x) and user_id = v_uid;
  update public.contact_invite set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'invites') x);
  update public.contact set employer_contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'staff') x) and owner_user_id = v_uid;
  if (v_log.moved -> 'filled') ? 'phone' then update public.contact set phone = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'email' then update public.contact set email = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'note' then update public.contact set note = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'date_of_birth' then update public.contact set date_of_birth = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  update private.contact_merge_log set undone_at = now() where id = v_log.id;
  return v_drop.id;
end $$;

-- ------------------------------------------------------------------ B1.4 · Giữ tất cả in batches

/** Clears up to 500 review flags and returns their ids; the app calls until it gets none. */
create or replace function public.clear_channel_review_batch(p_limit int default 500)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_ids uuid[];
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.contact_channel where owner_user_id = v_uid and needs_review
     order by id limit least(greatest(coalesce(p_limit, 500), 1), 500) for update
  ) s;
  update public.contact_channel set needs_review = false where id = any (v_ids);
  return v_ids;
end $$;

-- rename_contacts_bulk: the app now sends ≤ 500 per call; harden search_path while here.
alter function public.rename_contacts_bulk(jsonb) set search_path = public, pg_temp;

-- ------------------------------------------------------------------ grants
revoke all on function public.contact_match_channels(text[], text[]) from public, anon;
revoke all on function public.create_contacts_bulk(jsonb) from public, anon;
revoke all on function public.contact_duplicate_pairs() from public, anon;
revoke all on function public.dismiss_contact_duplicate(uuid, uuid) from public, anon;
revoke all on function public.merge_contacts(uuid, uuid) from public, anon;
revoke all on function public.undo_contact_merge(uuid) from public, anon;
revoke all on function public.clear_channel_review_batch(int) from public, anon;
grant execute on function public.contact_match_channels(text[], text[]) to authenticated;
grant execute on function public.create_contacts_bulk(jsonb) to authenticated;
grant execute on function public.contact_duplicate_pairs() to authenticated;
grant execute on function public.dismiss_contact_duplicate(uuid, uuid) to authenticated;
grant execute on function public.merge_contacts(uuid, uuid) to authenticated;
grant execute on function public.undo_contact_merge(uuid) to authenticated;
grant execute on function public.clear_channel_review_batch(int) to authenticated;

-- Advisors: cover the FK; the two private tables are reached only through the RPCs above.
create index if not exists contact_merge_log_owner_idx on private.contact_merge_log (owner_user_id, created_at desc);
drop policy if exists contact_merge_log_none on private.contact_merge_log;
create policy contact_merge_log_none on private.contact_merge_log for all to authenticated using (false);
drop policy if exists contact_not_duplicate_none on private.contact_not_duplicate;
create policy contact_not_duplicate_none on private.contact_not_duplicate for all to authenticated using (false);
