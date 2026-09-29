-- Đợt gộp 2 · VMT mục 7: no direct hard delete from the client on messages. The only delete path
-- the app uses is delete_journal_messages (SECURITY DEFINER, own journal notes only), which runs
-- as the function owner and is unaffected. Recall stays a soft delete (deleted_at).
revoke delete on public.messages from authenticated;
