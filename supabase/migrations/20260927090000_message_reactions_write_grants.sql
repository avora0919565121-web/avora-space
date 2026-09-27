-- AVORA-35 / A — let people actually leave a reaction.
--
-- The table, RLS and three policies already existed (migration "create-message-reactions",
-- 2026-09-14, applied outside this folder). What was missing: authenticated only held
-- SELECT and DELETE, so every reaction (an upsert = INSERT ... ON CONFLICT DO UPDATE) failed
-- with 42501, and there was no UPDATE policy for the ON CONFLICT branch.
--
-- ---------------------------------------------------------------------------------------
-- State BEFORE this migration (exported from pg_policies / role_table_grants, 2026-09-27):
--
--   RLS: enabled (not forced)
--   Grants to authenticated: SELECT, DELETE   (anon: none; no TRUNCATE for anyone in API roles)
--   PK (message_id, user_id, emoji); FK message_id -> messages ON DELETE CASCADE
--
--   message_reactions_select_participant  FOR SELECT  TO public
--     USING (EXISTS (SELECT 1 FROM messages m
--                    WHERE m.id = message_reactions.message_id
--                      AND private.is_conversation_participant(m.conversation_id, (SELECT auth.uid()))))
--
--   message_reactions_insert_own          FOR INSERT  TO public
--     WITH CHECK ((user_id = (SELECT auth.uid()))
--                 AND EXISTS (SELECT 1 FROM messages m
--                             WHERE m.id = message_reactions.message_id
--                               AND private.is_conversation_participant(m.conversation_id, (SELECT auth.uid()))))
--
--   message_reactions_delete_own          FOR DELETE  TO public
--     USING (user_id = (SELECT auth.uid()))
--
--   (no UPDATE policy)
--
--   private.is_conversation_participant(uuid, uuid): SQL, STABLE, SECURITY DEFINER,
--     search_path = public, pg_temp — reused below, no new helper.
-- ---------------------------------------------------------------------------------------

GRANT INSERT, UPDATE ON public.message_reactions TO authenticated;
REVOKE TRUNCATE ON public.message_reactions FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS message_reactions_update_own ON public.message_reactions;

-- Only your own row, and only while you are still in the conversation holding the message.
CREATE POLICY message_reactions_update_own
  ON public.message_reactions
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND private.is_conversation_participant(m.conversation_id, (SELECT auth.uid()))
    )
  );
