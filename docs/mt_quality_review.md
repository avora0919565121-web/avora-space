# AVORA-93 · 92.3b — Duyệt chất lượng dịch máy cả chương

**Tình trạng: CHƯA đủ để duyệt.** Cờ `chapter_mt_engines` đang rỗng: không ai thấy nút dịch cả chương.

| Đoạn mẫu | Bản gốc | Chrome Translator | Bergamot | Bản dịch người |
|---|---|---|---|---|
| *Pride and Prejudice*, ch. 1 (~300 chữ) | Gutenberg #1342, chương 1, 3 đoạn đầu | chưa chạy | chưa chạy | — |
| *Meditations*, quyển 2 (~300 chữ) | Gutenberg #2680, quyển 2, đoạn 1 | chưa chạy | chưa chạy | — |

## Vì sao chưa có bản dịch
- **Chrome Translator API** chỉ có trên Chrome / Edge máy tính có giao diện. Trình duyệt chạy thử trong máy dựng không có API này.
- **Bergamot** chưa được đưa vào app (xem báo cáo AVORA-93 · PHẦN 3 · 2.2).

## Cách VMT tạo hai cột còn thiếu
- **Cột Chrome:** mở một sách trên Chrome máy tính, tạm bật `chrome_translator` rồi dịch hai đoạn trên.
- **Cột Bergamot:** chờ bước thử 2.2 chạy được.
