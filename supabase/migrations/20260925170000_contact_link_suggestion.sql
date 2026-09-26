-- AVORA 32 / Nhóm D — suggest linking a Contact to the AVORA account it already belongs to.
--
-- Matching happens on the server only, on normalised values (email lower-cased; phone reduced to local digits,
-- +84/84 → 0, the same rule as contact_channel). The owner is told only THAT a match exists and on which field —
-- never who the account is — until they confirm. Confirming re-runs the match on the server and writes
-- contact.linked_user_id; the client never supplies a user id. Nothing is merged automatically.
-- "Bỏ qua" stores a hash of the dismissed match on the contact, so the same suggestion does not come back, while a
-- different account matching later (the contact's details changed) is still offered.

alter table public.contact add column if not exists link_suggestion_dismissed text;

create or replace function private.normalize_phone (p_raw text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select nullif(regexp_replace(
    regexp_replace(regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g'), '^\+?84', '0'),
    '[^0-9]', '', 'g'), '')
$$;

revoke execute on function private.normalize_phone (text) from public, anon;
grant execute on function private.normalize_phone (text) to authenticated;

/**
 * The single AVORA account a contact matches, or nothing. Ambiguous (two different accounts), the owner's own
 * account, or an account the owner already linked to another contact → no suggestion.
 */
create or replace function private.contact_link_match (p_contact_id uuid, p_owner uuid)
  returns table (user_id uuid, matched_by text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with target as (
    select c.* from public.contact c
    where c.id = p_contact_id and c.owner_user_id = p_owner
      and c.contact_type = 'individual' and c.linked_user_id is null
  ),
  emails as (
    select nullif(lower(btrim(t.email)), '') v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'email'
  ),
  phones as (
    select private.normalize_phone (t.phone) v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'phone'
  ),
  hits as (
    select u.id uid, 'email'::text how from auth.users u
    where u.deleted_at is null and lower(u.email) in (select v from emails where v is not null)
    union all
    select u.id, 'phone' from auth.users u
    where u.deleted_at is null and coalesce(u.phone, '') <> ''
      and private.normalize_phone (u.phone) in (select v from phones where v is not null)
  ),
  eligible as (
    select h.* from hits h
    where h.uid <> p_owner
      and not exists (
        select 1 from public.contact c
        where c.owner_user_id = p_owner and c.linked_user_id = h.uid and c.id <> p_contact_id
      )
  )
  select e.uid,
    case when count(distinct e.how) > 1 then 'email_phone' else min(e.how) end
  from eligible e
  where (select count(distinct uid) from eligible) = 1
  group by e.uid
$$;

revoke execute on function private.contact_link_match (uuid, uuid) from public, anon, authenticated;

create or replace function private.contact_link_fingerprint (p_contact_id uuid, p_user uuid)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select encode(extensions.digest(p_contact_id::text || ':' || p_user::text, 'sha256'), 'hex')
$$;

revoke execute on function private.contact_link_fingerprint (uuid, uuid) from public, anon, authenticated;

-- What the owner sees: whether a match exists and on which field. Never the account itself.
create or replace function public.preview_contact_link (p_contact_id uuid)
  returns text
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_dismissed text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then return null; end if;

  select link_suggestion_dismissed into v_dismissed from public.contact where id = p_contact_id;
  if v_dismissed = private.contact_link_fingerprint (p_contact_id, v_match.user_id) then
    return null;
  end if;

  return v_match.matched_by;
end;
$$;

revoke execute on function public.preview_contact_link (uuid) from public, anon;
grant execute on function public.preview_contact_link (uuid) to authenticated;

-- "Gộp": the match is found again here, never taken from the client.
create or replace function public.confirm_contact_link (p_contact_id uuid)
  returns public.contact
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_row public.contact%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then raise exception 'avora_contact_link_no_match'; end if;

  update public.contact
    set linked_user_id = v_match.user_id, link_suggestion_dismissed = null, updated_at = now()
    where id = p_contact_id and owner_user_id = v_uid and linked_user_id is null
    returning * into v_row;
  if not found then raise exception 'avora_contact_link_no_match'; end if;

  return v_row;
end;
$$;

revoke execute on function public.confirm_contact_link (uuid) from public, anon;
grant execute on function public.confirm_contact_link (uuid) to authenticated;

-- "Bỏ qua": this suggestion stays away; a different account matching later is still offered.
create or replace function public.dismiss_contact_link (p_contact_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_match record;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then return; end if;

  update public.contact
    set link_suggestion_dismissed = private.contact_link_fingerprint (p_contact_id, v_match.user_id)
    where id = p_contact_id and owner_user_id = v_uid;
end;
$$;

revoke execute on function public.dismiss_contact_link (uuid) from public, anon;
grant execute on function public.dismiss_contact_link (uuid) to authenticated;
