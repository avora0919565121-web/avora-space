-- AVORA-72: the owner edits the new opportunity fields in place; removing an opportunity is soft (`Bỏ cơ hội`).
grant update (next_action_date, next_action_note, last_contact_at, removed_at) on public.crm_opportunity to authenticated;
-- A hard delete would orphan its row on the synced board: only `Bỏ cơ hội` (removed_at) from now on.
revoke delete on public.crm_opportunity from authenticated;
