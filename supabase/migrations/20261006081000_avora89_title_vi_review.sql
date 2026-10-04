-- AVORA-89 · 1.2 — Vietnamese titles checked line by line against the real catalogue title.
-- 34380 is "The Call of the Wildflower" (Henry S. Salt), not Jack London — removed.
update public.book_catalog set title_vi = null, title_vi_kind = null where source = 'gutenberg' and source_id = '34380';
-- Volume / part made explicit; uncertain Vietnamese print titles downgraded to tạm dịch.
update public.book_catalog set title_vi = 'Bá tước Monte Cristo — Tập 1' where source = 'gutenberg' and source_id = '17989';
update public.book_catalog set title_vi = 'Thần khúc — Tập 1: Địa ngục', title_vi_kind = 'tam_dich' where source = 'gutenberg' and source_id = '1995';
update public.book_catalog set title_vi = 'Những ảo tưởng đám đông phi thường — Tập 1' where source = 'gutenberg' and source_id = '636';
update public.book_catalog set title_vi = 'Faust — Phần 1' where source = 'gutenberg' and source_id = '3023';
update public.book_catalog set title_vi = 'Sách rừng xanh' where source = 'gutenberg' and source_id = '236';
update public.book_catalog set title_vi_kind = 'tam_dich' where source = 'gutenberg' and source_id in ('59', '66048', '514', '98');
