-- KT-07a2 · QA04-03: người rời hoặc bị gỡ khỏi một nhóm thì rời luôn mọi nhóm con / nhóm dự án con
-- bên dưới (dây chuyền, trong cùng giao dịch với lệnh gỡ). Luật gốc: nhóm con chỉ gồm người đang ở
-- nhóm cha — trước đây gỡ ở nhóm cha không lan xuống, người bị gỡ vẫn đọc được tin mới của nhóm con.
--
-- Cách làm: trigger AFTER DELETE trên conversation_participants. Xoá dòng ở nhóm con lại kích hoạt
-- chính trigger này nên lan xuống mọi tầng (tối đa 3 tầng). Các trigger sẵn có (trả việc, dọn push,
-- báo đã bị gỡ…) chạy cho từng nhóm con như một lần gỡ thường.
-- Không lan khi nhóm cha đang bị xoá/giải tán (nhóm con đứng riêng, giữ nguyên người — như cũ).
-- Người bị gỡ là chủ nhóm con: quyền chủ chuyển cho chủ nhóm cha nếu người đó ở nhóm con, không thì
-- cho người vào nhóm con sớm nhất còn lại.

create or replace function private.cascade_leave_subgroups()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent public.conversations%rowtype; v_child record; v_heir uuid; v_parent_owner uuid;
begin
  select * into v_parent from public.conversations c where c.id = old.conversation_id;
  if v_parent.id is null or v_parent.type is distinct from 'group' or v_parent.deleted_at is not null then
    return old;
  end if;
  select cp.user_id into v_parent_owner from public.conversation_participants cp
  where cp.conversation_id = v_parent.id and cp.role = 'owner';

  for v_child in
    select cp.conversation_id, cp.role
    from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = old.user_id
    where c.parent_group_id = v_parent.id and c.type = 'group' and c.deleted_at is null
  loop
    delete from public.conversation_participants
    where conversation_id = v_child.conversation_id and user_id = old.user_id;
    if v_child.role = 'owner' then
      select cp.user_id into v_heir from public.conversation_participants cp
      where cp.conversation_id = v_child.conversation_id
      order by (cp.user_id = v_parent_owner) desc, (cp.role = 'admin') desc, cp.joined_at, cp.user_id
      limit 1;
      if v_heir is not null then
        update public.conversation_participants set role = 'owner'
        where conversation_id = v_child.conversation_id and user_id = v_heir;
      end if;
    end if;
  end loop;
  return old;
end $$;

revoke all on function private.cascade_leave_subgroups() from public, anon, authenticated;

drop trigger if exists conversation_participants_cascade_subgroups on public.conversation_participants;
create trigger conversation_participants_cascade_subgroups
  after delete on public.conversation_participants
  for each row execute function private.cascade_leave_subgroups();
