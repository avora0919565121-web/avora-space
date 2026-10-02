-- Advisor after AVORA-67: a primary key on the alarm log; the device_notify fix (unique dedupe key) is in the 67 migration.
alter table private.device_alarm_log add column if not exists id bigint generated always as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'private.device_alarm_log'::regclass and contype = 'p') then
    alter table private.device_alarm_log add primary key (id);
  end if;
end $$;
