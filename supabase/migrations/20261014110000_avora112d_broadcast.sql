-- AVORA-112-D · Realtime đúng và nhẹ (ADR-091). Tin nhắn đã đi bằng Broadcast từ K3; khối này chuyển nốt năm
-- luồng còn dùng `postgres_changes` toàn bảng (việc, gợi ý việc, đã đọc, đề nghị xoá thành viên, thêm thành
-- viên) sang Broadcast vào kênh riêng của từng người `user-<id>` (Realtime Authorization đã có:
-- private.realtime_topic_ok — chỉ chủ kênh nghe được). Máy chủ tính người nhận MỘT lần mỗi thay đổi, thay vì
-- Realtime kiểm RLS cho từng người đang nghe bảng.
-- Đường lui: app_config.realtime_mode = 'broadcast' | 'legacy'. Ấn phẩm `supabase_realtime` giữ nguyên để
-- chế độ legacy (mã cũ còn trong app) chạy lại được ngay.

insert into public.app_config (key, value) values ('realtime_mode', '"broadcast"'::jsonb)
on conflict (key) do nothing;

create or replace function private.send_to_users(p_users uuid[], p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  for v_user in select distinct u from unnest(p_users) u where u is not null loop
    perform realtime.send(p_payload, p_event, 'user-' || v_user::text, true);
  end loop;
end $$;
revoke execute on function private.send_to_users(uuid[], text, jsonb) from public, anon, authenticated;

create or replace function private.members_of(p_conversation uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(cp.user_id), '{}') from public.conversation_participants cp where cp.conversation_id = p_conversation
$$;
revoke execute on function private.members_of(uuid) from public, anon, authenticated;

-- Việc: cùng luật với tasks_select_visible. Không còn thấy được (đang chờ quyết định, cuộc đã đóng) → gửi như xoá.
create or replace function private.broadcast_task_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_users uuid[] := '{}';
  v_row public.tasks%rowtype;
  v_visible boolean;
begin
  if tg_op <> 'INSERT' then
    v_users := v_users || case when old.type = 'personal' then array[old.creator_id] else private.members_of(old.conversation_id) end;
  end if;
  if tg_op <> 'DELETE' then
    v_users := v_users || case when new.type = 'personal' then array[new.creator_id] else private.members_of(new.conversation_id) end;
    v_row := new;
    v_visible := new.pending_decision_id is null
      and (new.type = 'personal' or (new.conversation_id is not null and private.conversation_is_live(new.conversation_id)));
  else
    v_visible := false;
  end if;
  perform private.send_to_users(v_users, 'task', jsonb_build_object(
    'eventType', case when not v_visible then 'DELETE' else tg_op end,
    'new', case when v_visible then to_jsonb(v_row) else '{}'::jsonb end,
    'old', jsonb_build_object('id', coalesce(old.id, new.id))));
  return null;
exception when others then
  return null; -- a lost event is healed by the backfill on reconnect; it must never fail a write
end $$;
revoke execute on function private.broadcast_task_change() from public, anon, authenticated;

create or replace function private.broadcast_suggestion_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.send_to_users(
    private.members_of(coalesce(new.conversation_id, old.conversation_id)), 'task_suggestion',
    jsonb_build_object('eventType', tg_op,
      'new', case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end,
      'old', jsonb_build_object('id', coalesce(old.id, new.id))));
  return null;
exception when others then
  return null;
end $$;
revoke execute on function private.broadcast_suggestion_change() from public, anon, authenticated;

-- Đã đọc: chỉ chính người đọc (các thiết bị khác của họ). Không ai khác nhận dấu đã đọc của người này.
create or replace function private.broadcast_read_mark()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.send_to_users(array[new.user_id], 'read_mark',
    jsonb_build_object('new', jsonb_build_object('conversation_id', new.conversation_id, 'user_id', new.user_id)));
  return null;
exception when others then
  return null;
end $$;
revoke execute on function private.broadcast_read_mark() from public, anon, authenticated;

create or replace function private.broadcast_removal_resolution()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.send_to_users(array[new.requested_by], 'removal_request', jsonb_build_object('new', to_jsonb(new)));
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke execute on function private.broadcast_removal_resolution() from public, anon, authenticated;

create or replace function private.broadcast_participant_added()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.send_to_users(private.members_of(new.conversation_id), 'participant_added',
    jsonb_build_object('conversation_id', new.conversation_id));
  return null;
exception when others then
  return null;
end $$;
revoke execute on function private.broadcast_participant_added() from public, anon, authenticated;

drop trigger if exists tasks_broadcast_users on public.tasks;
create trigger tasks_broadcast_users after insert or update or delete on public.tasks
  for each row execute function private.broadcast_task_change();
drop trigger if exists task_suggestions_broadcast_users on public.task_suggestions;
create trigger task_suggestions_broadcast_users after insert or update or delete on public.task_suggestions
  for each row execute function private.broadcast_suggestion_change();
drop trigger if exists conversation_read_marks_broadcast_users on public.conversation_read_marks;
create trigger conversation_read_marks_broadcast_users after insert or update on public.conversation_read_marks
  for each row execute function private.broadcast_read_mark();
drop trigger if exists group_removal_requests_broadcast_users on public.group_removal_requests;
create trigger group_removal_requests_broadcast_users after update on public.group_removal_requests
  for each row execute function private.broadcast_removal_resolution();
drop trigger if exists conversation_participants_broadcast_added on public.conversation_participants;
create trigger conversation_participants_broadcast_added after insert on public.conversation_participants
  for each row execute function private.broadcast_participant_added();
