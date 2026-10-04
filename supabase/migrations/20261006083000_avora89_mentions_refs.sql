-- AVORA-89 · PHẦN 1 (AVORA-81 · PHẦN 3 · 3.E–3.G) — `@` / `#` / `@@` only inside the context you stand in.
-- Context = 'journal' | 'conversation:<uuid>' | 'project:<uuid>' (a project talks in its conversation).
-- Every suggestion is filtered on the server; every save is checked again (direct API included).
set search_path = '';

-- ---------------------------------------------------------------- columns
alter table public.messages add column if not exists refs jsonb;
alter table public.messages add column if not exists contact_card_user_id uuid references auth.users(id) on delete set null;
alter table public.messages drop constraint if exists messages_refs_shape;
alter table public.messages add constraint messages_refs_shape check (
  refs is null or (jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) <= 20));
-- A contact card is a real message with no text of its own.
alter table public.messages drop constraint if exists messages_content_not_blank;
alter table public.messages add constraint messages_content_not_blank check (
  btrim(content) <> '' or deleted_at is not null or attachment_count > 0 or contact_card_user_id is not null);

-- ---------------------------------------------------------------- context helpers
-- The conversation a context speaks in, if the caller belongs to it. Journal → the caller's own personal conversation.
create or replace function private.context_conversation(p_context text, p_user uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_user is null or p_context is null then return null; end if;
  if p_context = 'journal' then
    select c.id into v_id from public.conversations c
      join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = p_user
      where c.type = 'personal' and c.deleted_at is null limit 1;
    return v_id;
  end if;
  if p_context ~ '^conversation:[0-9a-f-]{36}$' then
    v_id := substr(p_context, 14)::uuid;
  elsif p_context ~ '^project:[0-9a-f-]{36}$' then
    select pr.conversation_id into v_id from public.projects pr where pr.id = substr(p_context, 9)::uuid and pr.deleted_at is null;
  else
    return null;
  end if;
  if v_id is null or not private.is_conversation_participant(v_id, p_user) then return null; end if;
  return v_id;
end $$;

-- Is this ref inside the conversation `p_conv` (as seen by `p_user`)?
create or replace function private.ref_in_conversation(p_conv uuid, p_user uuid, p_type text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_type text;
begin
  select c.type into v_type from public.conversations c where c.id = p_conv;
  if v_type is null then return false; end if;
  if p_type = 'file' then
    return exists (select 1 from public.message_attachments a join public.messages m on m.id = a.message_id
                   where a.id = p_id and a.conversation_id = p_conv and m.deleted_at is null and m.trashed_at is null);
  elsif p_type in ('record', 'board') then
    return exists (
      select 1 from public.think_hub_table t
      left join public.think_hub_record r on p_type = 'record' and r.id = p_id and r.table_id = t.id and r.deleted_at is null
      left join public.projects pr on pr.id = t.project_id
      where t.deleted_at is null
        and (case when p_type = 'board' then t.id = p_id else r.id is not null end)
        and (case
               when v_type = 'personal' then t.owner_user_id = p_user and t.conversation_id is null and t.project_id is null
               else t.conversation_id = p_conv or pr.conversation_id = p_conv
             end));
  elsif p_type = 'note' then
    return v_type = 'personal' and exists (select 1 from public.notes n where n.id = p_id and n.owner_user_id = p_user and n.deleted_at is null);
  elsif p_type = 'contact' then
    return v_type = 'personal' and exists (select 1 from public.contact ct where ct.id = p_id and ct.owner_user_id = p_user);
  end if;
  return false;
end $$;

-- Can `p_sender` introduce `p_person` inside conversation `p_conv`? Friends, has a PIN, not blocked, not already there.
create or replace function private.contact_card_allowed(p_conv uuid, p_sender uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conv is not null and p_person is not null and p_sender <> p_person
    and exists (select 1 from public.conversations c where c.id = p_conv and c.type in ('direct', 'group') and c.deleted_at is null)
    and private.is_conversation_participant(p_conv, p_sender)
    and not private.is_conversation_participant(p_conv, p_person)
    and private.are_connected(p_sender, p_person)
    and exists (select 1 from public.user_pins up where up.user_id = p_person)
    and not private.is_blocked_between(p_sender, p_person)
    and not exists (select 1 from public.conversation_participants cp
                    where cp.conversation_id = p_conv and cp.user_id <> p_sender and private.is_blocked_between(cp.user_id, p_person));
$$;

-- ---------------------------------------------------------------- the save-time gate (every insert, API included)
create or replace function private.enforce_message_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_ref jsonb; v_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.refs is distinct from old.refs or new.contact_card_user_id is distinct from old.contact_card_user_id then
      raise exception 'avora_ref_out_of_scope';
    end if;
    return new;
  end if;
  select c.type into v_type from public.conversations c where c.id = new.conversation_id;
  -- 1-1: the other person is already here; nobody to name. Journal: `@` links a contact, never notifies.
  if v_type in ('direct', 'personal') and coalesce(array_length(new.mentioned_user_ids, 1), 0) > 0 then
    raise exception 'avora_ref_out_of_scope';
  end if;
  if new.refs is not null then
    for v_ref in select * from jsonb_array_elements(new.refs) loop
      begin
        v_id := (v_ref ->> 'id')::uuid;
      exception when others then raise exception 'avora_ref_out_of_scope';
      end;
      if not private.ref_in_conversation(new.conversation_id, new.sender_id, v_ref ->> 'type', v_id) then
        raise exception 'avora_ref_out_of_scope';
      end if;
    end loop;
  end if;
  if new.contact_card_user_id is not null and not private.contact_card_allowed(new.conversation_id, new.sender_id, new.contact_card_user_id) then
    raise exception 'avora_contact_card_not_allowed';
  end if;
  return new;
end $$;
drop trigger if exists messages_enforce_refs on public.messages;
create trigger messages_enforce_refs before insert or update on public.messages
  for each row execute function private.enforce_message_refs();

-- ---------------------------------------------------------------- suggestions (read only, context-checked)
create or replace function public.suggest_mentions(p_context text, p_query text default '')
returns table (kind text, id uuid, label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null then raise exception 'avora_context_not_allowed'; end if;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  if v_type = 'direct' then return; end if;
  if v_type = 'personal' then
    return query select 'contact'::text, ct.id, ct.name from public.contact ct
      where ct.owner_user_id = v_user and (v_q = '' or lower(ct.name) like '%' || v_q || '%')
      order by ct.updated_at desc limit 20;
    return;
  end if;
  return query select 'user'::text, cp.user_id, coalesce(p.display_name, 'Thành viên')
    from public.conversation_participants cp left join public.profiles p on p.id = cp.user_id
    where cp.conversation_id = v_conv and cp.user_id <> v_user and not private.is_blocked_between(v_user, cp.user_id)
      and (v_q = '' or lower(coalesce(p.display_name, '')) like '%' || v_q || '%')
    order by p.display_name limit 20;
end $$;

create or replace function public.suggest_refs(p_context text, p_kind text default 'all', p_query text default '')
returns table (kind text, id uuid, label text, detail text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null then raise exception 'avora_context_not_allowed'; end if;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  return query
  select * from (
    select 'file'::text as kind, a.id, a.file_name as label, a.kind as detail, a.created_at as at
      from public.message_attachments a join public.messages m on m.id = a.message_id
      where p_kind in ('all', 'file') and a.conversation_id = v_conv and m.deleted_at is null and m.trashed_at is null
        and (v_q = '' or lower(a.file_name) like '%' || v_q || '%')
    union all
    select 'record', r.id, r.title, t.name, r.updated_at
      from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
      left join public.projects pr on pr.id = t.project_id
      where p_kind in ('all', 'record') and r.deleted_at is null and t.deleted_at is null
        and (case when v_type = 'personal' then t.owner_user_id = v_user and t.conversation_id is null and t.project_id is null
                  else t.conversation_id = v_conv or pr.conversation_id = v_conv end)
        and (v_q = '' or lower(r.title) like '%' || v_q || '%')
    union all
    select 'note', n.id, coalesce(nullif(n.title, ''), 'Ghi chép'), null, n.updated_at
      from public.notes n
      where p_kind in ('all', 'note') and v_type = 'personal' and n.owner_user_id = v_user and n.deleted_at is null
        and (v_q = '' or lower(coalesce(n.title, '')) like '%' || v_q || '%')
  ) s order by s.at desc limit 20;
end $$;

-- `@@`: my friends with a PIN who are not in this conversation. Friends without a PIN come back greyed (has_pin false).
create or replace function public.suggest_contact_cards(p_context text, p_query text default '')
returns table (user_id uuid, name text, pin text, has_pin boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_conv uuid; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null or p_context = 'journal' then raise exception 'avora_context_not_allowed'; end if;
  return query
  select f.other, coalesce(p.display_name, 'Người dùng Avora'), up.pin, up.pin is not null
  from (select case when uc.user_low = v_user then uc.user_high else uc.user_low end as other
        from public.user_connections uc where uc.status = 'active' and (uc.user_low = v_user or uc.user_high = v_user)) f
  left join public.profiles p on p.id = f.other
  left join public.user_pins up on up.user_id = f.other
  where not private.is_conversation_participant(v_conv, f.other)
    and not private.is_blocked_between(v_user, f.other)
    and (v_q = '' or lower(coalesce(p.display_name, '')) like '%' || v_q || '%')
  order by (up.pin is null), p.display_name limit 20;
end $$;

-- ---------------------------------------------------------------- `@@` · send a card, tell the person introduced
create table if not exists public.contact_card_notice (
  id uuid primary key default gen_random_uuid(),
  introduced_user_id uuid not null references auth.users(id) on delete cascade,
  introducer_id uuid not null references auth.users(id) on delete cascade,
  -- Who it was for: the other person's own display name (1-1) or the group's name. No ids of the room.
  audience_label text not null check (char_length(audience_label) between 1 and 120),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists contact_card_notice_user_idx on public.contact_card_notice (introduced_user_id, created_at desc);
alter table public.contact_card_notice enable row level security;
drop policy if exists contact_card_notice_own on public.contact_card_notice;
drop policy if exists avora_session_allowed on public.contact_card_notice;
create policy contact_card_notice_own on public.contact_card_notice for select to authenticated using (introduced_user_id = (select auth.uid()));
create policy avora_session_allowed on public.contact_card_notice as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.contact_card_notice from public, anon, authenticated;
grant select on public.contact_card_notice to authenticated;

create or replace function public.share_contact_card(p_context text, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_msg uuid; v_label text;
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null or not private.contact_card_allowed(v_conv, v_user, p_user_id) then
    raise exception 'avora_contact_card_not_allowed';
  end if;
  insert into public.messages (conversation_id, sender_id, content, contact_card_user_id)
  values (v_conv, v_user, '', p_user_id) returning id into v_msg;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  if v_type = 'direct' then
    select coalesce(p.display_name, 'một người') into v_label from public.conversation_participants cp
      left join public.profiles p on p.id = cp.user_id where cp.conversation_id = v_conv and cp.user_id <> v_user limit 1;
  else
    select coalesce(g.name, 'một nhóm') into v_label from public.conversation_groups g where g.conversation_id = v_conv;
  end if;
  insert into public.contact_card_notice (introduced_user_id, introducer_id, audience_label)
  values (p_user_id, v_user, left(coalesce(v_label, 'một người'), 120));
  return v_msg;
end $$;

-- Read at view time: name the person chose · PIN · avatar. Nothing else (no phone, email, note).
create or replace function public.contact_card_view(p_message_id uuid)
returns table (user_id uuid, name text, pin text, avatar_url text, is_friend boolean, is_self boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_conv uuid; v_person uuid;
begin
  perform private.assert_session_allowed();
  select m.conversation_id, m.contact_card_user_id into v_conv, v_person from public.messages m
    where m.id = p_message_id and m.deleted_at is null;
  if v_conv is null or v_person is null or not private.is_conversation_participant(v_conv, v_user) then return; end if;
  return query select v_person, p.display_name, up.pin, p.avatar_url, private.are_connected(v_user, v_person), v_person = v_user
    from public.profiles p join public.user_pins up on up.user_id = p.id where p.id = v_person;
end $$;

create or replace function public.mark_contact_card_notices_seen()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  update public.contact_card_notice set seen_at = now() where introduced_user_id = auth.uid() and seen_at is null;
end $$;

-- `#` chips: the label only while the viewer may still see it; otherwise null → `Không còn xem được`.
create or replace function public.resolve_message_refs(p_message_id uuid)
returns table (kind text, id uuid, label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_msg public.messages; v_ref jsonb; v_id uuid; v_kind text; v_label text;
begin
  perform private.assert_session_allowed();
  select * into v_msg from public.messages m where m.id = p_message_id;
  if v_msg.id is null or not private.is_conversation_participant(v_msg.conversation_id, v_user) or v_msg.refs is null then return; end if;
  for v_ref in select * from jsonb_array_elements(v_msg.refs) loop
    v_kind := v_ref ->> 'type';
    v_id := (v_ref ->> 'id')::uuid;
    v_label := null;
    -- Journal refs belong to the sender only; elsewhere they must still sit in this conversation.
    if private.ref_in_conversation(v_msg.conversation_id, case when v_kind in ('note', 'contact') or
         (select c.type from public.conversations c where c.id = v_msg.conversation_id) = 'personal' then v_user else v_msg.sender_id end, v_kind, v_id) then
      v_label := case v_kind
        when 'file' then (select a.file_name from public.message_attachments a where a.id = v_id)
        when 'record' then (select r.title from public.think_hub_record r where r.id = v_id)
        when 'board' then (select t.name from public.think_hub_table t where t.id = v_id)
        when 'note' then (select coalesce(nullif(n.title, ''), 'Ghi chép') from public.notes n where n.id = v_id)
        when 'contact' then (select ct.name from public.contact ct where ct.id = v_id)
      end;
    end if;
    kind := v_kind; id := v_id; label := v_label;
    return next;
  end loop;
end $$;

revoke all on function private.context_conversation(text, uuid) from public, anon, authenticated;
revoke all on function private.ref_in_conversation(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.contact_card_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.enforce_message_refs() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['suggest_mentions(text, text)', 'suggest_refs(text, text, text)', 'suggest_contact_cards(text, text)',
    'share_contact_card(text, uuid)', 'contact_card_view(uuid)', 'mark_contact_card_notices_seen()', 'resolve_message_refs(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- `#` chips travel with a normal message; a contact card only through share_contact_card (no direct column grant).
grant insert (refs) on public.messages to authenticated;
