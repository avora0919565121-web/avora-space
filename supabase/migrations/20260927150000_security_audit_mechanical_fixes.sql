-- AVORA-37 / D1 — mechanical permission fixes from the 2026-09-28 security audit.
-- See docs/SECURITY-AUDIT-2026-09-28.md for the full audit (7 checks) and what is only reported.
--
-- Only three kinds of change, none of which alters any condition:
--   (3) REVOKE TRUNCATE on every public table from anon/authenticated/PUBLIC. The audit found
--       none granted today; this is a guard so a replayed old grant cannot bring it back.
--   (4) Every policy that applied to role `public` now applies to `authenticated` only.
--       ALTER POLICY ... TO keeps USING / WITH CHECK exactly as they were (listed below).
--       anon already held no privileges on these tables, so nothing a signed-out caller could
--       do changes; this removes the reliance on the missing grant.
--   (6) public.forward_blocked_note() was executable by PUBLIC (default ACL). It is only called
--       from inside forward_messages (SECURITY DEFINER, runs as owner), so anon/PUBLIC lose it.
--       No function is kept open to anon: sign-in and password reset go through Supabase Auth
--       (GoTrue), not through any function in public.
--
-- ---------------------------------------------------------------------------------------
-- Policies BEFORE this migration (roles = {public}), exported 2026-09-27:
--   public.contact  contact_delete_own  DELETE  TO public
--     USING (owner_user_id = auth.uid())
--   public.contact  contact_insert_own  INSERT  TO public
--     WITH CHECK (owner_user_id = auth.uid())
--   public.contact  contact_select_own  SELECT  TO public
--     USING (owner_user_id = auth.uid())
--   public.contact  contact_update_own  UPDATE  TO public
--     USING (owner_user_id = auth.uid())
--     WITH CHECK (owner_user_id = auth.uid())
--   public.contact_channel  contact_channel_delete_own  DELETE  TO public
--     USING (owner_user_id = auth.uid())
--   public.contact_channel  contact_channel_select_own  SELECT  TO public
--     USING (owner_user_id = auth.uid())
--   public.contact_channel  contact_channel_update_own  UPDATE  TO public
--     USING (owner_user_id = auth.uid())
--     WITH CHECK (owner_user_id = auth.uid())
--   public.contact_invite  contact_invite_insert_own  INSERT  TO public
--     WITH CHECK (invited_by = auth.uid())
--   public.contact_invite  contact_invite_select_own  SELECT  TO public
--     USING (invited_by = auth.uid())
--   public.context_task_list_settings  context_task_list_settings_insert_allowed  INSERT  TO public
--     WITH CHECK (private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid)) AND (updated_by = ( SELECT auth.uid() AS uid)))
--   public.context_task_list_settings  context_task_list_settings_select_participant  SELECT  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   public.context_task_list_settings  context_task_list_settings_update_allowed  UPDATE  TO public
--     USING private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid))
--     WITH CHECK (private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid)) AND (updated_by = ( SELECT auth.uid() AS uid)))
--   public.conversation_groups  conversation_groups_insert_owner  INSERT  TO public
--     WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))
--   public.conversation_groups  conversation_groups_select_participant  SELECT  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   public.conversation_groups  conversation_groups_update_owner  UPDATE  TO public
--     USING (owner_id = ( SELECT auth.uid() AS uid))
--     WITH CHECK (owner_id = ( SELECT auth.uid() AS uid))
--   public.crm_opportunity  crm_opportunity_delete_own  DELETE  TO public
--     USING (owner_user_id = ( SELECT auth.uid() AS uid))
--   public.crm_opportunity  crm_opportunity_insert_own  INSERT  TO public
--     WITH CHECK (owner_user_id = ( SELECT auth.uid() AS uid))
--   public.crm_opportunity  crm_opportunity_select_own  SELECT  TO public
--     USING (owner_user_id = ( SELECT auth.uid() AS uid))
--   public.crm_opportunity  crm_opportunity_update_own  UPDATE  TO public
--     USING (owner_user_id = ( SELECT auth.uid() AS uid))
--     WITH CHECK (owner_user_id = ( SELECT auth.uid() AS uid))
--   public.dismissed_guidance  dismissed_guidance_delete_own  DELETE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.dismissed_guidance  dismissed_guidance_insert_own  INSERT  TO public
--     WITH CHECK (user_id = ( SELECT auth.uid() AS uid))
--   public.dismissed_guidance  dismissed_guidance_select_own  SELECT  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.family_relations  family_relations_delete_own  DELETE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.family_relations  family_relations_select_own  SELECT  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.family_relations  family_relations_update_own  UPDATE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--     WITH CHECK (user_id = ( SELECT auth.uid() AS uid))
--   public.group_invite_links  group_invite_links_members_read  SELECT  TO public
--     USING (EXISTS ( SELECT 1
--          FROM conversation_participants p
--         WHERE ((p.conversation_id = group_invite_links.conversation_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))
--   public.group_removal_requests  grr_select_owner_admin  SELECT  TO public
--     USING (EXISTS ( SELECT 1
--          FROM conversation_participants cp
--         WHERE ((cp.conversation_id = group_removal_requests.conversation_id) AND (cp.user_id = ( SELECT auth.uid() AS uid)) AND (cp.role = ANY (ARRAY['owner'::text, 'admin'::text])))))
--   public.meeting_note_details  meeting_note_details_select_participant  SELECT  TO public
--     USING private.is_conversation_participant(private.decision_conversation(decision_id), ( SELECT auth.uid() AS uid))
--   public.message_attachments  Attacher can remove attachment  DELETE  TO public
--     USING (attached_by = ( SELECT auth.uid() AS uid))
--   public.message_attachments  Participants can attach  INSERT  TO public
--     WITH CHECK ((attached_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--          FROM messages m
--         WHERE ((m.id = message_attachments.message_id) AND (m.conversation_id = message_attachments.conversation_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))))
--   public.message_attachments  Participants can read attachments  SELECT  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   public.message_pins  message_pins_delete_allowed  DELETE  TO public
--     USING (((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid))) OR ((scope = 'group'::text) AND private.is_group_officer(conversation_id, ( SELECT auth.uid() AS uid))))
--   public.message_pins  message_pins_select_visible  SELECT  TO public
--     USING (((scope = 'group'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))) OR ((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid))))
--   public.message_reactions  message_reactions_delete_own  DELETE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.message_reactions  message_reactions_insert_own  INSERT  TO public
--     WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--          FROM messages m
--         WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid))))))
--   public.message_reactions  message_reactions_select_participant  SELECT  TO public
--     USING (EXISTS ( SELECT 1
--          FROM messages m
--         WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)))))
--   public.messages  Authors can delete own journal messages  DELETE  TO public
--     USING ((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--          FROM conversations c
--         WHERE ((c.id = messages.conversation_id) AND (c.type = 'personal'::text)))))
--   public.mute_settings  mute_settings_delete_own  DELETE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.mute_settings  mute_settings_insert_own  INSERT  TO public
--     WITH CHECK (user_id = ( SELECT auth.uid() AS uid))
--   public.mute_settings  mute_settings_select_own  SELECT  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.mute_settings  mute_settings_update_own  UPDATE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--     WITH CHECK (user_id = ( SELECT auth.uid() AS uid))
--   public.profiles  Users can insert own profile  INSERT  TO public
--     WITH CHECK (( SELECT auth.uid() AS uid) = id)
--   public.profiles  Users can read own profile  SELECT  TO public
--     USING (( SELECT auth.uid() AS uid) = id)
--   public.profiles  Users can update own profile  UPDATE  TO public
--     USING (( SELECT auth.uid() AS uid) = id)
--     WITH CHECK (( SELECT auth.uid() AS uid) = id)
--   public.project_tasks  project_tasks_delete_participant  DELETE  TO public
--     USING (EXISTS ( SELECT 1
--          FROM projects p
--         WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid)))))
--   public.project_tasks  project_tasks_insert_participant  INSERT  TO public
--     WITH CHECK ((linked_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--          FROM projects p
--         WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid))))))
--   public.project_tasks  project_tasks_select_participant  SELECT  TO public
--     USING (EXISTS ( SELECT 1
--          FROM projects p
--         WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid)))))
--   public.task_celebration_views  task_celebration_views_insert_own  INSERT  TO public
--     WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--          FROM task_celebrations c
--         WHERE ((c.task_id = task_celebration_views.task_id) AND private.is_conversation_participant(c.conversation_id, ( SELECT auth.uid() AS uid))))))
--   public.task_celebration_views  task_celebration_views_select_own  SELECT  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.task_celebrations  task_celebrations_select_participant  SELECT  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   public.task_dependencies  task_dependencies_delete_party  DELETE  TO public
--     USING private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
--   public.task_dependencies  task_dependencies_insert_party  INSERT  TO public
--     WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)) AND private.can_link_task(task_id, ( SELECT auth.uid() AS uid)) AND private.can_view_task(depends_on_task_id, ( SELECT auth.uid() AS uid)))
--   public.task_dependencies  task_dependencies_select_visible  SELECT  TO public
--     USING (private.can_view_task(task_id, ( SELECT auth.uid() AS uid)) AND private.can_view_task(depends_on_task_id, ( SELECT auth.uid() AS uid)))
--   public.task_flags  task_flags_delete_own  DELETE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.task_flags  task_flags_insert_own  INSERT  TO public
--     WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND private.can_view_task(task_id, ( SELECT auth.uid() AS uid)))
--   public.task_flags  task_flags_select_own  SELECT  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--   public.task_flags  task_flags_update_own  UPDATE  TO public
--     USING (user_id = ( SELECT auth.uid() AS uid))
--     WITH CHECK (user_id = ( SELECT auth.uid() AS uid))
--   public.task_lists  task_lists_insert_participant  INSERT  TO public
--     WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))
--   public.task_lists  task_lists_select_participant  SELECT  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   public.task_lists  task_lists_update_participant  UPDATE  TO public
--     USING private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--     WITH CHECK private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   storage.objects  chat_attachments_delete_own  DELETE  TO public
--     USING ((bucket_id = 'chat-attachments'::text) AND (owner = ( SELECT auth.uid() AS uid)) AND (NOT (EXISTS ( SELECT 1
--          FROM message_attachments a
--         WHERE (a.storage_path = objects.name)))))
--   storage.objects  chat_attachments_read_participants  SELECT  TO public
--     USING ((bucket_id = 'chat-attachments'::text) AND (EXISTS ( SELECT 1
--          FROM message_attachments a
--         WHERE ((a.storage_path = objects.name) AND private.is_conversation_participant(a.conversation_id, ( SELECT auth.uid() AS uid))))))
--   storage.objects  chat_attachments_write_participants  INSERT  TO public
--     WITH CHECK ((bucket_id = 'chat-attachments'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'::text) AND private.is_conversation_participant(((storage.foldername(name))[1])::uuid, ( SELECT auth.uid() AS uid)))
-- ---------------------------------------------------------------------------------------

begin;

-- (3)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate on public.%I from anon, authenticated, public', t.relname);
  end loop;
end $$;

-- (4)
alter policy contact_delete_own on public.contact to authenticated;
alter policy contact_insert_own on public.contact to authenticated;
alter policy contact_select_own on public.contact to authenticated;
alter policy contact_update_own on public.contact to authenticated;
alter policy contact_channel_delete_own on public.contact_channel to authenticated;
alter policy contact_channel_select_own on public.contact_channel to authenticated;
alter policy contact_channel_update_own on public.contact_channel to authenticated;
alter policy contact_invite_insert_own on public.contact_invite to authenticated;
alter policy contact_invite_select_own on public.contact_invite to authenticated;
alter policy context_task_list_settings_insert_allowed on public.context_task_list_settings to authenticated;
alter policy context_task_list_settings_select_participant on public.context_task_list_settings to authenticated;
alter policy context_task_list_settings_update_allowed on public.context_task_list_settings to authenticated;
alter policy conversation_groups_insert_owner on public.conversation_groups to authenticated;
alter policy conversation_groups_select_participant on public.conversation_groups to authenticated;
alter policy conversation_groups_update_owner on public.conversation_groups to authenticated;
alter policy crm_opportunity_delete_own on public.crm_opportunity to authenticated;
alter policy crm_opportunity_insert_own on public.crm_opportunity to authenticated;
alter policy crm_opportunity_select_own on public.crm_opportunity to authenticated;
alter policy crm_opportunity_update_own on public.crm_opportunity to authenticated;
alter policy dismissed_guidance_delete_own on public.dismissed_guidance to authenticated;
alter policy dismissed_guidance_insert_own on public.dismissed_guidance to authenticated;
alter policy dismissed_guidance_select_own on public.dismissed_guidance to authenticated;
alter policy family_relations_delete_own on public.family_relations to authenticated;
alter policy family_relations_select_own on public.family_relations to authenticated;
alter policy family_relations_update_own on public.family_relations to authenticated;
alter policy group_invite_links_members_read on public.group_invite_links to authenticated;
alter policy grr_select_owner_admin on public.group_removal_requests to authenticated;
alter policy meeting_note_details_select_participant on public.meeting_note_details to authenticated;
alter policy "Attacher can remove attachment" on public.message_attachments to authenticated;
alter policy "Participants can attach" on public.message_attachments to authenticated;
alter policy "Participants can read attachments" on public.message_attachments to authenticated;
alter policy message_pins_delete_allowed on public.message_pins to authenticated;
alter policy message_pins_select_visible on public.message_pins to authenticated;
alter policy message_reactions_delete_own on public.message_reactions to authenticated;
alter policy message_reactions_insert_own on public.message_reactions to authenticated;
alter policy message_reactions_select_participant on public.message_reactions to authenticated;
alter policy "Authors can delete own journal messages" on public.messages to authenticated;
alter policy mute_settings_delete_own on public.mute_settings to authenticated;
alter policy mute_settings_insert_own on public.mute_settings to authenticated;
alter policy mute_settings_select_own on public.mute_settings to authenticated;
alter policy mute_settings_update_own on public.mute_settings to authenticated;
alter policy "Users can insert own profile" on public.profiles to authenticated;
alter policy "Users can read own profile" on public.profiles to authenticated;
alter policy "Users can update own profile" on public.profiles to authenticated;
alter policy project_tasks_delete_participant on public.project_tasks to authenticated;
alter policy project_tasks_insert_participant on public.project_tasks to authenticated;
alter policy project_tasks_select_participant on public.project_tasks to authenticated;
alter policy task_celebration_views_insert_own on public.task_celebration_views to authenticated;
alter policy task_celebration_views_select_own on public.task_celebration_views to authenticated;
alter policy task_celebrations_select_participant on public.task_celebrations to authenticated;
alter policy task_dependencies_delete_party on public.task_dependencies to authenticated;
alter policy task_dependencies_insert_party on public.task_dependencies to authenticated;
alter policy task_dependencies_select_visible on public.task_dependencies to authenticated;
alter policy task_flags_delete_own on public.task_flags to authenticated;
alter policy task_flags_insert_own on public.task_flags to authenticated;
alter policy task_flags_select_own on public.task_flags to authenticated;
alter policy task_flags_update_own on public.task_flags to authenticated;
alter policy task_lists_insert_participant on public.task_lists to authenticated;
alter policy task_lists_select_participant on public.task_lists to authenticated;
alter policy task_lists_update_participant on public.task_lists to authenticated;
alter policy chat_attachments_delete_own on storage.objects to authenticated;
alter policy chat_attachments_read_participants on storage.objects to authenticated;
alter policy chat_attachments_write_participants on storage.objects to authenticated;

-- (6)
revoke execute on function public.forward_blocked_note() from public, anon;
grant execute on function public.forward_blocked_note() to authenticated;

commit;
