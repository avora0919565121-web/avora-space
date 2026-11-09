# Tài khoản demo cho người duyệt App Store / Google Play · 111-C (ADR-094)

Người duyệt đăng nhập bằng email + mật khẩu, không có điện thoại của VMT, không nhận được thư xác nhận thiết bị.

## VMT làm (một lần, khoảng 15 phút)
1. **Tạo hai tài khoản** bằng mã mời như người dùng thường:
   - Tài khoản duyệt, ví dụ `review@avorachat.com` (thư về Gmail vận hành qua Cloudflare; nhãn Avora/Hỗ trợ nếu dùng support@ — có thể thêm quy tắc chuyển cho review@).
   - Tài khoản phụ (người thứ hai trong các cuộc trò chuyện mẫu), ví dụ tài khoản thử của VMT.
2. **Thêm mình vào nhóm vận hành** (nếu chưa): `update public.app_config set value = value || '["<uuid của VMT>"]'::jsonb where key = 'ops_user_ids';`
3. **Đánh dấu tài khoản duyệt** (đăng nhập bằng tài khoản ops, gọi RPC hoặc chạy SQL dưới quyền ops):
   `select public.ops_mark_review_account('review@avorachat.com', 'Apple review 2026');`
4. **Gieo dữ liệu mẫu:** `select public.ops_seed_review_data('<uuid tài khoản duyệt>', '<uuid tài khoản phụ>');` Chạy lại bất cứ lúc nào để làm mới.
5. **Đăng nhập tài khoản duyệt một lần** và đặt mật khẩu Két sắt. Ghi mật khẩu tài khoản và mật khẩu Két sắt vào ghi chú gửi duyệt (App Store Connect › App Review Information). Không lưu trong mã.
6. **Thử trên máy lạ** (trình duyệt ẩn danh hoặc máy khác): đăng nhập thẳng, mở được Két sắt, không bị hỏi xác nhận thiết bị.
7. Sau khi duyệt xong có thể gỡ: `select public.ops_unmark_review_account('review@avorachat.com');`

## Điều người duyệt thấy
- 1-1 với tài khoản phụ (3 tin), nhóm "Gia đình · Family (demo)" (2 tin), một báo cáo mẫu, 3 việc riêng + 1 việc giao trong 1-1, dự án "Chuyến đi cuối năm" có một Hạng mục việc, 3 thói quen (Đọc sách có đồng hồ), 2 dòng Nhật ký, tài khoản Tiền mặt với 2 giao dịch, 1 cuốn sách trên kệ.
- Xoá tài khoản: thực thi trong ≤ 5 phút (gọi ngay khi gửi yêu cầu; lịch dự phòng mỗi 5 phút).

## Ngoại lệ của tài khoản demo (tất cả qua `private.is_review_account`)
| Ngoại lệ | Hàm |
|---|---|
| Khoá thiết bị không chặn | `private.session_device_ok`, `public.device_status` |
| Két sắt mở trên máy chưa xếp Ưu tiên | `private.vault_device_allowed` |
| Không bị chặn vì thiếu mã mời | `private.invite_blocks` |
| Xoá ≤ 5 phút | `private.account_deletion_grace`, trigger `account_deletion_review_now`, cron `avora_delete_review_account` |

Tài khoản thường giữ nguyên mọi bước (bài kiểm `supabase/tests/avora111c_review.sql`).
