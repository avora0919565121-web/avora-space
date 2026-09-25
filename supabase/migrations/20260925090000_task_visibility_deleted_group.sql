-- AVORA 28 / Phần 1: a Task inside a deleted group (Inner Trash) is hidden from everyone.
--   Visibility used to ask only "is this person in the chat?". Deleting a project soft-deletes its sub-group
--   (conversations.deleted_at), but its members stay, so its Tasks kept showing in Nhiệm vụ and Avora Space.
--   Now the chat and every group above it must be live. Restoring the group brings the Tasks straight back,
--   because nothing about the Task itself changes.
--   Personal Tasks (conversation_id NULL) are untouched.

-- Walks up the group tree (depth ≤ 3, ADR-007). SECURITY DEFINER because a member of a sub-group need not be in
-- the parent any more, and the conversations policy would hide the parent row from them.
CREATE OR REPLACE FUNCTION private.conversation_is_live(p_conversation uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_group_id, c.deleted_at, 1 AS lvl
    FROM public.conversations c
    WHERE c.id = p_conversation
    UNION ALL
    SELECT c.id, c.parent_group_id, c.deleted_at, chain.lvl + 1
    FROM public.conversations c
    JOIN chain ON c.id = chain.parent_group_id
    WHERE chain.lvl < 4
  )
  SELECT EXISTS (SELECT 1 FROM chain)
     AND NOT EXISTS (SELECT 1 FROM chain WHERE deleted_at IS NOT NULL);
$$;

REVOKE ALL ON FUNCTION private.conversation_is_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.conversation_is_live(uuid) TO authenticated;

-- The shared gate for checklist, resources, dependencies, participants, reminders and Hạng mục links.
CREATE OR REPLACE FUNCTION private.can_view_task(p_task uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task
      AND (
        (t.type = 'personal' AND t.creator_id = p_user)
        OR (t.type IN ('1-1-shared', 'group-shared')
            AND private.is_conversation_participant(t.conversation_id, p_user)
            AND private.conversation_is_live(t.conversation_id))
      )
  );
$$;

REVOKE ALL ON FUNCTION private.can_view_task(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_task(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS tasks_select_visible ON public.tasks;
CREATE POLICY tasks_select_visible ON public.tasks
  FOR SELECT TO authenticated
  USING (
    (type = 'personal' AND creator_id = (SELECT auth.uid()))
    OR (type IN ('1-1-shared', 'group-shared')
        AND private.is_conversation_participant(conversation_id, (SELECT auth.uid()))
        AND private.conversation_is_live(conversation_id))
  );
