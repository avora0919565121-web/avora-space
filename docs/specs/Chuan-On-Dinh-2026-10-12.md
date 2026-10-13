# Chuẩn ổn định AVORA: 10 luồng vàng (12/10/2026)

**Triết lý (VMT, 12/10):** một app đáng tin trong mọi thao tác tạo trải nghiệm tốt và gắn kết, từ đó người dùng mời được người khác. Mọi tính năng khi xuất hiện phải cực kỳ ổn định, và làm đúng điều người dùng kỳ vọng vào lúc họ cần. Tính năng mới chỉ làm tốt thêm trải nghiệm; nền phải dùng tốt trước.

## 1. Các quyết định đã chốt

| # | Quyết định |
|---|---|
| 1 | Độ tin cậy được **đo ở các luồng có người thứ hai** (chat, giao việc, nhóm, lời mời), vì lan truyền chỉ xảy ra ở đó. Luồng dùng một mình cũng phải đạt chuẩn nhưng không đủ để kết luận "ổn" |
| 2 | Sau Đợt 2+3 còn lại, **dừng thêm tính năng mới** trong một đợt riêng: **Đợt Độ tin cậy** (AVORA-112) |
| 3 | Tính năng chưa đạt chuẩn thì **không hiển thị chức năng cho người dùng thật**. Có thể hiện nhãn **"Sắp có" trong phần nội dung** (không bao giờ trên tab, đúng quy tắc hiện hành) |
| 4 | 10 luồng vàng ở mục 3 là danh sách chuẩn để đo |

## 2. Ba trạng thái của một tính năng

| Trạng thái | Người dùng thấy | Điều kiện |
|---|---|---|
| `stable` | Dùng bình thường | Luồng liên quan **đạt chuẩn** và VMT đã xác nhận trên máy thật |
| `soon` | Một dòng nhẹ "Sắp có" trong phần nội dung, không có nút bấm | Chưa đạt chuẩn nhưng đã dự định ra mắt |
| `hidden` | Không thấy gì | Chưa đạt chuẩn và chưa cần giới thiệu |

- Trạng thái lưu ở một chỗ (bảng cấu hình, đọc khi mở app, lưu đệm để chạy được khi mất mạng). Chủ ops đổi được từ xa **không cần phát hành lại**; đây cũng là công tắc tắt khẩn cấp khi một tính năng gặp sự cố (điều kiện E5 trong tài liệu 50.000 người).
- Chuyển lên `stable` cần: bài kiểm tự động của luồng xanh **và** VMT xác nhận trên máy thật.

## 3. Mười luồng vàng và ngưỡng đo

Ngưỡng là **đề xuất ban đầu**, VMT chỉnh. "Bình thường" nghĩa là mạng 4G ổn định, điện thoại tầm trung. Mỗi dòng ghi cách đo: **T** = kiểm thử tự động, **M** = thử tay trên máy thật.

### Luồng 1. Vào app: đăng ký, đăng nhập, máy mới
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Đăng ký, đăng nhập thành công khi nhập đúng | 100% | T |
| Phiên không tự thoát khi tải lại, chuyển tab, để qua đêm | 0 lần thoát ngoài ý muốn | T, M |
| Email/OTP xác nhận thiết bị mới đến và dùng được | ≥ 99% trong 60 giây | M |
| Thông báo lỗi nói được nguyên nhân và bước kế tiếp (sai mật khẩu, hết hạn mã, mất mạng) | 100% trường hợp lỗi có câu rõ ràng | T |
| Mở app lần đầu đến màn dùng được | ≤ 3 giây bình thường | T, M |

### Luồng 2. Gửi tin (ít nhất hai người)
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Không mất tin: gửi 1.000 tin có chèn lỗi mạng ngẫu nhiên | 0 tin mất | T |
| Không gửi đúp khi bấm hai lần hoặc thử lại | 0 tin trùng | T |
| Thứ tự tin ổn định giữa hai người | 100% | T |
| Trạng thái rõ: đang gửi, đã gửi, gửi lỗi (kèm nút thử lại) | 100% | T, M |
| Tin chờ gửi còn nguyên sau khi tải lại hoặc tắt hẳn app | 100% | T, M |
| Không gửi nhầm cuộc: nháp riêng từng cuộc | 0 trường hợp | T |
| Thời gian gửi đến người nhận (cùng lúc đang mở app) | p95 ≤ 2 giây | T |
| Sửa, thu hồi, trả lời, chuyển tiếp cho kết quả đúng ở cả hai phía | 100% | T |

### Luồng 3. Thông báo
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Thông báo đến đúng người, đúng cuộc | 100% | T, M |
| Tôn trọng chế độ yên lặng, Tắt thông báo, ngày nghỉ | 100% | T |
| Nội dung mặc định không lộ nội dung tin | 100% | T |
| Số chưa đọc khớp thực tế sau khi đọc ở máy khác | 100% | T, M |
| Thông báo khi app đóng (PWA và sau này bản native) | ≥ 95% đến trong 10 giây | M |

### Luồng 4. Việc và giao việc (hai người)
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Giao việc: người nhận thấy việc | p95 ≤ 2 giây, 100% | T |
| Đổi trạng thái, hạn, người làm đồng bộ hai phía | 100% | T |
| Giờ, hạn chót đúng múi giờ người dùng (Asia/Saigon), không lệch ngày ở 23:30–00:30 | 0 lỗi | T |
| Nhắc việc báo đúng một lần, đúng giờ | 100% | T, M |
| Việc tạo từ tin nhắn, từ Hạng mục giữ đúng liên kết | 100% | T |

### Luồng 5. Mở lại app
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Không có màn hình trắng; lỗi một màn không làm hỏng tab khác | 0 | T |
| Mở lại đúng chỗ đang làm, không bị kéo sang tab khác | 100% | T, M |
| Bản nháp và vị trí cuộn được giữ | 100% | T |
| Tải lại khi mất mạng: hiện dữ liệu đã lưu kèm nhãn "ngoại tuyến", không báo rỗng | 100% | T |

### Luồng 6. Ảnh và tệp (hai người)
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Gửi ảnh, tệp: tiến độ, thử lại khi lỗi, huỷ được | 100% | T, M |
| Vượt giới hạn dung lượng/loại tệp: báo rõ trước khi tải lên | 100% | T |
| Không để lại tệp mồ côi khi tải lỗi giữa chừng | 0 | T |
| Người không còn trong cuộc không thấy tệp; "Chỉ xem" không tải được | 100% | T |
| Ảnh hiện thu nhỏ nhanh, mở ảnh lớn khi chạm | thu nhỏ ≤ 1 giây | M |

### Luồng 7. Thói quen và đồng hồ
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Đồng hồ chính xác sau khoá máy, chuyển app, tắt app | sai lệch ≤ 2 giây | T, M |
| Chế độ "Khi rời Avora" (Cứ chạy / dừng) hành xử đúng | 100% | T, M |
| Nhắc báo đúng giờ, đúng một lần, tôn trọng chế độ yên lặng | 100% | T, M |
| Hết ngày đúng 24:00 theo múi giờ người dùng | 100% | T |
| Chạy được ngoại tuyến | 100% | T |

### Luồng 8. Két sắt
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Mở, khoá, tự khoá theo thiết lập | 100% | T |
| Quên mật khẩu Két sắt: luồng đặt lại đúng như thiết kế | 100% | T, M |
| Không hiển thị lời hứa vượt thực tế về mã hoá | 0 chỗ | rà thủ công |
| Không để lộ dữ liệu khi chuyển app (ảnh xem trước, bộ nhớ đệm) | 0 | M |

### Luồng 9. Sao lưu, khôi phục, xoá tài khoản
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Sao lưu và khôi phục trên máy mới cho số lượng mục giống hệt | 100% khớp | T, M |
| Xuất dữ liệu đúng và đủ | 100% | T |
| Xoá tài khoản theo ADR (xác nhận, chờ, huỷ, thực thi): không để sót dữ liệu cá nhân | 0 bảng sót | T |
| Thông báo xoá/đổi mật khẩu đến mọi phiên khác | 100% | T |

### Luồng 10. Tải nặng và mạng yếu
| Yêu cầu | Ngưỡng | Đo |
|---|---|---|
| Cuộc trò chuyện 5.000 tin: hiện 30 tin mới nhất | ≤ 1,5 giây | T, M |
| Danh bạ 1.000 người: cuộn mượt, tìm kiếm nhanh | ≥ 50 khung hình/giây, tìm ≤ 300 ms | T |
| Mạng 3G chậm hoặc chập chờn: không treo, không mất dữ liệu | 0 treo, 0 mất | T |
| Dùng liên tục 1 giờ: bộ nhớ không tăng mãi, không giật | tăng ≤ 30% | M |
| Hai thiết bị, hai tab cùng tài khoản: không xung đột trạng thái | 0 lỗi | T |

## 4. Cách vận hành Đợt Độ tin cậy

1. **Đóng băng tính năng:** trong đợt này không thêm màn hình, chức năng mới. Chỉ sửa, thêm kiểm thử, thêm công cụ đo.
2. **Mọi lỗi tìm thấy được ghi vào một bảng duy nhất** (luồng, mô tả, mức độ, trạng thái). Lỗi mức "mất dữ liệu" hoặc "gửi nhầm" sửa trước tất cả.
3. **Đo trước, sửa sau:** Rork chạy toàn bộ kiểm thử, báo bảng đạt/không đạt có bằng chứng; không đoán.
4. **Kiểm thử hai người** dùng hai phiên trình duyệt độc lập; **chèn lỗi** (mất mạng, mạng chậm, tắt giữa lúc gửi, bấm hai lần, hết hạn phiên).
5. **VMT thử máy thật** theo danh sách do Rork lập (ít nhất iPhone và một Android, một máy tính).
6. **Cổng ra:** cả 10 luồng ở trạng thái đạt, hoặc tính năng liên quan chuyển `soon`/`hidden`. Sau cổng này mới tiếp tục tính năng mới, rồi gói native (AVORA-111, Capacitor).
7. **Giữ chuẩn về sau:** bộ kiểm thử luồng vàng chạy mỗi khi có thay đổi. Tính năng mới chỉ lên `stable` khi có kiểm thử riêng và VMT xác nhận.

## 5. Quan hệ với các kế hoạch khác

| Kế hoạch | Quan hệ |
|---|---|
| Đợt 2+3 còn lại (N2, N3, N4, 2F) | Chạy xong trước, rồi mới vào Đợt Độ tin cậy |
| AVORA-111 (chuẩn bị native) | Chạy **sau** AVORA-112; các luồng xoá tài khoản, báo cáo, demo mới được thêm vào bộ kiểm thử luồng vàng |
| Capacitor, TestFlight | Chỉ bắt đầu khi cổng ra ở mục 4 đạt |
| 50.000 người (điều kiện B, E) | Các hạng mục Realtime Broadcast, giám sát, công tắc tắt tính năng nằm trong AVORA-112 |
| Mã hoá đầu cuối (E1–E5) | Không nằm trong đợt này |

## 6. Giới hạn
- Ngưỡng đo là đề xuất của Claude, chưa kiểm chứng với thiết bị và mạng thực tế của người dùng.
- Kiểm thử tự động không thay được thử trên máy thật, nhất là thông báo khi app đóng và đồng hồ khi khoá máy.
- Chuẩn này giảm lỗi, không loại bỏ hoàn toàn; ghi trung thực với người dùng.
