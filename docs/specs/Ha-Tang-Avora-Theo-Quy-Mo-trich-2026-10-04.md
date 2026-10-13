# Trích từ "Hạ tầng Avora theo quy mô" (ảnh chụp 04/10/2026, mục 0 và 4)

> Ảnh chụp ngày 04/10; mã thật đã khác (K3 đưa tin nhắn vào Broadcast theo từng người). Dùng cho 112-D: đọc mã thật trước, chỉ làm phần còn thiếu.

## 0. Phát hiện quan trọng nhất trong code ngày 04/10
**Realtime đang nghe toàn bảng, không lọc.**
- `lib/realtime.tsx` (dòng 403–427 ngày 04/10): mỗi người dùng đăng ký `postgres_changes` trên **toàn bảng** `messages`, `tasks`, `task_suggestions`, `conversation_read_marks`… và để RLS lọc.
- Mỗi tin mới bị Supabase **kiểm RLS cho từng người đang mở app**, kể cả người không liên quan; mỗi lần kiểm chạy `session_allowed` và các hàm quyền. Một tin × 500 người online = 500 lần kiểm quyền. Bậc 10.000 người dùng là đã nghẽn.
- **Sửa:** chuyển sang **Broadcast có phân quyền**. Trigger trên `messages` / `tasks` gửi sự kiện vào **kênh riêng của từng cuộc trò chuyện hoặc từng người** (`realtime.send` / `broadcast_changes`), kèm Realtime Authorization, để mỗi tin chỉ đi tới đúng người trong cuộc.

## 4. Việc nên làm ngay (liên quan đến 112-D)
1. **Realtime: Broadcast theo kênh cuộc trò chuyện / người, bỏ `postgres_changes` toàn bảng.** Nghẽn đầu tiên, ngay ở mốc 10 nghìn.
2. Soát chỉ mục: `messages(conversation_id, created_at desc)`, `tasks(...)`; thiết kế `messages` sẵn để chia phân vùng theo thời gian.
3. Theo dõi `session_allowed` và các hàm quyền bằng `pg_stat_statements`: policy RESTRICTIVE chạy với **mọi** truy vấn nên phải rẻ (cache theo phiên). (Đo cái này ở 112-D khi báo trước/sau.)

## Giả định tải để đo (50.000 người đăng ký)
40% hoạt động mỗi ngày (khoảng 20.000), 8% đồng thời cao điểm (khoảng 4.000), mỗi người dùng gửi khoảng 40 tin/ngày, mỗi tin tới trung bình 3 người, khoảng 800.000 tin/ngày. Bài mô phỏng ở 112-D dùng 50 người cùng mở app làm mốc so sánh trước/sau.
