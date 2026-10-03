-- AVORA-77 · Advisor after migration: cover the two new foreign keys.
create index if not exists book_reading_state_record_idx on public.book_reading_state (record_id);
create index if not exists think_hub_conclusions_created_by_idx on public.think_hub_conclusions (created_by);
