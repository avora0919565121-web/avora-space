-- Trust Phase 1 (ADR-020): placeholders for end-to-end encryption of Tier 1 (chat 1-1/group).
-- Nothing is encrypted yet. Both columns stay null until a real scheme ships; they are written
-- together or not at all, and only by the server — clients hold no INSERT/UPDATE grant on them
-- (both tables use column-level grants, so new columns are not writable by default).
alter table public.messages
  add column if not exists key_version integer,
  add column if not exists algorithm_version text;
alter table public.message_attachments
  add column if not exists key_version integer,
  add column if not exists algorithm_version text;

alter table public.messages
  add constraint messages_crypto_version_pair
    check ((key_version is null) = (algorithm_version is null)),
  add constraint messages_key_version_positive
    check (key_version is null or key_version >= 1),
  add constraint messages_algorithm_version_len
    check (algorithm_version is null or char_length(algorithm_version) between 1 and 64);
alter table public.message_attachments
  add constraint message_attachments_crypto_version_pair
    check ((key_version is null) = (algorithm_version is null)),
  add constraint message_attachments_key_version_positive
    check (key_version is null or key_version >= 1),
  add constraint message_attachments_algorithm_version_len
    check (algorithm_version is null or char_length(algorithm_version) between 1 and 64);

comment on column public.messages.key_version is 'Trust Phase 1 placeholder (ADR-020). Null = plaintext. Server-written only.';
comment on column public.messages.algorithm_version is 'Trust Phase 1 placeholder (ADR-020). Null = plaintext. Server-written only.';
comment on column public.message_attachments.key_version is 'Trust Phase 1 placeholder (ADR-020). Null = plaintext. Server-written only.';
comment on column public.message_attachments.algorithm_version is 'Trust Phase 1 placeholder (ADR-020). Null = plaintext. Server-written only.';
