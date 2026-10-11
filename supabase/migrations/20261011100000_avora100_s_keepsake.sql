-- AVORA-100 · S.2 §4.3 (KHỐI 3B) — Dấu ấn riêng ở Avora Space.
-- One keepsake per person: an Avora sticker or one photo. Only in Avora Space, only for its owner:
-- the photo lives in the private bucket `keepsakes/{uid}/` that no one else can read; the column is
-- on profiles (own row only) and written through one RPC.

alter table public.profiles add column if not exists space_keepsake jsonb null;
alter table public.profiles drop constraint if exists profiles_space_keepsake_shape;
alter table public.profiles add constraint profiles_space_keepsake_shape check (
  space_keepsake is null
  or (space_keepsake ->> 'kind' = 'sticker' and jsonb_typeof(space_keepsake -> 'sticker_id') = 'string')
  or (space_keepsake ->> 'kind' = 'photo' and jsonb_typeof(space_keepsake -> 'path') = 'string'
      and jsonb_typeof(space_keepsake -> 'focus_y') = 'number'
      and (space_keepsake ->> 'focus_y')::numeric between 0 and 1)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('keepsakes', 'keepsakes', false, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists keepsakes_owner_insert on storage.objects;
create policy keepsakes_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'keepsakes' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists keepsakes_owner_read on storage.objects;
create policy keepsakes_owner_read on storage.objects for select to authenticated
using (bucket_id = 'keepsakes' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists keepsakes_owner_delete on storage.objects;
create policy keepsakes_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'keepsakes' and (storage.foldername(name))[1] = (select auth.uid())::text);

/**
 * Sets, moves (focus_y) or clears my keepsake. A sticker must be in the catalogue; a photo must be
 * my own object in `keepsakes/{uid}/`. Returns the photo path that is no longer used (the app
 * deletes it), or null.
 */
create or replace function public.set_space_keepsake(p_keepsake jsonb)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_path text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select space_keepsake into v_old from public.profiles where id = v_uid;
  if p_keepsake is not null then
    if p_keepsake ->> 'kind' = 'sticker' then
      if not exists (select 1 from public.sticker_catalog s where s.id = p_keepsake ->> 'sticker_id' and s.active) then
        raise exception 'avora_sticker_unknown';
      end if;
      p_keepsake := jsonb_build_object('kind', 'sticker', 'sticker_id', p_keepsake ->> 'sticker_id');
    elsif p_keepsake ->> 'kind' = 'photo' then
      v_path := p_keepsake ->> 'path';
      if v_path is null or v_path not like (v_uid::text || '/%') or v_path like '%..%'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'keepsakes' and o.name = v_path and o.owner_id = v_uid::text) then
        raise exception 'avora_keepsake_path_invalid';
      end if;
      p_keepsake := jsonb_build_object('kind', 'photo', 'path', v_path,
        'focus_y', greatest(0, least(1, coalesce((p_keepsake ->> 'focus_y')::numeric, 0.5))));
    else
      raise exception 'avora_keepsake_invalid';
    end if;
  end if;
  update public.profiles set space_keepsake = p_keepsake where id = v_uid;
  if v_old ->> 'kind' = 'photo' and (p_keepsake is null or p_keepsake ->> 'path' is distinct from v_old ->> 'path') then
    return v_old ->> 'path';
  end if;
  return null;
end $$;
revoke execute on function public.set_space_keepsake(jsonb) from public, anon;
grant execute on function public.set_space_keepsake(jsonb) to authenticated;

-- Own row only (profiles' select policy) — the column is readable by its owner.
grant select (space_keepsake) on public.profiles to authenticated;
