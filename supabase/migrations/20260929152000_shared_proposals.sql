-- Đợt gộp 2 · C9 / C10 · ADR-031 — Tài sản chung không xoá đơn phương.
-- A shared table (1-1 / Nhóm / Dự án, sub-tables included), a group, or a project is deleted,
-- archived or reopened only through a proposal that every stakeholder agrees to. One "Không đồng
-- ý" closes it as "Cần trao đổi". Silence is not consent: a reminder after 3 days, expiry after 14.
-- Every step leaves a system line in the conversation the thing belongs to.

-- ------------------------------------------------------------------ edit trail (who touched a Hạng mục)
alter table public.think_hub_record add column if not exists editor_ids uuid[] not null default '{}';
update public.think_hub_record set editor_ids = array[owner_user_id] where editor_ids = '{}';

create or replace function private.track_record_editor()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.editor_ids := array[new.owner_user_id];
  elsif v_uid is not null and not (v_uid = any(new.editor_ids)) then
    new.editor_ids := new.editor_ids || v_uid;
  end if;
  return new;
end $$;
drop trigger if exists trg_think_hub_record_editors on public.think_hub_record;
create trigger trg_think_hub_record_editors before insert or update on public.think_hub_record
  for each row execute function private.track_record_editor();

-- ------------------------------------------------------------------ provenance columns
alter table public.think_hub_table
  add column if not exists deleted_via uuid,
  add column if not exists orphan_origin text;
alter table public.projects add column if not exists deleted_via uuid;
alter table public.conversations add column if not exists deleted_via uuid;
grant select (orphan_origin) on public.think_hub_table to authenticated;

-- ------------------------------------------------------------------ system lines
alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (
  system_kind is null or system_kind in (
    'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected',
    'proposal_expired', 'proposal_withdrawn', 'shared_restored'));

create or replace function private.public_name(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(btrim(display_name), '') from profiles where id = p_user), 'Thành viên AVORA')
$$;

create or replace function private.post_system_line(p_conversation uuid, p_sender uuid, p_kind text, p_content text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform set_config('avora.project_system', 'on', true);
  insert into messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_sender, left(p_content, 4000), p_kind)
  returning id into v_id;
  perform set_config('avora.project_system', 'off', true);
  return v_id;
end $$;

-- Runs the rest of the transaction as this user (cron has no JWT; the RPCs below read auth.uid()).
create or replace function private.act_as(p_user uuid)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

revoke all on function private.public_name(uuid) from public, anon, authenticated;
revoke all on function private.post_system_line(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.act_as(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ proposals
create table if not exists public.shared_proposals (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('delete', 'archive', 'reopen')),
  target_type text not null check (target_type in ('think_hub_table', 'group', 'project')),
  target_id uuid not null,
  target_name text not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'withdrawn', 'expired')),
  message_id uuid references public.messages(id) on delete set null,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status = 'open') = (resolved_at is null))
);
create unique index if not exists shared_proposals_one_open on public.shared_proposals (target_type, target_id) where status = 'open';
create index if not exists shared_proposals_conversation_idx on public.shared_proposals (conversation_id, created_at desc);

create table if not exists public.shared_proposal_votes (
  proposal_id uuid not null references public.shared_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote text check (vote is null or vote in ('agree', 'disagree')),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 300),
  voted_at timestamptz,
  primary key (proposal_id, user_id)
);

alter table public.shared_proposals enable row level security;
alter table public.shared_proposal_votes enable row level security;
revoke all on public.shared_proposals from anon, authenticated;
revoke all on public.shared_proposal_votes from anon, authenticated;
grant select on public.shared_proposals to authenticated;
grant select on public.shared_proposal_votes to authenticated;

drop policy if exists shared_proposals_read on public.shared_proposals;
create policy shared_proposals_read on public.shared_proposals for select to authenticated
  using (private.is_conversation_participant(conversation_id, (select auth.uid())));
drop policy if exists shared_proposal_votes_read on public.shared_proposal_votes;
create policy shared_proposal_votes_read on public.shared_proposal_votes for select to authenticated
  using (exists (select 1 from public.shared_proposals p where p.id = proposal_id
                 and private.is_conversation_participant(p.conversation_id, (select auth.uid()))));

do $$ begin
  begin alter publication supabase_realtime add table public.shared_proposals; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shared_proposal_votes; exception when duplicate_object then null; end;
end $$;

-- ------------------------------------------------------------------ who a target belongs to
create or replace function private.proposal_conversation(p_target_type text, p_target_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select case p_target_type
    when 'think_hub_table' then (
      select coalesce(t.conversation_id, (select pr.conversation_id from projects pr where pr.id = t.project_id))
      from think_hub_table t where t.id = p_target_id)
    when 'group' then p_target_id
    when 'project' then (select conversation_id from projects where id = p_target_id)
  end
$$;

-- Stakeholders, still in the conversation, minus the proposer and anyone the proposer is blocked with
-- (a block ends the relationship; waiting on that person would be a dead end, D4).
create or replace function private.proposal_stakeholders(p_target_type text, p_target_id uuid, p_proposer uuid)
returns table (user_id uuid) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_conv uuid := private.proposal_conversation(p_target_type, p_target_id); v_type text; v_table think_hub_table%rowtype;
begin
  select type into v_type from conversations where id = v_conv;
  if p_target_type = 'think_hub_table' then
    select * into v_table from think_hub_table where id = p_target_id;
    if v_type = 'direct' then
      return query select cp.user_id from conversation_participants cp
        where cp.conversation_id = v_conv and cp.user_id <> p_proposer
          and not private.is_blocked_between(cp.user_id, p_proposer);
      return;
    end if;
    return query
      select distinct s.uid from (
        select v_table.owner_user_id as uid
        union all
        select unnest(r.owner_user_id || r.editor_ids) from private.think_hub_table_tree(p_target_id) tr
          join think_hub_record r on r.table_id = tr.id
        union all
        select t.assignee_id from private.think_hub_table_tree(p_target_id) tr
          join think_hub_record r on r.table_id = tr.id
          left join think_hub_record_tasks rt on rt.record_id = r.id
          left join project_tasks pt on pt.record_id = r.id
          join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
          where t.status not in ('done', 'skipped') and t.assignee_id is not null
      ) s
      where s.uid is not null and s.uid <> p_proposer
        and private.is_conversation_participant(v_conv, s.uid)
        and not private.is_blocked_between(s.uid, p_proposer);
    return;
  end if;
  return query select cp.user_id from conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id <> p_proposer
      and not private.is_blocked_between(cp.user_id, p_proposer);
end $$;

revoke all on function private.proposal_conversation(text, uuid) from public, anon, authenticated;
revoke all on function private.proposal_stakeholders(text, uuid, uuid) from public, anon, authenticated;

create or replace function private.proposal_words(p_action text, p_target_type text, p_name text)
returns text language sql immutable as $$
  select case
    when p_target_type = 'group' then 'giải tán Nhóm "' || p_name || '"'
    else (case p_action when 'delete' then 'xoá ' when 'archive' then 'lưu trữ ' else 'mở lại ' end)
      || (case p_target_type when 'project' then 'Dự án "' else 'Bảng "' end) || p_name || '"'
  end
$$;

-- ------------------------------------------------------------------ doing the thing
create or replace function private.dissolve_group(p_group uuid, p_proposal uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tbl uuid;
begin
  -- The group, every sub-group under it, their projects, and every shared table of those.
  create temp table if not exists _avora_dissolve (id uuid) on commit drop;
  truncate _avora_dissolve;
  insert into _avora_dissolve
    with recursive tree as (
      select id, 1 as lvl from conversations where id = p_group
      union all select c.id, tree.lvl + 1 from conversations c join tree on c.parent_group_id = tree.id where tree.lvl < 4
    ) select id from tree;

  for v_tbl in
    select t.id from think_hub_table t
    where t.deleted_at is null and t.parent_record_id is null
      and (t.conversation_id in (select id from _avora_dissolve)
           or t.project_id in (select pr.id from projects pr where pr.conversation_id in (select id from _avora_dissolve)))
  loop
    perform private.cascade_table_tasks(v_tbl);
    update think_hub_table set deleted_at = now(), deleted_via = p_proposal where id = v_tbl;
  end loop;

  update projects set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Nhóm đã giải tán', deleted_via = p_proposal
  where deleted_at is null and conversation_id in (select id from _avora_dissolve);
  update conversations set deleted_at = now(), deleted_via = p_proposal
  where deleted_at is null and id in (select id from _avora_dissolve);
end $$;
revoke all on function private.dissolve_group(uuid, uuid) from public, anon, authenticated;

create or replace function private.execute_proposal(p_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v shared_proposals%rowtype; v_title text;
begin
  select * into v from shared_proposals where id = p_id;
  perform private.act_as(p_actor);
  perform set_config('avora.proposal_exec', 'on', true);
  if v.target_type = 'think_hub_table' then
    if v.action = 'delete' then
      perform public.delete_think_hub_table(v.target_id);
      update think_hub_table set deleted_via = v.id where id = v.target_id;
    else
      perform public.set_think_hub_table_archived(v.target_id, v.action = 'archive');
    end if;
  elsif v.target_type = 'group' then
    perform private.dissolve_group(v.target_id, v.id);
  elsif v.action = 'delete' then
    select title into v_title from projects where id = v.target_id;
    perform public.delete_project(v.target_id, v_title, v.reason);
    update projects set deleted_via = v.id where id = v.target_id;
  else
    perform public.reopen_project(v.target_id);
  end if;
  perform set_config('avora.proposal_exec', 'off', true);
end $$;
revoke all on function private.execute_proposal(uuid, uuid) from public, anon, authenticated;

-- Closes the proposal if everyone still in the room has agreed. Returns the new status.
create or replace function private.settle_proposal(p_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v shared_proposals%rowtype; v_total int; v_agree int;
begin
  select * into v from shared_proposals where id = p_id for update;
  if v.status <> 'open' then return v.status; end if;
  -- Someone who left the conversation is no longer asked.
  delete from shared_proposal_votes pv where pv.proposal_id = p_id
    and not private.is_conversation_participant(v.conversation_id, pv.user_id);
  select count(*), count(*) filter (where vote = 'agree') into v_total, v_agree
  from shared_proposal_votes where proposal_id = p_id;
  if v_agree < v_total then return 'open'; end if;

  perform private.execute_proposal(p_id, coalesce(p_actor, v.proposed_by));
  update shared_proposals set status = 'approved', resolved_at = now() where id = p_id;
  perform private.post_system_line(v.conversation_id, coalesce(p_actor, v.proposed_by), 'proposal_approved',
    case when v_total = 0 then
      format('%s đã %s (không ai khác từng dùng).', private.public_name(v.proposed_by),
        replace(private.proposal_words(v.action, v.target_type, v.target_name), 'giải tán', 'giải tán'))
    else format('Đã %s theo đề nghị của %s · %s/%s đồng ý.',
      private.proposal_words(v.action, v.target_type, v.target_name), private.public_name(v.proposed_by), v_agree, v_total)
    end);
  return 'approved';
end $$;
revoke all on function private.settle_proposal(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ RPCs
create or replace function public.preview_shared_stakeholders(p_target_type text, p_target_id uuid)
returns table (user_id uuid, display_name text) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_conv := private.proposal_conversation(p_target_type, p_target_id);
  if v_conv is null or not private.is_conversation_participant(v_conv, v_uid) then raise exception 'avora_not_a_participant'; end if;
  return query select s.user_id, private.public_name(s.user_id) from private.proposal_stakeholders(p_target_type, p_target_id, v_uid) s;
end $$;

create or replace function public.propose_shared_action(p_action text, p_target_type text, p_target_id uuid, p_reason text)
returns public.shared_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
  v_conv uuid; v_name text; v_table think_hub_table%rowtype; v_project projects%rowtype; v_conv_row conversations%rowtype;
  v_row shared_proposals%rowtype; v_msg uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_reason = '' then raise exception 'avora_proposal_reason_required'; end if;
  if char_length(v_reason) > 300 then raise exception 'avora_proposal_reason_too_long'; end if;
  if p_action not in ('delete', 'archive', 'reopen') or p_target_type not in ('think_hub_table', 'group', 'project') then
    raise exception 'avora_proposal_action_invalid';
  end if;

  if p_target_type = 'think_hub_table' then
    select * into v_table from think_hub_table where id = p_target_id and deleted_at is null;
    if not found or not private.think_hub_table_visible(p_target_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
    if v_table.conversation_id is null and v_table.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
    if v_table.project_id is not null and v_table.parent_record_id is null then raise exception 'avora_think_hub_project_root_locked'; end if;
    if p_action in ('archive', 'reopen') and (v_table.parent_record_id is not null or v_table.project_id is not null) then
      raise exception 'avora_proposal_action_invalid';
    end if;
    if p_action = 'archive' and v_table.archived_at is not null then raise exception 'avora_table_archived'; end if;
    if p_action = 'reopen' and v_table.archived_at is null then raise exception 'avora_proposal_action_invalid'; end if;
    v_name := v_table.name;
  elsif p_target_type = 'group' then
    select * into v_conv_row from conversations where id = p_target_id and deleted_at is null and type = 'group';
    if not found or exists (select 1 from projects where conversation_id = p_target_id) or p_action <> 'delete' then
      raise exception 'avora_proposal_action_invalid';
    end if;
    select coalesce(name, 'Nhóm') into v_name from conversation_groups where conversation_id = p_target_id;
  else
    select * into v_project from projects where id = p_target_id and deleted_at is null;
    if not found then raise exception 'avora_project_missing'; end if;
    if p_action = 'archive' then raise exception 'avora_proposal_action_invalid'; end if;
    if p_action = 'reopen' and v_project.status = 'active' then raise exception 'avora_proposal_action_invalid'; end if;
    v_name := v_project.title;
  end if;

  v_conv := private.proposal_conversation(p_target_type, p_target_id);
  if v_conv is null or not private.is_conversation_participant(v_conv, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if not private.conversation_is_live(v_conv) and not (p_target_type = 'project') then raise exception 'avora_not_a_participant'; end if;
  if exists (select 1 from shared_proposals where target_type = p_target_type and target_id = p_target_id and status = 'open') then
    raise exception 'avora_proposal_already_open';
  end if;

  insert into shared_proposals (action, target_type, target_id, target_name, conversation_id, proposed_by, reason)
  values (p_action, p_target_type, p_target_id, coalesce(v_name, ''), v_conv, v_uid, v_reason)
  returning * into v_row;
  insert into shared_proposal_votes (proposal_id, user_id)
  select v_row.id, s.user_id from private.proposal_stakeholders(p_target_type, p_target_id, v_uid) s;

  v_msg := private.post_system_line(v_conv, v_uid, 'proposal_opened',
    format('%s đề nghị %s · Lý do: %s', private.public_name(v_uid), private.proposal_words(p_action, p_target_type, v_name), v_reason));
  update shared_proposals set message_id = v_msg where id = v_row.id returning * into v_row;

  -- Nobody else ever touched it: nobody to wait for.
  perform private.settle_proposal(v_row.id, v_uid);
  select * into v_row from shared_proposals where id = v_row.id;
  return v_row;
end $$;

create or replace function public.vote_shared_proposal(p_proposal_id uuid, p_vote text, p_reason text default null)
returns public.shared_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v shared_proposals%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_vote not in ('agree', 'disagree') then raise exception 'avora_proposal_vote_invalid'; end if;
  select * into v from shared_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_missing'; end if;
  if v.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  if not private.is_conversation_participant(v.conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if not exists (select 1 from shared_proposal_votes where proposal_id = v.id and user_id = v_uid) then
    raise exception 'avora_proposal_not_stakeholder';
  end if;
  if p_vote = 'disagree' and v_reason is null then raise exception 'avora_proposal_reason_required'; end if;
  if char_length(coalesce(v_reason, '')) > 300 then raise exception 'avora_proposal_reason_too_long'; end if;

  update shared_proposal_votes set vote = p_vote, reason = v_reason, voted_at = now()
  where proposal_id = v.id and user_id = v_uid;

  if p_vote = 'disagree' then
    update shared_proposals set status = 'rejected', resolved_at = now() where id = v.id returning * into v;
    perform private.post_system_line(v.conversation_id, v_uid, 'proposal_rejected',
      format('Cần trao đổi — %s không đồng ý %s: "%s"', private.public_name(v_uid),
        private.proposal_words(v.action, v.target_type, v.target_name), v_reason));
    return v;
  end if;
  perform private.settle_proposal(v.id, v_uid);
  select * into v from shared_proposals where id = v.id;
  return v;
end $$;

create or replace function public.withdraw_shared_proposal(p_proposal_id uuid)
returns public.shared_proposals language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v shared_proposals%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from shared_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_missing'; end if;
  if v.proposed_by <> v_uid then raise exception 'avora_proposal_not_proposer'; end if;
  if v.status = 'withdrawn' then return v; end if;
  if v.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  update shared_proposals set status = 'withdrawn', resolved_at = now() where id = v.id returning * into v;
  perform private.post_system_line(v.conversation_id, v_uid, 'proposal_withdrawn',
    format('%s đã rút lại đề nghị %s.', private.public_name(v_uid), private.proposal_words(v.action, v.target_type, v.target_name)));
  return v;
end $$;

-- Who may take a shared thing back out of the bin: the stakeholders of the proposal that put it there.
create or replace function private.is_proposal_party(p_proposal uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from shared_proposals p where p.id = p_proposal and p.proposed_by = p_user)
      or exists (select 1 from shared_proposal_votes v where v.proposal_id = p_proposal and v.user_id = p_user)
$$;
revoke all on function private.is_proposal_party(uuid, uuid) from public, anon, authenticated;

create or replace function public.restore_shared_table(p_table_id uuid)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_row think_hub_table%rowtype; v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_row.conversation_id is null and v_row.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
  if v_row.deleted_via is null or not private.is_proposal_party(v_row.deleted_via, v_uid) then
    raise exception 'avora_shared_restore_not_party';
  end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  if not private.conversation_is_live(v_conv) then raise exception 'avora_shared_restore_group_gone'; end if;
  perform set_config('avora.proposal_exec', 'on', true);
  v_row := public.restore_think_hub_table(p_table_id);
  perform set_config('avora.proposal_exec', 'off', true);
  update think_hub_table set deleted_via = null where id = p_table_id returning * into v_row;
  perform private.post_system_line(v_conv, v_uid, 'shared_restored',
    format('%s đã khôi phục Bảng "%s".', private.public_name(v_uid), v_row.name));
  return v_row;
end $$;

-- Shared tables in the bin that this person may restore.
create or replace function public.list_shared_trash()
returns table (table_id uuid, name text, conversation_id uuid, project_id uuid, deleted_at timestamptz, proposed_by_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.name, t.conversation_id, t.project_id, t.deleted_at, private.public_name(p.proposed_by)
  from think_hub_table t join shared_proposals p on p.id = t.deleted_via
  where t.deleted_at is not null and (t.conversation_id is not null or t.project_id is not null)
    and private.think_hub_table_visible(t.id, auth.uid())
    and private.is_proposal_party(t.deleted_via, auth.uid())
  order by t.deleted_at desc
$$;

-- Nhóm giải tán: any former member, within 30 days.
create or replace function public.restore_group(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_conv conversations%rowtype; v_tbl uuid; v_name text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_conv from conversations where id = p_conversation_id and type = 'group' for update;
  if not found or v_conv.deleted_at is null or v_conv.deleted_via is null then raise exception 'avora_group_missing'; end if;
  if not exists (select 1 from conversation_participants where conversation_id = p_conversation_id and user_id = v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_conv.deleted_at < now() - interval '30 days' then raise exception 'avora_group_restore_expired'; end if;

  update conversations set deleted_at = null, deleted_via = null where deleted_via = v_conv.deleted_via;
  update projects set deleted_at = null, deleted_by = null, delete_reason = null, deleted_via = null where deleted_via = v_conv.deleted_via;
  for v_tbl in select id from think_hub_table where deleted_via = v_conv.deleted_via loop
    update think_hub_table set deleted_at = null, deleted_via = null where id = v_tbl;
    perform private.restore_table_tasks(v_tbl);
  end loop;
  select coalesce(name, 'Nhóm') into v_name from conversation_groups where conversation_id = p_conversation_id;
  perform private.post_system_line(p_conversation_id, v_uid, 'shared_restored',
    format('%s đã khôi phục Nhóm "%s".', private.public_name(v_uid), v_name));
end $$;

create or replace function public.list_dissolved_groups()
returns table (conversation_id uuid, name text, deleted_at timestamptz, restorable_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, coalesce(g.name, 'Nhóm'), c.deleted_at, c.deleted_at + interval '30 days'
  from conversations c
  join conversation_participants cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
  left join conversation_groups g on g.conversation_id = c.id
  where c.type = 'group' and c.deleted_at is not null and c.deleted_via is not null
    and c.parent_group_id is null and c.deleted_at >= now() - interval '30 days'
  order by c.deleted_at desc
$$;

-- "Sao chép về Nhật ký": the structure plus only the Hạng mục this person made.
create or replace function public.copy_table_to_journal(p_table_id uuid)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_src think_hub_table%rowtype; v_row think_hub_table%rowtype; v_group text; v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_src from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_src.conversation_id is null and v_src.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  select coalesce(g.name, 'Nhóm') into v_group from conversation_groups g where g.conversation_id = private.group_root(v_conv);

  insert into think_hub_table (owner_user_id, name, purpose, position, column_defs, status_options, title_label,
    default_view, mobile_columns, source_template_key, source_template_version, orphan_origin)
  select v_uid, v_src.name, case when v_src.project_id is not null and v_src.parent_record_id is null then null else v_src.purpose end,
    coalesce(max(position), -1) + 1,
    coalesce((select jsonb_agg(c - 'width') from jsonb_array_elements(v_src.column_defs) c), '[]'::jsonb),
    v_src.status_options, v_src.title_label, v_src.default_view, v_src.mobile_columns,
    v_src.source_template_key, v_src.source_template_version,
    'Từng thuộc nhóm ' || coalesce(v_group, 'đã giải tán')
  from think_hub_table where owner_user_id = v_uid and conversation_id is null and project_id is null and parent_record_id is null
  returning * into v_row;

  insert into think_hub_record (table_id, owner_user_id, title, status, priority, category, next_action_date, tags, notes, extension_fields)
  select v_row.id, v_uid, r.title, r.status, r.priority, r.category, r.next_action_date, r.tags, r.notes, r.extension_fields
  from think_hub_record r where r.table_id = p_table_id and r.deleted_at is null and r.owner_user_id = v_uid
  order by r.created_at limit 1000;
  return v_row;
end $$;

revoke all on function public.preview_shared_stakeholders(text, uuid) from public, anon;
revoke all on function public.propose_shared_action(text, text, uuid, text) from public, anon;
revoke all on function public.vote_shared_proposal(uuid, text, text) from public, anon;
revoke all on function public.withdraw_shared_proposal(uuid) from public, anon;
revoke all on function public.restore_shared_table(uuid) from public, anon;
revoke all on function public.list_shared_trash() from public, anon;
revoke all on function public.restore_group(uuid) from public, anon;
revoke all on function public.list_dissolved_groups() from public, anon;
revoke all on function public.copy_table_to_journal(uuid) from public, anon;
grant execute on function public.preview_shared_stakeholders(text, uuid) to authenticated;
grant execute on function public.propose_shared_action(text, text, uuid, text) to authenticated;
grant execute on function public.vote_shared_proposal(uuid, text, text) to authenticated;
grant execute on function public.withdraw_shared_proposal(uuid) to authenticated;
grant execute on function public.restore_shared_table(uuid) to authenticated;
grant execute on function public.list_shared_trash() to authenticated;
grant execute on function public.restore_group(uuid) to authenticated;
grant execute on function public.list_dissolved_groups() to authenticated;
grant execute on function public.copy_table_to_journal(uuid) to authenticated;

-- ------------------------------------------------------------------ projects go through proposals
CREATE OR REPLACE FUNCTION public.delete_project(p_project_id uuid, p_confirm_title text, p_reason text)
 RETURNS projects LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_shared_needs_proposal';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;

  PERFORM private.post_system_line(v_project.conversation_id, v_uid, 'project_deleted',
    format('Dự án %s đã bị xoá theo đề nghị — Lý do: %s', v_project.title, v_reason));

  UPDATE projects SET deleted_at = now(), deleted_by = v_uid, delete_reason = v_reason
  WHERE id = p_project_id RETURNING * INTO v_project;
  UPDATE conversations SET deleted_at = now() WHERE id = v_project.conversation_id AND deleted_at IS NULL;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_project(p_project_id uuid)
 RETURNS projects LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_shared_needs_proposal';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'active' THEN RETURN v_project; END IF;
  UPDATE projects SET status = 'active', closed_at = NULL WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

-- Any member of the project may take it back out.
CREATE OR REPLACE FUNCTION public.restore_project(p_project_id uuid)
 RETURNS projects LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF NOT (private.is_conversation_participant(v_project.conversation_id, v_uid)
          OR private.is_group_root_owner(v_project.conversation_id, v_uid)) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;
  IF v_project.deleted_via IS NOT NULL AND EXISTS (
       SELECT 1 FROM conversations WHERE deleted_via = v_project.deleted_via AND type = 'group' AND id <> v_project.conversation_id) THEN
    RAISE EXCEPTION 'avora_project_restore_with_group';
  END IF;

  UPDATE conversations SET deleted_at = NULL WHERE id = v_project.conversation_id;
  UPDATE projects SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, deleted_via = NULL
  WHERE id = p_project_id RETURNING * INTO v_project;
  PERFORM private.post_system_line(v_project.conversation_id, v_uid, 'shared_restored',
    format('%s đã khôi phục Dự án "%s".', private.public_name(v_uid), v_project.title));
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_deleted_projects()
 RETURNS SETOF projects LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.* FROM projects p
  WHERE p.deleted_at IS NOT NULL
    AND (private.is_conversation_participant(p.conversation_id, auth.uid())
         OR private.is_group_root_owner(p.conversation_id, auth.uid()))
  ORDER BY p.deleted_at DESC
$function$;

-- ------------------------------------------------------------------ hourly: remind, re-count, expire
create or replace function private.sweep_shared_proposals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v shared_proposals%rowtype; v_n integer := 0;
begin
  for v in select * from shared_proposals where status = 'open' order by created_at loop
    begin
      if v.created_at < now() - interval '14 days' then
        update shared_proposals set status = 'expired', resolved_at = now() where id = v.id;
        perform private.post_system_line(v.conversation_id, v.proposed_by, 'proposal_expired',
          format('Hết hạn — chưa đủ đồng ý để %s.', private.proposal_words(v.action, v.target_type, v.target_name)));
      else
        perform private.settle_proposal(v.id, v.proposed_by);
        if v.reminded_at is null and v.created_at < now() - interval '3 days' then
          update shared_proposals set reminded_at = now() where id = v.id and status = 'open';
        end if;
      end if;
      v_n := v_n + 1;
    exception when others then
      raise warning 'avora_sweep_proposal_failed %', v.id;
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.sweep_shared_proposals() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'avora_sweep_shared_proposals') then
    perform cron.unschedule('avora_sweep_shared_proposals');
  end if;
  perform cron.schedule('avora_sweep_shared_proposals', '7 * * * *', 'select private.sweep_shared_proposals()');
end $$;
