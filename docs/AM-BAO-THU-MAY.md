# Âm báo tin nhắn — thử trên máy thật (AVORA-114)

Phần này không thử tự động được: âm thanh thật, nút gạt im lặng, chính sách tự phát của từng trình duyệt.
Khối FINAL sẽ gộp danh sách này vào `docs/reliability/THU-MAY-THAT.md`.

| # | Máy | Bước làm | Kết quả mong đợi | Đạt / Không / Ghi chú |
|---|---|---|---|---|
| 1 | iPhone, Avora đã thêm vào màn hình chính | Mở Avora, chạm một lần bất kỳ. Nhờ người khác gửi tin vào cuộc **bạn không đang mở**. | Nghe tiếng. Nếu chưa chạm lần nào: thấy dải "Chạm vào màn hình để bật âm báo." | |
| 2 | Cùng iPhone | Cài đặt › Thông báo › **Nghe thử** | Nghe tiếng; dòng kết quả "Đã phát". | |
| 3 | Cùng iPhone | Gạt nút im lặng bên hông, lặp lại (1) | Ghi lại có nghe hay không (iOS thường tắt âm web khi gạt im lặng). | |
| 4 | iPhone, Safari thường | Lặp lại (1) | Nghe tiếng. | |
| 5 | Mac — Chrome và Safari | Lặp lại (1) | Nghe tiếng. | |
| 6 | Android — Chrome | Lặp lại (1) | Nghe tiếng. | |
| 7 | Bất kỳ máy đã bật thông báo | Đóng hẳn app, nhờ người gửi tin | Thông báo hệ thống với **âm mặc định** của máy (Android rung ngắn). | |
| 8 | Bất kỳ | Bật `Đọc yên tĩnh`; rồi tắt thông báo một nhóm; rồi bật Chế độ tập trung. Mỗi lần nhờ người gửi tin. | Không có tiếng. Cài đặt › Thông báo › "Vì sao tôi không nghe thấy?" ghi đúng: `Đang Đọc yên tĩnh` · `Đã tắt thông báo cuộc/nhóm` · `Đang ở Chế độ tập trung`. | |

## Thông báo khi app đóng

Thông báo đẩy của trình duyệt dùng **âm mặc định của hệ điều hành**; `sw.js` đặt rõ `silent: false` và
`vibrate: [80]` (chỉ Android dùng). Avora không có âm riêng cho thông báo đẩy trên web — âm riêng chỉ có khi có bản
app gốc (native).
