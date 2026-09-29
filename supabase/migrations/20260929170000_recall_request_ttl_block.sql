-- Đợt gộp 2 · D4 bổ sung — Đề nghị thu hồi tin không chờ mãi.
--   · Open for 30 days; after that the hourly proposal sweep closes it (close_reason 'expired').
--   · A blocked pair (either direction, any room — same rule as tasks and suggestions in D4) closes it
--     at once (close_reason 'closed').
--   · System line: only for an expiry in a 1-1, where the two people are the whole room. A recall ask
--     is private to the asker and the sender (RLS), so a line in a group would tell everyone who objected
--     to whom; and a block is never announced to the blocked person (AVORA-37), so closing on a block
--     writes nothing anywhere. The message itself is never touched.

alter table public.message_recall_request add column if not exists close_reason text;
alter table public.message_recall_request drop constraint if exists message_recall_request_close_reason_check;
alter table public.message_recall_request add constraint message_recall_request_close_reason_check
  check (close_reason is null or close_reason in ('expired', 'closed'));
alter table public.message_recall_request drop constraint if exists message_recall_request_close_reason_resolved;
alter table public.message_recall_request add constraint message_recall_request_close_reason_resolved
  check (close_reason is null or resolved_at is not null);

-- The sender answers by setting resolved_at only; the close reason is the server's to write.
revoke update on public.message_recall_request from authenticated;
grant update (resolved_at) on public.message_recall_request to authenticated;

alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (
  system_kind is null or system_kind in ('project_deleted', 'proposal_opened', 'proposal_approved',
    'proposal_rejected', 'proposal_expired', 'proposal_withdrawn', 'shared_restored', 'recall_expired'));

-- Closes every open ask whose two people are now blocked. Silent by design.
create or replace function private.close_blocked_recall_requests()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update message_recall_request r set resolved_at = now(), close_reason = 'closed'
  from messages m
  where m.id = r.message_id and r.resolved_at is null
    and private.is_blocked_between(m.sender_id, r.requested_by);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.close_blocked_recall_requests() from public, anon, authenticated;

-- Expires asks older than 30 days; one line per expired ask, in a 1-1 only.
create or replace function private.expire_recall_requests()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; v_n integer := 0;
begin
  for v in
    update message_recall_request r set resolved_at = now(), close_reason = 'expired'
    from messages m join conversations c on c.id = m.conversation_id
    where m.id = r.message_id and r.resolved_at is null and r.created_at < now() - interval '30 days'
    returning r.requested_by, m.conversation_id, c.type, c.deleted_at
  loop
    v_n := v_n + 1;
    if v.type = 'direct' and v.deleted_at is null then
      begin
        perform private.post_system_line(v.conversation_id, v.requested_by, 'recall_expired',
          'Đề nghị thu hồi một tin nhắn đã hết hạn sau 30 ngày. Tin nhắn vẫn giữ nguyên.');
      exception when others then
        raise warning 'avora_recall_expiry_line_failed';
      end;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.expire_recall_requests() from public, anon, authenticated;

create or replace function private.close_blocked_recall_requests_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.close_blocked_recall_requests();
  return null;
end $$;
revoke all on function private.close_blocked_recall_requests_trigger() from public, anon, authenticated;

drop trigger if exists user_blocks_close_recall_requests on public.user_blocks;
create trigger user_blocks_close_recall_requests after insert on public.user_blocks
  for each statement execute function private.close_blocked_recall_requests_trigger();

-- The existing hourly proposal sweep (avora_sweep_shared_proposals, minute 7) now also covers recall asks.
create or replace function private.sweep_shared_proposals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare v shared_proposals%rowtype; v_n integer := 0;
begin
  for v in select * from shared_proposals where status = 'open' order by created_at loop
    begin
      if v.created_at < now() - interval '14 days' then
        update shared_proposals set status = 'expired', resolved_at = now() where id = v.id;
        perform private.post_system_line(v.conversation_id, v.proposed_by, 'proposal_expired',
          format('Hết hạn — chưa đủ đồng ý để %s.', private.proposal_words(v.action, v.target_type, v.target_name)));
      else
        perform private.settle_proposal(v.id, v.proposed_by);
        if v.reminded_at is null and v.created_at < now() - interval '3 days' then
          update shared_proposals set reminded_at = now() where id = v.id and status = 'open';
        end if;
      end if;
      v_n := v_n + 1;
    exception when others then
      raise warning 'avora_sweep_proposal_failed %', v.id;
    end;
  end loop;
  begin
    v_n := v_n + private.close_blocked_recall_requests() + private.expire_recall_requests();
  exception when others then
    raise warning 'avora_sweep_recall_failed';
  end;
  return v_n;
end $function$;
revoke all on function private.sweep_shared_proposals() from public, anon, authenticated;
