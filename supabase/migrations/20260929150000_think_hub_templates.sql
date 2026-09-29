-- Đợt gộp 2 · C1/C2 — Mẫu Bảng.
-- A template is a shape only: columns, statuses, what the title column is called, how the table
-- opens. Creating from a template copies that shape into the new table and keeps no link back:
-- editing a template never reaches a table made from it. "Mẫu của tôi" stores structure only,
-- never a single Hạng mục.

-- ------------------------------------------------------------------ table shape (C1.2)
alter table public.think_hub_table
  add column if not exists status_options jsonb,
  add column if not exists title_label text,
  add column if not exists default_view text,
  add column if not exists mobile_columns text[],
  add column if not exists source_template_key text,
  add column if not exists source_template_version integer;

alter table public.think_hub_table
  drop constraint if exists think_hub_table_status_options_shape,
  add constraint think_hub_table_status_options_shape check (
    status_options is null or (jsonb_typeof(status_options) = 'array' and jsonb_array_length(status_options) between 1 and 12)),
  drop constraint if exists think_hub_table_default_view_check,
  add constraint think_hub_table_default_view_check check (default_view is null or default_view in ('table', 'kanban', 'tree')),
  drop constraint if exists think_hub_table_title_label_len,
  add constraint think_hub_table_title_label_len check (title_label is null or char_length(btrim(title_label)) between 1 and 60),
  drop constraint if exists think_hub_table_mobile_columns_len,
  add constraint think_hub_table_mobile_columns_len check (mobile_columns is null or cardinality(mobile_columns) <= 2);

grant select (status_options, title_label, default_view, mobile_columns, source_template_key, source_template_version)
  on public.think_hub_table to authenticated;

-- ------------------------------------------------------------------ system templates (C1.1)
create table if not exists public.think_hub_template (
  key text primary key,
  name text not null,
  thinking_type text check (thinking_type is null or thinking_type in ('track', 'progress', 'breakdown', 'weigh', 'learn')),
  guiding_question text,
  description text,
  scopes text[] not null default '{journal,direct,group,project}',
  column_defs jsonb not null default '[]'::jsonb,
  status_options jsonb,
  title_label text not null default 'Tiêu đề',
  default_view text not null default 'table' check (default_view in ('table', 'kanban', 'tree')),
  mobile_columns text[] not null default '{}',
  sub_template_key text,
  version integer not null default 1,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

alter table public.think_hub_template enable row level security;
revoke all on public.think_hub_template from anon, authenticated;
grant select on public.think_hub_template to authenticated;
drop policy if exists think_hub_template_read on public.think_hub_template;
create policy think_hub_template_read on public.think_hub_template for select to authenticated using (true);

-- Column shapes in a template carry no id/key: those are issued when a table is made.
-- `mobile_columns` names columns by label for the same reason.
insert into public.think_hub_template
  (key, name, thinking_type, guiding_question, description, scopes, column_defs, status_options, title_label, default_view, mobile_columns, sub_template_key, is_active, sort_order)
values
  ('project_plan', 'Kế hoạch dự án', 'breakdown', 'Mục tiêu lớn gồm những phần nào?', 'Chia mục tiêu thành từng phần, ai phụ trách, đo kết quả thế nào.',
   '{project,group}', '[{"label":"Phụ trách","type":"text"},{"label":"Kết quả đo được","type":"text"}]', null, 'Hạng mục', 'tree', '{Phụ trách}', 'project_steps', true, 10),
  ('project_steps', 'Bước con', 'breakdown', null, null, '{journal,direct,group,project}',
   '[{"label":"Phụ trách","type":"text"}]', null, 'Bước', 'table', '{Phụ trách}', null, false, 11),

  ('customers', 'Khách hàng & Cơ hội', 'progress', 'Mỗi khách hàng đang ở giai đoạn nào?', 'Theo từng khách hàng từ lúc tiếp cận tới khi chốt.',
   '{journal,group}', '[{"label":"Nguồn","type":"select","options":["Giới thiệu","Tự tìm","Mạng xã hội","Khác"]},{"label":"Giá trị","type":"number"},{"label":"Ngày chốt dự kiến","type":"date"}]',
   '[{"key":"tiep_can","label":"Tiếp cận"},{"key":"bao_gia","label":"Báo giá"},{"key":"thuong_luong","label":"Thương lượng"},{"key":"chot","label":"Chốt","done":true},{"key":"khong_thanh","label":"Không thành","done":true}]',
   'Khách hàng', 'kanban', '{Giá trị}', 'deals', true, 20),
  ('deals', 'Đầu việc', 'track', null, null, '{journal,direct,group,project}', '[]', null, 'Đầu việc', 'table', '{}', null, false, 21),

  ('suppliers', 'Nhà cung cấp', 'track', 'Tôi cần nắm những gì về từng nhà cung cấp?', 'Mặt hàng, người liên hệ và đánh giá của từng nhà cung cấp.',
   '{group,journal}', '[{"label":"Mặt hàng","type":"text"},{"label":"Liên hệ","type":"text"},{"label":"Đánh giá","type":"select","options":["Tốt","Ổn","Cần theo dõi"]}]',
   '[{"key":"dang_hop_tac","label":"Đang hợp tác"},{"key":"tam_dung","label":"Tạm dừng"},{"key":"ngung","label":"Ngừng","done":true}]',
   'Nhà cung cấp', 'table', '{Mặt hàng}', 'supplier_log', true, 30),
  ('supplier_log', 'Lần làm việc / vấn đề', 'track', null, null, '{journal,direct,group,project}', '[]', null, 'Lần làm việc', 'table', '{}', null, false, 31),

  ('construction', 'Công trình', 'progress', 'Mỗi công trình đang ở giai đoạn nào?', 'Từ khảo sát tới bàn giao, ai phụ trách ở đâu.',
   '{group,project}', '[{"label":"Địa điểm","type":"text"},{"label":"Phụ trách","type":"text"}]',
   '[{"key":"khao_sat","label":"Khảo sát"},{"key":"thiet_ke","label":"Thiết kế"},{"key":"thi_cong","label":"Thi công"},{"key":"nghiem_thu","label":"Nghiệm thu"},{"key":"ban_giao","label":"Bàn giao","done":true}]',
   'Công trình', 'kanban', '{Địa điểm}', 'construction_items', true, 40),
  ('construction_items', 'Hạng mục thi công', 'progress', null, null, '{journal,direct,group,project}', '[{"label":"Phụ trách","type":"text"}]', null, 'Hạng mục thi công', 'table', '{Phụ trách}', null, false, 41),

  ('problem', 'Vấn đề cần giải quyết', 'breakdown', 'Vấn đề này do đâu và xử lý thế nào?', 'Ảnh hưởng, nguyên nhân gốc và hướng xử lý.',
   '{journal,direct,group,project}', '[{"label":"Ảnh hưởng","type":"select","options":["Cao","Vừa","Thấp"]},{"label":"Nguyên nhân gốc","type":"text"},{"label":"Hướng xử lý","type":"text"}]',
   null, 'Vấn đề', 'tree', '{Ảnh hưởng}', 'problem_causes', true, 50),
  ('problem_causes', 'Nguyên nhân → giải pháp', 'breakdown', null, null, '{journal,direct,group,project}', '[{"label":"Giải pháp","type":"text"}]', null, 'Nguyên nhân', 'table', '{Giải pháp}', null, false, 51),

  ('weigh_options', 'Cân nhắc lựa chọn', 'weigh', 'Nên chọn gì, vì sao?', 'Đặt các phương án cạnh nhau: lợi, hại, rủi ro.',
   '{journal,direct}', '[{"label":"Lợi","type":"text"},{"label":"Hại","type":"text"},{"label":"Rủi ro","type":"text"},{"label":"Kết luận","type":"select","options":["Chọn","Loại","Chưa rõ"]}]',
   '[{"key":"dang_can_nhac","label":"Đang cân nhắc"},{"key":"da_quyet","label":"Đã quyết","done":true}]',
   'Phương án', 'table', '{Kết luận}', null, true, 60),

  ('year_goals', 'Mục tiêu năm', 'breakdown', 'Năm nay tôi muốn đạt điều gì?', 'Mỗi mục tiêu một dòng, chia bước ở bảng con.',
   '{journal}', '[{"label":"Lĩnh vực","type":"select","options":["Công việc","Gia đình","Sức khoẻ","Tài chính","Phát triển bản thân"]},{"label":"Mốc","type":"date"},{"label":"Tiến độ %","type":"number"}]',
   null, 'Mục tiêu', 'tree', '{Tiến độ %}', 'goal_steps', true, 70),
  ('goal_steps', 'Các bước', 'breakdown', null, null, '{journal,direct,group,project}', '[]', null, 'Bước', 'table', '{}', null, false, 71),

  ('family_plan', 'Kế hoạch gia đình', 'breakdown', 'Gia đình mình sắp lo những việc lớn nào?', 'Việc lớn của gia đình, ai lo, lúc nào.',
   '{journal,direct}', '[{"label":"Người lo","type":"text"},{"label":"Thời điểm","type":"date"}]',
   null, 'Việc lớn', 'tree', '{Thời điểm}', 'family_prep', true, 80),
  ('family_prep', 'Chuẩn bị', 'breakdown', null, null, '{journal,direct,group,project}', '[]', null, 'Việc chuẩn bị', 'table', '{}', null, false, 81),

  ('event', 'Sự kiện', 'progress', 'Cần chuẩn bị những gì, ai lo?', 'Từng hạng mục chuẩn bị và người phụ trách.',
   '{group,project}', '[{"label":"Phụ trách","type":"text"}]',
   '[{"key":"can_lam","label":"Cần làm"},{"key":"dang_chuan_bi","label":"Đang chuẩn bị"},{"key":"san_sang","label":"Sẵn sàng","done":true}]',
   'Hạng mục chuẩn bị', 'kanban', '{Phụ trách}', null, true, 90),

  ('shopping', 'Danh sách mua sắm', 'track', 'Cần mua những gì?', 'Món cần mua, bao nhiêu, mua ở đâu.',
   '{journal,direct}', '[{"label":"Số lượng","type":"number"},{"label":"Nơi mua","type":"text"}]',
   '[{"key":"can_mua","label":"Cần mua"},{"key":"da_mua","label":"Đã mua","done":true}]',
   'Món', 'table', '{Số lượng}', null, true, 100),

  ('count_cost', 'Tính trước khi bắt đầu', 'weigh', 'Cần gì để làm đến nơi đến chốn?', 'Chi phí, nguồn lực, thời gian và rủi ro trước khi bắt tay vào.',
   '{journal,direct,group,project}', '[{"label":"Chi phí dự kiến","type":"number"},{"label":"Nguồn lực cần","type":"text"},{"label":"Thời gian cần","type":"text"},{"label":"Rủi ro","type":"text"},{"label":"Nếu dừng giữa chừng thì sao?","type":"text"},{"label":"Kết luận","type":"select","options":["Bắt đầu","Chờ","Không làm"]}]',
   '[{"key":"dang_tinh","label":"Đang tính"},{"key":"da_quyet","label":"Đã quyết","done":true}]',
   'Việc muốn bắt đầu', 'table', '{Kết luận}', null, true, 110),

  ('reading', 'Kệ sách', 'learn', 'Tôi học được gì, áp dụng thế nào?', 'Mỗi cuốn sách một Hạng mục. Mỗi người có đúng một Kệ sách.',
   '{journal}', '[{"label":"Tác giả","type":"text"},{"label":"Nguồn","type":"select","options":["Kindle","Sách giấy","Gutenberg","Wikisource","Tự soạn","Khác"]},{"label":"Link","type":"text"},{"label":"Đang ở","type":"text"},{"label":"Bài học chính","type":"text"}]',
   '[{"key":"muon_doc","label":"Muốn đọc"},{"key":"dang_doc","label":"Đang đọc"},{"key":"da_doc","label":"Đã đọc","done":true},{"key":"doc_lai","label":"Đọc lại"}]',
   'Tên sách', 'table', '{Tác giả}', null, true, 120),

  ('blank', 'Bảng trống', null, null, 'Tự đặt cột và trạng thái.', '{journal,direct,group,project}', '[]', null, 'Tiêu đề', 'table', '{}', null, true, 999)
on conflict (key) do update set
  name = excluded.name, thinking_type = excluded.thinking_type, guiding_question = excluded.guiding_question,
  description = excluded.description, scopes = excluded.scopes, column_defs = excluded.column_defs,
  status_options = excluded.status_options, title_label = excluded.title_label, default_view = excluded.default_view,
  mobile_columns = excluded.mobile_columns, sub_template_key = excluded.sub_template_key, is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- ------------------------------------------------------------------ "Mẫu của tôi" (C1.3)
create table if not exists public.think_hub_user_template (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  thinking_type text check (thinking_type is null or thinking_type in ('track', 'progress', 'breakdown', 'weigh', 'learn')),
  guiding_question text check (guiding_question is null or char_length(guiding_question) <= 300),
  column_defs jsonb not null default '[]'::jsonb check (jsonb_typeof(column_defs) = 'array'),
  status_options jsonb check (status_options is null or jsonb_typeof(status_options) = 'array'),
  title_label text,
  default_view text check (default_view is null or default_view in ('table', 'kanban', 'tree')),
  mobile_columns text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists think_hub_user_template_owner_idx on public.think_hub_user_template (owner_user_id, created_at desc);

alter table public.think_hub_user_template enable row level security;
revoke all on public.think_hub_user_template from anon, authenticated;
grant select on public.think_hub_user_template to authenticated;
drop policy if exists think_hub_user_template_own on public.think_hub_user_template;
create policy think_hub_user_template_own on public.think_hub_user_template for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- ------------------------------------------------------------------ helpers
-- Template-style columns ({label,type,options}) → table columns with freshly issued id = key.
create or replace function private.materialize_template_columns(p_cols jsonb)
returns jsonb language sql volatile set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', k.id, 'key', k.id, 'label', btrim(c->>'label'), 'type', c->>'type',
      'options', case when c->>'type' = 'select' then c->'options' end
    )) order by k.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cols, '[]'::jsonb)) with ordinality as e(c, ord)
  cross join lateral (select e.ord, 'col_' || replace(gen_random_uuid()::text, '-', '') as id) k
$$;

-- Status options must be [{key,label,done?}] with unique non-empty keys.
create or replace function private.clean_status_options(p_opts jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare v jsonb := '[]'::jsonb; o jsonb; seen text[] := '{}'; k text; l text;
begin
  if p_opts is null or jsonb_typeof(p_opts) <> 'array' then return null; end if;
  for o in select * from jsonb_array_elements(p_opts) loop
    continue when jsonb_typeof(o) <> 'object';
    k := btrim(coalesce(o->>'key', '')); l := btrim(coalesce(o->>'label', ''));
    continue when k = '' or l = '' or k = any(seen);
    seen := seen || k;
    v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', k, 'label', l,
      'done', case when (o->>'done')::boolean is true then true end)));
  end loop;
  if jsonb_array_length(v) = 0 then return null; end if;
  return v;
end $$;

-- Writes a template's shape onto one table: columns are appended (a table's existing column ids
-- never change), statuses/title/view/mobile columns replaced. Caller has checked rights.
create or replace function private.apply_structure_to_table(
  p_table_id uuid, p_cols jsonb, p_status jsonb, p_title_label text, p_default_view text,
  p_mobile_labels text[], p_source_key text, p_source_version integer, p_purpose text)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new jsonb; v_mobile text[]; v_row think_hub_table%rowtype;
begin
  v_new := private.materialize_template_columns(p_cols);
  select array_agg(c->>'key' order by array_position(p_mobile_labels, c->>'label'))
    into v_mobile
  from jsonb_array_elements(v_new) c
  where c->>'label' = any(coalesce(p_mobile_labels, '{}'));

  update think_hub_table set
    column_defs = column_defs || v_new,
    status_options = private.clean_status_options(p_status),
    title_label = nullif(btrim(coalesce(p_title_label, '')), ''),
    default_view = p_default_view,
    mobile_columns = case when v_mobile is null then null else v_mobile[1:2] end,
    source_template_key = p_source_key,
    source_template_version = p_source_version,
    purpose = case
      when purpose is null and not (project_id is not null and parent_record_id is null) and p_purpose is not null
        then p_purpose else purpose end
  where id = p_table_id
  returning * into v_row;
  return v_row;
end $$;
revoke all on function private.apply_structure_to_table(uuid, jsonb, jsonb, text, text, text[], text, integer, text) from public;

-- ------------------------------------------------------------------ RPCs (C2)
create or replace function public.create_think_hub_table_from_template(
  p_template_key text, p_user_template_id uuid, p_conversation_id uuid, p_name text)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_tpl think_hub_template%rowtype;
  v_mine think_hub_user_template%rowtype;
  v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if (p_template_key is null) = (p_user_template_id is null) then
    raise exception 'avora_template_source_required';
  end if;

  if p_template_key is not null then
    select * into v_tpl from think_hub_template where key = p_template_key and is_active;
    if not found then raise exception 'avora_template_missing'; end if;
    if v_tpl.key = 'reading' then raise exception 'avora_template_bookshelf_only'; end if;
  else
    select * into v_mine from think_hub_user_template where id = p_user_template_id and owner_user_id = v_user;
    if not found then raise exception 'avora_template_missing'; end if;
  end if;

  -- Same scope and permission rules as a blank table: one path, not a second copy of the rules.
  v_row := public.create_think_hub_table(
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), coalesce(v_tpl.name, v_mine.name)),
    coalesce(v_tpl.guiding_question, v_mine.guiding_question),
    p_conversation_id);

  if p_template_key is not null then
    v_row := private.apply_structure_to_table(v_row.id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
      v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, null);
  else
    v_row := private.apply_structure_to_table(v_row.id, v_mine.column_defs, v_mine.status_options, v_mine.title_label,
      v_mine.default_view, v_mine.mobile_columns, null, null, null);
  end if;
  return v_row;
end $$;

create or replace function public.apply_template_to_table(p_table_id uuid, p_template_key text, p_user_template_id uuid)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_tpl think_hub_template%rowtype;
  v_mine think_hub_user_template%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if (p_template_key is null) = (p_user_template_id is null) then raise exception 'avora_template_source_required'; end if;

  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or v_table.owner_user_id <> v_user or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if exists (select 1 from think_hub_record where table_id = p_table_id and deleted_at is null) then
    raise exception 'avora_template_table_not_empty';
  end if;

  if p_template_key is not null then
    select * into v_tpl from think_hub_template where key = p_template_key and is_active and key <> 'reading';
    if not found then raise exception 'avora_template_missing'; end if;
    return private.apply_structure_to_table(p_table_id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
      v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, v_tpl.guiding_question);
  end if;
  select * into v_mine from think_hub_user_template where id = p_user_template_id and owner_user_id = v_user;
  if not found then raise exception 'avora_template_missing'; end if;
  return private.apply_structure_to_table(p_table_id, v_mine.column_defs, v_mine.status_options, v_mine.title_label,
    v_mine.default_view, v_mine.mobile_columns, null, null, v_mine.guiding_question);
end $$;

create or replace function public.save_table_as_template(p_table_id uuid, p_name text)
returns public.think_hub_user_template language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_type text;
  v_row think_hub_user_template%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or v_table.owner_user_id <> v_user or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if (select count(*) from think_hub_user_template where owner_user_id = v_user) >= 50 then
    raise exception 'avora_template_limit';
  end if;
  select thinking_type into v_type from think_hub_template where key = v_table.source_template_key;

  -- Structure only: labels, types, options. No ids, no widths, no values, no Hạng mục.
  insert into think_hub_user_template (owner_user_id, name, thinking_type, guiding_question, column_defs,
    status_options, title_label, default_view, mobile_columns)
  values (
    v_user,
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_table.name),
    v_type,
    case when v_table.project_id is not null and v_table.parent_record_id is null then null else v_table.purpose end,
    coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', c->>'label', 'type', c->>'type',
        'options', case when c->>'type' = 'select' then c->'options' end)))
      from jsonb_array_elements(v_table.column_defs) c), '[]'::jsonb),
    v_table.status_options, v_table.title_label, v_table.default_view,
    coalesce((select array_agg(c->>'label') from jsonb_array_elements(v_table.column_defs) c
      where c->>'key' = any(coalesce(v_table.mobile_columns, '{}'))), '{}')
  ) returning * into v_row;
  return v_row;
end $$;

create or replace function public.delete_user_template(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  delete from think_hub_user_template where id = p_id and owner_user_id = auth.uid();
  if not found then raise exception 'avora_template_missing'; end if;
end $$;

-- Sub-table grows with its template's sub-shape when the parent came from a template.
create or replace function public.create_think_hub_sub_table(p_record_id uuid, p_name text default null, p_purpose text default null)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
DECLARE
  v_user     uuid := auth.uid();
  v_record   think_hub_record%ROWTYPE;
  v_parent   think_hub_table%ROWTYPE;
  v_existing think_hub_table%ROWTYPE;
  v_name     text;
  v_row      think_hub_table%ROWTYPE;
  v_sub      think_hub_template%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_record FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_record.table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  SELECT * INTO v_parent FROM think_hub_table WHERE id = v_record.table_id;
  IF v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  PERFORM private.assert_direct_talk(v_parent.conversation_id, v_user, 'rich');
  IF v_parent.depth >= 3 THEN
    RAISE EXCEPTION 'avora_think_hub_depth_limit';
  END IF;

  SELECT * INTO v_existing FROM think_hub_table WHERE parent_record_id = p_record_id;
  IF FOUND THEN
    IF v_existing.deleted_at IS NULL THEN
      RAISE EXCEPTION 'avora_think_hub_sub_table_exists';
    END IF;
    UPDATE think_hub_table SET deleted_at = NULL WHERE id = v_existing.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_record.title);

  INSERT INTO think_hub_table (owner_user_id, name, purpose, parent_record_id, position)
  VALUES (
    v_user, v_name,
    CASE WHEN p_purpose IS NULL THEN 'Theo dõi cho: ' || v_record.title
         ELSE nullif(btrim(p_purpose), '') END,
    p_record_id, 0
  )
  RETURNING * INTO v_row;

  IF v_parent.source_template_key IS NOT NULL THEN
    SELECT s.* INTO v_sub FROM think_hub_template t JOIN think_hub_template s ON s.key = t.sub_template_key
    WHERE t.key = v_parent.source_template_key;
    IF FOUND THEN
      v_row := private.apply_structure_to_table(v_row.id, v_sub.column_defs, v_sub.status_options, v_sub.title_label,
        v_sub.default_view, v_sub.mobile_columns, v_sub.key, v_sub.version, null);
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- A new Hạng mục starts at the table's first status when the table has its own.
create or replace function public.create_think_hub_record(p_table_id uuid, p_title text, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_next_action_date date DEFAULT NULL::date, p_tags text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text, p_extension_fields jsonb DEFAULT NULL::jsonb, p_scope_conversation_id uuid DEFAULT NULL::uuid, p_scope_project_id uuid DEFAULT NULL::uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_title text;
  v_count integer;
  v_table think_hub_table%ROWTYPE;
  v_row   think_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = p_table_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  IF v_table.conversation_id IS DISTINCT FROM p_scope_conversation_id
     OR v_table.project_id IS DISTINCT FROM p_scope_project_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_out_of_scope';
  END IF;

  PERFORM private.assert_direct_talk(v_table.conversation_id, v_user, 'rich');

  SELECT count(*) INTO v_count FROM think_hub_record
  WHERE table_id = p_table_id AND deleted_at IS NULL;

  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_think_hub_record_limit';
  END IF;

  INSERT INTO think_hub_record (
    table_id, owner_user_id, title, status, priority,
    category, next_action_date, tags, notes, extension_fields
  ) VALUES (
    p_table_id, v_user, v_title,
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_table.status_options->0->>'key', 'moi'),
    coalesce(p_priority, 'trung_binh'),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_next_action_date,
    coalesce(p_tags, '{}'),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_extension_fields, '{}'::jsonb)
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

revoke all on function public.create_think_hub_table_from_template(text, uuid, uuid, text) from public, anon;
revoke all on function public.apply_template_to_table(uuid, text, uuid) from public, anon;
revoke all on function public.save_table_as_template(uuid, text) from public, anon;
revoke all on function public.delete_user_template(uuid) from public, anon;
grant execute on function public.create_think_hub_table_from_template(text, uuid, uuid, text) to authenticated;
grant execute on function public.apply_template_to_table(uuid, text, uuid) to authenticated;
grant execute on function public.save_table_as_template(uuid, text) to authenticated;
grant execute on function public.delete_user_template(uuid) to authenticated;
