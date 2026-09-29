-- AVORA-44 · D — ADR-032: một công cụ tìm cho toàn AVORA.
--   · SECURITY INVOKER: each table's own RLS decides what comes back — nothing here widens access.
--   · Accent-free (public.f_unaccent) with trigram indexes.
--   · Két sắt / Tài chính (accounts, transactions, account_balance_history, categories, crm_opportunity)
--     are never read here and never indexed for it.

create index if not exists messages_search_trgm on public.messages
  using gin (public.f_unaccent(content) extensions.gin_trgm_ops)
  where deleted_at is null and trashed_at is null and system_kind is null;
create index if not exists message_attachments_name_trgm on public.message_attachments
  using gin (public.f_unaccent(file_name) extensions.gin_trgm_ops);
create index if not exists tasks_title_trgm on public.tasks
  using gin (public.f_unaccent(title || ' ' || coalesce(description, '')) extensions.gin_trgm_ops);
create index if not exists think_hub_record_trgm on public.think_hub_record
  using gin (public.f_unaccent(title || ' ' || coalesce(notes, '')) extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists think_hub_table_name_trgm on public.think_hub_table
  using gin (public.f_unaccent(name) extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists contact_name_trgm on public.contact using gin (public.f_unaccent(name) extensions.gin_trgm_ops);
create index if not exists conversation_groups_name_trgm on public.conversation_groups using gin (public.f_unaccent(name) extensions.gin_trgm_ops);

create or replace function public.search_avora(p_query text, p_here jsonb, p_types text[] default null, p_limit integer default 10)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  place_kind text,
  place_id uuid,
  place_name text,
  conversation_id uuid,
  at timestamptz,
  in_here boolean,
  scope text
)
language plpgsql stable security invoker set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_first text;
  v_like text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_tab text := coalesce(p_here->>'tab', '');
  v_here_conv uuid := nullif(p_here->>'conversation_id', '')::uuid;
  v_types text[] := coalesce(p_types, array['message', 'file', 'task', 'note', 'record', 'table', 'contact', 'conversation']);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := left(v_q, 120);
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(public.f_unaccent(v_q), '\s+')) w where w <> '';
  if v_words is null then return; end if;
  select w into v_first from unnest(v_words) w order by char_length(w) desc limit 1;
  v_like := '%' || replace(replace(replace(v_first, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- messages (not recalled, not in the journal bin, not system lines)
  if 'message' = any (v_types) then
    return query
    select 'message'::text, m.id, null::text, left(m.content, 240), c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, m.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct'
                when exists (select 1 from projects p where p.conversation_id = c.id) then 'project' else 'group' end
    from messages m
    join conversations c on c.id = m.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where m.deleted_at is null and m.trashed_at is null and m.system_kind is null
      and public.f_unaccent(m.content) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(m.content) not like '%' || w || '%')
    order by m.created_at desc
    limit v_limit * 3;
  end if;

  if 'file' = any (v_types) then
    return query
    select 'file'::text, a.message_id, a.file_name, null::text, c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, a.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from message_attachments a
    join messages m on m.id = a.message_id and m.deleted_at is null and m.trashed_at is null
    join conversations c on c.id = a.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where public.f_unaccent(a.file_name) like v_like
    order by a.created_at desc
    limit v_limit * 2;
  end if;

  if 'task' = any (v_types) then
    return query
    select 'task'::text, t.id, t.title, left(coalesce(t.description, ''), 200),
           case when t.conversation_id is null then 'personal' else coalesce(c.type, 'personal') end,
           t.conversation_id, coalesce(g.name, case when t.conversation_id is null then 'Của tôi' when c.type = 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           t.conversation_id, t.updated_at,
           v_tab = 'nhiem-vu' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = t.conversation_id),
           case when t.type = 'personal' then 'personal' when t.type = '1-1-shared' then 'direct' else 'group' end
    from tasks t
    left join conversations c on c.id = t.conversation_id
    left join conversation_groups g on g.conversation_id = t.conversation_id
    where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) not like '%' || w || '%')
      and not (t.creator_id = v_uid and t.deleted_by_creator) and not (t.creator_id <> v_uid and t.deleted_by_peer)
    order by t.updated_at desc
    limit v_limit * 2;
  end if;

  if 'note' = any (v_types) then
    return query
    select 'note'::text, n.id, coalesce(nullif(btrim(n.title), ''), 'Ghi chép'), left(n.search_text, 200),
           'personal'::text, n.folder_id, coalesce(f.name, 'Chưa xếp'), null::uuid, n.updated_at,
           v_tab = 'nhat-ky', 'personal'::text
    from notes n
    left join note_folders f on f.id = n.folder_id
    where n.deleted_at is null and n.search_text like v_like
      and not exists (select 1 from unnest(v_words) w where n.search_text not like '%' || w || '%')
    order by n.updated_at desc
    limit v_limit * 2;
  end if;

  if 'record' = any (v_types) then
    return query
    select 'record'::text, r.id, r.title, left(coalesce(r.notes, ''), 200),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, r.updated_at,
           v_tab = 'ke-hoach' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = tb.conversation_id),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_record r
    join think_hub_table tb on tb.id = r.table_id and tb.deleted_at is null
    left join conversations c on c.id = tb.conversation_id
    where r.deleted_at is null
      and public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) not like '%' || w || '%')
    order by r.updated_at desc
    limit v_limit * 2;
  end if;

  if 'table' = any (v_types) then
    return query
    select 'table'::text, tb.id, tb.name, coalesce(tb.purpose, ''),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, tb.updated_at, v_tab = 'ke-hoach',
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_table tb
    left join conversations c on c.id = tb.conversation_id
    where tb.deleted_at is null and public.f_unaccent(tb.name) like v_like
    order by tb.updated_at desc
    limit v_limit;
  end if;

  if 'contact' = any (v_types) then
    return query
    select 'contact'::text, ct.id, ct.name, null::text, 'contact'::text, ct.id, 'Liên hệ', null::uuid, ct.updated_at,
           v_tab = 'ket-noi' and v_here_conv is null, 'personal'::text
    from contact ct
    where public.f_unaccent(ct.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(ct.name) not like '%' || w || '%')
    order by ct.name
    limit v_limit;
  end if;

  if 'conversation' = any (v_types) then
    return query
    select 'conversation'::text, g.conversation_id, g.name, null::text, 'group'::text, g.conversation_id, g.name, g.conversation_id, g.updated_at,
           v_tab = 'ket-noi', 'group'::text
    from conversation_groups g
    join conversations c on c.id = g.conversation_id and c.deleted_at is null
    where public.f_unaccent(g.name) like v_like
    order by g.updated_at desc
    limit v_limit;
  end if;
end $$;
revoke all on function public.search_avora(text, jsonb, text[], integer) from public, anon;
grant execute on function public.search_avora(text, jsonb, text[], integer) to authenticated;
