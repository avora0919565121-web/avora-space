-- AVORA-110 · Ngày nghỉ: màu đồng nhất, vùng nội tâm giữ màu (VMT 09/10).
-- Two plain profile columns, read and written only by their owner (the profiles RLS is own-row;
-- column grants follow the rest_weekday pattern). Nothing here widens who reads profiles.
--  * rest_saturday: "Thêm Thứ Bảy làm ngày nghỉ" (rest days = {rest_weekday} ∪ {6 if on}).
--  * rest_theme_enabled: "Đổi màu vào ngày nghỉ" (on by default; off changes nothing else).
-- The day is the device's day; the server never decides it.
alter table public.profiles add column if not exists rest_saturday boolean not null default false;
alter table public.profiles add column if not exists rest_theme_enabled boolean not null default true;
grant select (rest_saturday, rest_theme_enabled), update (rest_saturday, rest_theme_enabled) on public.profiles to authenticated;
revoke all (rest_saturday, rest_theme_enabled) on public.profiles from anon;
