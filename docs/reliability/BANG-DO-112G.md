# Bảng đo lại 10 luồng vàng · 112-G (03/11/2026)

Đo lại toàn bộ bằng cùng bộ test vàng của 112-A, sau các sửa ở 112-B…F và 112-G.
Số đo mới ở `docs/reliability/do-112g/*.json`. Số gốc `do-112a/` giữ nguyên, không ghi đè (từ 112-G test chỉ ghi vào `web/.test-output/`, chép vào `docs/` bằng `bun run evidence:save`).
Ngưỡng, ký hiệu và giới hạn của khung hai người: xem `BANG-DO-112A.md`.

## Tóm tắt so với 112-A

| Luồng | 112-A | 112-G | Thay đổi |
|---|---|---|---|
| 1 Vào app | Một phần | Một phần | Thêm: lệch đồng hồ (LOI-11) và 429 (LOI-12) không còn làm mất phiên. 1.1 / 1.2 / 1.3 / 1.5 vẫn thử tay. |
| 2 Gửi tin | Một phần | **Đạt** | 2.4: lỗi vĩnh viễn báo sau 313 ms, 1 lần gọi (trước 16.590 ms, 5 lần) |
| 3 Thông báo | Một phần | Đạt (phần T) | 3.2 đã chốt theo ADR-086; 3.1 / 3.5 thử tay |
| 4 Việc | Một phần | **Đạt** | 4.3: 0/5 mốc lệch ở 3 múi giờ (112-E) |
| 5 Mở lại | Một phần | Một phần | 5.4: có nhãn ngoại tuyến thống nhất; chưa có dữ liệu trên máy cho tab ngoài Kết nối (LOI-07 → AVORA-116) |
| 6 Ảnh, tệp | Không đạt | Một phần | 6.2 đạt (6/6), 6.3 đạt (0 tệp mồ côi); 6.1 còn thiếu tiến độ (LOI-06, hoãn) |
| 7 Thói quen | Đạt (phần T) | Đạt (phần T) | — |
| 8 Két sắt | Đạt (phần T) | Đạt (phần T) | — |
| 9 Sao lưu, xoá | Chưa có / Một phần | Chưa có / Một phần → **9.3 Đạt (phần T)** ở 111-A | 9.3: xoá tài khoản trong app, SQL 9/9, browser 8/8, thử đầu-cuối thật 09/11 (367 cột uuid quét, 0 sót). Máy thật: `THU-MAY-THAT.md` mục D. |
| 10 Tải nặng | Đạt (phần T) | Đạt (phần T) | — |

## Số đo cạnh nhau

| # | Chỉ số | 112-A | 112-G | Ngưỡng | Đạt? |
|---|---|---|---|---|---|
| 2.1 | 1.000 tin, chèn lỗi mạng: mất / trùng / đúng thứ tự | 0 / 0 / có | 0 / 0 / có | 0 mất | Đạt |
| 2.1b | Người nhận rớt mạng, 120 tin: đủ sau khi kéo lên | có | có | 0 mất | Đạt |
| 2.2 | Bấm đúp / gửi lại hai lần: số tin | 1 / 1 | 1 / 1 | 0 trùng | Đạt |
| 2.3 | Hai người cùng thứ tự · lệch máy chủ (cùng 1 ms) | có · 4/120 | có · 6/120 | 100% giữa hai người | Đạt (LOI-04 vẫn mở) |
| 2.4 | Lỗi vĩnh viễn → `Chưa gửi được` | 315 ms, 1 lần | 313 ms, 1 lần | rõ ràng | Đạt |
| 2.5 | Tin chờ còn sau tải lại / tắt app · trùng | 3/3 · 0 | 3/3 · 0 | 100% | Đạt |
| 2.6 | Gửi nhầm cuộc | 0 | 0 | 0 | Đạt |
| 2.7 | Tới người nhận p50 / p95 / max (ms) | 145 / 188 / 214 | 146 / 187 / 207 | p95 ≤ 2.000 | Đạt (phần app) |
| 2.8 | Sửa / trả lời / chuyển tiếp / thu hồi hai phía | ✓✓✓✓ | ✓✓✓✓ | 100% | Đạt |
| 2.9 | Phiên hết hạn giữa lúc gửi: tới sau · bản sao | 3.026 ms · 1 | 3.031 ms · 1 | 0 mất, 0 trùng | Đạt |
| 3.4 | Chưa đọc hai máy về 0 | 0 / 0 | 0 / 0 | 100% | Đạt |
| 4.1 | Giao việc p50 / p95 (ms) · thấy | 120 / 169 · 30/30 | 121 / 163 · 30/30 | p95 ≤ 2.000 | Đạt (phần app) |
| 5.1 | Màn lỗi không lan | có | có | 0 | Đạt |
| 6.3 | Tệp mồ côi | 0 | 0 | 0 | Đạt |
| 10.1 | Cuộc 5.000 tin, 30 tin mới nhất (lần chậm nhất) | 213 ms | 248 ms | ≤ 1.500 ms | Đạt (máy thật: B11) |
| 10.2 | Lọc danh bạ 1.000 người p95 / max | 4,9 / 7,4 ms | 2,4 / 3,2 ms | — | Đạt (cuộn: B12) |
| 10.3 | 3G chập chờn, 50 tin: tới / trùng / bấm → bong bóng | 50 / 0 / 8 ms | 50 / 0 / 11 ms | không treo, không mất | Đạt |
| 10.5 | Hai tab cùng tài khoản: trùng / đúng thứ tự | 0 / có | 0 / có | 0 | Đạt |
| 10.6 | Realtime 50 người: phát nhầm | 0 | 0 | 0 | Đạt |

Ghi chú: cột 112-A ở trên là bản `do-112a/` đã nằm trong `docs/` lúc bắt đầu 112-G. Trước 112-G các lần chạy test ghi đè vào thư mục này (ví dụ `L1.4` có `measuredAt` 01/11), nên đây là số của lần chạy cuối trước 112-G, không phải số ngày 13/10. Số 13/10 còn trong lịch sử git và trong `BANG-DO-112A.md`.

## Thêm ở 112-G (có bài kiểm đỏ trước, xanh sau)

| Mục | Trước | Sau | Bài kiểm |
|---|---|---|---|
| 429 khi làm mới phiên | Phiên bị xoá (2 bài đỏ) | Giữ phiên, thử lại giãn cách | `auth-refresh-failure.test.ts` 4/4 |
| Mất mạng khi làm mới phiên | Giữ phiên | Giữ phiên | như trên |
| Tham số sách trên địa chỉ | Nằm lại sau khi tạo ghi chú | Gỡ ngay, thay địa chỉ, không thêm bước lùi | `notes-ask.test.ts` 3/3 · `notes-book-loop.browser.test.tsx` |

## Dòng chưa đạt và đề xuất cờ `app_features` (không tự đổi, chờ VMT)

Trạng thái hiện tại (đọc máy chủ 03/11): **29/29 khoá đều `stable`**.

| Dòng | Lỗi | Khoá liên quan | Đề xuất | Lý do |
|---|---|---|---|---|
| 6.1 Tiến độ / huỷ khi tải tệp | LOI-06 (hoãn) | `chat_direct`, `groups` (không có khoá riêng cho tệp) | Giữ `stable` | Tệp vẫn gửi được, thử lại được, Bỏ xoá tệp đã lên; chỉ thiếu thanh tiến độ. Ẩn cả chat là quá tay. |
| 5.4 Mở lại khi mất mạng (tab ngoài Kết nối) | LOI-07 (một phần) | `tasks`, `think_hub`, `contacts`, `finance`… | Giữ `stable` | App nói rõ "Ngoại tuyến"; không báo rỗng sai. Lưu dữ liệu trên máy thuộc AVORA-116. |
| 9.1 Sao lưu / khôi phục | Chưa có | — (không có giao diện) | Không cần cờ | Không có màn nào hứa sao lưu. |
| 9.2 Xuất tất cả | Một phần | `finance`, `contacts` | Giữ `stable` | Xuất từng phần đúng như đang ghi. |
| 9.3 Xoá tài khoản | **Đạt (phần T)** · 111-A | `account_deletion` | **`stable`** (09/11, sau khi đạt cổng) | Chờ VMT thử mục D trên máy thật. Demo xoá ≤ 5 phút làm ở 111-C. |
| 1.4 OTP hết hạn gọi là "liên kết" | LOI-08 | — | Giữ | Câu vẫn có nguyên nhân + bước kế tiếp. |

## Thử trên máy thật

47 dòng ở `THU-MAY-THAT.md` (iPhone 23 · Android 14 · máy tính 10).
