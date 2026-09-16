-- AVORA — Finance v3 giai đoạn 1: bốn loại nghĩa vụ (Vay / Cho vay / Thuế)
--
-- Chỉ mở rộng enum. Postgres cho phép ADD VALUE trong transaction block (PG 12+) nhưng
-- KHÔNG cho dùng giá trị mới trước khi commit — nên phần cột/hàm nằm ở migration kế tiếp.

ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'vay';
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'cho_vay';
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'thue_ca_nhan';
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'thue_kinh_doanh';
