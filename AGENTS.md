---
# AGENTS.md — Quy tắc bắt buộc khi làm việc trên AVORA

Đọc file này trước khi thực hiện bất kỳ Prompt nào. Đây là quy tắc cứng, ít khi thay đổi — không phải tầm nhìn hay kiến trúc chi tiết (những thứ đó nằm trong tài liệu riêng, được dẫn chiếu trong từng Prompt khi cần).

## 1. Thực thể không được tạo trùng

| Đừng tạo | Dùng thay |
|---|---|
| `diaries` | `conversations` với `type = 'personal'` |
| `context_links`, bảng context chung cho mọi entity | `context_snapshot` (JSON) trên từng entity phù hợp |
| `universal_permissions`, bảng quyền trung tâm | ACL/participant/grant riêng của từng domain |
| `forward_lineage` đệ quy | `origin_content_id` + `sender_id` trên chính reference message |
| Bản sao file cho mỗi nơi nội dung xuất hiện | Asset gốc + reference/context_snapshot trỏ về nó |

## 2. Quyền — chỉ một thang, ba bậc

`view` → `forward` (di chuyển trong AVORA, tạo bản sở hữu thật) → `export` (ra khỏi AVORA). `export` không tự phát sinh từ `forward` — luôn phải xin riêng.

**Trần leo thang theo node, không theo danh tính:** không ai được cấp cho người khác mức quyền cao hơn mức mình đang giữ — kể cả khi hai node liền kề cùng một người. Ai muốn nâng quyền thì xin đúng người vừa cấp cho mình, không xin ngược lên tận gốc.

## 3. Checklist bảo mật — áp dụng cho MỌI Prompt đụng tới database

- Mọi bảng/cột mới: GRANT phải khớp đúng RLS, không thiếu vế nào.
- Mọi hàm SECURITY DEFINER (đặc biệt hàm chạy tự động qua trigger): `REVOKE EXECUTE FROM PUBLIC`, chỉ GRANT cho đúng role cần.
- Pin `search_path` cho hàm SECURITY DEFINER, test dưới role `authenticated`, không phải superuser.
- Không hàm nào được tin `user_id` do client tự gửi lên mà không đối chiếu `auth.uid()`.
- Test với ít nhất 2 tài khoản giả trước khi báo hoàn thành — không chỉ test với 1 tài khoản.
- Không GRANT TRUNCATE cho role authenticated trên bất kỳ bảng nào — TRUNCATE bỏ qua RLS hoàn toàn. Kiểm tra DEFAULT PRIVILEGES để bảng mới không tái sinh quyền này.
- Hàm dùng trong RLS policy (predicate helper) không đặt ở schema `public` — PostgREST sẽ tự biến thành API gọi được trực tiếp. Đặt ở schema riêng không public hoá được.

## 4. Asset tĩnh (logo, icon, ảnh)

Đổi file trong `public/` → **đổi tên file, không ghi đè tên cũ**. Trình duyệt cache theo URL; ghi đè cùng tên khiến người dùng cũ kẹt bản ảnh cũ dù đã deploy bản mới.

## 5. Phạm vi

- Làm đúng phạm vi SCOPE của Prompt. Phần DO NOT MODIFY là tuyệt đối, không "tiện tay" sửa thêm.
- Nếu một phần hệ thống được đánh dấu "Sắp ra mắt"/"chưa xây" trong Prompt — không tự ý dựng logic thật cho nó dù có vẻ dễ.
- Có thể chủ động làm tốt hơn yêu cầu (ví dụ: thêm test, dọn code trùng lặp, sửa lỗi phát hiện được) miễn là **không mở rộng phạm vi dữ liệu hay tính năng** ngoài SCOPE đã cho.

## 6. Giọng điệu sản phẩm

- Không "dạy đời" — giọng chia sẻ, không giọng hệ thống ra lệnh.
- Ma sát (xác nhận, cảnh báo, bước dừng) chỉ đặt ở nơi thật sự cần suy nghĩ kỹ (ví dụ: export dữ liệu nhạy cảm, xoá ký ức người khác) — không rải đều, không làm chậm thao tác thường ngày.
- AVORA chuẩn bị và bàn giao, không tự ý hành động thay người dùng ở bất kỳ hệ thống ngoài nào (gọi điện, lịch, lưu trữ ngoài...).
- Ma sát có thời hạn, không cho phép vĩnh viễn khi thiết kế các cơ chế khoá/tạm dừng có chủ đích (ví dụ: khoá cờ khẩn cấp, mute) — luôn có điểm quay lại bình thường, không để người dùng tự "cài đặt rồi quên".

## 7. Khi không chắc

Nếu một Prompt có vẻ mâu thuẫn với quy tắc trong file này, hoặc với những gì đã có sẵn trong code — dừng lại, báo lại trước khi tự quyết định cách xử lý.

## 8. Tài liệu

Nhật ký quyết định thiết kế lưu tại `DESIGN.md` ở gốc repo — không lưu trong `.rork/` vì thư mục đó bị gitignore.
---
