-- 111-A · Ghi lại NGUYÊN VĂN 3 RPC nhóm đang chạy live (không đổi hành vi).
-- Nguồn: docs/db-snapshots/2026-11-09-group-rpcs.sql. Trước đây các hàm này chỉ tồn tại trên DB, không có trong migrations.
-- Giữ nguyên SET search_path TO public như live; hàm xoá tài khoản dùng lại logic qua private.account_transfer_groups.

-- leave_group_conversation(target_conversation_id uuid)  ACL live: {postgres=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.leave_group_conversation(target_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_uid;

  if v_role is null then
    raise exception 'You are not a participant of this group';
  end if;

  if v_role = 'owner' then
    raise exception 'Owner must transfer ownership before leaving — use transfer_group_ownership';
  end if;

  delete from public.conversation_participants
  where conversation_id = v_conv and user_id = v_uid;
end $function$;

revoke all on function public.leave_group_conversation(target_conversation_id uuid) from public, anon;
grant execute on function public.leave_group_conversation(target_conversation_id uuid) to authenticated;

-- set_group_admin(target_conversation_id uuid, target_user_id uuid, make_admin boolean)  ACL live: {postgres=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.set_group_admin(target_conversation_id uuid, target_user_id uuid, make_admin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_target uuid := target_user_id;
  v_conv uuid := target_conversation_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only owner can change admin';
  end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_target;

  if v_role is null then raise exception 'Target is not a participant of this group'; end if;
  if v_role = 'owner' then raise exception 'Owner is not an admin slot'; end if;

  if make_admin then
    if exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = v_conv and cp.role = 'admin' and cp.user_id <> v_target
    ) then
      raise exception 'This group already has an admin';
    end if;
    update public.conversation_participants
      set role = 'admin' where conversation_id = v_conv and user_id = v_target;
  else
    update public.conversation_participants
      set role = 'member' where conversation_id = v_conv and user_id = v_target;
  end if;
end $function$;

revoke all on function public.set_group_admin(target_conversation_id uuid, target_user_id uuid, make_admin boolean) from public, anon;
grant execute on function public.set_group_admin(target_conversation_id uuid, target_user_id uuid, make_admin boolean) to authenticated;

-- transfer_group_ownership(target_conversation_id uuid, new_owner_user_id uuid)  ACL live: {postgres=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.transfer_group_ownership(target_conversation_id uuid, new_owner_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_new uuid := new_owner_user_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only current owner can transfer ownership';
  end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_new;

  if v_role is null or v_role not in ('admin','member') then
    raise exception 'Target must be an existing admin or member of this group';
  end if;

  -- Step down first: two owners can never coexist, not even for one statement.
  update public.conversation_participants
    set role = 'member' where conversation_id = v_conv and user_id = v_uid;

  update public.conversation_participants
    set role = 'owner' where conversation_id = v_conv and user_id = v_new;

  -- The sidecar must not keep pointing at yesterday's owner.
  perform set_config('avora.owner_transfer', v_conv::text, true);
  update public.conversation_groups
    set owner_id = v_new where conversation_id = v_conv;
  perform set_config('avora.owner_transfer', '', true);
end $function$;

revoke all on function public.transfer_group_ownership(target_conversation_id uuid, new_owner_user_id uuid) from public, anon;
grant execute on function public.transfer_group_ownership(target_conversation_id uuid, new_owner_user_id uuid) to authenticated;

