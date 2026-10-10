-- AVORA-104 · PHẦN 4 — Toàn cảnh dự án trong Kế hoạch (ADR-076).
-- One read for the whole tree around a board: Dự án › Bảng › Hạng mục › Bảng con › … with done/total
-- task counts summed up every level. Only what the caller may see (board visibility + task visibility,
-- the same helpers RLS uses); never a task's contents — the lists load when a Hạng mục is opened.
--   node_kind: 'project' (a project's one root board, titled with the project) | 'table' | 'record' | 'unlinked'
--   parent_id: root → null; sub-board → its Hạng mục; Hạng mục → its board;
--              'unlinked' (Việc chưa gắn Hạng mục) → the root.

create or replace function public.think_hub_tree(p_root_table_id uuid)
returns table (node_kind text, node_id uuid, parent_id uuid, title text, depth integer, sort_order integer,
               done integer, total integer, own_total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_root public.think_hub_table%rowtype;
  v_project public.projects%rowtype;
  v_parent uuid;
  v_guard integer := 0;
begin
  if v_uid is null or not private.session_allowed() then return; end if;
  select b.* into v_root from public.think_hub_table b where b.id = p_root_table_id and b.deleted_at is null;
  if v_root.id is null or not private.think_hub_table_visible(v_root.id, v_uid) then return; end if;

  if v_root.project_id is not null then
    select pr.* into v_project from public.projects pr where pr.id = v_root.project_id and pr.deleted_at is null;
  end if;
  -- Not a project: the root is the top board this one grew from (a sub-board opens inside its whole tree).
  if v_project.id is null then
    loop
      v_parent := (select r.table_id from public.think_hub_record r where r.id = v_root.parent_record_id);
      exit when v_parent is null or v_guard > 8 or not private.think_hub_table_visible(v_parent, v_uid);
      select b.* into v_root from public.think_hub_table b where b.id = v_parent and b.deleted_at is null;
      exit when v_root.id is null;
      v_guard := v_guard + 1;
    end loop;
  end if;

  return query
  with recursive tabs as (
    select b.id, b.parent_record_id, b.name, b.position, b.created_at, 1 as lvl
    from public.think_hub_table b
    where b.deleted_at is null and b.archived_at is null
      and case when v_project.id is not null then b.project_id = v_project.id and b.parent_record_id is null
               else b.id = v_root.id end
      and private.think_hub_table_visible(b.id, v_uid)
    union all
    select s.id, s.parent_record_id, s.name, s.position, s.created_at, t.lvl + 1
    from tabs t
    join public.think_hub_record r on r.table_id = t.id and r.deleted_at is null and r.archived_at is null
    join public.think_hub_table s on s.parent_record_id = r.id and s.deleted_at is null and s.archived_at is null
    where t.lvl < 8 and private.think_hub_table_visible(s.id, v_uid)
  ),
  recs as (
    select r.id, r.table_id, r.title, r.created_at, t.lvl
    from public.think_hub_record r
    join tabs t on t.id = r.table_id
    where r.deleted_at is null and r.archived_at is null
  ),
  links as (
    select rt.record_id, rt.task_id from public.think_hub_record_tasks rt join recs on recs.id = rt.record_id
    union
    select pt.record_id, pt.task_id from public.project_tasks pt join recs on recs.id = pt.record_id
  ),
  live as (
    select l.record_id, t.id as task_id, (t.status in ('done', 'done_pending_review')) as is_done
    from links l
    join public.tasks t on t.id = l.task_id
    where t.pending_decision_id is null and t.status <> 'skipped'
      and not coalesce(t.deleted_by_creator, false) and not coalesce(t.deleted_by_peer, false)
      and private.can_view_task(t.id, v_uid)
  ),
  own as (
    select live.record_id, count(*) filter (where live.is_done)::integer as done, count(*)::integer as total
    from live group by live.record_id
  ),
  -- Every Hạng mục with each Hạng mục above it (itself included), through the sub-boards between them.
  rec_anc as (
    select recs.id as rec, recs.id as anc from recs
    union all
    select a.rec, pr.id
    from rec_anc a
    join recs ar on ar.id = a.anc
    join tabs tb on tb.id = ar.table_id
    join recs pr on pr.id = tb.parent_record_id
  ),
  rec_sum as (
    select a.anc as rec, coalesce(sum(o.done), 0)::integer as done, coalesce(sum(o.total), 0)::integer as total
    from rec_anc a left join own o on o.record_id = a.rec
    group by a.anc
  ),
  tab_sum as (
    select ar.table_id, coalesce(sum(o.done), 0)::integer as done, coalesce(sum(o.total), 0)::integer as total
    from rec_anc a
    join recs ar on ar.id = a.anc
    left join own o on o.record_id = a.rec
    group by ar.table_id
  ),
  unlinked as (
    select t.id, (t.status in ('done', 'done_pending_review')) as is_done
    from public.tasks t
    where (v_project.id is not null or v_root.conversation_id is not null)
      and t.pending_decision_id is null and t.status <> 'skipped' and t.type <> 'personal'
      and not coalesce(t.deleted_by_creator, false) and not coalesce(t.deleted_by_peer, false)
      and case when v_project.id is not null
               then exists (select 1 from public.project_tasks pt where pt.task_id = t.id and pt.project_id = v_project.id)
               else t.conversation_id = v_root.conversation_id end
      and not exists (select 1 from public.think_hub_record_tasks rt where rt.task_id = t.id)
      and not exists (select 1 from public.project_tasks pt where pt.task_id = t.id and pt.record_id is not null)
      and private.can_view_task(t.id, v_uid)
  ),
  un_sum as (
    select count(*) filter (where unlinked.is_done)::integer as done, count(*)::integer as total from unlinked
  )
  select case when tb.lvl = 1 and v_project.id is not null then 'project' else 'table' end, tb.id,
         tb.parent_record_id,
         case when tb.lvl = 1 and v_project.id is not null then v_project.title else tb.name end,
         (tb.lvl - 1) * 2,
         (row_number() over (partition by tb.parent_record_id order by tb.position, tb.created_at, tb.id))::integer,
         coalesce(ts.done, 0) + case when tb.lvl = 1 then (select u.done from un_sum u) else 0 end,
         coalesce(ts.total, 0) + case when tb.lvl = 1 then (select u.total from un_sum u) else 0 end,
         0
  from tabs tb left join tab_sum ts on ts.table_id = tb.id
  union all
  select 'record'::text, r.id, r.table_id, r.title, (r.lvl - 1) * 2 + 1,
         (row_number() over (partition by r.table_id order by r.created_at, r.id))::integer,
         coalesce(rs.done, 0), coalesce(rs.total, 0), coalesce(o.total, 0)
  from recs r left join rec_sum rs on rs.rec = r.id left join own o on o.record_id = r.id
  union all
  select 'unlinked'::text, v_root.id, v_root.id, 'Việc chưa gắn Hạng mục',
         1, 1000000, u.done, u.total, u.total
  from un_sum u
  where v_project.id is not null or v_root.conversation_id is not null;
end $$;

revoke all on function public.think_hub_tree(uuid) from public, anon;
grant execute on function public.think_hub_tree(uuid) to authenticated;
