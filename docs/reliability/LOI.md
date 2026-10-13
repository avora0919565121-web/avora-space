# Bảng lỗi duy nhất · Đợt Độ tin cậy (AVORA-112)

Mở ở 112-A (13/10/2026). Mỗi lỗi có luồng (theo `docs/specs/Chuan-On-Dinh-2026-10-12.md`), mô tả, mức, bằng chứng, trạng thái.
Mức, theo thứ tự ưu tiên sửa: **Mất dữ liệu · Gửi nhầm · Sai kết quả · Khó dùng · Mỹ thuật**.
Số đo nằm ở `docs/reliability/do-112a/*.json`; bảng đạt / không đạt ở `docs/reliability/BANG-DO-112A.md`.

**Mất dữ liệu: 0 lỗi đã biết. Gửi nhầm: 0 lỗi đã biết.** (Không có nghĩa là không có lỗi. Chỉ có nghĩa là các bài đo trên khung hai người chưa tìm ra lỗi nào ở hai mức này.)

| Mã | Luồng | Mô tả | Mức | Bằng chứng | Trạng thái |
|---|---|---|---|---|---|
| LOI-01 | 2 (trạng thái), 6 | **Lỗi vĩnh viễn bị coi là lỗi tạm.** `lib/chat.ts` và `lib/attachments.ts` dịch mã lỗi máy chủ sang câu tiếng Việt trước khi hàng chờ (`outbox.ts · isPermanentSendError`) đọc. Câu nào không chứa từ khoá trong danh sách thì bị coi là lỗi tạm: hàng chờ thử lại 5 lần (1 + 2 + 4 + 8 giây), bong bóng hiện `Chờ gửi…` khoảng 16,6 giây rồi mới hiện `Chưa gửi được · Gửi lại`. Chỉ 1/18 mã dừng ngay trên cả hai đường (chữ và tệp). Ví dụ: bị chặn (`avora_contact_unavailable`), tin trống, tin quá 4.000 ký tự, hết lượt tin xác minh. | Sai kết quả | `L2.4-trang-thai.json` (16.590 ms, 5 lần gọi máy chủ), `L2.4b-loi-vinh-vien-sau-khi-dich.json` | Mở → 112-C |
| LOI-02 | 6 | **Tệp mồ côi khi bỏ tin đã tải tệp.** Bỏ một tin lỗi hoặc đang chờ mạng mà tệp đã tải lên thì `use-outbox.ts · drop()` chỉ xoá mục khỏi hàng chờ, tệp vẫn nằm trong kho. Khung đo để lại 2/2 tệp. Máy chủ có lưới an toàn: `storage-sweep` (cron mỗi giờ, 48/48 lần chạy thành công trong 2 ngày) xoá tệp không tin nào trỏ tới sau 24 giờ. Đếm trên máy chủ thật: 0 tệp mồ côi cũ hơn 25 giờ. | Sai kết quả (thấp) | `L6.3-tep-mo-coi.json`; truy vấn `storage.objects` 13/10 | Mở → 112-C |
| LOI-03 | 4, 7 | **Ngày và hạn chót theo giờ của máy, không theo múi giờ hồ sơ.** `todayIso()` và `deadlineInstant()` dùng giờ máy. Máy đặt giờ Việt Nam: 0/4 mốc lệch (23:30 · 23:59:59 · 00:00:30 · 00:30). Máy đặt UTC trong khi hồ sơ là giờ Việt Nam: 2/4 mốc lệch ngày (00:00:30 và 00:30). Theo ADR-077, thói quen tính "24:00 giờ máy" là có chủ đích. Việc có `deadline_tz` nhưng app không dùng. | Sai kết quả (thấp, chỉ khi máy khác múi giờ hồ sơ) | `L4.3-nua-dem-mui-gio.json` | Mở → VMT quyết: giờ máy hay giờ hồ sơ |
| LOI-04 | 2 (thứ tự) | **Tin trong cùng một mili-giây xếp theo id**, khác thứ tự máy chủ (µs rồi id). `chat-cache.ts · compareMessages` so `Date.getTime()` (ms). Hai người luôn cùng thứ tự với nhau (cùng dữ liệu, cùng hàm xếp). Lệch 6/120 vị trí so với máy chủ, tất cả trong cùng 1 ms. | Sai kết quả (rất thấp) | `L2.3-thu-tu-hai-nguoi.json` | Mở → 112-C |
| LOI-05 | 6 | **Loại tệp bị chặn chỉ báo sau khi đã thử tải lên.** `attachmentRejectionReason` chỉ chặn trước tệp rỗng và tệp > 25 MB. Tệp .exe, .html… được nhận vào khung soạn, bị kho từ chối lúc tải (chính sách storage + `private.attachment_blocked`), rồi hiện bong bóng lỗi. | Khó dùng | `L6.2-gioi-han-truoc-khi-tai.json` | Mở → 112-C |
| LOI-06 | 6 | **Không có tiến độ tải lên, không huỷ được khi đang tải.** Bong bóng chỉ có `Chờ gửi…`; `Bỏ` chỉ hiện khi tin lỗi. | Khó dùng | rà mã `Messages.tsx` dòng ~4366–4394, `use-outbox.ts`; không có `progress` trong `components/chat` | Mở → 112-C / 112-G (có thể hạ `soon` phần tiến độ) |
| LOI-07 | 5 | **Tải lại khi mất mạng: chỉ khung chat có bản trên máy.** Khung chat vẽ ngay từ bản sao 50 tin (K3 · N2). Các tab khác (Nhiệm vụ, Kế hoạch, Liên hệ…) không lưu gì trên máy, nên hiện `Đang không có mạng · Chưa tải được · Thử lại`. App không báo rỗng, nhưng cũng không hiện dữ liệu đã có. Nhãn mất mạng không thống nhất: Kết nối viết `Đang kết nối lại`, nơi khác viết `Đang không có mạng`. | Khó dùng | rà mã `main.tsx` (không có persister cho React Query), `thread-cache.ts`, `LoadingOrRetry.tsx`; test `loading-or-retry.browser.test.tsx` | Mở → 112-F |
| LOI-08 | 1 | **Mã OTP hết hạn báo như liên kết hết hạn.** `Token has expired or is invalid` thành `Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email.`, kể cả khi người dùng đang gõ mã 6 số. | Khó dùng | `L1.4-loi-dang-nhap.json` | Mở → 112-F |
| LOI-09 | Kỹ thuật (2, 10) | **Hàng chờ mở một kết nối IndexedDB mới cho mỗi thao tác và không đóng.** Sau 1.000 tin có hàng nghìn kết nối chờ dọn rác. Một lệnh `deleteDatabase("avora-outbox")` (ví dụ `idbDeleteExcept` khi máy bị thu hồi) sẽ kẹt, và mọi lần mở sau phải xếp sau nó. Khung đo đã gặp đúng chuyện này: hàng chờ của bản app sau đứng yên. | Khó dùng (hiệu năng) | `outbox.ts · openDb`; ghi chú trong `test/reliability/record.ts · freshDevice` | Mở → 112-C |
| LOI-10 | 5 (điều hướng) | **Nút `‹` hiện nhãn cũ trong khung hình đầu.** Vào `/lien-he/c1` từ Avora Space, nhãn qua hai giá trị: `Quay lại Nhiệm vụ…` rồi `Quay lại Avora Space…`. Xảy ra ở cả 390 và 1440. Nếu chạm đúng khung hình đó, có thể bị đưa về sai chỗ (chưa tái hiện được). Đây cũng là gốc của test N.7 chập chờn. | Mỹ thuật | ghi nhãn bằng MutationObserver trong N.7, 3/3 lần | Mở → 112-F |

## Dòng chuẩn mâu thuẫn với quyết định đã chốt (VMT chốt)

| Luồng | Dòng chuẩn | Quyết định hiện hành | Đề xuất |
|---|---|---|---|
| 3.2 | "Tôn trọng chế độ yên lặng, Tắt thông báo, **ngày nghỉ**" | ADR-086 (AVORA-110): Ngày nghỉ chỉ đổi màu, "nhắc việc, thông báo không đổi". Nhắc **thói quen** thì có tôn trọng ngày nghỉ (ADR-077). | Giữ ADR-086 và sửa dòng chuẩn thành "ngày nghỉ (với nhắc thói quen)", hoặc VMT đổi ADR |

## Tính năng chưa có (không phải lỗi; cần quyết định `soon` / `hidden` ở 112-G)

| Luồng | Dòng | Hiện trạng |
|---|---|---|
| 9.1 | Sao lưu và khôi phục trên máy mới | Không có sao lưu toàn tài khoản. Chỉ có Bộ khôi phục của Két sắt và dữ liệu nằm trên máy chủ. |
| 9.2 | Xuất dữ liệu đúng và đủ | Có xuất từng phần: Két sắt · giao dịch, danh bạ vCard. Không có "xuất tất cả". |
| 9.3 | Xoá tài khoản theo ADR | Chưa có, làm ở 111-A. |

## Test chập chờn đã tìm ra gốc (112-A · 6)

| Test | Gốc | Sửa |
|---|---|---|
| `avora107_habits.sql` đỏ lúc 14:00 giờ VN | Phép đếm `push_outbox` lấy cả thói quen khác của fixture (khung 14:00). Khung "10 phút trước" lấy từ đồng hồ thật, và quanh nửa đêm rơi sang ngày hôm trước. | Lọc theo đúng thói quen đang đo. Múi giờ của A được ghim (trong transaction được rollback) vào một múi giờ đang là 10:00–13:59 lúc chạy, nên mọi khung giờ và "hôm nay" nằm giữa một ngày. Áp dụng cho cả `avora107_when_away.sql`: giờ báo "bây giờ + 15 phút" trước đây sang ngày mai nếu chạy sau 23:45. |
| `avora115` đỏ một lần (hai bản React) | Vite dùng lại bộ đóng gói thư viện cũ mà không quét lại. Lần chạy vài tệp để lại bộ thiếu `@radix-ui/react-slider` (thư viện mới dùng ở AVORA-115), nên lần chạy toàn bộ phải tối ưu lại giữa chừng và tải lại trang. | `vitest.browser.config.ts · optimizeDeps.include` lấy từ chính mã nguồn: mọi gói được import trong `src/`, cố định không phụ thuộc lần chạy trước. |
| N.7 hết giờ ở 1440 (15 giây, rồi 60 giây sau khi chỉ nới thời gian) | Không phải chậm. `userEvent.click(phần tử)` đổi phần tử thành bộ định vị theo nhãn. Nhãn `‹` đổi ngay sau khung hình đầu (LOI-10), nên bộ định vị chờ một nhãn không còn tồn tại. | `clickBack()` chờ nhãn đứng yên 150 ms rồi mới bấm, áp cho mọi lần bấm `‹` trong `navigation-rules`. N.7 về lại thời gian mặc định. |
| T.8 ở 1440 (thẻ chưa trượt xong) | Đo khi thẻ còn đang trượt. | Đã sửa ở Đợt 2+3: chờ thẻ dừng hẳn rồi mới đo. |
| `avora115` · đổi ảnh (lần chạy 1 của 112-A) | `vi.waitFor` mặc định 1 giây cho cả chuỗi nén → tải lên → `set_avatar` → xoá tệp cũ → vẽ lại. Khi chạy toàn bộ song song, chuỗi này có lúc vượt 1 giây. | Một ngân sách chờ chung `WAIT` (8 giây, hỏi lại mỗi 50 ms) cho các bước có mạng trong tệp. |
| Khung hai người làm đỏ `navigation-rules` / `resume-place` (bản đầu của khung) | Vitest chạy các tệp song song trong nhiều iframe **cùng một origin**, nên localStorage, sessionStorage và IndexedDB dùng chung. Bản đầu của `freshDevice()` xoá sạch localStorage trước mỗi test vàng, xoá luôn chỗ đã lưu, bộ nhớ tab và gợi ý của các tệp đang chạy cạnh. | `freshDevice()` chỉ xoá khoá và mục hàng chờ của chính người thử vàng (id dạng `…-0000-4000-8000-…`). Ghi chú cho sau này: 15 tệp test cũ vẫn gọi `localStorage.clear()` trong `beforeEach`; đây là rủi ro tiềm ẩn cùng loại, chưa thấy làm đỏ. |
