-- Đợt gộp 2 · A11: two per-account switches for in-app sounds, stored with the other profile
-- settings. Both default on. Column-level UPDATE only, like the rest of profiles.
alter table public.profiles
  add column if not exists sound_messages boolean not null default true,
  add column if not exists sound_reminders boolean not null default true;

grant select (sound_messages, sound_reminders) on public.profiles to authenticated;
grant update (sound_messages, sound_reminders) on public.profiles to authenticated;
