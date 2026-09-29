-- AVORA-44 · B — "Xoá biểu tượng thì tệp vẫn còn": the icon is only where the file is anchored,
-- so removing it clears anchor_block_id and nothing else. Owner-only through the existing policy.
grant update (anchor_block_id) on public.note_attachments to authenticated;
