-- AVORA-44 · A.5 — Xoá một mục Nhật ký là đưa cả mục vào Thùng rác, khôi phục được 30 ngày.
-- Only personal-journal rows are ever trashed; other rooms keep their own recall rules. The files
-- stay attached while in the bin (their storage rows are what make the bytes readable), and are
-- removed together with the entry when the bin is emptied.

alter table public.messages add column if not exists trashed_at timestamptz;
grant select (trashed_at) on public.messages to authenticated;
create index if not exists messages_journal_trash_idx on public.messages (conversation_id, trashed_at) where trashed_at is not null;

create or replace function public.delete_journal_messages(p_message_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_uid uuid := auth.uid(); v_n integer := 0;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_message_ids, 1) > 200 then raise exception 'avora_delete_too_many'; end if;
  if exists (
    select 1 from messages m join conversations c on c.id = m.conversation_id
    where m.id = any (p_message_ids) and (m.sender_id <> v_uid or c.type <> 'personal')
  ) then
    raise exception 'avora_delete_not_allowed';
  end if;
  update messages m set trashed_at = now()
  from conversations c
  where c.id = m.conversation_id and c.type = 'personal' and m.sender_id = v_uid
    and m.id = any (p_message_ids) and m.trashed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

create or replace function public.restore_journal_messages(p_message_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_uid uuid := auth.uid(); v_n integer := 0;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  update messages m set trashed_at = null
  from conversations c
  where c.id = m.conversation_id and c.type = 'personal' and m.sender_id = v_uid
    and m.id = any (coalesce(p_message_ids, '{}')) and m.trashed_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;
revoke all on function public.restore_journal_messages(uuid[]) from public, anon;
grant execute on function public.restore_journal_messages(uuid[]) to authenticated;

-- Emptied after 30 days by the hourly dead-end sweep.
create or replace function private.purge_journal_trash()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from message_attachments a using messages m
  where a.message_id = m.id and m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  delete from messages m where m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.purge_journal_trash() from public, anon, authenticated;

create or replace function private.sweep_dead_ends()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.close_dead_suggestions();
  begin perform private.purge_journal_trash(); exception when others then raise warning 'avora_journal_purge_failed'; end;
end $$;
revoke all on function private.sweep_dead_ends() from public, anon, authenticated;
