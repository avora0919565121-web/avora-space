-- KT-08 · QA04-07 (Nặng): 10 tin gửi nhanh mất nhiều giây mới hiện đủ bên nhận.
--
-- Đo trên staging (trước, bản 3a9d22d): bên nhận nhận WS và vẽ tin chỉ ~30 ms sau khi tin vào DB — realtime
-- không nghẽn, bên nhận không refetch theo từng tin. Chỗ chậm là BÊN GỬI: outbox gửi từng tin một, mỗi tin
-- chờ một vòng send_message (~0,7–0,9 s qua mạng), nên tin thứ 10 vào DB sau ~7 s (QA-04/05 đo tới 11–40 s
-- khi mạng chậm hơn). Nay outbox gửi các tin chữ đang xếp hàng của cùng một cuộc trò chuyện thành MỘT lô.
--
-- 1. public.send_messages(p_items jsonb): gửi lần lượt từng tin bằng chính public.send_message (giữ nguyên
--    mọi kiểm tra: quyền, chặn, hạn mức 5 tin/giây · 30 tin/phút, id cố định chống trùng). Mỗi tin trong
--    một savepoint: tin nào lỗi thì dừng ở đó, các tin trước vẫn đi, trả {sent, failed_id, error}; app giữ
--    lại tin lỗi và các tin sau (đúng thứ tự). Tối đa 10 tin/lô.
-- 2. messages.created_at mặc định clock_timestamp() thay vì now(): now() là MỘT giá trị cho cả giao dịch,
--    các tin trong một lô sẽ trùng giờ và thứ tự chỉ còn theo id. clock_timestamp() tăng theo từng dòng nên
--    thứ tự (created_at, id) = thứ tự gửi. Một tin đơn lẻ: khác now() vài micro giây, không ảnh hưởng.
--    (Đã có tiền lệ: AVORA-57 dùng clock_timestamp() để giữ thứ tự gửi.)
-- Áp lại được (idempotent).

alter table public.messages alter column created_at set default clock_timestamp();

create or replace function public.send_messages(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_row public.messages%rowtype;
  v_sent jsonb := '[]'::jsonb;
  v_n int;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'avora_batch_shape'; end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 10 then raise exception 'avora_batch_too_large'; end if;

  for v_item in select e.value from jsonb_array_elements(p_items) with ordinality as e(value, n) order by e.n loop
    begin
      v_row := public.send_message(
        (v_item ->> 'id')::uuid,
        (v_item ->> 'conversation_id')::uuid,
        coalesce(v_item ->> 'content', ''),
        nullif(v_item ->> 'reply_to', '')::uuid,
        '[]'::jsonb,
        case when jsonb_typeof(v_item -> 'refs') = 'array' and jsonb_array_length(v_item -> 'refs') > 0 then v_item -> 'refs' end,
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
          case when jsonb_typeof(v_item -> 'mentioned') = 'array' then v_item -> 'mentioned' else '[]'::jsonb end) x), '{}'::uuid[]),
        nullif(v_item ->> 'origin_group', '')::uuid,
        null,
        coalesce((v_item ->> 'urgent')::boolean, false),
        nullif(v_item ->> 'effect', ''),
        nullif(v_item ->> 'sticker', '')
      );
      v_sent := v_sent || jsonb_build_array(to_jsonb(v_row));
    exception when others then
      -- Stop here: what went before is sent (its savepoint committed); this one and the rest stay queued.
      return jsonb_build_object('sent', v_sent, 'failed_id', v_item ->> 'id', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('sent', v_sent, 'failed_id', null, 'error', null);
end $$;

revoke all on function public.send_messages(jsonb) from public, anon;
grant execute on function public.send_messages(jsonb) to authenticated;
