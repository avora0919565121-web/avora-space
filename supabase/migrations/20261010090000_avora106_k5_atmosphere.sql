-- AVORA-106 · K5 — Không khí · hiệu ứng · sticker (100 · S.2 / 84 §4.1–4.2, chỉ phần chat).
-- • sticker_catalog (24 id, nạp sẵn) · messages.sticker_id · messages.effect.
-- • send_message(…, p_effect, p_sticker): sticker phải có trong danh mục; hiệu ứng tối đa 3 / 10 phút /
--   người / cuộc (quá thì vẫn gửi, bỏ hiệu ứng), không ở Nhật ký, khung xác minh, tin Khẩn.
-- • conversation_appearance: màu + nền + icon của một cuộc; ghi chỉ qua RPC (1-1: một trong hai người;
--   Nhóm / Dự án: chủ hoặc quản trị → sai thì avora_not_admin). Đổi = một dòng hệ thống, không đẩy.
-- • conversation_member_prefs: phần riêng của mỗi người trong một cuộc (effects_level). Một bảng duy
--   nhất — các khối sau chỉ thêm cột.
-- • bucket conversation-icons: ảnh icon nhóm, thành viên đọc, quản trị ghi.

-- ------------------------------------------------------------ stickers + effects on messages
create table if not exists public.sticker_catalog (
  id text primary key check (id ~ '^[a-z_]+\.[a-z_]+$'),
  pack text not null check (pack in ('thuong_ngay', 'gia_dinh', 'hoc_lam')),
  active boolean not null default true
);
alter table public.sticker_catalog enable row level security;
drop policy if exists sticker_catalog_read on public.sticker_catalog;
create policy sticker_catalog_read on public.sticker_catalog for select to authenticated using (true);
revoke all on public.sticker_catalog from public, anon;
grant select on public.sticker_catalog to authenticated;
insert into public.sticker_catalog (id, pack, active) values
  ('miu.okela', 'thuong_ngay', true),
  ('miu.doi_qua', 'thuong_ngay', true),
  ('mam.ngu_ngon', 'thuong_ngay', true),
  ('miu.cuoi_xiu', 'thuong_ngay', true),
  ('cun.chuyen_nho', 'thuong_ngay', true),
  ('mam.nghi_chut', 'thuong_ngay', true),
  ('mam.binh_an', 'thuong_ngay', true),
  ('mam.ngay_tot', 'thuong_ngay', true),
  ('cun.nho_qua', 'gia_dinh', true),
  ('cau.xin_loi', 'gia_dinh', true),
  ('miu_cun.ban_than', 'gia_dinh', true),
  ('cun.om', 'gia_dinh', true),
  ('ga.an_com', 'gia_dinh', true),
  ('miu.ve_nha', 'gia_dinh', true),
  ('cau.di_cho', 'gia_dinh', true),
  ('cun.sinh_nhat', 'gia_dinh', true),
  ('cun.co_len', 'hoc_lam', true),
  ('cau.thu_toi', 'hoc_lam', true),
  ('miu.y_tuong', 'hoc_lam', true),
  ('ga.hieu_roi', 'hoc_lam', true),
  ('cun.dang_hoc', 'hoc_lam', true),
  ('ga.sap_tre', 'hoc_lam', true),
  ('ga_cau.cung_lam', 'hoc_lam', true),
  ('cau.cam_on', 'hoc_lam', true)
on conflict (id) do update set pack = excluded.pack, active = excluded.active;

alter table public.messages add column if not exists sticker_id text references public.sticker_catalog (id);
alter table public.messages add column if not exists effect text;
alter table public.messages drop constraint if exists messages_effect_check;
alter table public.messages add constraint messages_effect_check check (effect is null or effect in ('fireworks', 'hearts', 'balloons', 'buzz'));
alter table public.messages drop constraint if exists messages_content_not_blank;
alter table public.messages add constraint messages_content_not_blank check (
  btrim(content) <> '' or deleted_at is not null or attachment_count > 0 or contact_card_user_id is not null or sticker_id is not null
);
create index if not exists messages_effect_recent_idx on public.messages (conversation_id, sender_id, created_at desc) where effect is not null;

-- the appearance line is a quiet system line
alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (system_kind is null or system_kind = any (array[
  'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected', 'proposal_expired', 'proposal_withdrawn',
  'shared_restored', 'recall_expired', 'member_added', 'column_delete_requested', 'board_update', 'board_created',
  'board_shared', 'board_moved', 'member_left_task', 'appearance_changed'
]));

drop function if exists public.send_message(uuid, uuid, text, uuid, jsonb, jsonb, uuid[], uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.send_message(p_id uuid, p_conversation uuid, p_content text DEFAULT ''::text, p_reply_to uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb, p_refs jsonb DEFAULT NULL::jsonb, p_mentioned uuid[] DEFAULT '{}'::uuid[], p_origin_group uuid DEFAULT NULL::uuid, p_daily_thought text DEFAULT NULL::text, p_urgent boolean DEFAULT false, p_effect text DEFAULT NULL::text, p_sticker text DEFAULT NULL::text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.messages%rowtype;
  v_count int := coalesce(jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)), 0);
  v_content text := btrim(coalesce(p_content, ''));
  v_item jsonb;
  v_path text;
  v_obj record;
  v_total bigint := 0;
  v_size bigint;
  v_mime text;
  v_kind text;
  v_dur numeric;
  v_type text;
  v_verifying boolean;
  v_effect text := nullif(btrim(coalesce(p_effect, '')), '');
  v_sticker text := nullif(btrim(coalesce(p_sticker, '')), '');
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_id is null then raise exception 'avora_message_id_required'; end if;

  -- C1: the same id twice is the same message — return it, never a second one.
  select * into v_row from public.messages m where m.id = p_id;
  if v_row.id is not null then
    if v_row.sender_id <> v_uid then raise exception 'avora_message_id_taken'; end if;
    return v_row;
  end if;

  perform private.assert_can_act_in(p_conversation, v_uid, 'send');
  perform private.assert_direct_talk(p_conversation, v_uid, case when v_count > 0 then 'attachment' else 'text' end);

  -- L8: 5 / second, 30 / minute.
  perform private.rate_take(v_uid, 'msg_s', 5, interval '1 second');
  perform private.rate_take(v_uid, 'msg_m', 30, interval '1 minute');

  if v_count > 10 then raise exception 'avora_attachment_too_many'; end if;

  -- K5 · sticker: an Avora sticker is a message of its own — an id from the catalogue, no words, no files.
  if v_sticker is not null then
    if not exists (select 1 from public.sticker_catalog sc where sc.id = v_sticker and sc.active) then
      raise exception 'avora_sticker_unknown';
    end if;
    if v_count > 0 then raise exception 'avora_sticker_alone'; end if;
    v_content := '';
  end if;
  if v_content = '' and v_count = 0 and v_sticker is null then raise exception 'messages_content_not_blank'; end if;

  -- K5 · send effect: only in a 1-1 or group, never in the journal, a verification frame or an
  -- urgent line; at most 3 per 10 minutes per person per conversation — past that the words still
  -- go, quietly without the effect.
  if v_effect is not null then
    if v_effect not in ('fireworks', 'hearts', 'balloons', 'buzz') then raise exception 'avora_effect_unknown'; end if;
    select c.type, (c.verification_status = 'pending') into v_type, v_verifying from public.conversations c where c.id = p_conversation;
    if v_type not in ('direct', 'group') or coalesce(v_verifying, false) or coalesce(p_urgent, false) or v_sticker is not null then
      v_effect := null;
    elsif (
      select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.sender_id = v_uid and m.effect is not null
        and m.created_at > now() - interval '10 minutes'
    ) >= 3 then
      v_effect := null;
    end if;
  end if;
  if coalesce(array_length(p_mentioned, 1), 0) > 20 then raise exception 'avora_mentions_too_many'; end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages r where r.id = p_reply_to and r.conversation_id = p_conversation
  ) then
    raise exception 'avora_reply_out_of_scope';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_path := v_item ->> 'storage_path';
    if v_path is null or v_path not like (p_conversation::text || '/%') or v_path like '%..%' then
      raise exception 'avora_attachment_path_invalid';
    end if;
    select o.owner_id, o.metadata into v_obj from storage.objects o where o.bucket_id = 'chat-attachments' and o.name = v_path;
    if not found then raise exception 'avora_attachment_missing'; end if;
    if v_obj.owner_id is distinct from v_uid::text then raise exception 'avora_attachment_path_invalid'; end if;
    if exists (select 1 from public.message_attachments a where a.storage_path = v_path) then
      raise exception 'avora_attachment_path_invalid';
    end if;
    v_size := coalesce((v_obj.metadata ->> 'size')::bigint, 0);
    v_mime := coalesce(nullif(v_obj.metadata ->> 'mimetype', ''), 'application/octet-stream');
    if private.attachment_blocked(v_path, v_mime) or private.attachment_blocked(v_item ->> 'file_name', v_mime) then
      raise exception 'avora_attachment_type_blocked';
    end if;
    v_dur := nullif(v_item ->> 'duration_seconds', '')::numeric;
    if v_mime like 'video/%' then
      if v_size > 52428800 then raise exception 'avora_attachment_too_large'; end if;
      if v_dur is not null and v_dur > 180 then raise exception 'avora_video_too_long'; end if;
    elsif v_size > 26214400 then
      raise exception 'avora_attachment_too_large';
    end if;
    v_total := v_total + v_size;
  end loop;
  if v_total > 104857600 then raise exception 'avora_attachment_total_too_large'; end if;

  insert into public.messages (
    id, conversation_id, sender_id, content, reply_to_message_id, mentioned_user_ids, origin_group_id,
    attachment_count, refs, reply_to_daily_thought_id, is_urgent, effect, sticker_id
  ) values (
    p_id, p_conversation, v_uid, v_content, p_reply_to, coalesce(p_mentioned, '{}'), p_origin_group,
    v_count, case when p_refs is null or jsonb_array_length(p_refs) = 0 then null else p_refs end,
    p_daily_thought, coalesce(p_urgent, false), v_effect, v_sticker
  );

  insert into public.message_attachments (
    message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size,
    width, height, duration_seconds, permission, capture_source
  )
  select p_id, p_conversation, v_uid,
    case when item ->> 'kind' = 'voice' then 'voice'
         when o.metadata ->> 'mimetype' like 'image/%' then 'image' else 'file' end,
    item ->> 'storage_path',
    left(coalesce(nullif(btrim(item ->> 'file_name'), ''), 'tep'), 255),
    coalesce(nullif(o.metadata ->> 'mimetype', ''), 'application/octet-stream'),
    greatest(coalesce((o.metadata ->> 'size')::bigint, 1), 1),
    nullif(item ->> 'width', '')::int,
    nullif(item ->> 'height', '')::int,
    least(nullif(item ->> 'duration_seconds', '')::numeric, 300),
    case when item ->> 'permission' in ('view', 'forward', 'export') then item ->> 'permission' else 'export' end,
    case when (o.metadata ->> 'mimetype' like 'image/%' or o.metadata ->> 'mimetype' like 'video/%')
              and item ->> 'capture_source' in ('camera', 'library') then item ->> 'capture_source' end
  from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) item
  join storage.objects o on o.bucket_id = 'chat-attachments' and o.name = item ->> 'storage_path';

  select * into v_row from public.messages m where m.id = p_id;
  return v_row;
end $function$;

revoke execute on function public.send_message(uuid, uuid, text, uuid, jsonb, jsonb, uuid[], uuid, text, boolean, text, text) from public, anon;
grant execute on function public.send_message(uuid, uuid, text, uuid, jsonb, jsonb, uuid[], uuid, text, boolean, text, text) to authenticated;

-- ------------------------------------------------------------ conversation_member_prefs
create table if not exists public.conversation_member_prefs (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  effects_level text check (effects_level in ('full', 'light', 'off')),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_member_prefs add column if not exists effects_level text check (effects_level in ('full', 'light', 'off'));
alter table public.conversation_member_prefs enable row level security;
drop policy if exists conversation_member_prefs_own on public.conversation_member_prefs;
create policy conversation_member_prefs_own on public.conversation_member_prefs for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists conversation_member_prefs_session on public.conversation_member_prefs;
create policy conversation_member_prefs_session on public.conversation_member_prefs as restrictive for all to authenticated
  using (private.session_allowed()) with check (private.session_allowed());
revoke all on public.conversation_member_prefs from public, anon;
grant select on public.conversation_member_prefs to authenticated;

create or replace function public.set_my_conversation_prefs(p_conversation uuid, p_effects_level text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_can_act_in(p_conversation, v_uid, 'read');
  if p_effects_level is not null and p_effects_level not in ('full', 'light', 'off') then raise exception 'avora_effects_level_invalid'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, effects_level)
  values (p_conversation, v_uid, p_effects_level)
  on conflict (conversation_id, user_id) do update set effects_level = excluded.effects_level, updated_at = now();
end $$;
revoke execute on function public.set_my_conversation_prefs(uuid, text) from public, anon;
grant execute on function public.set_my_conversation_prefs(uuid, text) to authenticated;

-- ------------------------------------------------------------ conversation_appearance
create table if not exists public.conversation_appearance (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  color_key text check (color_key is null or color_key in ('avora', 'bien', 'ngoc', 'tim', 'than')),
  backdrop_key text check (backdrop_key is null or backdrop_key in ('giay', 'la', 'may', 'song')),
  icon_key text check (icon_key is null or icon_key ~ '^[a-z_]{2,24}$'),
  icon_path text check (icon_path is null or icon_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.conversation_appearance enable row level security;
drop policy if exists conversation_appearance_members on public.conversation_appearance;
create policy conversation_appearance_members on public.conversation_appearance for select to authenticated
  using (private.can_act_in(conversation_id, (select auth.uid()), 'read'));
drop policy if exists conversation_appearance_session on public.conversation_appearance;
create policy conversation_appearance_session on public.conversation_appearance as restrictive for all to authenticated
  using (private.session_allowed()) with check (private.session_allowed());
revoke all on public.conversation_appearance from public, anon;
grant select on public.conversation_appearance to authenticated;

/** 1-1: either person; Nhóm / Dự án: owner or admin. Journal / email: never. */
create or replace function private.assert_can_style(p_conversation uuid, p_uid uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_type text; v_role text;
begin
  perform private.assert_can_act_in(p_conversation, p_uid, 'send');
  select c.type into v_type from public.conversations c where c.id = p_conversation;
  if v_type not in ('direct', 'group') then raise exception 'avora_not_allowed'; end if;
  if v_type = 'group' then
    select cp.role into v_role from public.conversation_participants cp where cp.conversation_id = p_conversation and cp.user_id = p_uid;
    if coalesce(v_role, '') not in ('owner', 'admin') then raise exception 'avora_not_admin'; end if;
  end if;
  return v_type;
end $$;
revoke execute on function private.assert_can_style(uuid, uuid) from public, anon, authenticated;

create or replace function private.appearance_line(p_conversation uuid, p_uid uuid, p_what text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_name from public.profiles p where p.id = p_uid;
  insert into public.messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_uid, coalesce(v_name, 'Một thành viên') || ' đã đổi ' || p_what, 'appearance_changed');
end $$;
revoke execute on function private.appearance_line(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.set_conversation_appearance(p_conversation_id uuid, p_color text default null, p_backdrop text default null)
returns public.conversation_appearance language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.conversation_appearance%rowtype; v_old public.conversation_appearance%rowtype; v_what text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_can_style(p_conversation_id, v_uid);
  if p_color is not null and p_color not in ('avora', 'bien', 'ngoc', 'tim', 'than') then raise exception 'avora_appearance_invalid'; end if;
  if p_backdrop is not null and p_backdrop not in ('giay', 'la', 'may', 'song') then raise exception 'avora_appearance_invalid'; end if;
  select * into v_old from public.conversation_appearance a where a.conversation_id = p_conversation_id;
  insert into public.conversation_appearance (conversation_id, color_key, backdrop_key, updated_by)
  values (p_conversation_id, p_color, nullif(p_backdrop, 'giay'), v_uid)
  on conflict (conversation_id) do update set color_key = excluded.color_key, backdrop_key = excluded.backdrop_key,
    updated_by = v_uid, updated_at = now()
  returning * into v_row;
  v_what := case
    when v_old.color_key is distinct from v_row.color_key and v_old.backdrop_key is distinct from v_row.backdrop_key then 'màu và nền cuộc trò chuyện'
    when v_old.color_key is distinct from v_row.color_key then 'màu cuộc trò chuyện'
    when v_old.backdrop_key is distinct from v_row.backdrop_key then 'nền cuộc trò chuyện'
  end;
  if v_what is not null then perform private.appearance_line(p_conversation_id, v_uid, v_what); end if;
  return v_row;
end $$;
revoke execute on function public.set_conversation_appearance(uuid, text, text) from public, anon;
grant execute on function public.set_conversation_appearance(uuid, text, text) to authenticated;

create or replace function public.set_group_icon(p_conversation_id uuid, p_icon_key text default null, p_icon_path text default null)
returns public.conversation_appearance language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_type text; v_row public.conversation_appearance%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_type := private.assert_can_style(p_conversation_id, v_uid);
  if v_type <> 'group' then raise exception 'avora_not_allowed'; end if;
  if p_icon_key is not null and p_icon_path is not null then raise exception 'avora_appearance_invalid'; end if;
  if p_icon_path is not null then
    if p_icon_path not like p_conversation_id::text || '/%' then raise exception 'avora_appearance_invalid'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'conversation-icons' and o.name = p_icon_path) then
      raise exception 'avora_attachment_missing';
    end if;
  end if;
  insert into public.conversation_appearance (conversation_id, icon_key, icon_path, updated_by)
  values (p_conversation_id, p_icon_key, p_icon_path, v_uid)
  on conflict (conversation_id) do update set icon_key = excluded.icon_key, icon_path = excluded.icon_path,
    updated_by = v_uid, updated_at = now()
  returning * into v_row;
  perform private.appearance_line(p_conversation_id, v_uid, 'icon của nhóm');
  return v_row;
end $$;
revoke execute on function public.set_group_icon(uuid, text, text) from public, anon;
grant execute on function public.set_group_icon(uuid, text, text) to authenticated;

-- ------------------------------------------------------------ bucket: group icons
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversation-icons', 'conversation-icons', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

/** The first path segment as a conversation id, or null — never an error on another bucket's names. */
create or replace function private.folder_uuid(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid end
$$;
revoke execute on function private.folder_uuid(text) from public, anon;
grant execute on function private.folder_uuid(text) to authenticated;

drop policy if exists conversation_icons_read on storage.objects;
create policy conversation_icons_read on storage.objects for select to authenticated using (
  bucket_id = 'conversation-icons'
  and private.can_act_in(private.folder_uuid(name), (select auth.uid()), 'read')
);
drop policy if exists conversation_icons_write on storage.objects;
create policy conversation_icons_write on storage.objects for insert to authenticated with check (
  bucket_id = 'conversation-icons'
  and exists (
    select 1 from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    where cp.conversation_id = private.folder_uuid(name)
      and cp.user_id = (select auth.uid()) and cp.role in ('owner', 'admin') and c.type = 'group'
  )
);
