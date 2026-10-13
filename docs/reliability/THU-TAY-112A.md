# Dòng chỉ thử được trên máy thật (gom từ 112-A, sẽ nhập vào `THU-MAY-THAT.md` ở 112-G)

Đây là danh sách thô theo luồng. 112-G sẽ viết thành bước làm, kết quả mong đợi và ô Đạt / Không / Ghi chú, theo thứ tự iPhone → Android → máy tính, và gộp với `docs/AM-BAO-THU-MAY.md` (114) cùng các mục thử tay của 115.

| Luồng | Dòng | Vì sao không tự động được | Máy |
|---|---|---|---|
| 1.1 | Đăng ký / đăng nhập thật (Turnstile, email xác nhận) | Đi qua Supabase Auth thật và Turnstile; khung hai người dùng phiên giả | iPhone, Android, máy tính |
| 1.2 | Để qua đêm, mở lại: còn đăng nhập | Cần thời gian thật (token xoay vòng mỗi giờ) | iPhone (PWA đã cài), máy tính |
| 1.3 | OTP thiết bị mới đến trong 60 giây | Email thật | iPhone, máy tính |
| 1.5 | Mở app lần đầu ≤ 3 giây trên 4G | Mạng và máy thật | iPhone, Android |
| 3.1 / 3.5 | Thông báo khi app đóng: đúng người, đúng cuộc, ≥ 95% trong 10 giây | Push thật của hệ điều hành | iPhone (PWA), Android |
| 3.4 | Đọc ở máy tính → số trên biểu tượng app ở điện thoại về đúng | Huy hiệu biểu tượng thật | iPhone + máy tính |
| 4.4 / 7.3 | Nhắc việc / nhắc thói quen báo đúng giờ, một lần | Push thật, đồng hồ thật | iPhone, Android |
| 5.2 | Mở lại đúng chỗ sau khi hệ điều hành đóng app nền | Hệ điều hành thật | iPhone, Android |
| 6.1 | Gửi ảnh lớn trên 4G: thấy đang gửi, thử lại khi rớt | Mạng thật | iPhone, Android |
| 6.5 | Ảnh thu nhỏ hiện ≤ 1 giây | Mạng thật | iPhone, Android |
| 7.1 / 7.2 | Đồng hồ thói quen sau khoá máy, chuyển app, tắt app (Cứ chạy / Dừng khi rời) | Vòng đời trang thật | iPhone, Android |
| 8.2 | Quên mật khẩu Két sắt: đặt lại bằng email + Bộ khôi phục | Email thật | máy tính |
| 8.4 | Chuyển app khi Két sắt mở: ảnh xem trước trong trình chuyển app không lộ dữ liệu | Ảnh chụp của hệ điều hành | iPhone, Android |
| 10.1 | Cuộc 5.000 tin trên máy tầm trung: 30 tin mới nhất ≤ 1,5 giây | Máy và mạng thật | Android tầm trung |
| 10.2 | Danh bạ 1.000 người cuộn mượt (≥ 50 khung hình/giây) | Đo khung hình cần màn hình thật | Android tầm trung, iPhone |
| 10.3 | Mạng 3G thật / thang máy: gửi 20 tin, không treo, không mất | Mạng thật | iPhone, Android |
| 10.4 | Dùng liên tục 1 giờ: bộ nhớ tăng ≤ 30%, không giật | Công cụ đo bộ nhớ của máy | máy tính (Chrome DevTools), Android |
| 10.5 | Hai máy cùng tài khoản gửi / đọc xen kẽ | Hai máy thật | iPhone + máy tính |
