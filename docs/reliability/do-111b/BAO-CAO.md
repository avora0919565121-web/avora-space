# Báo cáo 111-B · An toàn nội dung (09/11/2026)

ADR-093. Migration `20261110090000_avora111b_safety.sql` (đã áp live). Commit trước khối: `a435bec` (111-A). Git chỉ đọc nên không đặt được tên commit theo mã khối; Rork tự commit cuối lượt.

## 1. Cổng kiểm (theo vùng — toàn bộ browser để FINAL)

| Bộ | Kết quả |
|---|---|
| SQL | **32 / 32** (+`avora111b_safety.sql`, 11 mục, `AVORA111B failures=0`) |
| Unit | **2.367 / 2.367** (142 tệp; +`avora111b-safety.test.ts`; sửa `blocks-reports.test.ts` 9 lý do, `policy-content.test.ts` phiên bản) |
| Browser (vùng) | `avora111b` **11/11** (mới) · `avora115` 8/8 (sửa luồng báo cáo ảnh) · `screens-58-60` + `screens-61-63` + `scroll-x-screens` **173/173** |
| Lint | **61** cảnh báo (đúng giới hạn) |
| tsc · build · runChecks web | sạch |
| Advisor | để sau 111-D |

## 2. Đỏ trước, xanh sau

| Lớp | Đỏ | Xanh | Tệp |
|---|---|---|---|
| SQL | hàm / bảng 111-B chưa có, người bị khoá vẫn đọc ghi được | 11/11 | `red-before-sql.txt` · `green-after-sql.txt` |
| Web unit | không chụp riêng (đỏ đã chứng minh ở SQL; unit kiểm map lỗi và hình dạng gọi RPC) | xanh | `web/src/test/avora111b-safety.test.ts` |
| Browser | chưa có luồng | 11/11 | `web/src/test/avora111b.browser.test.tsx` |

## 3. Chi phí `session_allowed` (khoá tài khoản nằm trong hàm này)

| | Mỗi lần gọi | `count(*) messages` |
|---|---|---|
| Trước | ~37–39 µs | 3,07–3,70 ms |
| Sau (3 lần) | 56,65 / 51,10 / 50,58 µs | 3,70 / 3,17 / 3,06 ms |

+~14 µs mỗi lần gọi do hàm lồng; truy vấn không đổi vì chính sách gọi qua initplan. Năm chính sách còn gọi theo từng dòng đã bọc `(select private.session_allowed())`: `disappear_proposals`, `conversation_member_prefs`, `conversation_appearance`, `conversation_storage`, `storage_usage` — đếm lại còn **0**. Số đo: `measure-before.txt`, `measure-after.txt`, `measure-session-allowed.sql`.

## 4. Ảnh (`.test-output/screens/111b/`, 390×844)

bao-cao-tep · da-nhan-bao-cao · tai-khoan-bi-khoa · dong-y-dieu-khoan · khong-dong-y · dang-ky-dong-y · quan-tri-bao-cao (thêm 1280×800).

## 5. Lưu ý

- Bộ từ lọc khởi đầu chỉ là điểm xuất phát, chưa phân tầng mức độ.
- Điều khoản sử dụng và Quy tắc cộng đồng bản `2026-11-10` là **bản nháp, cần luật sư rà**.
- Điều khoản chỉ ép ở client; máy chủ chưa chặn ghi khi chưa đồng ý (chủ ý, xem ADR-093).
- Tên hiển thị chứa từ bị lọc lúc đăng ký: tài khoản vẫn tạo, tên để trống.

## 6. VMT cần làm

1. Thêm ID nhóm vận hành (live đang `[]`):
   `update public.app_config set value = value || '["<uuid>"]'::jsonb where key='ops_user_ids';`
2. Gỡ khoá một tài khoản khi cần:
   `delete from private.account_suspensions where user_id='<uuid>';`
3. Tạo 4 hộp thư: support@, privacy@, abuse@, security@avorachat.com.
4. Gửi Điều khoản / Quy tắc cộng đồng cho luật sư; rà bộ từ lọc khởi đầu.
5. Thử trên máy thật: báo cáo tin có tệp, báo cáo nhóm, màn bị khoá (khoá tạm testerb 1 ngày rồi gỡ).
