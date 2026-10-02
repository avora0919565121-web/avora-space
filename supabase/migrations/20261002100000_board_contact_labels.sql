-- AVORA-65 · E: a Liên hệ cell on a shared board shows the name the picker chose to bring in,
-- `Anh Hùng · của Lan`. The name is read by the server from the PICKER's own contact book at the
-- moment of picking (never typed by the client, never the phone / email / anything else), and
-- who picked it is auth.uid(). Clients cannot write contact_labels themselves.

alter table public.think_hub_record
  add column if not exists contact_labels jsonb not null default '{}'::jsonb;

create or replace function private.stamp_think_hub_contact_labels()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_defs   jsonb;
  v_def    jsonb;
  v_key    text;
  v_new    text;
  v_old    text;
  v_labels jsonb;
  v_name   text;
  v_uid    uuid := auth.uid();
  v_by     text;
begin
  -- Whatever the client sent is ignored: start from what was stored.
  v_labels := case when tg_op = 'UPDATE' then coalesce(old.contact_labels, '{}'::jsonb) else '{}'::jsonb end;
  select column_defs into v_defs from think_hub_table where id = new.table_id;

  for v_def in select * from jsonb_array_elements(coalesce(v_defs, '[]'::jsonb)) loop
    continue when v_def->>'type' is distinct from 'contact';
    v_key := v_def->>'key';
    v_new := nullif(btrim(coalesce(new.extension_fields->>v_key, '')), '');
    v_old := case when tg_op = 'UPDATE' then nullif(btrim(coalesce(old.extension_fields->>v_key, '')), '') else null end;

    if v_new is null then
      v_labels := v_labels - v_key;
    elsif v_new is distinct from v_old or not (v_labels ? v_key) then
      select c.name into v_name from contact c where c.id = v_new::uuid and c.owner_user_id = v_uid;
      if v_name is not null then
        select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_by from profiles p where p.id = v_uid;
        v_labels := v_labels || jsonb_build_object(
          v_key, jsonb_build_object('name', left(v_name, 80), 'by', v_uid, 'by_name', coalesce(v_by, 'Một thành viên')));
      elsif v_new is distinct from v_old then
        -- Not in the writer's book (a moved / copied row): no name travels with it.
        v_labels := v_labels - v_key;
      end if;
    end if;
  end loop;

  new.contact_labels := v_labels;
  return new;
end;
$$;

revoke all on function private.stamp_think_hub_contact_labels() from public, anon, authenticated;

drop trigger if exists trg_think_hub_record_contact_labels on public.think_hub_record;
create trigger trg_think_hub_record_contact_labels
  before insert or update on public.think_hub_record
  for each row execute function private.stamp_think_hub_contact_labels();

-- Rows already holding a contact: name them from their author's book, once.
update public.think_hub_record r set contact_labels = sub.labels
from (
  select r2.id, jsonb_object_agg(d->>'key', jsonb_build_object(
           'name', left(c.name, 80), 'by', c.owner_user_id,
           'by_name', coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên'))) as labels
  from think_hub_record r2
  join think_hub_table t on t.id = r2.table_id
  cross join lateral jsonb_array_elements(t.column_defs) d
  join contact c on c.id::text = r2.extension_fields->>(d->>'key') and c.owner_user_id = r2.owner_user_id
  left join profiles p on p.id = c.owner_user_id
  where d->>'type' = 'contact'
  group by r2.id
) sub
where sub.id = r.id;
