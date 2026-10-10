# Thói quen — đặc tả thiết kế (VMT chốt 08/10/2026 13:37 · bổ sung 23:13)

Bản lưu trong repo của tệp VMT gửi kèm KHỐI 2D (AVORA-107). Nguồn duy nhất cho nội dung, chữ và luật.

## 1. Ý tưởng và vị trí
- Thói quen tạo nên tính cách và định hình số phận — xu hướng, không tuyệt đối. Avora giúp chọn thói quen và theo dõi theo chu kỳ người dùng đặt.
- **Thói quen là kỷ luật, nhiệm vụ là trách nhiệm.** Không biến thói quen thành nhiệm vụ.
- Vị trí: mục `Thói quen` trong Nhiệm vụ + một bảng trong Bảng Avora mặc định (khu Nhiệm vụ). Không dựng hub riêng (ADR-018).
- AVORA-77 D6: thói quen đọc sách nay là một thói quen.
- Chỉ cá nhân. Không chia sẻ, không so sánh. Tìm được như Hạng mục.
- Avora Space: chỉ một dòng xem `Thói quen hôm nay 2/5` (ADR-013).

## 2. Duy trì (không gamification)
Không chuỗi ngày, không huy hiệu, không điểm.
1. Tiến độ trung tính: `Hôm nay 2/3` · `Tuần này 5/7` · `4 tuần gần nhất: 5/7 · 6/7 · 4/7 · 7/7` · `Tổng 48 lần`.
2. Lỡ một ngày không bị "đứt"; không chữ đỏ, không "trễ / quá hạn / thất bại"; chưa làm ghi `Chưa làm` (mờ).
3. Treo đến khi làm: còn trong Hôm nay đến hết ngày; qua ngày chưa làm → `Chưa làm`, không dồn.
4. Khung giờ bắt buộc khi tạo.
5. Bắt đầu nhỏ: thói quen có đồng hồ gợi ý số phút nhỏ.
6. Nhìn lại tuần / hôm nay: khối Thói quen chỉ đọc `Đã giữ` · `Chưa làm`.
7. `Tạm nghỉ` / `Lưu trữ` bất cứ lúc nào, không xoá lịch sử; tạm nghỉ không hiện, không nhắc.

## 3. Tạo thói quen
1. Gợi ý trung tính `Dậy sớm` · `Uống đủ nước` · `Vận động` · `Đọc sách` · `Ngủ đúng giờ` + `Thói quen của tôi`. Không ngôn ngữ tôn giáo.
2. Loại `Có đồng hồ` (số phút) / `Chỉ đánh dấu`.
3. Ngày trong tuần (mặc định mọi ngày).
4. Khung giờ: một hoặc nhiều, mỗi khung có giờ nhắc.
5. Nhắc bật / tắt từng thói quen.
- Mặc định: Vận động, Đọc sách `có đồng hồ`; Dậy sớm, Uống đủ nước, Ngủ đúng giờ `chỉ đánh dấu`; Uống đủ nước nhiều khung.

## 4. Nhắc
Nhẹ hơn nhắc nhiệm vụ; tuân theo Chế độ tập trung (ADR-027), Tắt thông báo, ngày nghỉ (VMT 23:13: có). Nhắc nhiệm vụ không đổi. Âm / toast loại riêng, nhẹ hơn.

## 5. Đồng hồ đếm ngược (PHẦN 2)
Toàn màn; rời màn / mất focus = dừng, chip góc; hết giờ = `Đã làm`; `Hoàn thành` giữa chừng = `Đã làm` thời lượng thực; tính theo mốc tích luỹ; một phiên; qua ngày tự huỷ; `Bỏ phiên` ghi `Đã bỏ phiên · {n} phút` + ghi chú; tôn trọng giảm chuyển động; phiên chỉ trên máy.

> **VMT đổi quyết định 10/10/2026 21:11 — sửa mục 5 và 10.2.** Mỗi thói quen có đồng hồ có lựa chọn **"Khi rời Avora": `Cứ chạy` | `Dừng khi rời`**, mặc định **`Cứ chạy`** (VMT đọc sách ở app khác; vận động không cầm máy). Chọn trong Tạo / Sửa thói quen.
> - `Cứ chạy`: đếm theo mốc như cũ; khoá màn hình, chuyển app, đóng tab **không** dừng. Một phiên một lúc; qua 24:00 tự huỷ (kể cả đang chạy); chạy offline. Mở lại Avora **không** tự ghi `Đã làm`: hiện thẻ `Đã trôi qua n phút` (đủ mục tiêu thì `Đủ N phút`) với `Ghi Đã làm (n phút)` · `Bỏ phiên`; ghi **n thật, không cắt trần**. Chip ở góc **đang đếm**. Báo đủ giờ khi app đóng: `send-push` loại `habit` (`Đồng hồ thói quen đã đủ giờ`), tuân chế độ yên lặng lúc gửi.
> - `Dừng khi rời`: đúng như mục 5 cũ (rời màn / mất focus / khoá màn = dừng; chip đứng; hết giờ trước mặt = `Đã làm`, ghi tối đa bằng mục tiêu).

## 6. Bảng Avora mặc định `Thói quen`
Luôn có sẵn; tên và Mục tiêu không sửa được; chỉ `Ẩn khỏi danh sách`.
- Mục tiêu: *Tôi đang duy trì những thói quen nào, và tuần này giữ được bao nhiêu?*
- Cột: Thói quen · Loại · Lịch · Hôm nay · Tuần này · 4 tuần gần nhất · Tổng số lần; cột tự thêm: ghi chú.
- Xoá dòng = Lưu trữ thói quen, nhật ký giữ nguyên.
- Màn trống: `Tạo thói quen đầu tiên ở Nhiệm vụ › Thói quen`.
- Chỉ chủ.

## 7. Dữ liệu
`habits`, `habit_logs` (duy nhất theo habit + ngày + khung); ghi chỉ qua RPC; xung đột theo `version`; không tính chuỗi; chạy đủ khi không mạng.

## 10. Đã chốt thêm (23:13)
1. Nhắc tuân chế độ yên lặng: Có. 2. Mất focus = dừng đồng hồ: Có — **sửa 10/10 21:11:** chỉ khi thói quen chọn `Dừng khi rời`; mặc định `Cứ chạy` (xem ghi chú dưới mục 5). 3. `Bỏ phiên` có và ghi lại. 4. Ranh giới ngày đúng 24:00 giờ máy. 5. Các đề xuất còn lại ở mục 5: giữ.

## 11. Không làm
Chia sẻ thói quen · gắn vào Hạng mục · biểu đồ dài hạn · gợi ý bằng AI · đồng bộ phiên đồng hồ giữa máy.
