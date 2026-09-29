-- Đợt gộp 2 · D4 — census only. Counts what was stuck before the no-dead-end rules; changes nothing.
do $$
declare r record;
begin
  for r in
    select 'shared task · creator deleted, assignee still holds, not done' k, count(*) n from public.tasks
      where type in ('1-1-shared','group-shared') and deleted_by_creator and not deleted_by_peer and status <> 'done'
    union all select 'shared task · skipped, still on assignee list', count(*) from public.tasks
      where type in ('1-1-shared','group-shared') and status = 'skipped' and not deleted_by_peer
    union all select 'shared task · creator left the conversation', count(*) from public.tasks t
      where type in ('1-1-shared','group-shared') and not deleted_by_peer and not private.is_conversation_participant(t.conversation_id, t.creator_id)
    union all select 'shared task · blocked pair', count(*) from public.tasks t
      where type in ('1-1-shared','group-shared') and not deleted_by_peer and t.assignee_id is not null and private.is_blocked_between(t.creator_id, t.assignee_id)
    union all select 'suggestion · pending but can no longer be answered', count(*) from public.task_suggestions s
      where status = 'pending' and private.suggestion_dead_reason(s) is not null
    union all select 'scheduled message · failed', count(*) from public.scheduled_messages where status = 'failed'
  loop
    raise notice 'avora_dead_end_census % = %', r.k, r.n;
  end loop;
end $$;
