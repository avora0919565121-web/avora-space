# Thử trên máy thật (AVORA-112-G)

Những dòng ở đây **không thử tự động được**: push của hệ điều hành, âm thanh thật, Face ID, mạng thật, đồng hồ thật, vòng đời app trên điện thoại.
Danh sách gộp từ `THU-TAY-112A.md` (112-A), `docs/AM-BAO-THU-MAY.md` (114) và các lỗi mới tìm thấy ngày 01/11 (lệch đồng hồ, 429, ghi chú nhân bản).

**Cách dùng:** làm theo thứ tự iPhone → Android → máy tính. Mỗi dòng ghi `Đạt`, `Không` hoặc ghi chú ngắn (máy, phiên bản hệ điều hành, giờ thử).
Dòng `Không` thì chụp màn hình và ghi giờ để đối chiếu nhật ký.

Tài khoản thử: **testera** và **testerb**. Không dùng tài khoản người thật.

## Chuẩn bị

- iPhone (iOS 16.4 trở lên): mở Avora trong Safari › Chia sẻ › **Thêm vào Màn hình chính**. Từ đây gọi là "PWA".
- Android tầm trung (Chrome): cài Avora từ menu Chrome › **Cài đặt ứng dụng**.
- Máy tính: Chrome và Safari (Mac).
- Hai người: một người cầm testera, một người cầm testerb.

## A. iPhone

| # | Nguồn | Bước làm | Kết quả mong đợi | Đạt / Không / Ghi chú |
|---|---|---|---|---|
| A1 | 112A · 1.1 | Đăng xuất. Đăng nhập lại testera trong PWA (có Turnstile). | Vào được trong ≤ 5 giây, không hiện chữ tiếng Anh thô. | |
| A2 | 112A · 1.3 | Đăng nhập testera trên một trình duyệt chưa dùng bao giờ (Safari riêng tư). | Email mã xác nhận thiết bị đến trong **≤ 60 giây**. | |
| A3 | 112A · 1.2 | Để PWA ở nền qua đêm (≥ 8 giờ). Sáng mở lại. | Vẫn đăng nhập, thấy ngay danh sách cuộc trò chuyện. | |
| A4 | 112A · 1.5 | Đóng hẳn PWA. Tắt Wi-Fi, chỉ dùng 4G. Mở lại, bấm giờ. | Thấy nội dung trong **≤ 3 giây**. | |
| A5 | 01/11 · lệch đồng hồ | Cài đặt iPhone › Cài đặt chung › Ngày & Giờ: tắt **Đặt tự động**, chỉnh **sớm 1 giờ**. Mở PWA, dùng 5 phút (gửi tin, mở Két sắt). Lặp lại với **muộn 1 giờ**. Xong thì bật lại Đặt tự động. | Không bị đăng xuất, không có vòng tải lại, tin gửi đi bình thường. | |
| A6 | 112A · 3.1 / 3.5 | Đóng hẳn PWA trên máy testera. testerb gửi 10 tin, mỗi tin cách nhau 30 giây. | ≥ 10/10 thông báo đến trong 10 giây; bấm vào mở **đúng cuộc** với testerb. | |
| A7 | 114 · 7 | Như A6, lắng nghe. | Thông báo có **âm mặc định** của máy. | |
| A8 | 114 · 1 | Mở PWA, chạm một lần bất kỳ. testerb gửi tin vào cuộc **testera không đang mở**. | Nghe tiếng. Nếu chưa chạm lần nào: thấy dải "Chạm vào màn hình để bật âm báo." | |
| A9 | 114 · 2 | Cài đặt › Thông báo › **Nghe thử**. | Nghe tiếng; dòng kết quả "Đã phát". | |
| A10 | 114 · 3 | Gạt nút im lặng bên hông, lặp lại A8. | Ghi lại có nghe hay không (iOS thường tắt âm web khi gạt im lặng). | |
| A11 | 114 · 4 | Mở Avora trong Safari thường (không phải PWA), lặp lại A8. | Nghe tiếng. | |
| A12 | 114 · 8 | Bật `Đọc yên tĩnh`; rồi tắt thông báo một nhóm; rồi bật Chế độ tập trung. Mỗi lần testerb gửi tin. | Không có tiếng. Cài đặt › Thông báo › "Vì sao tôi không nghe thấy?" ghi đúng lý do từng lần. | |
| A13 | 112A · 3.4 | Có 3 tin chưa đọc → số trên biểu tượng PWA là 3. Mở cuộc đó trên **máy tính**. | Trong ≤ 1 phút số trên biểu tượng iPhone về 0 (hoặc đúng số còn lại). | |
| A14 | 112A · 4.4 / 7.3 | Tạo nhắc việc lúc **+3 phút**, một thói quen nhắc lúc **+5 phút**. Khoá máy. | Mỗi nhắc đến **đúng giờ (±1 phút), đúng một lần**. | |
| A15 | 112A · 7.1 | Bắt đầu đồng hồ thói quen chế độ **Cứ chạy**. Khoá máy 5 phút, mở lại. | Đồng hồ đã chạy thêm ~5 phút, không về 0. | |
| A16 | 112A · 7.2 | Đồng hồ chế độ **Dừng khi rời**. Chuyển sang app khác 2 phút rồi quay lại. | Đồng hồ dừng đúng lúc rời, không cộng 2 phút. | |
| A17 | 112A · 7.1 | Đồng hồ chế độ Cứ chạy, **vuốt tắt hẳn PWA**, mở lại sau 3 phút. | Đồng hồ còn, đã cộng ~3 phút. | |
| A18 | 112A · 5.2 | Đang soạn dở một ghi chú. Mở 6–8 app nặng (camera, game) cho iOS đóng PWA ở nền. Mở lại. | Mở lại đúng màn đang dở; chữ đang gõ còn. | |
| A19 | Face ID | Két sắt › bật mở khoá bằng Face ID. Khoá két, mở lại bằng Face ID. Rồi che mặt / để người khác thử. | Mở bằng Face ID được; người khác không mở được, rơi về nhập mã. | |
| A20 | 112A · 8.4 | Mở Két sắt đang hiện mật khẩu. Vuốt lên mở trình chuyển app. | Ảnh xem trước của Avora **không lộ** dữ liệu két. | |
| A21 | 112A · 6.1 / 6.5 | Trên 4G gửi một ảnh ≥ 5 MB. Giữa chừng bật chế độ Máy bay 5 giây rồi tắt. | Thấy đang gửi; rớt mạng thì báo và tự / bấm thử lại; ảnh đến **một lần**. Ảnh thu nhỏ bên kia hiện ≤ 1 giây. | |
| A22 | 112A · 10.3 | Bật 3G (hoặc vào thang máy). Gửi 20 tin liên tiếp. | Không treo, không mất tin, không trùng tin; tin chờ có dấu đang gửi. | |
| A23 | 01/11 · ghi chú nhân bản | Trong Sách, bấm **Hỏi Avora** về một đoạn **một lần**. Sau đó bấm Lùi, rồi Tiến, rồi tải lại trang. | Đúng **1 ghi chú** được tạo; địa chỉ trang không còn tham số sách; Lùi không tạo thêm ghi chú. | |

## B. Android (Chrome, máy tầm trung)

| # | Nguồn | Bước làm | Kết quả mong đợi | Đạt / Không / Ghi chú |
|---|---|---|---|---|
| B1 | 112A · 1.1 | Đăng nhập testerb trong app đã cài. | Vào được trong ≤ 5 giây. | |
| B2 | 112A · 1.5 | Đóng hẳn app, chỉ dùng 4G, mở lại. | Thấy nội dung ≤ 3 giây. | |
| B3 | 01/11 · lệch đồng hồ | Cài đặt › Ngày giờ: tắt tự động, chỉnh **±1 giờ** (hai lần). Dùng 5 phút mỗi lần. | Không đăng xuất, không vòng tải lại. | |
| B4 | 112A · 3.1 / 3.5 · 114 · 7 | Đóng hẳn app. testera gửi 10 tin. | ≥ 10/10 thông báo trong 10 giây, âm mặc định + **rung ngắn**, bấm mở đúng cuộc. | |
| B5 | 114 · 6 | Mở app, chạm một lần. testera gửi tin vào cuộc khác. | Nghe tiếng. | |
| B6 | 112A · 4.4 / 7.3 | Như A14. | Đúng giờ, đúng một lần. | |
| B7 | 112A · 7.1 / 7.2 | Như A15, A16, A17. | Như iPhone. | |
| B8 | 112A · 5.2 | Như A18 (Android hay đóng app nền hơn). | Mở lại đúng chỗ. | |
| B9 | 112A · 8.4 | Như A20 (nút Gần đây). | Ảnh xem trước không lộ dữ liệu két. | |
| B10 | 112A · 6.1 / 6.5 | Như A21. | Như iPhone. | |
| B11 | 112A · 10.1 | Mở một cuộc có ~5.000 tin (testera ↔ testerb). | 30 tin mới nhất hiện ≤ 1,5 giây. | |
| B12 | 112A · 10.2 | Mở Danh bạ có ~1.000 người, cuộn nhanh từ đầu đến cuối. | Mượt, không khựng thấy rõ (≥ 50 khung hình/giây nếu có công cụ đo). | |
| B13 | 112A · 10.3 | Như A22 trên 3G thật. | Như iPhone. | |
| B14 | 112A · 10.4 | Dùng liên tục **1 giờ** (chat, chuyển tab, mở sách). Chrome › `chrome://inspect` nếu có. | Không giật dần; bộ nhớ tăng ≤ 30%. | |

## C. Máy tính (Chrome, Safari)

| # | Nguồn | Bước làm | Kết quả mong đợi | Đạt / Không / Ghi chú |
|---|---|---|---|---|
| C1 | 112A · 1.1 / 1.3 | Đăng nhập testera trên Chrome mới. | Email mã thiết bị ≤ 60 giây; vào được. | |
| C2 | 112A · 1.2 | Để tab mở qua đêm, máy ngủ. Sáng mở lại. | Vẫn đăng nhập. | |
| C3 | 01/11 · 429 | Đang đăng nhập. Chrome DevTools › Network › chuột phải lệnh `token?grant_type=refresh_token` › **Override headers/content**, đặt mã trả về **429**. Chờ đến lượt làm mới phiên (tối đa 1 giờ; nhanh hơn: chỉnh giờ máy +55 phút). | **Không bị đăng xuất.** Khi bỏ override, phiên tự làm mới tiếp. | |
| C4 | 01/11 · mất mạng | Như C3 nhưng tắt mạng hẳn khi làm mới phiên. | Không bị đăng xuất; có mạng lại thì dùng tiếp. | |
| C5 | 01/11 · lệch đồng hồ | Chỉnh giờ máy tính **±1 giờ**, dùng 5 phút. | Không đăng xuất, không vòng tải lại. | |
| C6 | 114 · 5 | Chrome rồi Safari: chạm một lần, testerb gửi tin cuộc khác. | Nghe tiếng ở cả hai. | |
| C7 | 112A · 8.2 | Két sắt › Quên mật khẩu: đặt lại bằng email + Bộ khôi phục. | Email đến; đặt lại được; dữ liệu két còn nguyên. | |
| C8 | 112A · 10.4 | Dùng liên tục 1 giờ. Chrome DevTools › Memory, chụp trước và sau. | Bộ nhớ tăng ≤ 30%, không giật. | |
| C9 | 112A · 10.5 | testera mở trên iPhone **và** máy tính cùng lúc. Gửi xen kẽ 10 tin từ hai máy; testerb trả lời. | Hai máy thấy cùng thứ tự, không thiếu, không trùng; đã đọc ở máy này thì máy kia cập nhật. | |
| C10 | 01/11 · ghi chú nhân bản | Như A23 trên Chrome, thêm: bấm Hỏi Avora rồi bấm F5 ngay. | Vẫn đúng 1 ghi chú. | |

## Ghi kết quả

- Người thử · ngày · máy: ……………………
- Số dòng Đạt / tổng: …… / 47
- Dòng Không (ghi số dòng + ảnh): ……………………
