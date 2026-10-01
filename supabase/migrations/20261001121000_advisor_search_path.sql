-- AVORA-55 · 5 — Supabase Security Advisor.
-- 1. function_search_path_mutable: pin search_path on the ten helpers that had none, so a caller's
--    session search_path can never redirect the names inside them. All are plain (non-definer)
--    helpers; `public, pg_temp` matches what their bodies already resolve against.
alter function private.note_plain_text(jsonb) set search_path = public, pg_temp;
alter function public.message_edit_window() set search_path = public, pg_temp;
alter function private.table_statuses(jsonb) set search_path = public, pg_temp;
alter function private.status_label_in(jsonb, text) set search_path = public, pg_temp;
alter function private.notes_with(text, text[]) set search_path = public, pg_temp;
alter function public.message_pin_limit() set search_path = public, pg_temp;
alter function private.contact_details_filled() set search_path = public, pg_temp;
alter function public.forward_blocked_note() set search_path = public, pg_temp;
alter function private.proposal_words(text, text, text) set search_path = public, pg_temp;
alter function private.transaction_confirm_word(text) set search_path = public, pg_temp;

-- 2. currency_rate_at is only reached from the transaction triggers (security definer, run as the
--    owner); the app never calls it. No signed-in role needs to execute it directly.
revoke execute on function public.currency_rate_at(text, text, date) from public, anon, authenticated;
