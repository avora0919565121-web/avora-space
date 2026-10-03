-- AVORA-77 · D1: `+ Thêm sách tôi đang có` records where it is read — Kindle · Sách giấy · PDF · Khác.
-- `PDF` joins the `Nguồn` options of every Kệ sách (and the template new shelves are made from).
update public.think_hub_template
set column_defs = (
  select jsonb_agg(case when c->>'label' = 'Nguồn' and not (c->'options' ? 'PDF')
                        then jsonb_set(c, '{options}', (c->'options') || '["PDF"]'::jsonb) else c end order by ord)
  from jsonb_array_elements(column_defs) with ordinality as e(c, ord))
where key = 'reading';

alter table public.think_hub_table disable trigger trg_think_hub_table_touch_updated_at;
update public.think_hub_table
set column_defs = (
  select jsonb_agg(case when c->>'label' = 'Nguồn' and not (c->'options' ? 'PDF')
                        then jsonb_set(c, '{options}', (c->'options') || '["PDF"]'::jsonb) else c end order by ord)
  from jsonb_array_elements(column_defs) with ordinality as e(c, ord))
where kind = 'bookshelf' and jsonb_array_length(column_defs) > 0;
alter table public.think_hub_table enable trigger trg_think_hub_table_touch_updated_at;
