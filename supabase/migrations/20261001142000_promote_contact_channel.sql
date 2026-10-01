-- AVORA-57 · J — "Số chính" on a Cần xem lại card.
--
-- Swaps a channel with the contact's own phone / email in one transaction: the chosen value
-- becomes the contact row's field, the old primary becomes an ordinary channel, and the whole
-- kind is marked as looked at (the person has just answered the question). Owner only.

create or replace function public.promote_contact_channel (p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_ch public.contact_channel%rowtype;
  v_old text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_ch from public.contact_channel where id = p_channel_id and owner_user_id = v_uid;
  if not found then raise exception 'Không tìm thấy kênh liên hệ này'; end if;

  if v_ch.kind = 'phone' then
    select phone into v_old from public.contact where id = v_ch.contact_id and owner_user_id = v_uid;
    update public.contact set phone = v_ch.value where id = v_ch.contact_id and owner_user_id = v_uid;
  else
    select email into v_old from public.contact where id = v_ch.contact_id and owner_user_id = v_uid;
    update public.contact set email = v_ch.value where id = v_ch.contact_id and owner_user_id = v_uid;
  end if;

  if coalesce (btrim (v_old), '') = '' then
    delete from public.contact_channel where id = v_ch.id;
  else
    update public.contact_channel set value = v_old, value_normalized = private.normalize_channel (v_ch.kind, v_old), label = null
    where id = v_ch.id;
  end if;

  update public.contact_channel set needs_review = false
  where contact_id = v_ch.contact_id and kind = v_ch.kind and owner_user_id = v_uid;
end;
$$;
revoke all on function public.promote_contact_channel (uuid) from public, anon;
grant execute on function public.promote_contact_channel (uuid) to authenticated;
