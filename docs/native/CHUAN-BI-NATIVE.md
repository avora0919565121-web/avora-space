# Chuẩn bị native · 111-D (ADR-095)

Bản native đầu tiên (Capacitor, đóng gói ngoài Rork) **không hiện** bất cứ thứ gì liên quan tới tiền: Donation, ủng hộ, "mua cho tôi ly cà phê", gói Standard/Pro/Business, giá, "miễn phí năm đầu", link tới trang thanh toán ngoài. Không thay bằng câu hướng dẫn mua ở nơi khác. Mua trong ứng dụng làm ở bản sau.

## Cờ

| Hàm (`web/src/lib/platform.ts`) | Trả về |
|---|---|
| `isNativeShell()` | `true` khi `window.Capacitor.isNativePlatform()` đúng |
| `platformName()` | `ios` · `android` · `web` |
| `canShowPayments()` | `!isNativeShell()` |

**Thử trên trình duyệt (chỉ bản dev/test):** thêm `?shell=native` vào địa chỉ; giữ trong tab cho tới khi mở `?shell=web`. Bản build chính thức bỏ qua tham số này.

## Điểm đã bọc cờ (rà 09/11/2026)

| Nơi | Nội dung | Cách bọc |
|---|---|---|
| Chính sách › Điều khoản (`policy-content.ts · TERMS · free`) | "AVORA miễn phí. Ủng hộ là tự nguyện, không mở khoá tính năng." | `payments: true` → `PolicyView` lọc bằng `visiblePolicyItems(…, canShowPayments())` |

Rà toàn bộ `web/src` (trừ test, spike, kiểu Supabase) theo: donat, ủng hộ, cà phê/coffee, Pro, Standard, bảng giá, trả phí, thu phí, thanh toán, /tháng, VNĐ, "miễn phí năm đầu", link ngoài. Chỉ thấy đúng một câu ở trên. Hướng dẫn sử dụng (`guide-content.ts`), Cài đặt, Hồ sơ: không có câu nhắc tiền. Màn Donation (AVORA-23) **chưa xây**: khi xây, bọc cả màn bằng `canShowPayments()`.

Test giữ cho danh sách này không lọt câu mới: `web/src/test/avora111d-platform.test.ts` quét mọi câu Chính sách và Hướng dẫn; câu nào khớp biểu thức tiền mà thiếu `payments: true` thì đỏ.

## Việc còn lại để làm Capacitor (không thuộc web, không làm ở Rork)

1. Tạo dự án Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`), `webDir = web/dist`.
2. Push native: thay Web Push bằng APNs/FCM (`@capacitor/push-notifications`); `send-push` thêm nhánh native.
3. Deep link `avorachat.com` → app (Universal Links / App Links) cho liên kết mời, xác nhận thiết bị, đặt lại mật khẩu.
4. Khoá màn hình và Face ID cho Két sắt (`@capacitor-community/biometric-auth` hoặc tương đương) — tuỳ chọn.
5. Tài khoản demo cho người duyệt (111-C) và ghi chú gửi duyệt: email, mật khẩu, mật khẩu Két sắt do VMT đặt.
6. Thử máy thật theo `docs/reliability/THU-MAY-THAT.md` trên bản đóng gói (không chỉ trình duyệt).
