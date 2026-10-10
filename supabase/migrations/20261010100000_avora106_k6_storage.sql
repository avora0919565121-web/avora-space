-- AVORA-106 · K6 — Kho chung của cuộc trò chuyện, đợt A: chỉ ĐẾM và GHI, chưa xoá tệp của người dùng.
-- • conversation_storage(conversation_id, bytes, files, cap_bytes): trigger cộng / trừ theo message_attachments;
--   trần 1 GB (1-1) / 2 GB (Nhóm, Dự án). Thành viên đọc.
-- • storage_usage(user_id, bytes, files, day_bytes, day): tệp MÌNH tải lên (5 GB Standard — đếm, chưa chặn).
-- • message_attachments.expires_at = created_at + 30 ngày; retain_reason = 'decision' khi tệp gắn biên bản
--   (meeting_note_files cùng đường dẫn). Chỉ ghi, không xoá.
-- • Dọn: tệp tải lên mà không gắn tin nào sau 24 giờ (ảnh nhỏ thumb-320 của ảnh đã gắn thì giữ) và tệp của
--   mục Nhật ký đã hết 30 ngày trong Thùng rác → hàng đợi private.storage_delete_queue; Edge Function
--   storage-sweep (pg_cron mỗi giờ) xoá qua Storage API (máy chủ không cho xoá thẳng bằng SQL).

-- ------------------------------------------------------------ counters
create table if not exists public.conversation_storage (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  bytes bigint not null default 0,
  files integer not null default 0,
  cap_bytes bigint not null default 1073741824,
  updated_at timestamptz not null default now()
);
alter table public.conversation_storage enable row level security;
drop policy if exists conversation_storage_members on public.conversation_storage;
create policy conversation_storage_members on public.conversation_storage for select to authenticated
  using (private.can_act_in(conversation_id, (select auth.uid()), 'read'));
drop policy if exists conversation_storage_session on public.conversation_storage;
create policy conversation_storage_session on public.conversation_storage as restrictive for all to authenticated
  using (private.session_allowed()) with check (private.session_allowed());
revoke all on public.conversation_storage from public, anon;
grant select on public.conversation_storage to authenticated;

create table if not exists public.storage_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bytes bigint not null default 0,
  files integer not null default 0,
  day_bytes bigint not null default 0,
  day date not null default current_date,
  updated_at timestamptz not null default now()
);
alter table public.storage_usage enable row level security;
drop policy if exists storage_usage_own on public.storage_usage;
create policy storage_usage_own on public.storage_usage for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists storage_usage_session on public.storage_usage;
create policy storage_usage_session on public.storage_usage as restrictive for all to authenticated
  using (private.session_allowed()) with check (private.session_allowed());
revoke all on public.storage_usage from public, anon;
grant select on public.storage_usage to authenticated;

alter table public.message_attachments add column if not exists expires_at timestamptz;
alter table public.message_attachments add column if not exists retain_reason text;
alter table public.message_attachments drop constraint if exists message_attachments_retain_reason_check;
alter table public.message_attachments add constraint message_attachments_retain_reason_check check (retain_reason is null or retain_reason in ('decision'));

create or replace function private.cap_for(p_conversation uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when c.type = 'direct' then 1073741824::bigint else 2147483648::bigint end
  from public.conversations c where c.id = p_conversation
$$;
revoke execute on function private.cap_for(uuid) from public, anon, authenticated;

create or replace function private.attachment_count_storage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.expires_at := coalesce(new.expires_at, new.created_at + interval '30 days');
    if new.retain_reason is null and exists (select 1 from public.meeting_note_files f where f.storage_path = new.storage_path) then
      new.retain_reason := 'decision';
    end if;
    return new;
  end if;
  return new;
end $$;
revoke execute on function private.attachment_count_storage() from public, anon, authenticated;

create or replace function private.attachment_tally()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sign int; v_row public.message_attachments%rowtype;
begin
  if tg_op = 'INSERT' then v_sign := 1; v_row := new; else v_sign := -1; v_row := old; end if;
  -- A forwarded file points at the same bytes (ADR-012): it is counted where it was first sent only.
  if v_row.origin_message_id is not null then return null; end if;
  insert into public.conversation_storage (conversation_id, bytes, files, cap_bytes)
  values (v_row.conversation_id, greatest(0, v_sign * v_row.byte_size), greatest(0, v_sign), coalesce(private.cap_for(v_row.conversation_id), 1073741824))
  on conflict (conversation_id) do update set
    bytes = greatest(0, public.conversation_storage.bytes + v_sign * v_row.byte_size),
    files = greatest(0, public.conversation_storage.files + v_sign),
    updated_at = now();
  if v_row.attached_by is not null then
    insert into public.storage_usage (user_id, bytes, files, day_bytes, day)
    values (v_row.attached_by, greatest(0, v_sign * v_row.byte_size), greatest(0, v_sign), greatest(0, v_sign * v_row.byte_size), current_date)
    on conflict (user_id) do update set
      bytes = greatest(0, public.storage_usage.bytes + v_sign * v_row.byte_size),
      files = greatest(0, public.storage_usage.files + v_sign),
      day_bytes = case when public.storage_usage.day = current_date
        then greatest(0, public.storage_usage.day_bytes + greatest(0, v_sign * v_row.byte_size))
        else greatest(0, v_sign * v_row.byte_size) end,
      day = current_date,
      updated_at = now();
  end if;
  return null;
end $$;
revoke execute on function private.attachment_tally() from public, anon, authenticated;

drop trigger if exists message_attachments_expiry on public.message_attachments;
create trigger message_attachments_expiry before insert on public.message_attachments
  for each row execute function private.attachment_count_storage();
drop trigger if exists message_attachments_tally on public.message_attachments;
create trigger message_attachments_tally after insert or delete on public.message_attachments
  for each row execute function private.attachment_tally();

-- backfill (idempotent: recomputed from the rows)
update public.message_attachments set expires_at = created_at + interval '30 days' where expires_at is null;
insert into public.conversation_storage (conversation_id, bytes, files, cap_bytes)
select a.conversation_id, sum(a.byte_size), count(*), coalesce(private.cap_for(a.conversation_id), 1073741824)
from public.message_attachments a where a.origin_message_id is null group by a.conversation_id
on conflict (conversation_id) do update set bytes = excluded.bytes, files = excluded.files, cap_bytes = excluded.cap_bytes, updated_at = now();
insert into public.storage_usage (user_id, bytes, files)
select a.attached_by, sum(a.byte_size), count(*)
from public.message_attachments a where a.origin_message_id is null and a.attached_by is not null group by a.attached_by
on conflict (user_id) do update set bytes = excluded.bytes, files = excluded.files, updated_at = now();

-- ------------------------------------------------------------ cleanup queue
create table if not exists private.storage_delete_queue (
  bucket text not null,
  path text not null,
  reason text not null check (reason in ('orphan', 'journal_trash')),
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table private.storage_delete_queue enable row level security;
revoke all on private.storage_delete_queue from public, anon, authenticated;

/** Journal entries past 30 days in Thùng rác: their files (and thumbnails) go to the queue, then the rows go. */
create or replace function private.purge_journal_trash()
returns integer language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare v_n integer;
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', p, 'journal_trash'
  from (
    select a.storage_path as p from message_attachments a join messages m on m.id = a.message_id
    where m.trashed_at is not null and m.trashed_at < now() - interval '30 days' and a.origin_message_id is null
    union
    select regexp_replace(a.storage_path, '/[^/]+$', '/thumb-320.webp') from message_attachments a join messages m on m.id = a.message_id
    where m.trashed_at is not null and m.trashed_at < now() - interval '30 days' and a.origin_message_id is null and a.kind = 'image'
  ) x
  -- never a file another message still points at (forwarded copies share bytes)
  where not exists (
    select 1 from message_attachments b join messages mb on mb.id = b.message_id
    where b.storage_path = x.p and (mb.trashed_at is null or mb.trashed_at >= now() - interval '30 days')
  )
  on conflict do nothing;
  delete from message_attachments a using messages m
  where a.message_id = m.id and m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  delete from messages m where m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/**
 * One batch for the storage-sweep function (service role only): queued deletions plus chat uploads
 * older than 24 hours that no message points at. A photo's thumbnail stays while its photo is attached.
 */
create or replace function public.storage_sweep_batch(p_limit integer default 500)
returns table(bucket text, path text, reason text)
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', o.name, 'orphan'
  from storage.objects o
  where o.bucket_id = 'chat-attachments'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.message_attachments a where a.storage_path = o.name)
    and not (
      o.name like '%/thumb-320.webp'
      and exists (
        select 1 from public.message_attachments a
        where a.storage_path like regexp_replace(o.name, '/thumb-320\.webp$', '/') || '%'
      )
    )
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
  on conflict do nothing;
  return query
    select q.bucket, q.path, q.reason from private.storage_delete_queue q
    order by q.queued_at limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;
revoke execute on function public.storage_sweep_batch(integer) from public, anon, authenticated;
grant execute on function public.storage_sweep_batch(integer) to service_role;

create or replace function public.storage_sweep_done(p_bucket text, p_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from private.storage_delete_queue q where q.bucket = p_bucket and q.path = any(p_paths);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.storage_sweep_done(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_sweep_done(text, text[]) to service_role;

create or replace function private.call_storage_sweep()
returns void language plpgsql security definer set search_path = 'public', 'extensions', 'pg_temp' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/storage-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke execute on function private.call_storage_sweep() from public, anon, authenticated;

select cron.unschedule('avora_storage_sweep') where exists (select 1 from cron.job where jobname = 'avora_storage_sweep');
select cron.schedule('avora_storage_sweep', '27 * * * *', 'select private.call_storage_sweep()');

-- Advisors after K5–K6: cover the new foreign keys.
create index if not exists conversation_appearance_updated_by_idx on public.conversation_appearance (updated_by);
create index if not exists conversation_member_prefs_user_idx on public.conversation_member_prefs (user_id);
create index if not exists messages_sticker_id_idx on public.messages (sticker_id) where sticker_id is not null;
