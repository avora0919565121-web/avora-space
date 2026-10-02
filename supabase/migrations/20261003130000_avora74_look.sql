-- AVORA-74 (ADR-046) — Giao diện: Sắc màu (light / dark / device) + Tông màu (personal accent).
-- Stored on the account so every device follows; `device` in either column means each device
-- follows itself. New accounts: scheme `device`, tone `avora`. No age or birth date is read.

alter table public.profiles
  add column if not exists color_scheme text not null default 'device',
  add column if not exists accent_tone text not null default 'avora';

alter table public.profiles drop constraint if exists profiles_color_scheme_check;
alter table public.profiles
  add constraint profiles_color_scheme_check check (color_scheme in ('light', 'dark', 'device'));

-- No red / green / yellow tone on purpose: those colours carry meaning (delete, done, ★).
alter table public.profiles drop constraint if exists profiles_accent_tone_check;
alter table public.profiles
  add constraint profiles_accent_tone_check check (accent_tone in ('avora', 'bien', 'ngoc', 'tim', 'than', 'device'));

grant select (color_scheme, accent_tone), update (color_scheme, accent_tone) on public.profiles to authenticated;
