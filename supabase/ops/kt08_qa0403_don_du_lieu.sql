-- KT-08 · Dọn dữ liệu cũ QA04-03 (AICOS đã duyệt). KHÔNG phải migration: chạy tay một lần.
--
-- Bối cảnh: trigger private.cascade_leave_subgroups (KT-07a2) chỉ áp cho các lần gỡ từ 13/11. Người đã bị gỡ
-- khỏi nhóm cha TRƯỚC đó vẫn còn trong nhóm con/nhóm dự án con.
--
-- STAGING (đã chạy 13/11/2026, 04:4x giờ VN): giới hạn đúng 2 dòng — PH 8b8ecb06… ở 70dfb583… và 7de33915…
-- Trước: 2 dòng mồ côi (cả hai là PH, hai nhóm tầng 3 không có nhóm con). Sau: 0 dòng mồ côi; AICOS, SP,
-- Design vẫn ở cả hai nhóm.
delete from public.conversation_participants cp
using public.conversations c
where c.id = cp.conversation_id
  and cp.user_id = '8b8ecb06-5518-479f-9c06-95f76bdd5a02'
  and cp.conversation_id in ('70dfb583-51bb-4a9e-9476-6f35c5388ff4', '7de33915-6c88-4cd5-a152-03de050added')
  and c.parent_group_id is not null and c.deleted_at is null
  and not exists (select 1 from public.conversation_participants p where p.conversation_id = c.parent_group_id and p.user_id = cp.user_id);

-- LIVE (chưa chạy, cần AICOS/CEO duyệt riêng): câu dọn tổng quát của KT-07. Xem trước bằng SELECT cùng điều
-- kiện, rồi chạy lặp tới khi 0 dòng (3 tầng; trigger cascade cũng tự lan xuống).
-- delete from public.conversation_participants cp using public.conversations c
--  where c.id = cp.conversation_id and c.parent_group_id is not null and c.deleted_at is null
--    and not exists (select 1 from public.conversation_participants p where p.conversation_id = c.parent_group_id and p.user_id = cp.user_id);
