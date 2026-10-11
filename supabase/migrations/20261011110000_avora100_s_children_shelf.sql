-- AVORA-100 · S.2 §4.4 (KHỐI 3B) — Tủ sách tuổi thơ. Rule of AVORA-103 / ADR-080: every author and
-- translator died > 70 years ago (≤ 1955 in 2026) or an open licence (CC BY / CC BY-SA). Each
-- Wikisource page below was opened on vi.wikisource.org (API) on 11/10/2026: it exists, its header
-- names the author / translator, and it carries a public-domain or open-licence tag.
--   Thơ ngụ ngôn La Fontaine (1951)      La Fontaine †1695 · Nguyễn Văn Vĩnh dịch †1936 · PD-old-80
--   Chuyện trẻ con                        Charles Perrault †1703 · Nguyễn Văn Vĩnh dịch †1936 · PD-old-80
--   Đeo nhạc cho mèo                      Nguyễn Văn Ngọc †1942 · PVCC-Việt Nam
--   Biên dịch:Cô bé Lọ Lem                Anh em Grimm †1859/†1863 · bản dịch cộng đồng Wikisource · CC BY-SA 4.0
--   Nam Hải dị nhân liệt truyện           Phan Kế Bính †1921 · PD-old-80
-- Checked and left out (báo cáo): Việt Nam sử lược (Trần Trọng Kim †1953, PVCC) — its chapters sit two
-- levels deep (Quyển I/Phần I/Chương I), so the reader would show only tables of contents; Luân lý
-- giáo khoa thư (Đặng Đình Phúc, Đỗ Thận: năm mất không rõ); Truyền kỳ mạn lục (Ngô Văn Triện dịch:
-- năm mất không rõ); folk tales filed `Văn kiện vô danh` with no edition or licence tag (Tấm Cám,
-- Thánh Gióng…); Gulliver du ký / Tê-lê-mặc (Nguyễn Văn Vĩnh dịch) — no page on Wikisource.
insert into public.book_catalog (source, source_id, title, title_vi, title_vi_kind, authors, language, category, author_died, pd_status, access)
values
  ('wikisource', 'Thơ ngụ ngôn La Fontaine (1951)', 'Thơ ngụ ngôn La Fontaine', 'Thơ ngụ ngôn La Fontaine', 'xuat_ban', 'Jean de La Fontaine; Nguyễn Văn Vĩnh (dịch)', 'vi', 'thieu_nhi', 1936, 'ok', 'read'),
  ('wikisource', 'Chuyện trẻ con', 'Chuyện trẻ con', 'Chuyện trẻ con', 'xuat_ban', 'Charles Perrault; Nguyễn Văn Vĩnh (dịch)', 'vi', 'thieu_nhi', 1936, 'ok', 'read'),
  ('wikisource', 'Đeo nhạc cho mèo', 'Đeo nhạc cho mèo', 'Đeo nhạc cho mèo', 'xuat_ban', 'Nguyễn Văn Ngọc', 'vi', 'thieu_nhi', 1942, 'ok', 'read'),
  ('wikisource', 'Biên dịch:Cô bé Lọ Lem', 'Cô bé Lọ Lem', 'Cô bé Lọ Lem', 'xuat_ban', 'Anh em Grimm; bản dịch Wikisource (CC BY-SA 4.0)', 'vi', 'thieu_nhi', 1863, 'ok', 'read'),
  ('wikisource', 'Nam Hải dị nhân liệt truyện', 'Nam Hải dị nhân liệt truyện', 'Nam Hải dị nhân liệt truyện', 'xuat_ban', 'Phan Kế Bính', 'vi', 'thieu_nhi', 1921, 'ok', 'read')
on conflict (source, source_id) do update set
  title = excluded.title, title_vi = excluded.title_vi, title_vi_kind = excluded.title_vi_kind, authors = excluded.authors,
  category = excluded.category, author_died = excluded.author_died, pd_status = excluded.pd_status, access = excluded.access, updated_at = now();

delete from public.book_catalog where source = 'wikisource' and source_id in ('Việt Nam sử lược/Quyển I', 'Việt Nam sử lược/Quyển II/1928');

-- Gutenberg books of the shelf that had no Vietnamese title yet (added to docs/book_title_vi_review.csv).
update public.book_catalog c set title_vi = v.title_vi, title_vi_kind = v.kind, updated_at = now()
from (values
  ('18732', 'Truyện ngụ ngôn Aesop', 'xuat_ban'),
  ('16865', 'Những cuộc phiêu lưu của Pinocchio', 'xuat_ban'),
  ('11757', 'Chú thỏ nhung', 'tam_dich'),
  ('521', 'Robinson Crusoe', 'xuat_ban'),
  ('1450', 'Pollyanna', 'xuat_ban'),
  ('11703', 'Gia đình Robinson Thụy Sĩ', 'xuat_ban')
) as v(source_id, title_vi, kind)
where c.source = 'gutenberg' and c.source_id = v.source_id and c.title_vi is null;

-- The children's books on Gutenberg sit under `Thiếu nhi · Thiếu niên` too (they were filed as Văn học).
update public.book_catalog set category = 'thieu_nhi', updated_at = now()
where source = 'gutenberg' and pd_status = 'ok' and category <> 'thieu_nhi'
  and source_id in ('11', '27200', '2591', '18732', '16', '16865', '55', '289', '236', '11757',
                    '113', '514', '45', '120', '521', '74', '271', '1450', '146', '164', '103', '46', '11703', '829');
