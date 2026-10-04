-- AVORA-100 · PHẦN V (ADR-063) — 13 vai trò · 6 bảng nền tảng · dọn dẹp chỉ gợi ý · Thùng rác bảng 30 ngày · Cài đặt › Dung lượng.
set search_path = '';

-- V·1 — 13 vai trò (+ `moi_nguoi` nội bộ cho mẫu dùng chung): 14 khoá.
alter table public.think_hub_template drop constraint if exists think_hub_template_audiences_check;
alter table public.think_hub_template add constraint think_hub_template_audiences_check check (
  cardinality(audiences) >= 1 and audiences <@ array['moi_nguoi','hoc_sinh','giao_vien','van_phong','quan_ly','doanh_nhan','sales','ke_toan','ky_thuat','tu_do','gia_dinh','cham_soc','hoi_thanh','cong_dong']::text[]);

-- V·2 — bảng nền tảng.
alter table public.think_hub_template add column if not exists is_foundation boolean not null default false;
update public.think_hub_template set is_foundation = true, sort_order = 5, audiences = array['moi_nguoi']::text[] where key = 'weigh_options';
update public.think_hub_template set is_foundation = true, audiences = array['moi_nguoi']::text[] where key = 'blank';
-- Mẫu cũ chỉ đổi `audiences` (cột, khoá, bảng đã tạo không đổi).
update public.think_hub_template set audiences = array['moi_nguoi','van_phong']::text[] where key = 'lessons';
update public.think_hub_template set audiences = array['doanh_nhan','quan_ly']::text[] where key in ('quarter_goals','hiring');
update public.think_hub_template set audiences = array['moi_nguoi','gia_dinh','cong_dong','hoi_thanh']::text[] where key = 'event';
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('f_list', 'Danh sách', 'track', 'Còn gì chưa xong?', 'Cột: Mục · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "chua", "label": "Chưa"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Mục', 'table', array['Ghi chú']::text[], 1, true, 1, array['moi_nguoi']::text[], 'Cần gom vài thứ phải nhớ, phải làm.', '[{"title": "Gửi lại hợp đồng", "Ghi chú": "Bản có chữ ký"}, {"title": "Mua quà sinh nhật mẹ", "Ghi chú": "Trước thứ Bảy"}]'::jsonb, true)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('f_track', 'Theo dõi tiến độ', 'progress', 'Việc nào đang vướng, vướng ở đâu?', 'Cột: Việc · Ai · Hạn', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Ai"}, {"type": "date", "label": "Hạn"}]'::jsonb, '[{"key": "chua_lam", "label": "Chưa làm"}, {"key": "dang_lam", "label": "Đang làm"}, {"key": "vuong", "label": "Vướng"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Việc', 'table', array['Ai']::text[], 1, true, 2, array['moi_nguoi']::text[], 'Nhiều việc chạy song song, muốn biết việc nào tới đâu.', '[{"title": "Làm slide báo cáo", "Ai": "Lan", "Hạn": "2026-10-10"}, {"title": "Đặt phòng họp", "Ai": "Minh", "Hạn": "2026-10-08"}]'::jsonb, true)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('f_catalog', 'Kho thông tin', 'learn', 'Lần sau cần tìm lại, mình sẽ tìm bằng chữ gì?', 'Cột: Tên · Loại · Liên kết · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "select", "label": "Loại", "options": ["Tài liệu", "Liên kết", "Ý tưởng", "Khác"]}, {"type": "text", "label": "Liên kết"}, {"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "moi", "label": "Mới"}, {"key": "da_dung", "label": "Đã dùng", "done": true}]'::jsonb, 'Tên', 'table', array['Loại']::text[], 1, true, 3, array['moi_nguoi']::text[], 'Có tài liệu, đường link, ý tưởng muốn giữ một chỗ.', '[{"title": "Mẫu hợp đồng thuê nhà", "Loại": "Tài liệu", "Ghi chú": "Bản 2025"}, {"title": "Bài viết về quản lý thời gian", "Loại": "Liên kết", "Liên kết": "https://…"}]'::jsonb, true)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('f_log', 'Ghi số theo ngày', 'track', 'Con số này đang lên hay xuống?', 'Cột: Mục · Ngày · Con số · Đơn vị · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "number", "label": "Con số"}, {"type": "text", "label": "Đơn vị"}, {"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "moi_ghi", "label": "Mới ghi"}, {"key": "da_xem", "label": "Đã xem", "done": true}]'::jsonb, 'Mục', 'table', array['Ngày']::text[], 1, true, 4, array['moi_nguoi']::text[], 'Muốn ghi một con số đều đặn: cân nặng, chi tiêu, số trang đọc…', '[{"title": "Đi bộ", "Ngày": "2026-10-04", "Con số": "6500", "Đơn vị": "bước"}, {"title": "Đi bộ", "Ngày": "2026-10-05", "Con số": "8200", "Đơn vị": "bước"}]'::jsonb, true)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('lesson_plan', 'Giáo án theo tuần', 'progress', 'Sau buổi này, học trò làm được điều gì mới?', 'Cột: Buổi · Lớp · Ngày · Mục tiêu · Chuẩn bị', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Lớp"}, {"type": "date", "label": "Ngày"}, {"type": "text", "label": "Mục tiêu"}, {"type": "text", "label": "Chuẩn bị"}]'::jsonb, '[{"key": "soan", "label": "Soạn"}, {"key": "san_sang", "label": "Sẵn sàng"}, {"key": "da_day", "label": "Đã dạy", "done": true}]'::jsonb, 'Buổi', 'table', array['Lớp']::text[], 1, true, 500, array['giao_vien']::text[], 'Chuẩn bị các buổi dạy trong tuần.', '[{"title": "Phân số – bài 1", "Lớp": "6A", "Ngày": "2026-10-07", "Mục tiêu": "Hiểu tử số, mẫu số", "Chuẩn bị": "Bánh giấy cắt 8 phần"}, {"title": "Ôn tập chương 1", "Lớp": "6B", "Ngày": "2026-10-09", "Mục tiêu": "Làm được 10 câu trắc nghiệm", "Chuẩn bị": "Phiếu bài tập"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('learners', 'Theo dõi học viên', 'track', 'Em này cần mình giúp điều gì tuần này?', 'Cột: Học viên · Lớp · Điểm mạnh · Cần giúp · Lần trao đổi gần nhất', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Lớp"}, {"type": "text", "label": "Điểm mạnh"}, {"type": "text", "label": "Cần giúp"}, {"type": "date", "label": "Lần trao đổi gần nhất"}]'::jsonb, '[{"key": "dang_theo", "label": "Đang theo"}, {"key": "da_xong", "label": "Đã xong khoá", "done": true}]'::jsonb, 'Học viên', 'table', array['Lớp']::text[], 1, true, 501, array['giao_vien']::text[], 'Muốn để ý từng học viên, không chỉ điểm số.', '[{"title": "An", "Lớp": "6A", "Điểm mạnh": "Đọc nhanh", "Cần giúp": "Trình bày bài giải"}, {"title": "Bình", "Lớp": "6A", "Điểm mạnh": "Hỏi nhiều", "Cần giúp": "Tập trung cuối giờ"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('question_bank', 'Ngân hàng câu hỏi', 'learn', 'Câu này kiểm tra hiểu hay chỉ kiểm tra nhớ?', 'Cột: Câu hỏi · Chủ đề · Mức · Đáp án', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Chủ đề"}, {"type": "select", "label": "Mức", "options": ["Dễ", "Vừa", "Khó"]}, {"type": "text", "label": "Đáp án"}]'::jsonb, '[{"key": "nhap", "label": "Nháp"}, {"key": "da_dung", "label": "Đã dùng", "done": true}]'::jsonb, 'Câu hỏi', 'table', array['Chủ đề']::text[], 1, true, 502, array['giao_vien']::text[], 'Gom câu hỏi để ra đề, kiểm tra nhanh.', '[{"title": "1/2 và 2/4 có bằng nhau không?", "Chủ đề": "Phân số", "Mức": "Dễ", "Đáp án": "Bằng nhau"}, {"title": "Vì sao không cộng mẫu số với nhau?", "Chủ đề": "Phân số", "Mức": "Vừa", "Đáp án": "Mẫu chỉ số phần chia"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('weekly_report', 'Việc tuần & báo cáo', 'progress', 'Tuần này mình đã làm ra được gì?', 'Cột: Việc · Tuần · Kết quả · Vướng', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Tuần"}, {"type": "text", "label": "Kết quả"}, {"type": "text", "label": "Vướng"}]'::jsonb, '[{"key": "dang_lam", "label": "Đang làm"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Việc', 'table', array['Tuần']::text[], 1, true, 510, array['van_phong']::text[], 'Cuối tuần cần báo cáo việc đã làm.', '[{"title": "Tổng hợp số liệu bán hàng", "Tuần": "Tuần 40", "Kết quả": "Gửi sếp thứ Năm"}, {"title": "Cập nhật danh bạ khách", "Tuần": "Tuần 40", "Vướng": "Thiếu số điện thoại 12 khách"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('meeting_followup', 'Họp & việc sau họp', 'track', 'Sau cuộc họp này, ai làm gì, khi nào?', 'Cột: Cuộc họp · Ngày · Việc phải làm · Ai · Hạn', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "text", "label": "Việc phải làm"}, {"type": "text", "label": "Ai"}, {"type": "date", "label": "Hạn"}]'::jsonb, '[{"key": "chua", "label": "Chưa"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Cuộc họp', 'table', array['Ngày']::text[], 1, true, 511, array['van_phong']::text[], 'Họp xong hay quên việc đã hứa.', '[{"title": "Họp giao ban thứ Hai", "Ngày": "2026-10-06", "Việc phải làm": "Gửi kế hoạch quý", "Ai": "Hà", "Hạn": "2026-10-10"}, {"title": "Họp với đối tác", "Ngày": "2026-10-07", "Việc phải làm": "Báo giá lại", "Ai": "Tuấn", "Hạn": "2026-10-09"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('team_assign', 'Phân việc trong nhóm', 'progress', 'Ai đang ôm nhiều quá, ai đang chờ việc?', 'Cột: Việc · Ai · Hạn · Vướng gì', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Ai"}, {"type": "date", "label": "Hạn"}, {"type": "text", "label": "Vướng gì"}]'::jsonb, '[{"key": "chua_nhan", "label": "Chưa nhận"}, {"key": "dang_lam", "label": "Đang làm"}, {"key": "vuong", "label": "Vướng"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Việc', 'table', array['Ai']::text[], 1, true, 520, array['quan_ly']::text[], 'Chia việc cho nhóm và nhìn ai đang vướng.', '[{"title": "Chuẩn bị hội thảo", "Ai": "Nga", "Hạn": "2026-10-20"}, {"title": "Sửa quy trình nhập kho", "Ai": "Khoa", "Vướng gì": "Chờ kế toán duyệt"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('one_on_one', 'Gặp riêng từng người', 'track', 'Lần trước mình đã hứa giúp người này điều gì?', 'Cột: Người · Lần gặp · Điều đã nói · Hẹn lần sau', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Lần gặp"}, {"type": "text", "label": "Điều đã nói"}, {"type": "text", "label": "Hẹn lần sau"}]'::jsonb, '[{"key": "sap_gap", "label": "Sắp gặp"}, {"key": "da_gap", "label": "Đã gặp", "done": true}]'::jsonb, 'Người', 'table', array['Lần gặp']::text[], 1, true, 521, array['quan_ly']::text[], 'Gặp riêng từng người trong nhóm định kỳ.', '[{"title": "Nga", "Lần gặp": "2026-10-01", "Điều đã nói": "Muốn học thêm thiết kế", "Hẹn lần sau": "Gửi khoá học"}, {"title": "Khoa", "Lần gặp": "2026-09-28", "Điều đã nói": "Mệt vì tăng ca", "Hẹn lần sau": "Xem lại lịch trực"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('inventory', 'Hàng tồn & nhập hàng', 'track', 'Món nào sắp hết mà chưa đặt?', 'Cột: Món · Còn · Mức đặt lại · Nhà cung cấp', '{journal,direct,group,project}'::text[], '[{"type": "number", "label": "Còn"}, {"type": "number", "label": "Mức đặt lại"}, {"type": "text", "label": "Nhà cung cấp"}]'::jsonb, '[{"key": "du", "label": "Đủ"}, {"key": "sap_het", "label": "Sắp hết"}, {"key": "da_dat", "label": "Đã đặt", "done": true}]'::jsonb, 'Món', 'table', array['Còn']::text[], 1, true, 530, array['doanh_nhan']::text[], 'Bán hàng cần biết món nào sắp hết.', '[{"title": "Cà phê hạt 1kg", "Còn": "4", "Mức đặt lại": "5", "Nhà cung cấp": "Anh Phúc"}, {"title": "Ly giấy 12oz", "Còn": "300", "Mức đặt lại": "200", "Nhà cung cấp": "Cty Minh An"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('quotes_sent', 'Báo giá đã gửi', 'progress', 'Báo giá nào chưa ai hỏi lại?', 'Cột: Khách · Ngày gửi · Giá trị · Bước tiếp', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày gửi"}, {"type": "number", "label": "Giá trị"}, {"type": "text", "label": "Bước tiếp"}]'::jsonb, '[{"key": "cho", "label": "Chờ"}, {"key": "thuong_luong", "label": "Đang thương lượng"}, {"key": "chot", "label": "Chốt", "done": true}, {"key": "khong_thanh", "label": "Không thành", "done": true}]'::jsonb, 'Khách', 'table', array['Ngày gửi']::text[], 1, true, 540, array['sales']::text[], 'Gửi nhiều báo giá, sợ quên theo.', '[{"title": "Cty Hoà Bình", "Ngày gửi": "2026-10-01", "Giá trị": "45000000", "Bước tiếp": "Gọi lại thứ Tư"}, {"title": "Chị Mai – quán ăn", "Ngày gửi": "2026-09-29", "Giá trị": "8500000", "Bước tiếp": "Gửi mẫu thử"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('materials', 'Vật tư cần đặt', 'progress', 'Thứ gì phải về trước để thợ không phải chờ?', 'Cột: Vật tư · Số lượng · Đơn vị · Cần trước', '{journal,direct,group,project}'::text[], '[{"type": "number", "label": "Số lượng"}, {"type": "text", "label": "Đơn vị"}, {"type": "date", "label": "Cần trước"}]'::jsonb, '[{"key": "chua_dat", "label": "Chưa đặt"}, {"key": "da_dat", "label": "Đã đặt"}, {"key": "da_ve", "label": "Đã về", "done": true}]'::jsonb, 'Vật tư', 'table', array['Số lượng']::text[], 1, true, 550, array['ky_thuat']::text[], 'Công trình cần vật tư đúng lúc.', '[{"title": "Xi măng", "Số lượng": "40", "Đơn vị": "bao", "Cần trước": "2026-10-08"}, {"title": "Ống nước phi 27", "Số lượng": "12", "Đơn vị": "cây", "Cần trước": "2026-10-10"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('maintenance', 'Bảo trì định kỳ', 'track', 'Thiết bị nào sắp tới hạn bảo trì?', 'Cột: Thiết bị · Chu kỳ · Lần gần nhất · Lần tới', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Chu kỳ"}, {"type": "date", "label": "Lần gần nhất"}, {"type": "date", "label": "Lần tới"}]'::jsonb, '[{"key": "on", "label": "Ổn"}, {"key": "sap_toi_han", "label": "Sắp tới hạn"}, {"key": "qua_han", "label": "Quá hạn"}]'::jsonb, 'Thiết bị', 'table', array['Chu kỳ']::text[], 1, true, 551, array['ky_thuat']::text[], 'Có máy móc cần kiểm tra đều đặn.', '[{"title": "Máy lạnh phòng họp", "Chu kỳ": "3 tháng", "Lần gần nhất": "2026-07-10", "Lần tới": "2026-10-10"}, {"title": "Máy phát điện", "Chu kỳ": "6 tháng", "Lần gần nhất": "2026-05-02", "Lần tới": "2026-11-02"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('client_jobs', 'Khách & việc nhận', 'progress', 'Việc nào đã giao mà chưa thu tiền?', 'Cột: Việc · Khách · Giá · Hạn', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Khách"}, {"type": "number", "label": "Giá"}, {"type": "date", "label": "Hạn"}]'::jsonb, '[{"key": "bao_gia", "label": "Báo giá"}, {"key": "dang_lam", "label": "Đang làm"}, {"key": "da_giao", "label": "Đã giao"}, {"key": "da_thu", "label": "Đã thu tiền", "done": true}]'::jsonb, 'Việc', 'table', array['Khách']::text[], 1, true, 560, array['tu_do']::text[], 'Nhận việc từ nhiều khách cùng lúc.', '[{"title": "Thiết kế logo", "Khách": "Tiệm bánh Mơ", "Giá": "3000000", "Hạn": "2026-10-12"}, {"title": "Chụp ảnh sản phẩm", "Khách": "Shop Lá", "Giá": "2500000", "Hạn": "2026-10-15"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('content_calendar', 'Lịch đăng nội dung', 'progress', 'Bài này giúp người xem điều gì?', 'Cột: Bài · Kênh · Ngày đăng', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Kênh"}, {"type": "date", "label": "Ngày đăng"}]'::jsonb, '[{"key": "y_tuong", "label": "Ý tưởng"}, {"key": "dang_lam", "label": "Đang làm"}, {"key": "da_dang", "label": "Đã đăng", "done": true}]'::jsonb, 'Bài', 'table', array['Kênh']::text[], 1, true, 561, array['tu_do']::text[], 'Đăng nội dung đều đặn trên một hoặc vài kênh.', '[{"title": "3 mẹo chụp ảnh bằng điện thoại", "Kênh": "Facebook", "Ngày đăng": "2026-10-09"}, {"title": "Hậu trường buổi chụp", "Kênh": "Instagram", "Ngày đăng": "2026-10-11"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('ideas_bank', 'Ý tưởng sáng tác', 'learn', 'Ý tưởng nào làm mình muốn bắt tay ngay?', 'Cột: Ý tưởng · Loại · Vì sao thích', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Loại"}, {"type": "text", "label": "Vì sao thích"}]'::jsonb, '[{"key": "moi", "label": "Mới"}, {"key": "da_lam", "label": "Đã làm", "done": true}]'::jsonb, 'Ý tưởng', 'table', array['Loại']::text[], 1, true, 562, array['tu_do']::text[], 'Ý tưởng đến bất chợt, muốn giữ lại.', '[{"title": "Bộ ảnh chợ sáng", "Loại": "Ảnh", "Vì sao thích": "Ánh sáng đẹp lúc 6 giờ"}, {"title": "Truyện ngắn về người đưa thư", "Loại": "Viết", "Vì sao thích": "Nhớ ông ngoại"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('care_schedule', 'Lịch thuốc & tái khám', 'track', 'Hôm nay còn việc gì cho người thân chưa làm?', 'Cột: Việc · Người được chăm · Giờ / ngày · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Người được chăm"}, {"type": "text", "label": "Giờ / ngày"}, {"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "sap_toi", "label": "Sắp tới"}, {"key": "da_lam", "label": "Đã làm", "done": true}]'::jsonb, 'Việc', 'table', array['Người được chăm']::text[], 1, true, 570, array['cham_soc']::text[], 'Chăm người thân cần nhớ giờ thuốc, ngày tái khám.', '[{"title": "Uống thuốc huyết áp", "Người được chăm": "Bố", "Giờ / ngày": "7:00 mỗi sáng"}, {"title": "Tái khám mắt", "Người được chăm": "Mẹ", "Giờ / ngày": "14/10, 9:00", "Ghi chú": "Mang sổ khám cũ"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('care_contacts', 'Người hỗ trợ & bác sĩ', 'track', 'Khi cần gấp, mình gọi ai trước?', 'Cột: Tên · Vai trò · Cách liên hệ · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Vai trò"}, {"type": "text", "label": "Cách liên hệ"}, {"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "dang_ho_tro", "label": "Đang hỗ trợ"}, {"key": "thoi", "label": "Thôi", "done": true}]'::jsonb, 'Tên', 'table', array['Vai trò']::text[], 1, true, 571, array['cham_soc']::text[], 'Gom số điện thoại những người cùng chăm sóc.', '[{"title": "BS. Hạnh", "Vai trò": "Bác sĩ tim mạch", "Cách liên hệ": "Phòng khám, sáng T2–T6"}, {"title": "Cô Tư", "Vai trò": "Người trông buổi chiều", "Cách liên hệ": "Gọi trước 30 phút"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('care_log', 'Nhật ký chăm sóc', 'track', 'Hôm nay có điều gì khác hôm qua?', 'Cột: Ngày · Tình hình · Điều cần để ý', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Tình hình"}, {"type": "text", "label": "Điều cần để ý"}]'::jsonb, '[{"key": "on", "label": "Ổn"}, {"key": "can_de_y", "label": "Cần để ý"}, {"key": "da_qua", "label": "Đã qua", "done": true}]'::jsonb, 'Ngày', 'table', array['Tình hình']::text[], 1, true, 572, array['cham_soc']::text[], 'Muốn ghi lại tình hình mỗi ngày để kể cho bác sĩ.', '[{"title": "Thứ Hai 6/10", "Tình hình": "Ăn được, ngủ sớm", "Điều cần để ý": "Ho nhẹ buổi tối"}, {"title": "Thứ Ba 7/10", "Tình hình": "Đi bộ 15 phút", "Điều cần để ý": "Không"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('member_care', 'Chăm sóc · thăm viếng', 'track', 'Ai đã lâu mình chưa hỏi thăm?', 'Cột: Tín hữu · Nhóm / ban · Lần thăm gần nhất · Cần quan tâm', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Nhóm / ban"}, {"type": "date", "label": "Lần thăm gần nhất"}, {"type": "text", "label": "Cần quan tâm"}]'::jsonb, '[{"key": "on", "label": "Ổn"}, {"key": "can_tham", "label": "Cần thăm"}, {"key": "da_tham", "label": "Đã thăm", "done": true}]'::jsonb, 'Tín hữu', 'table', array['Nhóm / ban']::text[], 1, true, 600, array['hoi_thanh']::text[], 'Thăm viếng, quan tâm từng người trong hội thánh.', '[{"title": "Bà Năm", "Nhóm / ban": "Ban cao niên", "Lần thăm gần nhất": "2026-09-14", "Cần quan tâm": "Mới xuất viện"}, {"title": "Gia đình anh Tín", "Nhóm / ban": "Nhóm Thủ Đức", "Cần quan tâm": "Mới chuyển nhà"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('serve_roster', 'Lịch phục vụ · phân công', 'progress', 'Chủ nhật này còn chỗ nào chưa có người?', 'Cột: Việc · Ngày · Ai', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "text", "label": "Ai"}]'::jsonb, '[{"key": "chua_co", "label": "Chưa có người"}, {"key": "da_nhan", "label": "Đã nhận"}, {"key": "xong", "label": "Xong", "done": true}]'::jsonb, 'Việc', 'table', array['Ngày']::text[], 1, true, 601, array['hoi_thanh']::text[], 'Phân công giảng, hướng dẫn, đàn, đọc Kinh Thánh, tiếp tân…', '[{"title": "Đàn", "Ngày": "2026-10-12", "Ai": "Chị Hồng"}, {"title": "Đọc Kinh Thánh", "Ngày": "2026-10-12"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('teaching_plan', 'Chuẩn bị bài giảng · bài học', 'progress', 'Sau bài này, người nghe sống khác đi ở điểm nào?', 'Cột: Bài · Ngày · Phân đoạn Kinh Thánh · Ý chính · Lớp / buổi', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "text", "label": "Phân đoạn Kinh Thánh"}, {"type": "text", "label": "Ý chính"}, {"type": "text", "label": "Lớp / buổi"}]'::jsonb, '[{"key": "dang_soan", "label": "Đang soạn"}, {"key": "san_sang", "label": "Sẵn sàng"}, {"key": "da_giang", "label": "Đã giảng", "done": true}]'::jsonb, 'Bài', 'table', array['Ngày']::text[], 1, true, 602, array['hoi_thanh']::text[], 'Soạn bài giảng hoặc bài học theo lịch.', '[{"title": "Người Samari nhân lành", "Ngày": "2026-10-12", "Phân đoạn Kinh Thánh": "Lu-ca 10:25-37", "Ý chính": "Ai là người lân cận"}, {"title": "Lời cầu nguyện chung", "Ngày": "2026-10-19", "Phân đoạn Kinh Thánh": "Ma-thi-ơ 6:9-13", "Lớp / buổi": "Lớp thanh niên"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('prayer_list', 'Danh sách cầu nguyện', 'track', 'Điều mình đã cầu xin, giờ ra sao?', 'Cột: Lời cầu xin · Cho ai · Từ ngày · Lời đáp', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Cho ai"}, {"type": "date", "label": "Từ ngày"}, {"type": "text", "label": "Lời đáp"}]'::jsonb, '[{"key": "dang", "label": "Đang cầu nguyện"}, {"key": "da_dap", "label": "Đã được đáp", "done": true}]'::jsonb, 'Lời cầu xin', 'table', array['Cho ai']::text[], 1, true, 603, array['hoi_thanh']::text[], 'Giữ lại những điều đang cầu nguyện và lời đáp.', '[{"title": "Sức khoẻ sau mổ", "Cho ai": "Bà Năm", "Từ ngày": "2026-09-10"}, {"title": "Công việc mới", "Cho ai": "Anh Tín", "Từ ngày": "2026-09-20", "Lời đáp": "Đã nhận việc"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('newcomers', 'Người mới đến · theo dõi', 'progress', 'Người mới này đã có ai làm bạn chưa?', 'Cột: Tên · Lần đầu đến · Ai tiếp · Bước tiếp', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Lần đầu đến"}, {"type": "text", "label": "Ai tiếp"}, {"type": "text", "label": "Bước tiếp"}]'::jsonb, '[{"key": "moi", "label": "Mới"}, {"key": "da_lien_lac", "label": "Đã liên lạc"}, {"key": "da_vao_nhom", "label": "Đã vào nhóm", "done": true}]'::jsonb, 'Tên', 'table', array['Lần đầu đến']::text[], 1, true, 610, array['hoi_thanh']::text[], 'Đón người mới đến và giúp họ có chỗ đứng.', '[{"title": "Chị Thảo", "Lần đầu đến": "2026-09-28", "Ai tiếp": "Chị Hồng", "Bước tiếp": "Mời vào nhóm Thủ Đức"}, {"title": "Anh Quân", "Lần đầu đến": "2026-10-05", "Ai tiếp": "Anh Tín"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('worship_set', 'Chương trình thờ phượng · bài hát', 'progress', 'Các bài hát này dẫn hội chúng đi tới đâu?', 'Cột: Bài hát · Ngày · Giọng · Người hát / đàn', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "text", "label": "Giọng"}, {"type": "text", "label": "Người hát / đàn"}]'::jsonb, '[{"key": "da_chon", "label": "Đã chọn"}, {"key": "da_tap", "label": "Đã tập", "done": true}]'::jsonb, 'Bài hát', 'table', array['Ngày']::text[], 1, true, 611, array['hoi_thanh']::text[], 'Chọn bài và chuẩn bị chương trình thờ phượng.', '[{"title": "Ân điển lạ lùng", "Ngày": "2026-10-12", "Giọng": "G", "Người hát / đàn": "Ban hát A"}, {"title": "Chúa là tình yêu", "Ngày": "2026-10-12", "Giọng": "D"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('bible_class', 'Lớp học Kinh Thánh · môn đồ', 'learn', 'Học viên này đang hiểu tới đâu?', 'Cột: Học viên · Bài đang học · Buổi gần nhất · Ghi chú', '{journal,direct,group,project}'::text[], '[{"type": "text", "label": "Bài đang học"}, {"type": "date", "label": "Buổi gần nhất"}, {"type": "text", "label": "Ghi chú"}]'::jsonb, '[{"key": "dang_hoc", "label": "Đang học"}, {"key": "hoan_thanh", "label": "Hoàn thành", "done": true}]'::jsonb, 'Học viên', 'table', array['Bài đang học']::text[], 1, true, 612, array['hoi_thanh']::text[], 'Theo dõi từng người trong lớp học Kinh Thánh.', '[{"title": "Chị Thảo", "Bài đang học": "Bài 3 – Cầu nguyện", "Buổi gần nhất": "2026-10-01"}, {"title": "Anh Quân", "Bài đang học": "Bài 1 – Đức Chúa Trời là ai", "Ghi chú": "Hỏi nhiều, rất hăng"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('small_group', 'Nhóm nhỏ · thăm hỏi', 'track', 'Ai trong nhóm đã lâu không thấy?', 'Cột: Thành viên · Lần gặp gần nhất · Cần quan tâm', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Lần gặp gần nhất"}, {"type": "text", "label": "Cần quan tâm"}]'::jsonb, '[{"key": "on", "label": "Ổn"}, {"key": "can_tham", "label": "Cần thăm"}, {"key": "da_tham", "label": "Đã thăm", "done": true}]'::jsonb, 'Thành viên', 'table', array['Lần gặp gần nhất']::text[], 1, true, 620, array['cong_dong','hoi_thanh']::text[], 'Nhóm nhỏ, câu lạc bộ cần để ý từng người.', '[{"title": "Chú Hai", "Lần gặp gần nhất": "2026-09-20", "Cần quan tâm": "Đau lưng"}, {"title": "Vy", "Lần gặp gần nhất": "2026-10-03"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;
insert into public.think_hub_template (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, version, is_active, sort_order, audiences, when_to_use, example_rows, is_foundation)
values ('donations', 'Quỹ & đóng góp', 'track', 'Quỹ đang còn bao nhiêu, đã chi cho việc gì?', 'Cột: Khoản · Ngày · Số tiền · Người / nơi', '{journal,direct,group,project}'::text[], '[{"type": "date", "label": "Ngày"}, {"type": "number", "label": "Số tiền"}, {"type": "text", "label": "Người / nơi"}]'::jsonb, '[{"key": "thu", "label": "Thu"}, {"key": "chi", "label": "Chi"}]'::jsonb, 'Khoản', 'table', array['Ngày']::text[], 1, true, 621, array['cong_dong','hoi_thanh']::text[], 'Ghi các khoản thu chi của quỹ chung. Avora chỉ ghi, không giữ tiền.', '[{"title": "Đóng góp tháng 10", "Ngày": "2026-10-01", "Số tiền": "2000000", "Người / nơi": "Các thành viên"}, {"title": "Mua quà Trung thu", "Ngày": "2026-10-03", "Số tiền": "850000", "Người / nơi": "Nhà sách Phú Nhuận"}]'::jsonb, false)
on conflict (key) do update set name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question, description = excluded.description, column_defs = excluded.column_defs, status_options = excluded.status_options, title_label = excluded.title_label, mobile_columns = excluded.mobile_columns, sort_order = excluded.sort_order, audiences = excluded.audiences, when_to_use = excluded.when_to_use, example_rows = excluded.example_rows, is_foundation = excluded.is_foundation, is_active = true;

-- V·3 — mục đã cất.
alter table public.think_hub_record add column if not exists archived_at timestamptz;
create index if not exists think_hub_record_archived_idx on public.think_hub_record (table_id) where archived_at is not null;

-- Cất / lấy ra nhiều mục: cùng quyền với xoá một mục (người tạo mục hoặc chủ bảng, bảng còn thấy được).
create or replace function public.set_think_hub_records_archived(p_record_ids uuid[], p_archived boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_n integer;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_record_ids is null or cardinality(p_record_ids) = 0 then return 0; end if;
  if cardinality(p_record_ids) > 500 then raise exception 'avora_too_many'; end if;
  update public.think_hub_record r set archived_at = case when p_archived then coalesce(r.archived_at, now()) else null end
  where r.id = any (p_record_ids) and r.deleted_at is null
    and private.think_hub_table_visible(r.table_id, v_user)
    and (r.owner_user_id = v_user or exists (select 1 from public.think_hub_table t where t.id = r.table_id and t.owner_user_id = v_user));
  get diagnostics v_n = row_count;
  if v_n <> cardinality(p_record_ids) then raise exception 'avora_think_hub_record_not_yours'; end if;
  return v_n;
end $$;
revoke all on function public.set_think_hub_records_archived(uuid[], boolean) from public, anon;
grant execute on function public.set_think_hub_records_archived(uuid[], boolean) to authenticated;

-- Mục đã cất của một bảng (dòng `Đã cất n mục · Xem`).
create or replace function public.think_hub_archived_records(p_table_id uuid)
returns setof public.think_hub_record language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  return query select r.* from public.think_hub_record r
    where r.table_id = p_table_id and r.deleted_at is null and r.archived_at is not null order by r.archived_at desc;
end $$;
revoke all on function public.think_hub_archived_records(uuid) from public, anon;
grant execute on function public.think_hub_archived_records(uuid) to authenticated;

-- Bảng riêng của tôi đủ điều kiện gợi ý dọn: không chia sẻ, còn sống, chưa cất, không phải bảng con / kệ sách.
create or replace function private.cleanup_own_board(p_table_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.think_hub_table t
    where t.id = p_table_id and t.owner_user_id = p_user and t.conversation_id is null and t.project_id is null
      and t.deleted_at is null and t.archived_at is null and t.parent_record_id is null and t.kind is distinct from 'bookshelf')
$$;
revoke all on function private.cleanup_own_board(uuid, uuid) from public, anon, authenticated;

create or replace function private.record_is_done(p_status_options jsonb, p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status = 'khong_lam' or coalesce(
    (select (o ->> 'done')::boolean from jsonb_array_elements(coalesce(p_status_options, '[]'::jsonb)) o where o ->> 'key' = p_status limit 1),
    p_status = 'xong')
$$;
revoke all on function private.record_is_done(jsonb, text) from public, anon, authenticated;

-- V·3.2 — gợi ý dọn kệ: chỉ bảng tôi sở hữu và không chia sẻ.
create or replace function public.think_hub_cleanup_suggestions()
returns table(kind text, table_id uuid, table_name text, item_count integer, last_touch timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  return query
  with own as (
    select t.* from public.think_hub_table t
    where t.owner_user_id = v_user and private.cleanup_own_board(t.id, v_user)
  ),
  opened as (
    select o.board_key, max(o.opened_at) as at from public.think_hub_board_opened o where o.user_id = v_user group by o.board_key
  ),
  live as (
    select r.table_id, count(*)::integer as n from public.think_hub_record r join own on own.id = r.table_id
    where r.deleted_at is null and r.archived_at is null group by r.table_id
  )
  select 'dusty_board'::text, own.id, own.name, coalesce(live.n, 0), coalesce(op.at, own.created_at)
  from own left join opened op on op.board_key = own.id::text left join live on live.table_id = own.id
  where coalesce(op.at, own.created_at) < now() - interval '90 days' and coalesce(live.n, 0) > 0
  union all
  select 'done_records', own.id, own.name, count(*)::integer, max(r.updated_at)
  from own join public.think_hub_record r on r.table_id = own.id
  where r.deleted_at is null and r.archived_at is null and r.updated_at < now() - interval '90 days'
    and private.record_is_done(own.status_options, r.status)
  group by own.id, own.name
  union all
  select 'empty_board', own.id, own.name, 0, own.created_at
  from own left join live on live.table_id = own.id
  where coalesce(live.n, 0) = 0 and own.created_at < now() - interval '7 days'
    and not exists (select 1 from public.think_hub_record r where r.table_id = own.id and r.deleted_at is null);
end $$;
revoke all on function public.think_hub_cleanup_suggestions() from public, anon;
grant execute on function public.think_hub_cleanup_suggestions() to authenticated;

-- V·3.2 — làm những gì người dùng đã chọn; kiểm lại quyền và điều kiện từng mục.
create or replace function public.think_hub_cleanup_apply(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb; v_kind text; v_table uuid;
  v_archived_tables uuid[] := '{}'; v_archived_records uuid[] := '{}'; v_trashed uuid[] := '{}';
  v_ids uuid[];
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'avora_cleanup_bad_items'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_kind := v_item ->> 'kind';
    begin v_table := (v_item ->> 'table_id')::uuid; exception when others then raise exception 'avora_cleanup_bad_items'; end;
    if not private.cleanup_own_board(v_table, v_user) then raise exception 'avora_cleanup_not_allowed'; end if;
    if v_kind = 'dusty_board' then
      if exists (select 1 from public.think_hub_board_opened o where o.user_id = v_user and o.board_key = v_table::text and o.opened_at >= now() - interval '90 days')
         or exists (select 1 from public.think_hub_table t where t.id = v_table and t.created_at >= now() - interval '90 days') then
        raise exception 'avora_cleanup_not_allowed';
      end if;
      update public.think_hub_table set archived_at = now(), archived_by = v_user where id = v_table;
      v_archived_tables := v_archived_tables || v_table;
    elsif v_kind = 'done_records' then
      with done as (
        update public.think_hub_record r set archived_at = now()
        from public.think_hub_table t
        where t.id = r.table_id and r.table_id = v_table and r.deleted_at is null and r.archived_at is null
          and r.updated_at < now() - interval '90 days' and private.record_is_done(t.status_options, r.status)
        returning r.id)
      select coalesce(array_agg(id), '{}') into v_ids from done;
      v_archived_records := v_archived_records || v_ids;
    elsif v_kind = 'empty_board' then
      if exists (select 1 from public.think_hub_record r where r.table_id = v_table and r.deleted_at is null)
         or exists (select 1 from public.think_hub_table t where t.id = v_table and t.created_at >= now() - interval '7 days') then
        raise exception 'avora_cleanup_not_allowed';
      end if;
      perform public.delete_think_hub_table(v_table);
      v_trashed := v_trashed || v_table;
    else
      raise exception 'avora_cleanup_bad_items';
    end if;
  end loop;
  return jsonb_build_object('count', cardinality(v_archived_tables) + cardinality(v_trashed) + case when cardinality(v_archived_records) > 0 then 1 else 0 end,
    'archived_tables', to_jsonb(v_archived_tables), 'archived_records', to_jsonb(v_archived_records), 'trashed_tables', to_jsonb(v_trashed));
end $$;
revoke all on function public.think_hub_cleanup_apply(jsonb) from public, anon;
grant execute on function public.think_hub_cleanup_apply(jsonb) to authenticated;

-- V·3.2 — Thùng rác bảng / mục RIÊNG tự xoá hẳn sau 30 ngày, kèm đúng file đính kèm của chúng (think_hub_cell_files + object).
-- Bảng chia sẻ không bao giờ tự xoá (ADR-031). Không dùng hàm dọn file chung nào khác.
create or replace function private.think_hub_trash_purge()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_tables uuid[]; v_records uuid[]; v_paths text[]; v_n integer := 0;
begin
  select coalesce(array_agg(tree.id), '{}') into v_tables
  from public.think_hub_table t, lateral private.think_hub_table_tree(t.id) tree
  where t.deleted_at is not null and t.deleted_at < now() - interval '30 days'
    and t.conversation_id is null and t.project_id is null and t.parent_record_id is null and t.kind is distinct from 'bookshelf';
  select coalesce(array_agg(r.id), '{}') into v_records
  from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
  where r.deleted_at is not null and r.deleted_at < now() - interval '30 days'
    and t.conversation_id is null and t.project_id is null and t.deleted_at is null
    and not (r.table_id = any (v_tables));
  -- Bảng con dưới các mục bị xoá hẳn cũng đi theo.
  select v_tables || coalesce(array_agg(tree.id), '{}') into v_tables
  from public.think_hub_table c, lateral private.think_hub_table_tree(c.id) tree
  where c.parent_record_id = any (v_records);
  select coalesce(array_agg(f.storage_path), '{}') into v_paths from public.think_hub_cell_files f
  where f.table_id = any (v_tables) or f.record_id = any (v_records);
  if cardinality(v_paths) > 0 then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects o where o.bucket_id = 'board-files' and o.name = any (v_paths);
  end if;
  delete from public.think_hub_delete_cascade where table_id = any (v_tables);
  delete from public.think_hub_table where id = any (v_tables);
  get diagnostics v_n = row_count;
  delete from public.think_hub_record where id = any (v_records);
  return v_n + cardinality(v_records);
end $$;
revoke all on function private.think_hub_trash_purge() from public, anon, authenticated;
select cron.unschedule('avora_think_hub_trash_purge') where exists (select 1 from cron.job where jobname = 'avora_think_hub_trash_purge');
select cron.schedule('avora_think_hub_trash_purge', '40 0 * * *', 'select private.think_hub_trash_purge()');

-- V·4 — Cài đặt › Dung lượng: chỉ file do chính người gọi tải lên; không lộ tên file của ai khác.
create or replace function public.my_storage_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_out jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  with mine as (
    select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as size, o.created_at,
      case
        when o.bucket_id = 'chat-attachments' and exists (select 1 from public.conversations c where c.id::text = split_part(o.name, '/', 1) and c.type = 'personal') then 'journal'
        when o.bucket_id in ('chat-attachments', 'meeting-files') then 'chat'
        when o.bucket_id = 'note-files' then 'journal'
        when o.bucket_id = 'board-files' then 'boards'
        when o.bucket_id = 'vault-files' then 'vault'
        else 'other'
      end as place
    from storage.objects o where o.owner = v_user and o.bucket_id <> 'public-domain-books'
  )
  select jsonb_build_object(
    'total_bytes', coalesce((select sum(size) from mine), 0),
    'by_place', coalesce((select jsonb_object_agg(place, jsonb_build_object('bytes', b, 'files', n)) from (select place, sum(size) b, count(*) n from mine group by place) x), '{}'::jsonb),
    'boards', (select count(*) from public.think_hub_table t where t.owner_user_id = v_user and t.deleted_at is null),
    'records', (select count(*) from public.think_hub_record r where r.owner_user_id = v_user and r.deleted_at is null),
    'largest', coalesce((select jsonb_agg(x) from (
      select place, bucket_id as bucket, name as path, split_part(name, '/', 1) as ref, regexp_replace(name, '^.*/', '') as file_name, size, created_at
      from mine order by size desc limit 20) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.my_storage_usage() from public, anon;
grant execute on function public.my_storage_usage() to authenticated;

-- V·3.2 — mục đã cất: ẩn khỏi số đếm / kệ 2, vẫn hiện trong tìm kiếm với nhãn `Đã cất`.
CREATE OR REPLACE FUNCTION public.think_hub_room_stats(p_since date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_out jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_since is null or p_since < current_date - 180 or p_since > current_date + 1 then raise exception 'avora_activity_bad_day'; end if;

  with boards as (
    select t.id, t.name, coalesce(t.lifecycle, 'waiting') as lifecycle
    from public.think_hub_table t
    where t.deleted_at is null and t.archived_at is null and coalesce(t.lifecycle, 'waiting') <> 'archived'
      and t.kind is distinct from 'bookshelf' and t.parent_record_id is null
      and private.think_hub_table_visible(t.id, v_user)
  ),
  recs as (
    select r.id, r.table_id, r.created_at from public.think_hub_record r join boards b on b.id = r.table_id where r.deleted_at is null and r.archived_at is null
  ),
  linked as (
    select rt.task_id from public.think_hub_record_tasks rt join recs on recs.id = rt.record_id
    union
    select pt.task_id from public.project_tasks pt join recs on recs.id = pt.record_id
  ),
  open_tasks as (
    select distinct k.id from public.tasks k join linked l on l.task_id = k.id
    where k.status <> 'done' and (k.creator_id = v_user or k.assignee_id = v_user)
      and not (k.creator_id = v_user and coalesce(k.deleted_by_creator, false))
  ),
  act as (
    select a.kind, a.item_key, sum(a.opens)::int as opens, sum(a.active_seconds)::int as seconds, max(a.day) as last_day
    from public.activity_daily a where a.user_id = v_user and a.day >= p_since group by a.kind, a.item_key
  ),
  board_act as (
    select act.*, b.name from act left join boards b on b.id::text = act.item_key
    where act.kind = 'board' and (b.id is not null or act.item_key !~ '^[0-9a-f]{8}-')
  ),
  book_act as (
    select act.*, r.title as name from act join public.think_hub_record r on r.id::text = act.item_key
    where act.kind = 'book' and r.owner_user_id = v_user and r.deleted_at is null
  ),
  counts as (select table_id, count(*)::int as n from recs group by table_id)
  select jsonb_build_object(
    'boards_by_status', jsonb_build_object(
      'waiting', (select count(*) from boards where lifecycle = 'waiting'),
      'thinking', (select count(*) from boards where lifecycle = 'thinking'),
      'concluded', (select count(*) from boards where lifecycle = 'concluded')),
    'records_total', (select count(*) from recs),
    'records_new', (select count(*) from recs where created_at >= p_since::timestamptz),
    'open_tasks', (select count(*) from open_tasks),
    'top_items', coalesce((select jsonb_agg(x order by x.value desc, x.name) from (
        select b.id::text as board_key, b.name, c.n as value from boards b join counts c on c.table_id = b.id order by c.n desc, b.name limit 3) x), '[]'::jsonb),
    'top_opens', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, opens as value from board_act where opens > 0 order by opens desc, item_key limit 3) x), '[]'::jsonb),
    'top_time', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, seconds as value from board_act where seconds > 0 order by seconds desc, item_key limit 3) x), '[]'::jsonb),
    'viewed', coalesce((select jsonb_agg(x order by x.last_day desc, x.seconds desc) from (
        select 'board' as kind, item_key, name, opens, seconds, last_day from board_act
        union all
        select 'book', item_key, name, opens, seconds, last_day from book_act) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_open_questions()
 RETURNS TABLE(table_id uuid, empty_cells integer, has_conclusion boolean, others_changed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  return query
  select t.id,
    coalesce((select sum((select count(*) from jsonb_array_elements(t.column_defs) c
                          where coalesce(c ->> 'system', 'false') <> 'true' and c ? 'id'
                            and coalesce(r.extension_fields ->> (c ->> 'id'), '') = ''))::integer
              from public.think_hub_record r where r.table_id = t.id and r.deleted_at is null and r.archived_at is null), 0),
    exists (select 1 from public.think_hub_conclusions k where k.table_id = t.id),
    (select max(l.created_at) from public.think_hub_change_log l where l.table_id = t.id and l.actor_id <> v_user)
  from public.think_hub_table t
  where t.deleted_at is null and t.archived_at is null and private.think_hub_table_visible(t.id, v_user);
end $function$;

CREATE OR REPLACE FUNCTION public.search_avora(p_query text, p_here jsonb, p_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(kind text, id uuid, title text, snippet text, place_kind text, place_id uuid, place_name text, conversation_id uuid, at timestamp with time zone, in_here boolean, scope text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_first text;
  v_like text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_tab text := coalesce(p_here->>'tab', '');
  v_here_conv uuid := nullif(p_here->>'conversation_id', '')::uuid;
  v_types text[] := coalesce(p_types, array['message', 'file', 'task', 'note', 'record', 'table', 'contact', 'conversation']);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := left(v_q, 120);
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(public.f_unaccent(v_q), '\s+')) w where w <> '';
  if v_words is null then return; end if;
  select w into v_first from unnest(v_words) w order by char_length(w) desc limit 1;
  v_like := '%' || replace(replace(replace(v_first, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- messages (not recalled, not in the journal bin, not system lines)
  if 'message' = any (v_types) then
    return query
    select 'message'::text, m.id, null::text, left(m.content, 240), c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, m.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct'
                when exists (select 1 from projects p where p.conversation_id = c.id) then 'project' else 'group' end
    from messages m
    join conversations c on c.id = m.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where m.deleted_at is null and m.trashed_at is null and m.system_kind is null
      and public.f_unaccent(m.content) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(m.content) not like '%' || w || '%')
    order by m.created_at desc
    limit v_limit * 3;
  end if;

  if 'file' = any (v_types) then
    return query
    select 'file'::text, a.message_id, a.file_name, null::text, c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, a.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from message_attachments a
    join messages m on m.id = a.message_id and m.deleted_at is null and m.trashed_at is null
    join conversations c on c.id = a.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where public.f_unaccent(a.file_name) like v_like
    order by a.created_at desc
    limit v_limit * 2;
  end if;

  if 'task' = any (v_types) then
    return query
    select 'task'::text, t.id, t.title, left(coalesce(t.description, ''), 200),
           case when t.conversation_id is null then 'personal' else coalesce(c.type, 'personal') end,
           t.conversation_id, coalesce(g.name, case when t.conversation_id is null then 'Của tôi' when c.type = 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           t.conversation_id, t.updated_at,
           v_tab = 'nhiem-vu' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = t.conversation_id),
           case when t.type = 'personal' then 'personal' when t.type = '1-1-shared' then 'direct' else 'group' end
    from tasks t
    left join conversations c on c.id = t.conversation_id
    left join conversation_groups g on g.conversation_id = t.conversation_id
    where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) not like '%' || w || '%')
      and not (t.creator_id = v_uid and t.deleted_by_creator) and not (t.creator_id <> v_uid and t.deleted_by_peer)
    order by t.updated_at desc
    limit v_limit * 2;
  end if;

  if 'note' = any (v_types) then
    return query
    select 'note'::text, n.id, coalesce(nullif(btrim(n.title), ''), 'Ghi chép'), left(n.search_text, 200),
           'personal'::text, n.folder_id, coalesce(f.name, 'Chưa xếp'), null::uuid, n.updated_at,
           v_tab = 'nhat-ky', 'personal'::text
    from notes n
    left join note_folders f on f.id = n.folder_id
    where n.deleted_at is null and n.search_text like v_like
      and not exists (select 1 from unnest(v_words) w where n.search_text not like '%' || w || '%')
    order by n.updated_at desc
    limit v_limit * 2;
  end if;

  if 'record' = any (v_types) then
    return query
    select 'record'::text, r.id, r.title, case when r.archived_at is not null then 'Đã cất · ' else '' end || left(coalesce(r.notes, ''), 200),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, r.updated_at,
           v_tab = 'ke-hoach' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = tb.conversation_id),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_record r
    join think_hub_table tb on tb.id = r.table_id and tb.deleted_at is null
    left join conversations c on c.id = tb.conversation_id
    where r.deleted_at is null
      and public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) not like '%' || w || '%')
    order by r.updated_at desc
    limit v_limit * 2;
  end if;

  if 'table' = any (v_types) then
    return query
    select 'table'::text, tb.id, tb.name, coalesce(tb.purpose, ''),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, tb.updated_at, v_tab = 'ke-hoach',
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_table tb
    left join conversations c on c.id = tb.conversation_id
    where tb.deleted_at is null and public.f_unaccent(tb.name) like v_like
    order by tb.updated_at desc
    limit v_limit;
  end if;

  if 'contact' = any (v_types) then
    return query
    select 'contact'::text, ct.id, ct.name, null::text, 'contact'::text, ct.id, 'Liên hệ', null::uuid, ct.updated_at,
           v_tab = 'ket-noi' and v_here_conv is null, 'personal'::text
    from contact ct
    where public.f_unaccent(ct.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(ct.name) not like '%' || w || '%')
    order by ct.name
    limit v_limit;
  end if;

  if 'conversation' = any (v_types) then
    return query
    select 'conversation'::text, g.conversation_id, g.name, null::text, 'group'::text, g.conversation_id, g.name, g.conversation_id, g.updated_at,
           v_tab = 'ket-noi', 'group'::text
    from conversation_groups g
    join conversations c on c.id = g.conversation_id and c.deleted_at is null
    where public.f_unaccent(g.name) like v_like
    order by g.updated_at desc
    limit v_limit;
  end if;
end $function$;
