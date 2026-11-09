-- 111-A · ĐỎ: tái hiện hành vi TRƯỚC 111-A trong một giao dịch rollback.
-- Đặt lại khoá ngoại messages.sender_id về ON DELETE CASCADE như cũ, xoá A thẳng (không qua account_purge).
do $red$
declare a uuid := private.test_ephemeral_user('A'); b uuid := private.test_ephemeral_user('B');
  d uuid := gen_random_uuid(); g uuid := gen_random_uuid(); n_d int; n_g int; grp boolean; err text := 'none';
begin
  alter table public.messages drop constraint messages_sender_id_fkey;
  alter table public.messages add constraint messages_sender_id_fkey foreign key (sender_id) references auth.users(id) on delete cascade;
  insert into public.conversations (id, type) values (d, 'direct'), (g, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'red', a);
  insert into public.conversation_participants (conversation_id, user_id, role) values (d, a, 'member'), (d, b, 'member'), (g, a, 'owner'), (g, b, 'member');
  insert into public.messages (conversation_id, sender_id, content) select x, a, 'Tin ' || i from generate_series(1, 5) i, unnest(array[d, g]) x;
  perform set_config('request.jwt.claims', '', true);
  begin
    delete from auth.users where id = a;
  exception when others then err := sqlerrm;
  end;
  select count(*) into n_d from public.messages where conversation_id = d;
  select count(*) into n_g from public.messages where conversation_id = g;
  grp := exists (select 1 from public.conversation_groups where conversation_id = g);
  raise exception 'PROBE RED · B thấy 1-1=%/5, nhóm=%/5 · nhóm còn sidecar=% · lỗi xoá=%', n_d, n_g, grp, err;
end $red$;
