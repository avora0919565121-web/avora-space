-- AVORA-37 / B — Báo cáo.
--
-- A report tells AVORA about a person (optionally one message) so an account can be dealt
-- with. The reported person is never told. v1 has no admin screen: VMT reads the table in the
-- Supabase dashboard (service role), which is the only way to see anyone else's report.
--
-- The message text is copied by the SERVER, and only when the reporter explicitly agreed
-- (p_include_message) and is a member of the conversation that message belongs to. Nothing
-- the client sends is ever stored as reported_content.
--
-- New objects only — no existing definition is changed. report_user calls block_user
-- (AVORA-37 / A) in the same transaction when p_also_block is true.

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  reason text not null
    constraint user_reports_reason_check
    check (reason in ('harassment', 'scam', 'inappropriate', 'impersonation', 'other')),
  note text constraint user_reports_note_len check (note is null or char_length(note) <= 500),
  reported_content text
    constraint user_reports_content_len check (reported_content is null or char_length(reported_content) <= 4000),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint user_reports_not_self check (reporter_id <> reported_user_id)
);

-- The daily limit counts the reporter's own rows for the last 24 hours.
create index user_reports_reporter_created_idx on public.user_reports (reporter_id, created_at desc);

alter table public.user_reports enable row level security;

revoke all on public.user_reports from anon, authenticated, public;
grant select, insert on public.user_reports to authenticated;

create policy user_reports_insert_own on public.user_reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));
-- A reporter reads back only their own reports. Nobody else can read any row through the API.
create policy user_reports_select_own on public.user_reports
  for select to authenticated using (reporter_id = (select auth.uid()));

create or replace function public.report_user (
  p_user_id uuid,
  p_reason text,
  p_note text default null,
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_include_message boolean default false,
  p_also_block boolean default true
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_conversation uuid := p_conversation_id;
  v_content text;
  v_msg public.messages%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'avora_report_self'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'avora_user_not_found';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'scam', 'inappropriate', 'impersonation', 'other') then
    raise exception 'avora_report_reason_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'avora_report_note_max_len'; end if;

  -- Serialise one reporter's calls so two parallel requests cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('avora_report:' || v_uid::text, 0));
  if (select count(*) from public.user_reports
      where reporter_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'avora_report_limit';
  end if;

  -- A conversation or message the reporter is not part of is dropped, not echoed back:
  -- the report still goes in, but it carries no pointer and no text from somewhere the
  -- reporter could not read.
  if v_conversation is not null and not private.is_conversation_participant (v_conversation, v_uid) then
    v_conversation := null;
  end if;

  if p_message_id is not null then
    select * into v_msg from public.messages where id = p_message_id;
    if found
       and private.is_conversation_participant (v_msg.conversation_id, v_uid)
       and v_msg.sender_id = p_user_id then
      v_conversation := v_msg.conversation_id;
      if coalesce(p_include_message, false) and v_msg.deleted_at is null then
        v_content := left(v_msg.content, 4000);
      end if;
    else
      v_msg := null;
    end if;
  end if;

  insert into public.user_reports (
    reporter_id, reported_user_id, conversation_id, message_id, reason, note, reported_content
  )
  values (v_uid, p_user_id, v_conversation, v_msg.id, p_reason, v_note, v_content)
  returning id into v_id;

  if coalesce(p_also_block, false) then
    perform public.block_user (p_user_id);
  end if;

  return v_id;
end;
$$;

revoke all on function public.report_user (uuid, text, text, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.report_user (uuid, text, text, uuid, uuid, boolean, boolean) to authenticated;
