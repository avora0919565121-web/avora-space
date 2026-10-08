-- AVORA-106 · K0 — ghi lại hiện trạng schema chat (chỉ schema, không dữ liệu).
-- Sinh từ catalog của DB thật ngày 08/10/2026 (pg_catalog qua Management API). Mọi lệnh đều
-- idempotent (`if not exists`, `create or replace`, policy chỉ tạo khi chưa có) — chạy lại trên DB
-- thật KHÔNG đổi gì. Mục đích: repo khớp DB, để K1 trở đi sửa trên một nền đã thấy được.

create table if not exists public.conversations (
  id uuid default gen_random_uuid() not null,
  type text default 'direct'::text not null,
  created_at timestamp with time zone default now() not null,
  direct_key text,
  related_group_id uuid,
  deleted_at timestamp with time zone,
  parent_group_id uuid,
  group_depth smallint default 1 not null,
  verification_status text,
  verification_started_at timestamp with time zone,
  verification_expires_at timestamp with time zone,
  verification_via_group_id uuid,
  verification_opened_by uuid,
  verification_resolved_at timestamp with time zone,
  deleted_via uuid,
  constraint conversations_pkey PRIMARY KEY (id),
  constraint conversations_group_depth_range CHECK (((group_depth >= 1) AND (group_depth <= 3))),
  constraint conversations_parent_group_only CHECK (((parent_group_id IS NULL) OR (type = 'group'::text))),
  constraint conversations_parent_not_self CHECK ((parent_group_id IS DISTINCT FROM id)),
  constraint conversations_type_check CHECK ((type = ANY (ARRAY['direct'::text, 'group'::text, 'personal'::text]))),
  constraint conversations_verification_status_check CHECK (((verification_status IS NULL) OR (verification_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'closed'::text]))))
);
create table if not exists public.conversation_participants (
  conversation_id uuid not null,
  user_id uuid not null,
  joined_at timestamp with time zone default now() not null,
  role text default 'member'::text not null,
  constraint conversation_participants_pkey PRIMARY KEY (conversation_id, user_id),
  constraint conversation_participants_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);
create table if not exists public.messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  sender_id uuid not null,
  content text not null,
  created_at timestamp with time zone default now() not null,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  reply_to_message_id uuid,
  mentioned_user_ids uuid[] default '{}'::uuid[] not null,
  origin_group_id uuid,
  attachment_count integer default 0 not null,
  origin_content_id uuid,
  origin_sender_id uuid,
  reply_to_daily_thought_id text,
  key_version integer,
  algorithm_version text,
  system_kind text,
  forward_bundle jsonb,
  trashed_at timestamp with time zone,
  is_urgent boolean default false not null,
  refs jsonb,
  contact_card_user_id uuid,
  constraint messages_pkey PRIMARY KEY (id),
  constraint messages_algorithm_version_len CHECK (((algorithm_version IS NULL) OR ((char_length(algorithm_version) >= 1) AND (char_length(algorithm_version) <= 64)))),
  constraint messages_attachment_count_check CHECK (((attachment_count >= 0) AND (attachment_count <= 10))),
  constraint messages_content_max_len CHECK ((char_length(content) <= 4000)),
  constraint messages_content_not_blank CHECK (((btrim(content) <> ''::text) OR (deleted_at IS NOT NULL) OR (attachment_count > 0) OR (contact_card_user_id IS NOT NULL))),
  constraint messages_crypto_version_pair CHECK (((key_version IS NULL) = (algorithm_version IS NULL))),
  constraint messages_forward_bundle_object CHECK (((forward_bundle IS NULL) OR (jsonb_typeof(forward_bundle) = 'object'::text))),
  constraint messages_key_version_positive CHECK (((key_version IS NULL) OR (key_version >= 1))),
  constraint messages_refs_shape CHECK (((refs IS NULL) OR ((jsonb_typeof(refs) = 'array'::text) AND (jsonb_array_length(refs) <= 20)))),
  constraint messages_reply_to_daily_thought_id_shape CHECK (((reply_to_daily_thought_id IS NULL) OR (reply_to_daily_thought_id ~ '^[a-z_]{1,32}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'::text))),
  constraint messages_system_kind_check CHECK (((system_kind IS NULL) OR (system_kind = ANY (ARRAY['project_deleted'::text, 'proposal_opened'::text, 'proposal_approved'::text, 'proposal_rejected'::text, 'proposal_expired'::text, 'proposal_withdrawn'::text, 'shared_restored'::text, 'recall_expired'::text, 'member_added'::text, 'column_delete_requested'::text, 'board_update'::text, 'board_created'::text, 'board_shared'::text, 'board_moved'::text]))))
);
create table if not exists public.message_attachments (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  conversation_id uuid not null,
  attached_by uuid not null,
  kind text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  duration_seconds numeric(7,2),
  permission text default 'export'::text not null,
  origin_message_id uuid,
  created_at timestamp with time zone default now() not null,
  key_version integer,
  algorithm_version text,
  capture_source text,
  constraint message_attachments_message_id_storage_path_key UNIQUE (message_id, storage_path),
  constraint message_attachments_pkey PRIMARY KEY (id),
  constraint message_attachments_algorithm_version_len CHECK (((algorithm_version IS NULL) OR ((char_length(algorithm_version) >= 1) AND (char_length(algorithm_version) <= 64)))),
  constraint message_attachments_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 26214400))),
  constraint message_attachments_capture_source_check CHECK (((capture_source IS NULL) OR (capture_source = ANY (ARRAY['camera'::text, 'library'::text])))),
  constraint message_attachments_crypto_version_pair CHECK (((key_version IS NULL) = (algorithm_version IS NULL))),
  constraint message_attachments_duration_seconds_check CHECK (((duration_seconds IS NULL) OR ((duration_seconds > (0)::numeric) AND (duration_seconds <= (300)::numeric)))),
  constraint message_attachments_file_name_check CHECK (((btrim(file_name) <> ''::text) AND (char_length(file_name) <= 255))),
  constraint message_attachments_height_check CHECK (((height IS NULL) OR (height > 0))),
  constraint message_attachments_key_version_positive CHECK (((key_version IS NULL) OR (key_version >= 1))),
  constraint message_attachments_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'file'::text, 'voice'::text]))),
  constraint message_attachments_mime_type_check CHECK ((btrim(mime_type) <> ''::text)),
  constraint message_attachments_permission_check CHECK ((permission = ANY (ARRAY['view'::text, 'forward'::text, 'export'::text]))),
  constraint message_attachments_width_check CHECK (((width IS NULL) OR (width > 0)))
);
create table if not exists public.message_reactions (
  message_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamp with time zone default now() not null,
  constraint message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji),
  constraint message_reactions_emoji_len CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16))),
  constraint message_reactions_emoji_not_blank CHECK ((btrim(emoji) <> ''::text))
);
create table if not exists public.conversation_read_marks (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamp with time zone not null,
  constraint conversation_read_marks_pkey PRIMARY KEY (conversation_id, user_id)
);
create table if not exists public.message_deliveries (
  message_id uuid not null,
  user_id uuid not null,
  delivered_at timestamp with time zone default now() not null,
  constraint message_deliveries_pkey PRIMARY KEY (message_id, user_id)
);
create table if not exists public.message_pins (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  conversation_id uuid not null,
  pinned_by uuid not null,
  scope text not null,
  pinned_at timestamp with time zone default now() not null,
  constraint message_pins_pkey PRIMARY KEY (id),
  constraint message_pins_scope_valid CHECK ((scope = ANY (ARRAY['group'::text, 'personal'::text])))
);
create table if not exists public.conversation_pins (
  user_id uuid not null,
  conversation_id uuid not null,
  pinned_at timestamp with time zone default now() not null,
  constraint conversation_pins_pkey PRIMARY KEY (user_id, conversation_id)
);
create table if not exists public.scheduled_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  sender_id uuid not null,
  content text not null,
  mentioned_user_ids uuid[] default '{}'::uuid[] not null,
  reply_to_message_id uuid,
  send_at timestamp with time zone not null,
  status text default 'pending'::text not null,
  fail_reason text,
  sent_message_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint scheduled_messages_pkey PRIMARY KEY (id),
  constraint scheduled_messages_content_check CHECK (((btrim(content) <> ''::text) AND (char_length(content) <= 4000))),
  constraint scheduled_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'cancelled'::text, 'failed'::text])))
);
create table if not exists public.message_recall_request (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  requested_by uuid not null,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  close_reason text,
  constraint message_recall_request_pkey PRIMARY KEY (id),
  constraint message_recall_request_close_reason_check CHECK (((close_reason IS NULL) OR (close_reason = ANY (ARRAY['expired'::text, 'closed'::text])))),
  constraint message_recall_request_close_reason_resolved CHECK (((close_reason IS NULL) OR (resolved_at IS NOT NULL)))
);
create table if not exists public.conversation_archives (
  user_id uuid not null,
  conversation_id uuid not null,
  archived_at timestamp with time zone default now() not null,
  constraint conversation_archives_pkey PRIMARY KEY (user_id, conversation_id)
);
create table if not exists public.conversation_groups (
  conversation_id uuid not null,
  name text,
  owner_id uuid not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  project_mode boolean default false not null,
  constraint conversation_groups_pkey PRIMARY KEY (conversation_id),
  constraint conversation_groups_name_len CHECK (((name IS NULL) OR ((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))))
);
create table if not exists public.conversation_verification_confirms (
  conversation_id uuid not null,
  user_id uuid not null,
  confirmed_at timestamp with time zone default now() not null,
  constraint conversation_verification_confirms_pkey PRIMARY KEY (conversation_id, user_id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversations_parent_group_id_fkey') then alter table public.conversations add constraint conversations_parent_group_id_fkey FOREIGN KEY (parent_group_id) REFERENCES conversations(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversations_related_group_id_fkey') then alter table public.conversations add constraint conversations_related_group_id_fkey FOREIGN KEY (related_group_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversations_verification_opened_by_fkey') then alter table public.conversations add constraint conversations_verification_opened_by_fkey FOREIGN KEY (verification_opened_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversations_verification_via_group_id_fkey') then alter table public.conversations add constraint conversations_verification_via_group_id_fkey FOREIGN KEY (verification_via_group_id) REFERENCES conversations(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_participants_conversation_id_fkey') then alter table public.conversation_participants add constraint conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_participants_user_id_fkey') then alter table public.conversation_participants add constraint conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_contact_card_user_id_fkey') then alter table public.messages add constraint messages_contact_card_user_id_fkey FOREIGN KEY (contact_card_user_id) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_conversation_id_fkey') then alter table public.messages add constraint messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_origin_content_id_fkey') then alter table public.messages add constraint messages_origin_content_id_fkey FOREIGN KEY (origin_content_id) REFERENCES messages(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_origin_group_id_fkey') then alter table public.messages add constraint messages_origin_group_id_fkey FOREIGN KEY (origin_group_id) REFERENCES conversations(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_origin_sender_id_fkey') then alter table public.messages add constraint messages_origin_sender_id_fkey FOREIGN KEY (origin_sender_id) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_reply_to_message_id_fkey') then alter table public.messages add constraint messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'messages_sender_id_fkey') then alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_attachments_attached_by_fkey') then alter table public.message_attachments add constraint message_attachments_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_attachments_conversation_id_fkey') then alter table public.message_attachments add constraint message_attachments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_attachments_message_id_fkey') then alter table public.message_attachments add constraint message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_attachments_origin_message_id_fkey') then alter table public.message_attachments add constraint message_attachments_origin_message_id_fkey FOREIGN KEY (origin_message_id) REFERENCES messages(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_reactions_message_id_fkey') then alter table public.message_reactions add constraint message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_reactions_user_id_fkey') then alter table public.message_reactions add constraint message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_read_marks_conversation_id_fkey') then alter table public.conversation_read_marks add constraint conversation_read_marks_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_read_marks_user_id_fkey') then alter table public.conversation_read_marks add constraint conversation_read_marks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_deliveries_message_id_fkey') then alter table public.message_deliveries add constraint message_deliveries_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_deliveries_user_id_fkey') then alter table public.message_deliveries add constraint message_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_pins_conversation_id_fkey') then alter table public.message_pins add constraint message_pins_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_pins_message_id_fkey') then alter table public.message_pins add constraint message_pins_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_pins_pinned_by_fkey') then alter table public.message_pins add constraint message_pins_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_pins_conversation_id_fkey') then alter table public.conversation_pins add constraint conversation_pins_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_pins_user_id_fkey') then alter table public.conversation_pins add constraint conversation_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_conversation_id_fkey') then alter table public.scheduled_messages add constraint scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_reply_to_message_id_fkey') then alter table public.scheduled_messages add constraint scheduled_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_sender_id_fkey') then alter table public.scheduled_messages add constraint scheduled_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_sent_message_id_fkey') then alter table public.scheduled_messages add constraint scheduled_messages_sent_message_id_fkey FOREIGN KEY (sent_message_id) REFERENCES messages(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_recall_request_message_id_fkey') then alter table public.message_recall_request add constraint message_recall_request_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'message_recall_request_requested_by_fkey') then alter table public.message_recall_request add constraint message_recall_request_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_archives_conversation_id_fkey') then alter table public.conversation_archives add constraint conversation_archives_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_archives_user_id_fkey') then alter table public.conversation_archives add constraint conversation_archives_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_groups_conversation_id_fkey') then alter table public.conversation_groups add constraint conversation_groups_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_groups_owner_id_fkey') then alter table public.conversation_groups add constraint conversation_groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_verification_confirms_conversation_id_fkey') then alter table public.conversation_verification_confirms add constraint conversation_verification_confirms_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_verification_confirms_user_id_fkey') then alter table public.conversation_verification_confirms add constraint conversation_verification_confirms_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
create index if not exists conversation_groups_name_trgm ON public.conversation_groups USING gin (f_unaccent(name) gin_trgm_ops);
create index if not exists conversation_groups_owner_idx ON public.conversation_groups USING btree (owner_id);
create index if not exists conversation_participants_user_id_idx ON public.conversation_participants USING btree (user_id);
create unique index if not exists one_admin_per_conversation ON public.conversation_participants USING btree (conversation_id) WHERE (role = 'admin'::text);
create unique index if not exists one_owner_per_conversation ON public.conversation_participants USING btree (conversation_id) WHERE (role = 'owner'::text);
create unique index if not exists conversations_direct_key_key ON public.conversations USING btree (direct_key) WHERE (direct_key IS NOT NULL);
create index if not exists conversations_related_group_idx ON public.conversations USING btree (related_group_id) WHERE (related_group_id IS NOT NULL);
create index if not exists idx_conversations_parent_group ON public.conversations USING btree (parent_group_id) WHERE (parent_group_id IS NOT NULL);
create index if not exists message_attachments_conversation_idx ON public.message_attachments USING btree (conversation_id, created_at DESC);
create index if not exists message_attachments_message_idx ON public.message_attachments USING btree (message_id);
create index if not exists message_attachments_name_trgm ON public.message_attachments USING gin (f_unaccent(file_name) gin_trgm_ops);
create index if not exists message_attachments_path_idx ON public.message_attachments USING btree (storage_path);
create index if not exists message_pins_conversation_idx ON public.message_pins USING btree (conversation_id, scope);
create unique index if not exists message_pins_group_unique ON public.message_pins USING btree (conversation_id, message_id) WHERE (scope = 'group'::text);
create unique index if not exists message_pins_personal_unique ON public.message_pins USING btree (conversation_id, message_id, pinned_by) WHERE (scope = 'personal'::text);
create index if not exists message_reactions_message_idx ON public.message_reactions USING btree (message_id);
create index if not exists message_recall_request_message_idx ON public.message_recall_request USING btree (message_id) WHERE (resolved_at IS NULL);
create unique index if not exists message_recall_request_unique_open ON public.message_recall_request USING btree (message_id, requested_by) WHERE (resolved_at IS NULL);
create index if not exists messages_conversation_created_idx ON public.messages USING btree (conversation_id, created_at DESC);
create index if not exists messages_journal_trash_idx ON public.messages USING btree (conversation_id, trashed_at) WHERE (trashed_at IS NOT NULL);
create index if not exists messages_live_by_conversation_idx ON public.messages USING btree (conversation_id, created_at) WHERE (deleted_at IS NULL);
create index if not exists messages_mentions_idx ON public.messages USING gin (mentioned_user_ids) WHERE (mentioned_user_ids <> '{}'::uuid[]);
create index if not exists messages_origin_content_idx ON public.messages USING btree (origin_content_id);
create index if not exists messages_origin_group_idx ON public.messages USING btree (origin_group_id) WHERE (origin_group_id IS NOT NULL);
create index if not exists messages_reply_to_idx ON public.messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL);
create index if not exists messages_search_trgm ON public.messages USING gin (f_unaccent(content) gin_trgm_ops) WHERE ((deleted_at IS NULL) AND (trashed_at IS NULL) AND (system_kind IS NULL));
create index if not exists scheduled_messages_due ON public.scheduled_messages USING btree (send_at) WHERE (status = 'pending'::text);
create index if not exists scheduled_messages_mine ON public.scheduled_messages USING btree (sender_id, conversation_id);
alter table public.conversation_archives enable row level security;
alter table public.conversation_groups enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.conversation_pins enable row level security;
alter table public.conversation_read_marks enable row level security;
alter table public.conversation_verification_confirms enable row level security;
alter table public.conversations enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.message_pins enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_recall_request enable row level security;
alter table public.messages enable row level security;
alter table public.scheduled_messages enable row level security;

-- Policies (only created when missing; the live definition wins).
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_archives' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_archives as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_archives' and policyname = $n$conversation_archives_own_delete$n$) then
  create policy "conversation_archives_own_delete" on public.conversation_archives as permissive for delete to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_archives' and policyname = $n$conversation_archives_own_insert$n$) then
  create policy "conversation_archives_own_insert" on public.conversation_archives as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (( SELECT conversations.type
   FROM conversations
  WHERE (conversations.id = conversation_archives.conversation_id)) <> 'personal'::text)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_archives' and policyname = $n$conversation_archives_own_select$n$) then
  create policy "conversation_archives_own_select" on public.conversation_archives as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_archives' and policyname = $n$conversation_archives_own_update$n$) then
  create policy "conversation_archives_own_update" on public.conversation_archives as permissive for update to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_groups' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_groups as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_groups' and policyname = $n$conversation_groups_insert_owner$n$) then
  create policy "conversation_groups_insert_owner" on public.conversation_groups as permissive for insert to authenticated with check (((owner_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_groups' and policyname = $n$conversation_groups_select_participant$n$) then
  create policy "conversation_groups_select_participant" on public.conversation_groups as permissive for select to authenticated using (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_groups' and policyname = $n$conversation_groups_update_owner$n$) then
  create policy "conversation_groups_update_owner" on public.conversation_groups as permissive for update to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_participants' and policyname = $n$Participants can read conversation members$n$) then
  create policy "Participants can read conversation members" on public.conversation_participants as permissive for select to authenticated using (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_participants' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_participants as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_pins' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_pins as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_pins' and policyname = $n$conversation_pins_own_select$n$) then
  create policy "conversation_pins_own_select" on public.conversation_pins as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_read_marks' and policyname = $n$Own read marks only$n$) then
  create policy "Own read marks only" on public.conversation_read_marks as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_read_marks' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_read_marks as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_verification_confirms' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversation_verification_confirms as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_verification_confirms' and policyname = $n$conversation_verification_confirms_select$n$) then
  create policy "conversation_verification_confirms_select" on public.conversation_verification_confirms as permissive for select to authenticated using (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations' and policyname = $n$Participants can read their conversations$n$) then
  create policy "Participants can read their conversations" on public.conversations as permissive for select to authenticated using (private.is_conversation_participant(id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.conversations as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = $n$Attacher can remove attachment$n$) then
  create policy "Attacher can remove attachment" on public.message_attachments as permissive for delete to authenticated using ((attached_by = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = $n$Participants can attach$n$) then
  create policy "Participants can attach" on public.message_attachments as permissive for insert to authenticated with check (((attached_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_attachments.message_id) AND (m.conversation_id = message_attachments.conversation_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'attachment'::text)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = $n$Participants can read attachments$n$) then
  create policy "Participants can read attachments" on public.message_attachments as permissive for select to authenticated using (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.message_attachments as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_deliveries' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.message_deliveries as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_deliveries' and policyname = $n$message_deliveries_sender_reads$n$) then
  create policy "message_deliveries_sender_reads" on public.message_deliveries as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_deliveries.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_pins' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.message_pins as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_pins' and policyname = $n$message_pins_delete_allowed$n$) then
  create policy "message_pins_delete_allowed" on public.message_pins as permissive for delete to authenticated using ((((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid))) OR ((scope = 'group'::text) AND private.is_group_officer(conversation_id, ( SELECT auth.uid() AS uid)))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_pins' and policyname = $n$message_pins_select_visible$n$) then
  create policy "message_pins_select_visible" on public.message_pins as permissive for select to authenticated using ((((scope = 'group'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))) OR ((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid)))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.message_reactions as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = $n$message_reactions_delete_own$n$) then
  create policy "message_reactions_delete_own" on public.message_reactions as permissive for delete to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = $n$message_reactions_insert_own$n$) then
  create policy "message_reactions_insert_own" on public.message_reactions as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = $n$message_reactions_select_participant$n$) then
  create policy "message_reactions_select_participant" on public.message_reactions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = $n$message_reactions_update_own$n$) then
  create policy "message_reactions_update_own" on public.message_reactions as permissive for update to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_recall_request' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.message_recall_request as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_recall_request' and policyname = $n$message_recall_request_delete$n$) then
  create policy "message_recall_request_delete" on public.message_recall_request as permissive for delete to authenticated using ((requested_by = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_recall_request' and policyname = $n$message_recall_request_insert$n$) then
  create policy "message_recall_request_insert" on public.message_recall_request as permissive for insert to authenticated with check (((requested_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id <> ( SELECT auth.uid() AS uid)) AND (m.deleted_at IS NULL) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_recall_request' and policyname = $n$message_recall_request_select$n$) then
  create policy "message_recall_request_select" on public.message_recall_request as permissive for select to authenticated using (((requested_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_recall_request' and policyname = $n$message_recall_request_update$n$) then
  create policy "message_recall_request_update" on public.message_recall_request as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = $n$Authors can delete own journal messages$n$) then
  create policy "Authors can delete own journal messages" on public.messages as permissive for delete to authenticated using (((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type = 'personal'::text))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = $n$Participants can read messages$n$) then
  create policy "Participants can read messages" on public.messages as permissive for select to authenticated using (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = $n$Participants can send messages$n$) then
  create policy "Participants can send messages" on public.messages as permissive for insert to authenticated with check (((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'text'::text)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.messages as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scheduled_messages' and policyname = $n$Sender reads own scheduled$n$) then
  create policy "Sender reads own scheduled" on public.scheduled_messages as permissive for select to authenticated using ((sender_id = ( SELECT auth.uid() AS uid)));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scheduled_messages' and policyname = $n$avora_session_allowed$n$) then
  create policy "avora_session_allowed" on public.scheduled_messages as restrictive for all to public using (( SELECT private.session_allowed() AS session_allowed)) with check (( SELECT private.session_allowed() AS session_allowed));
end if; end $do$;

-- Table grants as they are on the live DB (anon / authenticated).
-- conversation_archives: authenticated = DELETE, INSERT, SELECT
-- conversation_groups: authenticated = INSERT, SELECT
-- conversation_participants: authenticated = SELECT
-- conversation_pins: authenticated = SELECT
-- conversation_read_marks: authenticated = SELECT
-- conversation_verification_confirms: authenticated = SELECT
-- conversations: authenticated = SELECT
-- message_attachments: authenticated = DELETE, INSERT, SELECT
-- message_deliveries: authenticated = SELECT
-- message_pins: authenticated = DELETE, SELECT
-- message_reactions: authenticated = DELETE, INSERT, SELECT, UPDATE
-- message_recall_request: authenticated = DELETE, INSERT, SELECT
-- messages: authenticated = SELECT
-- scheduled_messages: authenticated = SELECT

-- Column grants (INSERT / UPDATE) — K0.3: what a client may write directly.
-- conversation_archives.INSERT to authenticated: archived_at, conversation_id, user_id
-- conversation_archives.UPDATE to authenticated: archived_at
-- conversation_groups.INSERT to authenticated: conversation_id, created_at, name, owner_id, project_mode, updated_at
-- conversation_groups.UPDATE to authenticated: name, updated_at
-- message_attachments.INSERT to authenticated: algorithm_version, attached_by, byte_size, capture_source, conversation_id, created_at, duration_seconds, file_name, height, id, key_version, kind, message_id, mime_type, origin_message_id, permission, storage_path, width
-- message_reactions.INSERT to authenticated: created_at, emoji, message_id, user_id
-- message_reactions.UPDATE to authenticated: created_at, emoji, message_id, user_id
-- message_recall_request.INSERT to authenticated: close_reason, created_at, id, message_id, requested_by, resolved_at
-- message_recall_request.UPDATE to authenticated: resolved_at
-- messages.INSERT to authenticated: content, conversation_id, created_at, deleted_at, edited_at, id, is_urgent, mentioned_user_ids, origin_group_id, refs, reply_to_daily_thought_id, reply_to_message_id, sender_id

-- Triggers
-- CREATE TRIGGER conversation_groups_touch BEFORE UPDATE ON public.conversation_groups FOR EACH ROW EXECUTE FUNCTION touch_conversation_group()
-- CREATE TRIGGER conversation_participants_close_verifications AFTER DELETE ON public.conversation_participants FOR EACH ROW EXECUTE FUNCTION private.close_verifications_on_group_leave()
-- CREATE TRIGGER conversation_participants_group_capacity BEFORE INSERT ON public.conversation_participants FOR EACH ROW EXECUTE FUNCTION private.enforce_group_capacity()
-- CREATE TRIGGER participants_close_suggestions AFTER DELETE ON public.conversation_participants FOR EACH STATEMENT EXECUTE FUNCTION private.close_dead_suggestions_trigger()
-- CREATE TRIGGER read_marks_skip_push AFTER INSERT OR UPDATE OF last_read_at ON public.conversation_read_marks FOR EACH ROW EXECUTE FUNCTION private.skip_push_on_read()
-- CREATE TRIGGER conversations_close_suggestions AFTER UPDATE OF deleted_at ON public.conversations FOR EACH STATEMENT EXECUTE FUNCTION private.close_dead_suggestions_trigger()
-- CREATE TRIGGER conversations_enforce_group_depth BEFORE INSERT OR UPDATE OF parent_group_id, group_depth ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.enforce_group_depth()
-- CREATE TRIGGER conversations_soft_delete_origin_messages BEFORE DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.soft_delete_group_origin_messages()
-- CREATE TRIGGER message_attachments_sync_count AFTER INSERT OR DELETE ON public.message_attachments FOR EACH ROW EXECUTE FUNCTION private.sync_message_attachment_count()
-- CREATE TRIGGER message_pins_quota BEFORE INSERT ON public.message_pins FOR EACH ROW EXECUTE FUNCTION enforce_message_pin_quota()
-- CREATE TRIGGER messages_check_daily_thought_reply BEFORE INSERT ON public.messages FOR EACH ROW WHEN ((new.reply_to_daily_thought_id IS NOT NULL)) EXECUTE FUNCTION private.check_daily_thought_reply()
-- CREATE TRIGGER messages_enforce_mentions BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_message_mentions()
-- CREATE TRIGGER messages_enforce_project_open BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enforce_project_chat_open()
-- CREATE TRIGGER messages_enforce_refs BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enforce_message_refs()
-- CREATE TRIGGER messages_enforce_urgent BEFORE INSERT ON public.messages FOR EACH ROW WHEN (new.is_urgent) EXECUTE FUNCTION private.enforce_urgent_message()
-- CREATE TRIGGER messages_enqueue_push AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enqueue_message_push()
-- CREATE TRIGGER messages_refuse_links_while_pending BEFORE INSERT OR UPDATE OF content ON public.messages FOR EACH ROW EXECUTE FUNCTION private.refuse_links_while_pending()
-- CREATE TRIGGER messages_touch_opportunity AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_contact()
-- CREATE TRIGGER messages_validate_origin_group BEFORE INSERT OR UPDATE OF origin_group_id ON public.messages FOR EACH ROW EXECUTE FUNCTION private.validate_message_origin_group()


-- ------------------------------------------------------------------ functions (as live)
-- public.edit_message
CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_content text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.messages%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select
    * into v_row
  from
    public.messages
  where
    id = p_message_id
  for update;
  if not found then
    raise exception 'avora_message_not_found';
  end if;

  if v_row.sender_id <> v_uid then
    raise exception 'avora_message_not_yours';
  end if;

  -- AVORA-37 / A: rewriting an old line is still putting new words into a blocked 1-1.
  perform private.assert_direct_talk (v_row.conversation_id, v_uid, 'reaction');

  -- A withdrawn message has no text to correct; bringing it back would undo the withdrawal.
  if v_row.deleted_at is not null then
    raise exception 'avora_message_recalled';
  end if;

  if now() - v_row.created_at > public.message_edit_window () then
    raise exception 'avora_message_edit_expired';
  end if;

  if v_content = '' then
    raise exception 'messages_content_not_blank';
  end if;
  if char_length(v_content) > 4000 then
    raise exception 'messages_content_max_len';
  end if;

  -- Rewriting the same words is not an edit, and must not stamp the message as one.
  if v_content = v_row.content then
    return v_row;
  end if;

  update
    public.messages
  set
    content = v_content,
    edited_at = now()
  where
    id = p_message_id;

  select
    * into v_row
  from
    public.messages
  where
    id = p_message_id;
  return v_row;
end;
$function$;

-- private.is_conversation_participant
CREATE OR REPLACE FUNCTION private.is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = p_user_id
  );
$function$;

-- public.join_group_with_invite
CREATE OR REPLACE FUNCTION public.join_group_with_invite(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  select conversation_id into v_conversation_id
    from public.group_invite_links
    where token = p_token and revoked_at is null and expires_at > now();
  if v_conversation_id is null then
    raise exception 'Invite link not found';
  end if;
  if exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conversation_id and user_id = v_uid
  ) then
    return v_conversation_id;
  end if;
  insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_conversation_id, v_uid, 'member');
  return v_conversation_id;
end;
$function$;

-- public.mark_conversation_read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_latest timestamptz;
  v_result timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if not private.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;

  select max(m.created_at) into v_latest from public.messages m where m.conversation_id = p_conversation_id;

  if v_latest is not null then
    -- Monotonic, and no write when nothing moved.
    insert into public.conversation_read_marks as r (conversation_id, user_id, last_read_at)
    values (p_conversation_id, v_user, v_latest)
    on conflict (conversation_id, user_id) do update
      set last_read_at = excluded.last_read_at
      where r.last_read_at < excluded.last_read_at;
  end if;

  select last_read_at into v_result from public.conversation_read_marks
  where conversation_id = p_conversation_id and user_id = v_user;
  return v_result;
end;
$function$;

-- public.mark_messages_delivered
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(p_message_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  -- 1-1 only (a group never shows who is online), never one's own line, never across a block.
  insert into message_deliveries (message_id, user_id)
  select m.id, v_uid
  from messages m
  join conversations c on c.id = m.conversation_id and c.type = 'direct'
  where m.id = any (p_message_ids)
    and m.sender_id <> v_uid
    and m.system_kind is null
    and private.is_conversation_participant(m.conversation_id, v_uid)
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

-- public.pin_message
CREATE OR REPLACE FUNCTION public.pin_message(p_message_id uuid, p_scope text)
 RETURNS message_pins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_conversation uuid;
  v_deleted timestamptz;
  v_row public.message_pins%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  if p_scope not in ('group', 'personal') then
    raise exception 'avora_pin_bad_scope';
  end if;

  select
    conversation_id,
    deleted_at into v_conversation,
    v_deleted
  from
    public.messages
  where
    id = p_message_id;
  if v_conversation is null then
    raise exception 'avora_message_not_found';
  end if;

  if not private.is_conversation_participant (v_conversation, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- A withdrawn message has no words left to point at, so pinning it would put an empty
  -- placeholder on the noticeboard.
  if v_deleted is not null then
    raise exception 'avora_message_recalled';
  end if;

  -- A shared pin speaks for the room, so it belongs to the seats that answer for it.
  if p_scope = 'group'
    and not private.is_group_officer (v_conversation, v_uid) then
    raise exception 'avora_pin_officers_only';
  end if;

  -- Already pinned for this audience: a retry is a no-op success, and must not consume a
  -- second slot of the quota.
  if p_scope = 'group' then
    select
      * into v_row
    from
      public.message_pins
    where
      conversation_id = v_conversation
      and message_id = p_message_id
      and scope = 'group';
  else
    select
      * into v_row
    from
      public.message_pins
    where
      conversation_id = v_conversation
      and message_id = p_message_id
      and scope = 'personal'
      and pinned_by = v_uid;
  end if;

  if found then
    return v_row;
  end if;

  insert into public.message_pins (message_id, conversation_id, pinned_by, scope)
    values (p_message_id, v_conversation, v_uid, p_scope)
  returning
    * into v_row;

  return v_row;
end;
$function$;

-- private.realtime_topic_ok
CREATE OR REPLACE FUNCTION private.realtime_topic_ok(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_topic = 'avora-milestone' then return auth.uid() is not null; end if;
  if p_topic ~ '^thread-[0-9a-f-]{36}$' then
    return private.is_conversation_participant(substr(p_topic, 8)::uuid, auth.uid());
  end if;
  return false;
end $function$;

-- public.recall_message
CREATE OR REPLACE FUNCTION public.recall_message(p_message_id uuid)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.messages%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'avora_message_not_found';
  end if;

  if v_row.sender_id <> v_uid then
    raise exception 'avora_message_not_yours';
  end if;

  -- Already withdrawn: a retry is a no-op success, not a second withdrawal.
  if v_row.deleted_at is not null then
    return v_row;
  end if;

  if now() - v_row.created_at > public.message_edit_window () then
    raise exception 'avora_message_recall_expired';
  end if;

  -- Files first: the trigger on this delete zeroes attachment_count, which the not-blank
  -- constraint needs to have happened before content becomes ''.
  delete from public.message_attachments where message_id = p_message_id;

  update public.messages
  set content = '', deleted_at = now()
  where id = p_message_id;

  select * into v_row from public.messages where id = p_message_id;
  return v_row;
end;
$function$;

-- public.save_push_subscription
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device_label text)
 RETURNS push_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v push_subscriptions%rowtype; v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  -- The same browser under another account moves to this one: one device, one owner.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_uid, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(coalesce(nullif(btrim(p_device_label), ''), 'Thiết bị'), 80))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    device_label = excluded.device_label, created_at = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.created_at else now() end
  returning * into v;
  return v;
end $function$;


-- ------------------------------------------------------------------ bucket chat-attachments (as live)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 26214400, null)
on conflict (id) do nothing;

do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = $n$chat_attachments_delete_own$n$) then
  create policy "chat_attachments_delete_own" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'chat-attachments'::text) AND (owner = ( SELECT auth.uid() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE (a.storage_path = objects.name))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = $n$chat_attachments_read_participants$n$) then
  create policy "chat_attachments_read_participants" on storage.objects as permissive for select to authenticated using (((bucket_id = 'chat-attachments'::text) AND (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE ((a.storage_path = objects.name) AND private.is_conversation_participant(a.conversation_id, ( SELECT auth.uid() AS uid)))))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = $n$chat_attachments_write_participants$n$) then
  create policy "chat_attachments_write_participants" on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'chat-attachments'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'::text) AND private.is_conversation_participant(((storage.foldername(name))[1])::uuid, ( SELECT auth.uid() AS uid))));
end if; end $do$;

-- ------------------------------------------------------------------ realtime.messages (as live)
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = $n$avora_rt_read$n$) then
  create policy "avora_rt_read" on realtime.messages as permissive for select to authenticated using ((( SELECT private.session_allowed() AS session_allowed) AND private.realtime_topic_ok(( SELECT realtime.topic() AS topic))));
end if; end $do$;
do $do$ begin if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = $n$avora_rt_write$n$) then
  create policy "avora_rt_write" on realtime.messages as permissive for insert to authenticated with check ((( SELECT private.session_allowed() AS session_allowed) AND private.realtime_topic_ok(( SELECT realtime.topic() AS topic))));
end if; end $do$;
