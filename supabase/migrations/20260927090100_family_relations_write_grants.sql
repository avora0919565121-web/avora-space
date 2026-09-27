-- AVORA-35 / E — let people mark family, without requiring a past 1-1.
--
-- The table, RLS and four policies already existed (migration "create-family-relations",
-- 2026-09-14, applied outside this folder). What was missing: authenticated only held
-- SELECT and DELETE, so marking (an upsert) failed with 42501. Decided in AVORA-35: who is
-- family is the person's own call, so the insert policy no longer demands a shared 1-1.
--
-- ---------------------------------------------------------------------------------------
-- State BEFORE this migration (exported from pg_policies / role_table_grants, 2026-09-27):
--
--   RLS: enabled (not forced)
--   Grants to authenticated: SELECT, DELETE   (anon: none; no TRUNCATE for anyone in API roles)
--   PK (user_id, related_user_id); CHECK user_id <> related_user_id;
--   CHECK relation_type IN ('spouse','parent','parent_in_law','child','other')
--
--   family_relations_select_own  FOR SELECT  TO public
--     USING (user_id = (SELECT auth.uid()))
--
--   family_relations_insert_own  FOR INSERT  TO public
--     WITH CHECK ((user_id = (SELECT auth.uid()))
--                 AND EXISTS (SELECT 1
--                             FROM conversation_participants mine
--                             JOIN conversation_participants theirs ON theirs.conversation_id = mine.conversation_id
--                             JOIN conversations c ON c.id = mine.conversation_id
--                             WHERE mine.user_id = (SELECT auth.uid())
--                               AND theirs.user_id = family_relations.related_user_id
--                               AND c.type = 'direct'))
--
--   family_relations_update_own  FOR UPDATE  TO public
--     USING (user_id = (SELECT auth.uid()))
--     WITH CHECK (user_id = (SELECT auth.uid()))
--
--   family_relations_delete_own  FOR DELETE  TO public
--     USING (user_id = (SELECT auth.uid()))
-- ---------------------------------------------------------------------------------------

GRANT INSERT, UPDATE ON public.family_relations TO authenticated;
REVOKE TRUNCATE ON public.family_relations FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS family_relations_insert_own ON public.family_relations;

CREATE POLICY family_relations_insert_own
  ON public.family_relations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
