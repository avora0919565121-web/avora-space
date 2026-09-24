# AVORA — Architecture Decision Log (ADR)

*Nguồn quyết định kiến trúc chính thức, cùng cấp với AGENTS.md/DESIGN.md. Mỗi ADR là 1 quyết định đã đủ chín — không nên tự ý thay đổi khi thực thi Prompt; nếu 1 Prompt có vẻ mâu thuẫn với ADR nào, dừng lại hỏi thay vì tự chọn 1 trong 2.*

## Freeze v1 — Đã khoá

- **ADR-001** — Khung Six-Hub: Avora Space (Clarity), Connect Hub (Relationship), Task Hub (Trách nhiệm thực thi), Think Hub (Trách nhiệm suy nghĩ, đổi tên từ Business Hub), Vault (Truth/Authority), Cài đặt. Self-develop Hub tồn tại như khái niệm nhưng KHÔNG xây riêng ở v1 (xem ADR-018).
- **ADR-002** — Project chỉ tạo được từ Nhóm (Group, ≥3 người); không tạo được từ Diary hoặc 1-1.
- **ADR-003** — Diary và 1-1 không có khái niệm Project; dùng Bảng/Record (Think Hub) trực tiếp cho nhu cầu cấu trúc suy nghĩ.
- **ADR-004** — Không có Sub-project (Project lồng trong Project). Chỉ giữ đúng 1 cơ chế phân tầng: Sub-table sinh từ 1 Record. Phân nhánh dự án dùng Project mới song song (cùng hoặc khác Group), không lồng cấp.
- **ADR-005** — Think Hub (Table/Record) = đơn vị suy nghĩ/cấu trúc; Task = đơn vị thực thi duy nhất của toàn hệ thống. Không có Objective Engine/Deliverable Engine/Milestone Engine riêng biệt — tất cả hội tụ về Record → Task.
- **ADR-006** — Sub-table giới hạn tối đa 3 tầng (`depth` CHECK 1-3). Mỗi Project có đúng 1 bảng gốc (unique index `project_id WHERE parent_record_id IS NULL`). Diary/1-1/Nhóm được nhiều bảng độc lập không giới hạn.
- **ADR-007** — Sub-group giới hạn tối đa 3 tầng (mô hình AF0-AF1-AF2). Cần nhánh sâu hơn → mở 1 cây Group độc lập mới (A1F0-A1F1-A1F2, chỉ là quy ước đặt tên, không lưu liên kết dữ liệu) thay vì lồng thêm tầng.
- **ADR-008** — 3 tầng AI (AAI-Avora/AAIUID/AAICID) phân biệt theo VỊ TRÍ CHẠM, không phải theo cấu hình bật/tắt: AAI-Avora (chưa đăng nhập/chưa kích hoạt AAIUID, zero data access), AAIUID (không gian riêng của user), AAICID (không gian chat dùng chung, do Owner gọi lên).
- **ADR-009** — AAICID chỉ xem được dữ liệu của đúng 1 ChatID nó đang hiện diện, không tổng hợp xuyên nhiều ChatID.
- **ADR-010** — Vault là tầng khoá riêng, trong cùng nhất, độc lập hoàn toàn với đăng nhập tài khoản — mở được tài khoản không đồng nghĩa mở được Vault.
- **ADR-011** — Trash 2 tầng thống nhất: mọi nội dung (không phân biệt nguồn trong/ngoài) xoá lần đầu → Inner Trash (khoá còn sống) → xoá tiếp → Outer Trash (khoá chuyển vào recovery envelope riêng) → xoá tiếp → Final Purge (crypto-erasure, biến mất vĩnh viễn thật).
- **ADR-012** — Reference-over-Copy: dùng tham chiếu thay vì sao chép khi phù hợp (Forward tin nhắn, file cloud ngoài qua Layer C).
- **ADR-013** — View vs Context: mọi màn "View" (Avora Space, Vault Space, Table overview) chỉ hiển thị, không cho phép hành động nghiệp vụ/đổi trạng thái — phải vào đúng Context gốc.
- **ADR-014** — Non-transitive authority: quyền ở 1 cấp (Owner Group cha) không tự động lan sang cấp khác (nội dung Group con) — kể cả trong tổ chức phân cấp.
- **ADR-015** — Permission ceiling áp theo từng node, kể cả trong luồng tự tham chiếu (Vault → Diary).
- **ADR-016** — Context Snapshot (JSONB trên Task) giữ nguyên ngữ cảnh gốc (ai nói gì, khi nào) dù tin nhắn/nguồn gốc bị xoá sau đó.
- **ADR-017** — Diary = 1 conversation type `personal`, không phải bảng dữ liệu riêng biệt.
- **ADR-018** — Self-develop Hub v1: hoãn, không xây tab/schema riêng — nhu cầu "tăng năng lực tư duy" tạm gộp vào Task lặp lại (recurrence) + Góc suy gẫm trong Avora Space (phản hồi Daily Thought).
- **ADR-019** — Identity/PIN Architecture: User PIN (`A-`+8 ký tự) là định danh vĩnh viễn, KHÔNG phải bí mật — chỉ dùng định tuyến lời mời, không tự lộ hồ sơ; 3 mật khẩu tối thiểu (tài khoản/Vault/backup), mỗi cái xuất hiện đúng lúc cần; khôi phục đăng nhập (1-trong-3: mật khẩu/email/SĐT) tách biệt khôi phục Vault (Recovery Kit riêng); Reset/Delete tài khoản bắt buộc cả 3 lớp (PIN + mật khẩu Vault + mật khẩu tài khoản×2); chính sách "nhà hoang" 2 năm + 12 lần nhắc trước khi Final Purge.
- **ADR-020** — Phân tầng bảo mật theo loại dữ liệu, không hứa đồng đều "an toàn tuyệt đối": Chat 1-1/Nhóm = E2EE thật, zero-access (kể cả AVORA không đọc được); Universal Inbox/Task/nội dung Forward = mã hoá tại chỗ nhưng KHÔNG zero-access, vì AI cần đọc để gợi ý Task/Deadline/người phụ trách — đánh đổi có chủ đích; Finance = mã hoá theo trường (field-level), hướng zero-knowledge. Cam kết truyền thông với người dùng phải nói rõ theo từng loại, không quảng cáo "an toàn tuyệt đối" chung chung.
- **ADR-021** — Hiệu ứng hoàn thành theo tầng, dùng đúng token trong `AVORA-Motion.tokens.json`, không phát minh hiệu ứng mới: Task hoàn thành → duration ngắn + đổi opacity 1 lần, không lặp; Record hoàn thành (Think Hub) → cực nhẹ, gần như không nhận ra; Project đóng thành công → duration chậm nhất + đổi opacity đầy đủ, KHÔNG có bước AI soạn nháp lời cảm ơn — hệ thống chỉ hỏi đúng 1 câu để trống hoàn toàn cho người lãnh đạo tự viết, gửi thì đăng vào Project chat và tự động ghim đầu; Project đóng không thành công → cùng duration chậm nhưng không đổi màu mừng, chỉ mở màn Check-Adjust riêng tư, không đăng gì vào chat. Với chế độ giảm chuyển động: mọi hiệu ứng trên chỉ được đổi qua opacity, không dịch chuyển/scale dù nhỏ.
- **ADR-022** — Thuật ngữ điều hướng chính thức (Anh = canonical dùng cho code/schema, Việt = hiển thị UI, không dịch tên biến): Task Hub → nav **"Nhiệm vụ"**; Think Hub → nav **"Kế hoạch"**; Connect Hub → nav **"Kết nối"**; Record → **"Hạng mục"**; Vault → **"Két sắt"**; Avora Space → không dịch. Loại khỏi mọi đề xuất khoá: "Trung tâm X", "Review Date/Ngày xem lại" (khái niệm đã gỡ bỏ).
- **ADR-023** — Khi đăng nhập, nội thất chiếm trọn màn hình — KHÔNG có khung/viền nào luôn hiển thị thế giới ngoài bên trong không gian đã đăng nhập. 3 giai đoạn hành trình người dùng chính thức là **Clarity → Inner Space → My Space** — KHÔNG dùng "Inner Sanctuary"/"Digital Home".

## Chưa Freeze — còn mở

- **OPEN-001** — Key & Trust Architecture thật (AMK/VMK/Device Key/Recovery Kit/Rotation/Revocation) — cần xong trước khi mời người dùng thật đầu tiên, không phải trước mọi thứ khác.
- **OPEN-002** — Notification Architecture nên là Projection (giống Calendar) — nguyên tắc đồng ý, chưa thiết kế chi tiết.
- **OPEN-003** — Event RSVP: đã có Accepted/Declined, còn thiếu Tentative/Follow.
- **OPEN-004** — Donation Payment Gateway (VNPay/Momo) — chưa chọn.
- **OPEN-005** — Organizational Finance (Pro tier) — chưa thiết kế.
- **OPEN-006** — Unified Domain Map chính thức — Avora Space và Think Space KHÔNG cùng 1 tầng.
- **OPEN-007** — Metadata leakage budget — chưa quyết định mức log tối thiểu.
- **OPEN-008** — Mindmap View cho Table/Record/Sub-table — dạng cây thư mục (tree/folder) là mặc định, không phải mindmap toả tròn tự do.
- **OPEN-009** — Vault Obligation → Task tự sinh — chưa xác nhận đã build cho Vay/Cho vay/Thuế.
- **OPEN-010** — Unified Trust Layer diagram — gộp PIN/Identity/Vault/Trash/Backup/AI Permission thành 1 sơ đồ.

## Nguyên tắc đọc file này

Mỗi Prompt mới nên tự đối chiếu với file này trước khi giả định hiện trạng. Nếu 1 yêu cầu trong Prompt có vẻ mâu thuẫn với 1 ADR đã Freeze, coi đó là dấu hiệu Prompt viết sai hoặc dựa trên hiểu biết cũ — dừng lại hỏi, đừng tự chọn hướng nào. Nếu liên quan tới 1 mục còn OPEN, cứ hỏi cụ thể trước khi tự quyết định thay.
