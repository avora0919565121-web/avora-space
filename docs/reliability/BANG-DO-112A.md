# Bảng đo 10 luồng vàng · gốc của Đợt Độ tin cậy (112-A · 13/10/2026)

Ngưỡng theo `docs/specs/Chuan-On-Dinh-2026-10-12.md`. Đây là **đo hiện trạng**: ở 112-A chưa sửa mã chức năng nào. Chỉ thêm khung kiểm thử, bộ dữ liệu thử, sửa gốc các test chập chờn, và sửa một chỗ hiển thị ngôn ngữ theo ghi chú 3.
Số đo của từng dòng nằm ở `docs/reliability/do-112a/<mã>.json` (có `measuredAt`). Lỗi ghi ở `LOI.md`.

**Ký hiệu**
- **Đạt** · **Không đạt** · **Một phần**: có dòng đạt, có dòng không.
- **Thử tay**: chỉ đo được trên máy thật, gom ở 112-G.
- **Chưa có**: tính năng chưa tồn tại.
- **T-khung**: đo trên khung hai người (hai bản app độc lập, một máy chủ giả giữ đúng luật máy chủ).
- **T-SQL**: đo trên máy chủ thật, rollback.
- **T-đơn vị**: unit test.

**Giới hạn của khung hai người**
- Mạng là mạng mô phỏng trong trình duyệt, máy chủ là máy chủ giả. Thời gian đo được là thời gian của **app**, không phải của Supabase Realtime thật (đo ở 112-D và trên máy thật).
- Luật máy chủ thật (quyền, chống trùng, phát tin theo người) được chứng minh riêng bằng T-SQL.

## Tóm tắt

| Luồng | Kết quả | Dòng không đạt / chưa đo |
|---|---|---|
| 1 Vào app | Một phần | 1.1, 1.2, 1.5 chưa có bài đo tự động (cần máy chủ Auth thật); 1.3 thử tay |
| 2 Gửi tin | Một phần | 2.4 lỗi vĩnh viễn chờ 16,6 s mới báo (LOI-01) |
| 3 Thông báo | Một phần | 3.2 mâu thuẫn với ADR-086 (ngày nghỉ), chờ VMT chốt; 3.5 thử tay |
| 4 Việc | Một phần | 4.3 lệch ngày khi máy khác múi giờ hồ sơ (LOI-03) |
| 5 Mở lại | Một phần | 5.4 tab ngoài Kết nối không có dữ liệu ngoại tuyến (LOI-07) |
| 6 Ảnh, tệp | Không đạt | 6.1 không có tiến độ, không huỷ được (LOI-06); 6.2 loại tệp bị chặn chỉ báo sau khi tải (LOI-05); 6.3 tệp mồ côi ≤ 25 giờ (LOI-02) |
| 7 Thói quen | Đạt (phần T) | 7.1, 7.2, 7.3 còn phần thử tay |
| 8 Két sắt | Đạt (phần T) | 8.4 thử tay |
| 9 Sao lưu, xoá | Chưa có / Một phần | 9.1, 9.3 chưa có; 9.2 chỉ xuất từng phần |
| 10 Tải nặng | Đạt (phần T) | 10.2 cuộn ≥ 50 khung hình/giây và 10.4 thử tay |

## Bảng chi tiết

### Luồng 1. Vào app
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 1.1 | Đăng ký / đăng nhập đúng thì vào được | 100% | Chưa có bài đo tự động: luồng đi qua Supabase Auth thật và Turnstile, khung hai người dùng phiên giả | Chưa đo · thử tay | — |
| 1.2 | Phiên không tự thoát (tải lại, chuyển tab, qua đêm) | 0 | Đã kiểm luật lưu phiên (localStorage, sessionStorage trên máy người khác) và việc nạp lại token cho realtime. "Qua đêm" chưa đo. | Một phần · thử tay | `avora-77.test.ts`, `realtime.tsx` (TOKEN_REFRESHED) |
| 1.3 | OTP thiết bị mới đến trong 60 giây | ≥ 99% | — | Thử tay | — |
| 1.4 | Lỗi nói nguyên nhân + bước kế tiếp | 100% | Sai mật khẩu, mất mạng, email chưa xác nhận, quá nhiều lần: đều có câu tiếng Việt và bước kế tiếp. Mã OTP hết hạn bị gọi là "liên kết" (LOI-08). | Đạt (có ghi chú) | `L1.4-loi-dang-nhap.json` (T-đơn vị) |
| 1.5 | Mở app tới màn dùng được | ≤ 3 s | Chưa có bài đo khởi động trên bản build | Chưa đo · thử tay | → 112-F |

### Luồng 2. Gửi tin (hai người)
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 2.1 | 1.000 tin, chèn lỗi mạng ngẫu nhiên | 0 mất | 1.000/1.000 tới máy chủ, **0 mất, 0 trùng**, đúng thứ tự viết ở cả 4 cuộc. Lỗi đã chèn: 28 yêu cầu mất, 27 câu trả lời mất (máy chủ đã nhận nhưng app không biết), 165 lần bị từ chối vì rớt mạng (300 ms mỗi 2 s). Màn người gửi là một đoạn đuôi liền của cuộc trên máy chủ; màn người nhận bằng đúng máy chủ. | Đạt | `L2.1-1000-tin.json` (T-khung, seed 112) |
| 2.1b | Người nhận rớt mạng trong lúc người kia gửi 120 tin | 0 mất trên màn | Nối lại: hiện 50 tin mới nhất, không lỗ hổng. Kéo lên 2 trang: đủ 120, đúng thứ tự máy chủ. | Đạt | `L2.1b-nguoi-nhan-rot-mang.json` |
| 2.2 | Không gửi đúp (bấm hai lần, thử lại) | 0 trùng | Bấm đúp thật trên `MessageComposer`: 1 tin. Gửi lại hai lần cùng lúc một tin đã tới máy chủ (câu trả lời bị mất): 1 tin, 1 bong bóng. | Đạt | `L2.2-bam-hai-lan.json`; T-SQL `k2_accuracy.sql` (C1) |
| 2.3 | Thứ tự ổn định giữa hai người | 100% | 2 × 60 tin gửi xen kẽ cùng lúc: hai người thấy **cùng một thứ tự**. So với máy chủ lệch 6/120 vị trí, tất cả trong cùng 1 ms (LOI-04). | Đạt | `L2.3-thu-tu-hai-nguoi.json` |
| 2.4 | Trạng thái rõ: đang gửi, đã gửi, gửi lỗi + Gửi lại | 100% | Mất mạng: `Chờ gửi…` → `Đang chờ mạng` → `Chờ gửi…` → `Đã gửi`. Lỗi vĩnh viễn (bị chặn): `Chờ gửi…` suốt **16,6 s**, 5 lần gọi máy chủ, rồi mới `Chưa gửi được · Gửi lại`. 17/18 mã lỗi vĩnh viễn bị thử lại như lỗi tạm. | **Không đạt** | `L2.4-trang-thai.json`, `L2.4b-loi-vinh-vien-sau-khi-dich.json` · LOI-01 |
| 2.5 | Tin chờ còn sau tải lại / tắt hẳn app | 100% | 3/3 còn sau tải lại, bong bóng hiện lại ngay. Tắt app giữa lúc yêu cầu đang đi, mở lại: 3/3 tới máy chủ, 0 trùng, người nhận có 3. | Đạt | `L2.5-tai-lai-tat-app.json` |
| 2.6 | Không gửi nhầm cuộc · nháp riêng từng cuộc | 0 | Viết dở ở cuộc 1, sang cuộc 2 gửi: tin vào cuộc 2, cuộc 1 nhận 0 tin. Nháp cuộc 1 còn sau khi tải lại. | Đạt | `L2.6-nhap-rieng-tung-cuoc.json` |
| 2.7 | Thời gian tới người nhận (đang mở app) | p95 ≤ 2 s | p50 146 ms · **p95 186 ms** · max 212 ms (60 tin, mạng mô phỏng 30–90 ms mỗi chiều). Realtime thật: đo ở 112-D. | Đạt (phần app) | `L2.7-p95-toi-nguoi-nhan.json` |
| 2.8 | Sửa, thu hồi, trả lời, chuyển tiếp đúng ở hai phía | 100% | Sửa ✓ · trả lời ✓ · chuyển tiếp (bản sao, giữ nguồn) ✓ · thu hồi (hai phía còn rỗng + dấu) ✓ | Đạt | `L2.8-sua-thu-hoi-tra-loi-chuyen-tiep.json`; T-SQL `k2_accuracy.sql` (C14) |
| 2.9 | (chèn lỗi e) Phiên hết hạn giữa lúc gửi | 0 mất · 0 trùng | Máy chủ trả `JWT expired` 3 s rồi phiên được làm mới: tin tới sau 3,0 s, 1 bản trên máy chủ. Bong bóng hiện `Chờ gửi…` trong lúc đó. | Đạt | `L2.9-phien-het-han.json` |

### Luồng 3. Thông báo
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 3.1 | Đúng người, đúng cuộc | 100% | Máy chủ thật: mỗi tin phát tới chủ đề riêng của từng thành viên. Người ngoài không vào được chủ đề, không đọc được tin. Đẩy thông báo: đọc theo `push_outbox` của từng người. | Đạt (T) · thử tay (đẩy thật) | T-SQL `k3_speed.sql` (N1), `k1_safety.sql` (K1.3) |
| 3.2 | Tôn trọng yên lặng, Tắt thông báo, ngày nghỉ | 100% | Âm trong app: bảng quyết định 128 tổ hợp. Đẩy thông báo: Chế độ tập trung, tắt toàn AVORA. Ngày nghỉ **không** chặn thông báo theo ADR-086 (chỉ chặn nhắc thói quen) → mâu thuẫn với dòng chuẩn, chờ VMT. | Đạt theo ADR · chờ VMT chốt dòng chuẩn | `avora114-sound.test.ts`, `avora-46-push.test.ts`, T-SQL `avora107_habits.sql` |
| 3.3 | Mặc định không lộ nội dung | 100% | `profiles.push_show_content` mặc định `false` | Đạt | migration push; `avora-46-push.test.ts` |
| 3.4 | Số chưa đọc khớp sau khi đọc ở máy khác | 100% | 2 thiết bị cùng tài khoản, mỗi máy 3 chưa đọc. Đọc ở máy tính, điện thoại về 0 ngay khi nhận sự kiện (0 ms sau phản hồi). | Đạt | `L3.4-chua-doc-hai-may.json` |
| 3.5 | Thông báo khi app đóng | ≥ 95% trong 10 s | Cron `avora_send_push` chạy 2.880/2.880 lần thành công trong 2 ngày (máy chủ). Thông báo trên máy chưa đo. | Thử tay | `cron.job_run_details` 13/10 |

### Luồng 4. Việc và giao việc (hai người)
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 4.1 | Người nhận thấy việc được giao | p95 ≤ 2 s, 100% | 30/30 thấy · p50 133 ms · **p95 169 ms**. Chỉ khi danh sách việc đã có trong bộ nhớ đệm; nếu chưa, màn Việc tải lại khi mở. | Đạt (phần app) | `L4.1-giao-viec-p95.json` |
| 4.2 | Đổi trạng thái / hạn / người làm đồng bộ hai phía | 100% | Trạng thái + hạn: hai phía ✓. Đổi người làm chưa đo riêng. | Đạt (một phần chưa đo) | `L4.1-giao-viec-p95.json` |
| 4.3 | Đúng múi giờ, không lệch ngày 23:30–00:30 | 0 lỗi | Máy giờ VN: 0/8 kiểm tra lệch. Máy UTC, hồ sơ giờ VN: 2/4 mốc lệch ngày. | **Một phần** | `L4.3-nua-dem-mui-gio.json` · LOI-03 |
| 4.4 | Nhắc việc đúng một lần, đúng giờ | 100% | Máy chủ thật: đến hạn → đúng 1 dòng gửi khi gọi hai lần. Nhắc đã quá 61 phút khi cron chạy thì không gửi (có chủ đích, ghi để VMT biết). | Đạt (T) · thử tay | T-SQL `golden_112a_reminders.sql` (mới) |
| 4.5 | Việc từ tin nhắn / Hạng mục giữ liên kết | 100% | Kiểm thử hiện có xanh | Đạt | T-SQL `avora104_p3_link.sql`; `task-context.test.ts`, `message-tasks.test.ts` |

### Luồng 5. Mở lại app
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 5.1 | Không màn trắng; lỗi một màn không hỏng tab khác | 0 | Màn ném lỗi: hiện `Phần này đang gặp sự cố`, thanh tab còn, sang tab khác dùng bình thường | Đạt | `L5.1-man-loi-khong-lan.json` |
| 5.2 | Mở lại đúng chỗ đang làm | 100% | Kiểm thử hiện có xanh | Đạt (T) · thử tay | `resume-place.browser.test.tsx`, `navigation-rules.browser.test.tsx` |
| 5.3 | Giữ nháp và vị trí cuộn | 100% | Nháp sau tải lại ✓. Vị trí cuộn của tab ✓ (N.4, N.7). Vị trí cuộn trong một cuộc chat sau tải lại chưa đo. | Đạt (một phần chưa đo) | `L2.6-…json`, `navigation-rules` N.4/N.7 |
| 5.4 | Tải lại khi mất mạng: dữ liệu đã lưu + nhãn ngoại tuyến | 100% | Khung chat có (bản trên máy). Tab khác hiện `Đang không có mạng · Chưa tải được`, không có dữ liệu. | **Không đạt** | rà mã · LOI-07 |

### Luồng 6. Ảnh và tệp (hai người)
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 6.1 | Tiến độ, thử lại, huỷ được | 100% | Thử lại ✓ (`Gửi lại`). Không có tiến độ. Không huỷ được khi đang tải. | **Không đạt** | LOI-06 |
| 6.2 | Vượt dung lượng / loại tệp: báo trước khi tải | 100% | PDF 30 MB và tệp rỗng: báo trước ✓. Tệp .exe, .html: không báo trước, bị kho từ chối khi tải. | **Không đạt** | `L6.2-gioi-han-truoc-khi-tai.json` · LOI-05 |
| 6.3 | Không để lại tệp mồ côi | 0 | App để lại 2/2 tệp khi bỏ tin. Máy chủ dọn sau 24 giờ; máy chủ thật hiện có 0 tệp cũ hơn 25 giờ. | **Không đạt** (tạm ≤ 25 giờ) | `L6.3-tep-mo-coi.json` · LOI-02 |
| 6.4 | Người rời cuộc không thấy tệp; "Chỉ xem" không tải được | 100% | Máy chủ thật: người ngoài không đọc / ký được tệp; tệp "Chỉ xem" không ra khỏi cuộc | Đạt | T-SQL `k1_safety.sql` (K1.1–K1.3), `k6_storage.sql` |
| 6.5 | Ảnh thu nhỏ ≤ 1 s | ≤ 1 s | — | Thử tay | — |

### Luồng 7. Thói quen và đồng hồ
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 7.1 | Đồng hồ đúng sau khoá máy / chuyển app / tắt app | ≤ 2 s | Đếm theo mốc tích luỹ, không theo nhịp (kiểm thử hiện có) | Đạt (T) · thử tay | `avora107-timer.test.ts`, `avora107-timer.browser.test.tsx` |
| 7.2 | "Khi rời Avora" đúng | 100% | Kiểm thử hiện có xanh | Đạt (T) · thử tay | T-SQL `avora107_when_away.sql` |
| 7.3 | Nhắc đúng giờ, một lần, tôn trọng yên lặng | 100% | Một dòng, gọi lại không đôi; Chế độ tập trung thì không đẩy | Đạt (T) · thử tay | T-SQL `avora107_habits.sql` |
| 7.4 | Hết ngày đúng 24:00 | 100% | Theo giờ máy (ADR-077); qua 24:00 phiên tự huỷ | Đạt | `avora107-timer.test.ts`, `L4.3-…json` |
| 7.5 | Chạy ngoại tuyến | 100% | Hàng đợi trên máy, id tạo tại máy | Đạt | `avora107-habits.test.ts` |

### Luồng 8. Két sắt
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 8.1 | Mở, khoá, tự khoá | 100% | Kiểm thử hiện có xanh | Đạt | `avora-51-vault-lock.test.ts`, `avora-102-vault.browser.test.tsx` |
| 8.2 | Quên mật khẩu Két sắt đúng thiết kế | 100% | Kiểm thử hiện có xanh | Đạt (T) · thử tay | `avora-102-vault.browser.test.tsx`, `screens-66-73.browser.test.tsx` |
| 8.3 | Không hứa vượt thực tế về mã hoá | 0 chỗ | Quét `src/`: không có "an toàn tuyệt đối", "không thể sao chép", "không ai đọc được". Câu duy nhất có "mã hoá đầu-cuối" là câu nói thật "chưa được mã hoá đầu-cuối" (ADR-020). | Đạt | quét 13/10; `policy-content.test.ts` |
| 8.4 | Không lộ dữ liệu khi chuyển app | 0 | — | Thử tay | — |

### Luồng 9. Sao lưu, khôi phục, xoá tài khoản
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 9.1 | Sao lưu / khôi phục máy mới | 100% khớp | Không có tính năng sao lưu toàn tài khoản | Chưa có | LOI.md · tính năng chưa có |
| 9.2 | Xuất dữ liệu đúng và đủ | 100% | Có xuất từng phần (Két sắt · giao dịch, vCard), không có "xuất tất cả" | Một phần | `finance-export.browser.test.tsx`, `contact-vcard.test.ts` |
| 9.3 | Xoá tài khoản không sót bảng | 0 bảng sót | Chưa có (111-A) | Chưa có | — |
| 9.4 | Báo xoá / đổi mật khẩu tới mọi phiên | 100% | Đổi mật khẩu đăng xuất các phiên khác (`signOut scope=others`); thiết bị bị thu hồi bị chặn qua `session_allowed`. Chưa có bài đo hai phiên. | Một phần | `auth.tsx · updatePassword`, T-SQL `avora102_vault_device_gate.probe.sql` |

### Luồng 10. Tải nặng và mạng yếu
| # | Yêu cầu | Ngưỡng | Kết quả đo | Đạt? | Bằng chứng |
|---|---|---|---|---|---|
| 10.1 | 5.000 tin: hiện 30 tin mới nhất | ≤ 1,5 s | 490 / 332 / 372 ms, gồm khởi động app (mạng mô phỏng). Máy chủ thật đọc theo chỉ mục. | Đạt (phần app) · thử tay | `L10.1-5000-tin.json`; T-SQL `k3_speed.sql` (N2) |
| 10.2 | Danh bạ 1.000: tìm ≤ 300 ms, cuộn ≥ 50 khung hình/giây | — | Tìm không dấu: p95 4,6 ms, max 7 ms. Cuộn: thử tay. | Đạt (tìm) · thử tay (cuộn) | `L10.2-danh-ba-1000.json`; `avora-102-contacts.browser.test.tsx` (102.14) |
| 10.3 | 3G chậm / chập chờn: không treo, không mất | 0 · 0 | 400 ± 200 ms mỗi chiều, 10% rớt: 50/50 tới, 0 trùng. Bấm Gửi tới khi có bong bóng ≤ 14 ms. | Đạt | `L10.3-3g-chap-chon.json` |
| 10.4 | Dùng 1 giờ: bộ nhớ tăng ≤ 30% | — | — | Thử tay | — |
| 10.5 | Hai thiết bị / hai tab: không xung đột | 0 lỗi | Hai tab: tab 2 mang luôn hàng chờ của tab 1 (chung IndexedDB), 0 trùng, đúng thứ tự, hai tab cùng một cuộc. Hai thiết bị: số chưa đọc khớp (3.4). | Đạt | `L10.5-hai-tab.json`, `L3.4-…json` |

### Ngoài 10 luồng: dữ liệu dài (112-A · 7)
Liên hệ (120 người tên dài, nhiều chữ viết), Nhiệm vụ Hôm nay / Tất cả (60 việc tiêu đề rất dài), Hồ sơ (tên và email rất dài), Avora Space. Đo ở 390×844 và 360×740: **10/10 không tràn, không kéo ngang được**. Chữ dài cắt bằng dấu "…".
Bằng chứng: `L-dai-*.json`, ảnh `docs/screens/2026-10-13/112A-dai-*.png`.
Bộ dữ liệu: `web/src/test/fixtures/long-data.ts`.

### 114 và 115 trong bảng
- Âm báo (luồng 3) nằm trong 3.2: bảng 128 tổ hợp, 11 test trình duyệt.
- Ảnh đại diện (hiển thị người trong chat và danh bạ) có ở luồng 2: avatar trong khung chat, danh bạ dữ liệu dài. Luật "ai thấy" kiểm bằng T-SQL `avora115_avatars.sql` (12/12).

## Khung kiểm thử (dùng lại ở mọi PHẦN sau)
- `web/src/test/reliability/session-graphs.ts`: mỗi người hoặc thiết bị là **một bản app riêng** (bộ module `src/` riêng: bộ nhớ đệm, hàng chờ, client Supabase riêng; React dùng chung).
- `two-people.ts`: `world.open(userId, tên, {conversationId, inbox, tasks})` trả về `{ api, net, reload(), close(), open() }`; mở hai lần cùng một userId là hai thiết bị hoặc hai tab.
- `fake-server.ts`: một máy chủ giả dùng chung. Giữ luật: `send_message` chống trùng theo id, máy chủ đặt giờ, phát theo chủ đề riêng `user-<id>`, quyền theo thành viên, `messages_page` theo con trỏ (µs, id), dọn tệp mồ côi đếm được. `refuse` để giả lập lỗi máy chủ.
- `faults.ts` (chèn lỗi):
  - (a) `net.offline()` / `online()`
  - (b) `net.slow({latencyMs, jitterMs})`
  - (c) `person.reload()` / `close()` + `open()` giữa chừng một thao tác
  - (d) `userEvent.dblClick` trên nút thật
  - (e) `net.expireSession()` / `renewSession()`
  - ngẫu nhiên: `net.chaos({dropRequest, dropResponse, seed})`.
- `record.ts`: `recordMeasure()` ghi JSON vào `docs/reliability/do-112a/`.
- Chạy: `bun x vitest run --config vitest.browser.config.ts src/test/golden-` · `bun x vitest run src/test/golden-units.test.ts` · `bun run test:sql`.
