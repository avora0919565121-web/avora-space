-- Đợt gộp 2 · B2: send later. The message belongs to the sender until it is sent: the recipient
-- sees nothing before then. Delivery runs in the database every minute (pg_cron), never on the
-- sender's device. The delivery function passes the sender explicitly — it never relies on
-- auth.uid() — and re-checks membership, blocks, bạn and the verification quota at send time.

create extension if not exists pg_cron;

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (btrim(content) <> '' and char_length(content) <= 4000),
  mentioned_user_ids uuid[] not null default '{}',
  reply_to_message_id uuid null references public.messages(id) on delete set null,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'failed')),
  fail_reason text null,
  sent_message_id uuid null references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_messages_due on public.scheduled_messages (send_at) where status = 'pending';
create index if not exists scheduled_messages_mine on public.scheduled_messages (sender_id, conversation_id);

alter table public.scheduled_messages enable row level security;
revoke all on public.scheduled_messages from public, anon, authenticated;
grant select on public.scheduled_messages to authenticated;
drop policy if exists "Sender reads own scheduled" on public.scheduled_messages;
create policy "Sender reads own scheduled" on public.scheduled_messages
  for select to authenticated using (sender_id = (select auth.uid()));

-- Which of my own messages went out on a timer (the sender's small clock; recipients never see it).
alter table public.scheduled_messages replica identity default;

create or replace function private.schedule_guard(p_conversation_id uuid, p_user uuid, p_send_at timestamptz, p_skip_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if p_user is null then raise exception 'avora_not_signed_in'; end if;
  select c.type into v_type from public.conversations c where c.id = p_conversation_id and c.deleted_at is null;
  if v_type is null or not private.is_conversation_participant(p_conversation_id, p_user) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_type = 'personal' then raise exception 'avora_schedule_not_here'; end if;
  if v_type = 'direct' and private.verification_is_live(p_conversation_id) then
    raise exception 'avora_schedule_not_here';
  end if;
  -- Blocked / no longer bạn → the same refusals as any rich write into a 1-1.
  perform private.assert_direct_talk(p_conversation_id, p_user, 'rich');
  if p_send_at < now() + interval '5 minutes' then raise exception 'avora_schedule_too_soon'; end if;
  if p_send_at > now() + interval '30 days' then raise exception 'avora_schedule_too_far'; end if;
  if (select count(*) from public.scheduled_messages s
      where s.sender_id = p_user and s.conversation_id = p_conversation_id and s.status = 'pending'
        and s.id is distinct from p_skip_id) >= 20 then
    raise exception 'avora_schedule_limit';
  end if;
end;
$$;
revoke all on function private.schedule_guard(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.schedule_message(
  p_conversation_id uuid,
  p_content text,
  p_send_at timestamptz,
  p_mentioned_user_ids uuid[],
  p_reply_to_message_id uuid
)
returns public.scheduled_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_content, ''));
  v_row public.scheduled_messages;
begin
  perform private.schedule_guard(p_conversation_id, v_uid, p_send_at, null);
  if v_text = '' then raise exception 'avora_schedule_empty'; end if;
  if char_length(v_text) > 4000 then raise exception 'avora_message_too_long'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  insert into public.scheduled_messages (conversation_id, sender_id, content, mentioned_user_ids, reply_to_message_id, send_at)
  values (p_conversation_id, v_uid, v_text, coalesce(p_mentioned_user_ids, '{}'), p_reply_to_message_id, p_send_at)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_scheduled_message(p_id uuid, p_content text, p_send_at timestamptz)
returns public.scheduled_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.scheduled_messages;
  v_text text := btrim(coalesce(p_content, ''));
begin
  select * into v_row from public.scheduled_messages where id = p_id and sender_id = v_uid for update;
  if not found then raise exception 'avora_schedule_missing'; end if;
  if v_row.status not in ('pending', 'failed') then raise exception 'avora_schedule_not_pending'; end if;
  perform private.schedule_guard(v_row.conversation_id, v_uid, p_send_at, p_id);
  if v_text = '' then raise exception 'avora_schedule_empty'; end if;
  if char_length(v_text) > 4000 then raise exception 'avora_message_too_long'; end if;
  update public.scheduled_messages
    set content = v_text, send_at = p_send_at, status = 'pending', fail_reason = null, updated_at = now()
    where id = p_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_scheduled_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.scheduled_messages set status = 'cancelled', updated_at = now()
  where id = p_id and sender_id = auth.uid() and status in ('pending', 'failed');
  if not found then raise exception 'avora_schedule_missing'; end if;
end;
$$;

create or replace function public.list_my_scheduled_messages(p_conversation_id uuid)
returns setof public.scheduled_messages
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.scheduled_messages
  where sender_id = auth.uid() and conversation_id = p_conversation_id and status in ('pending', 'failed')
  order by send_at;
$$;

-- One delivery, for one row. Returns the new message id or raises a readable reason.
create or replace function private.deliver_scheduled_row(p_row public.scheduled_messages)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_reply uuid := p_row.reply_to_message_id;
begin
  if not exists (select 1 from public.conversations where id = p_row.conversation_id and deleted_at is null)
     or not private.is_conversation_participant(p_row.conversation_id, p_row.sender_id) then
    raise exception 'Bạn không còn trong cuộc trò chuyện này';
  end if;
  begin
    perform private.assert_direct_talk(p_row.conversation_id, p_row.sender_id, 'text');
  exception when others then
    raise exception 'Không gửi được tới người này';
  end;
  -- The quoted message was withdrawn: still send, just without the quote.
  if v_reply is not null and exists (select 1 from public.messages where id = v_reply and deleted_at is not null) then
    v_reply := null;
  end if;
  -- The ordinary write path: same table, same triggers, created_at = now(), so unread counts,
  -- realtime and ordering behave exactly like a message typed now.
  insert into public.messages (id, conversation_id, sender_id, content, reply_to_message_id, mentioned_user_ids)
  values (v_id, p_row.conversation_id, p_row.sender_id, p_row.content, v_reply,
    array(select u from unnest(p_row.mentioned_user_ids) u
          where private.is_conversation_participant(p_row.conversation_id, u)));
  return v_id;
end;
$$;
revoke all on function private.deliver_scheduled_row(public.scheduled_messages) from public, anon, authenticated;

create or replace function public.send_scheduled_message_now(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.scheduled_messages;
  v_msg uuid;
begin
  select * into v_row from public.scheduled_messages where id = p_id and sender_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'avora_schedule_missing'; end if;
  v_msg := private.deliver_scheduled_row(v_row);
  update public.scheduled_messages set status = 'sent', sent_message_id = v_msg, updated_at = now() where id = p_id;
  return v_msg;
end;
$$;

create or replace function private.deliver_due_scheduled_messages()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.scheduled_messages;
  v_msg uuid;
  v_done integer := 0;
begin
  for v_row in
    select * from public.scheduled_messages
    where status = 'pending' and send_at <= now()
    order by send_at
    limit 200
    for update skip locked
  loop
    begin
      v_msg := private.deliver_scheduled_row(v_row);
      update public.scheduled_messages set status = 'sent', sent_message_id = v_msg, updated_at = now() where id = v_row.id;
      v_done := v_done + 1;
    exception when others then
      update public.scheduled_messages
        set status = 'failed',
            fail_reason = case when sqlerrm like 'avora_%' or sqlerrm like '%_%_%' and sqlerrm !~ ' ' then 'Không gửi được tin này' else left(sqlerrm, 200) end,
            updated_at = now()
        where id = v_row.id;
    end;
  end loop;
  return v_done;
end;
$$;
revoke all on function private.deliver_due_scheduled_messages() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'avora_deliver_scheduled_messages') then
    perform cron.unschedule('avora_deliver_scheduled_messages');
  end if;
  perform cron.schedule('avora_deliver_scheduled_messages', '* * * * *', 'select private.deliver_due_scheduled_messages()');
end $$;

revoke all on function public.schedule_message(uuid, text, timestamptz, uuid[], uuid) from public, anon;
revoke all on function public.update_scheduled_message(uuid, text, timestamptz) from public, anon;
revoke all on function public.cancel_scheduled_message(uuid) from public, anon;
revoke all on function public.list_my_scheduled_messages(uuid) from public, anon;
revoke all on function public.send_scheduled_message_now(uuid) from public, anon;
grant execute on function public.schedule_message(uuid, text, timestamptz, uuid[], uuid) to authenticated;
grant execute on function public.update_scheduled_message(uuid, text, timestamptz) to authenticated;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;
grant execute on function public.list_my_scheduled_messages(uuid) to authenticated;
grant execute on function public.send_scheduled_message_now(uuid) to authenticated;
