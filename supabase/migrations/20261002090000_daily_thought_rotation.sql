-- AVORA-64 · Danh ngôn luân phiên chủ đề.
-- New value 'danh_ngon_luan_phien' and it becomes the default for NEW profiles only.
-- Existing rows keep exactly what they hold (people on 'danh_ngon' see the same line as before).
alter table public.profiles drop constraint if exists profiles_daily_thought_category_valid;
alter table public.profiles
  add constraint profiles_daily_thought_category_valid
  check (daily_thought_category = any (array['kinh_thanh'::text, 'danh_ngon'::text, 'danh_ngon_luan_phien'::text, 'khong_chon'::text]));
alter table public.profiles alter column daily_thought_category set default 'danh_ngon_luan_phien';
