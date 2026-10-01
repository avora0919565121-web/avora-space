-- AVORA-61 · B: a cover colour per Ghi chép folder (one of 8 quiet AVORA tones).
-- Owner-only already: policy note_folders_own covers every command with owner_user_id = auth.uid().
alter table public.note_folders add column if not exists color text;
alter table public.note_folders drop constraint if exists note_folders_color_valid;
alter table public.note_folders
  add constraint note_folders_color_valid
  check (color is null or color = any (array['cam','dat','mat_ong','reu','suong','man','than','tro']));
revoke all (color) on public.note_folders from anon;
grant select (color), insert (color), update (color) on public.note_folders to authenticated;
