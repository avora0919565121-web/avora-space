CREATE POLICY contact_merge_log_none ON private.contact_merge_log AS PERMISSIVE FOR ALL TO authenticated USING (false);
CREATE POLICY contact_not_duplicate_none ON private.contact_not_duplicate AS PERMISSIVE FOR ALL TO authenticated USING (false);
CREATE POLICY avora_session_allowed ON public.account_balance_history AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY balance_history_select_own ON public.account_balance_history AS PERMISSIVE FOR SELECT TO authenticated USING ((private.vault_is_unlocked() AND (EXISTS ( SELECT 1
   FROM accounts a
  WHERE ((a.id = account_balance_history.account_id) AND (a.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY account_device_lock_own_select ON public.account_device_lock AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.account_device_lock AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY account_devices_own_select ON public.account_devices AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.account_devices AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY accounts_insert_own ON public.accounts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY accounts_select_own ON public.accounts AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY accounts_update_own ON public.accounts AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked())) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY avora_session_allowed ON public.accounts AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY activity_daily_own_select ON public.activity_daily AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.activity_daily AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY app_config_read ON public.app_config AS PERMISSIVE FOR SELECT TO authenticated USING ((key <> 'ops_user_ids'::text));
CREATE POLICY avora_session_allowed ON public.app_config AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY app_feature_changes_ops_read ON public.app_feature_changes AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT private.is_ops(( SELECT auth.uid() AS uid)) AS is_ops));
CREATE POLICY avora_session_allowed ON public.app_feature_changes AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY app_features_read ON public.app_features AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY avora_session_allowed ON public.app_features AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.book_catalog AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY book_catalog_read ON public.book_catalog AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY avora_session_allowed ON public.book_edition_link AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY book_edition_link_read ON public.book_edition_link AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY avora_session_allowed ON public.book_my_covers AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY book_my_covers_own ON public.book_my_covers AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.book_reading_state AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY book_reading_state_own ON public.book_reading_state AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.book_text_hits AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.categories AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY categories_delete_own_custom ON public.categories AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (type = 'custom'::category_origin) AND private.vault_is_unlocked()));
CREATE POLICY categories_insert_own_custom ON public.categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (type = 'custom'::category_origin) AND private.vault_is_unlocked()));
CREATE POLICY categories_select_own ON public.categories AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY categories_update_own_custom ON public.categories AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (type = 'custom'::category_origin) AND private.vault_is_unlocked())) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (type = 'custom'::category_origin) AND private.vault_is_unlocked()));
CREATE POLICY avora_session_allowed ON public.checklist_items AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY checklist_items_delete ON public.checklist_items AS PERMISSIVE FOR DELETE TO authenticated USING (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY checklist_items_insert ON public.checklist_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY checklist_items_select ON public.checklist_items AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_task_private(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY checklist_items_update ON public.checklist_items AS PERMISSIVE FOR UPDATE TO authenticated USING (private.can_link_task(task_id, ( SELECT auth.uid() AS uid))) WITH CHECK (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.client_errors AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY client_errors_ops_read ON public.client_errors AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT private.is_ops(( SELECT auth.uid() AS uid)) AS is_ops));
CREATE POLICY avora_session_allowed ON public.contact AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY contact_delete_own ON public.contact AS PERMISSIVE FOR DELETE TO authenticated USING ((owner_user_id = auth.uid()));
CREATE POLICY contact_insert_own ON public.contact AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((owner_user_id = auth.uid()));
CREATE POLICY contact_select_own ON public.contact AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = auth.uid()));
CREATE POLICY contact_update_own ON public.contact AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_user_id = auth.uid())) WITH CHECK ((owner_user_id = auth.uid()));
CREATE POLICY avora_session_allowed ON public.contact_card_notice AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY contact_card_notice_own ON public.contact_card_notice AS PERMISSIVE FOR SELECT TO authenticated USING ((introduced_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.contact_channel AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY contact_channel_delete_own ON public.contact_channel AS PERMISSIVE FOR DELETE TO authenticated USING ((owner_user_id = auth.uid()));
CREATE POLICY contact_channel_select_own ON public.contact_channel AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = auth.uid()));
CREATE POLICY contact_channel_update_own ON public.contact_channel AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_user_id = auth.uid())) WITH CHECK ((owner_user_id = auth.uid()));
CREATE POLICY avora_session_allowed ON public.contact_invite AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY contact_invite_insert_own ON public.contact_invite AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((invited_by = auth.uid()));
CREATE POLICY contact_invite_select_own ON public.contact_invite AS PERMISSIVE FOR SELECT TO authenticated USING ((invited_by = auth.uid()));
CREATE POLICY avora_session_allowed ON public.contact_link_changes AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY contact_link_changes_owner_read ON public.contact_link_changes AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.context_task_list_settings AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY context_task_list_settings_insert_allowed ON public.context_task_list_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid)) AND (updated_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY context_task_list_settings_select_participant ON public.context_task_list_settings AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY context_task_list_settings_update_allowed ON public.context_task_list_settings AS PERMISSIVE FOR UPDATE TO authenticated USING (private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid))) WITH CHECK ((private.can_toggle_task_lists(conversation_id, ( SELECT auth.uid() AS uid)) AND (updated_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY conversation_appearance_members ON public.conversation_appearance AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text));
CREATE POLICY conversation_appearance_session ON public.conversation_appearance AS RESTRICTIVE FOR ALL TO authenticated USING (private.session_allowed()) WITH CHECK (private.session_allowed());
CREATE POLICY avora_session_allowed ON public.conversation_archives AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY conversation_archives_own_delete ON public.conversation_archives AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY conversation_archives_own_insert ON public.conversation_archives AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (( SELECT conversations.type
   FROM conversations
  WHERE (conversations.id = conversation_archives.conversation_id)) <> 'personal'::text)));
CREATE POLICY conversation_archives_own_select ON public.conversation_archives AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY conversation_archives_own_update ON public.conversation_archives AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.conversation_groups AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY conversation_groups_insert_owner ON public.conversation_groups AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY conversation_groups_select_participant ON public.conversation_groups AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY conversation_groups_update_owner ON public.conversation_groups AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY conversation_member_prefs_own ON public.conversation_member_prefs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY conversation_member_prefs_session ON public.conversation_member_prefs AS RESTRICTIVE FOR ALL TO authenticated USING (private.session_allowed()) WITH CHECK (private.session_allowed());
CREATE POLICY "Participants can read conversation members" ON public.conversation_participants AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.conversation_participants AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.conversation_pins AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY conversation_pins_own_select ON public.conversation_pins AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Own read marks only" ON public.conversation_read_marks AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.conversation_read_marks AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY conversation_storage_members ON public.conversation_storage AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text));
CREATE POLICY conversation_storage_session ON public.conversation_storage AS RESTRICTIVE FOR ALL TO authenticated USING (private.session_allowed()) WITH CHECK (private.session_allowed());
CREATE POLICY avora_session_allowed ON public.conversation_verification_confirms AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY conversation_verification_confirms_select ON public.conversation_verification_confirms AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY "Participants can read their conversations" ON public.conversations AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.conversations AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.crm_opportunity AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY crm_opportunity_delete_own ON public.crm_opportunity AS PERMISSIVE FOR DELETE TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY crm_opportunity_insert_own ON public.crm_opportunity AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY crm_opportunity_select_own ON public.crm_opportunity AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY crm_opportunity_update_own ON public.crm_opportunity AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.currencies AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY currencies_read_all ON public.currencies AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY avora_session_allowed ON public.currency_rates AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY currency_rates_read_all ON public.currency_rates AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY disappear_proposals_read ON public.disappear_proposals AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text));
CREATE POLICY disappear_proposals_session ON public.disappear_proposals AS RESTRICTIVE FOR ALL TO authenticated USING (private.session_allowed()) WITH CHECK (private.session_allowed());
CREATE POLICY avora_session_allowed ON public.dismissed_guidance AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY dismissed_guidance_delete_own ON public.dismissed_guidance AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY dismissed_guidance_insert_own ON public.dismissed_guidance AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY dismissed_guidance_select_own ON public.dismissed_guidance AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.family_relations AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY family_relations_delete_own ON public.family_relations AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY family_relations_insert_own ON public.family_relations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY family_relations_select_own ON public.family_relations AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY family_relations_update_own ON public.family_relations AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.feedback AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY feedback_read_own_or_ops ON public.feedback AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_ops(( SELECT auth.uid() AS uid)) AS is_ops)));
CREATE POLICY avora_session_allowed ON public.group_decision_grants AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY group_decision_grants_select_involved ON public.group_decision_grants AS PERMISSIVE FOR SELECT TO authenticated USING (((grantee_id = ( SELECT auth.uid() AS uid)) OR private.is_group_officer(conversation_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.group_decision_options AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY group_decision_options_select_participant ON public.group_decision_options AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(private.decision_conversation(decision_id), ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.group_decision_votes AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY group_decision_votes_select_own_or_settled ON public.group_decision_votes AS PERMISSIVE FOR SELECT TO authenticated USING (((voter_id = ( SELECT auth.uid() AS uid)) OR (private.decision_is_settled(decision_id) AND private.is_conversation_participant(private.decision_conversation(decision_id), ( SELECT auth.uid() AS uid)))));
CREATE POLICY avora_session_allowed ON public.group_decisions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY group_decisions_select_participant ON public.group_decisions AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.group_invite_links AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY group_invite_links_members_read ON public.group_invite_links AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversation_participants p
  WHERE ((p.conversation_id = group_invite_links.conversation_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.group_removal_requests AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY grr_select_owner_admin ON public.group_removal_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = group_removal_requests.conversation_id) AND (cp.user_id = ( SELECT auth.uid() AS uid)) AND (cp.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY avora_session_allowed ON public.habit_logs AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY habit_logs_own_select ON public.habit_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.habits AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY habits_own_select ON public.habits AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.invite_code AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY invite_code_ops_read ON public.invite_code AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT private.is_ops(( SELECT auth.uid() AS uid)) AS is_ops));
CREATE POLICY avora_session_allowed ON public.meeting_note_details AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY meeting_note_details_select_participant ON public.meeting_note_details AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(private.decision_conversation(decision_id), ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.meeting_note_files AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY meeting_note_files_select_participant ON public.meeting_note_files AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY "Attacher can remove attachment" ON public.message_attachments AS PERMISSIVE FOR DELETE TO authenticated USING ((attached_by = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Participants can read attachments" ON public.message_attachments AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text));
CREATE POLICY avora_session_allowed ON public.message_attachments AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.message_deliveries AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY message_deliveries_sender_reads ON public.message_deliveries AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_deliveries.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)) AND (c.type = 'direct'::text)))));
CREATE POLICY avora_session_allowed ON public.message_pins AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY message_pins_delete_allowed ON public.message_pins AS PERMISSIVE FOR DELETE TO authenticated USING ((private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'pin'::text) AND (((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid))) OR ((scope = 'group'::text) AND private.is_group_officer(conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY message_pins_select_visible ON public.message_pins AS PERMISSIVE FOR SELECT TO authenticated USING ((private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text) AND ((scope = 'group'::text) OR ((scope = 'personal'::text) AND (pinned_by = ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.message_reactions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY message_reactions_delete_own ON public.message_reactions AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.can_act_in(m.conversation_id, ( SELECT auth.uid() AS uid), 'react'::text))))));
CREATE POLICY message_reactions_insert_own ON public.message_reactions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY message_reactions_select_participant ON public.message_reactions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.can_act_in(m.conversation_id, ( SELECT auth.uid() AS uid), 'read'::text)))));
CREATE POLICY message_reactions_update_own ON public.message_reactions AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY avora_session_allowed ON public.message_recall_request AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY message_recall_request_delete ON public.message_recall_request AS PERMISSIVE FOR DELETE TO authenticated USING ((requested_by = ( SELECT auth.uid() AS uid)));
CREATE POLICY message_recall_request_insert ON public.message_recall_request AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((requested_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id <> ( SELECT auth.uid() AS uid)) AND (m.deleted_at IS NULL) AND private.is_conversation_participant(m.conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(m.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY message_recall_request_select ON public.message_recall_request AS PERMISSIVE FOR SELECT TO authenticated USING (((requested_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY message_recall_request_update ON public.message_recall_request AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_recall_request.message_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Authors can delete own journal messages" ON public.messages AS PERMISSIVE FOR DELETE TO authenticated USING (((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type = 'personal'::text))))));
CREATE POLICY "Participants can read messages" ON public.messages AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_act_in(conversation_id, ( SELECT auth.uid() AS uid), 'read'::text));
CREATE POLICY avora_session_allowed ON public.messages AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.mute_settings AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY mute_settings_delete_own ON public.mute_settings AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY mute_settings_insert_own ON public.mute_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ((conversation_id IS NULL) OR private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))));
CREATE POLICY mute_settings_select_own ON public.mute_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY mute_settings_update_own ON public.mute_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.note_attachments AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY note_attachments_own ON public.note_attachments AS PERMISSIVE FOR ALL TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.note_folders AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY note_folders_own ON public.note_folders AS PERMISSIVE FOR ALL TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((owner_user_id = ( SELECT auth.uid() AS uid)) AND (NOT is_system)));
CREATE POLICY avora_session_allowed ON public.notes AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY notes_own ON public.notes AS PERMISSIVE FOR ALL TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "Users can read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY avora_session_allowed ON public.profiles AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.project_check_adjust AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY project_check_adjust_select_owner ON public.project_check_adjust AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.project_success_criteria AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY project_success_criteria_select_participant ON public.project_success_criteria AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_success_criteria.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.project_tasks AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY project_tasks_delete_participant ON public.project_tasks AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY project_tasks_insert_participant ON public.project_tasks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((linked_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY project_tasks_select_participant ON public.project_tasks AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_tasks.project_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.projects AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY projects_select_participant ON public.projects AS PERMISSIVE FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY projects_update_owner ON public.projects AS PERMISSIVE FOR UPDATE TO authenticated USING (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'active'::text) AND (deleted_at IS NULL))) WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'active'::text) AND (deleted_at IS NULL)));
CREATE POLICY avora_session_allowed ON public.push_outbox AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY push_outbox_select_own ON public.push_outbox AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.push_subscriptions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Sender reads own scheduled" ON public.scheduled_messages AS PERMISSIVE FOR SELECT TO authenticated USING ((sender_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.scheduled_messages AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.shared_proposal_votes AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY shared_proposal_votes_read ON public.shared_proposal_votes AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM shared_proposals p
  WHERE ((p.id = shared_proposal_votes.proposal_id) AND private.is_conversation_participant(p.conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.shared_proposals AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY shared_proposals_read ON public.shared_proposals AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY sticker_catalog_read ON public.sticker_catalog AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY storage_usage_own ON public.storage_usage AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY storage_usage_session ON public.storage_usage AS RESTRICTIVE FOR ALL TO authenticated USING (private.session_allowed()) WITH CHECK (private.session_allowed());
CREATE POLICY avora_session_allowed ON public.task_categories AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_categories_delete_own_custom ON public.task_categories AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_default = false)));
CREATE POLICY task_categories_insert_own ON public.task_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (is_default = false)));
CREATE POLICY task_categories_select_own ON public.task_categories AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY task_categories_update_own ON public.task_categories AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_celebration_views AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_celebration_views_insert_own ON public.task_celebration_views AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM task_celebrations c
  WHERE ((c.task_id = task_celebration_views.task_id) AND private.is_conversation_participant(c.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY task_celebration_views_select_own ON public.task_celebration_views AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_celebrations AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_celebrations_select_participant ON public.task_celebrations AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_confirmations AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_confirmations_delete_own_pending ON public.task_confirmations AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_confirmations.task_id) AND (t.type = '1-1-shared'::text) AND (t.status = 'pending_confirmation'::text) AND private.is_conversation_participant(t.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY task_confirmations_insert_peer ON public.task_confirmations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_confirmations.task_id) AND (t.type = '1-1-shared'::text) AND (t.status = 'pending_confirmation'::text) AND (t.creator_id <> ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(t.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY task_confirmations_select_participant ON public.task_confirmations AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_confirmations.task_id) AND (t.type = '1-1-shared'::text) AND private.is_conversation_participant(t.conversation_id, ( SELECT auth.uid() AS uid))))));
CREATE POLICY avora_session_allowed ON public.task_dependencies AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_dependencies_delete_party ON public.task_dependencies AS PERMISSIVE FOR DELETE TO authenticated USING (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY task_dependencies_insert_party ON public.task_dependencies AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND private.can_link_task(task_id, ( SELECT auth.uid() AS uid)) AND private.can_view_task(depends_on_task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY task_dependencies_select_visible ON public.task_dependencies AS PERMISSIVE FOR SELECT TO authenticated USING ((private.can_view_task(task_id, ( SELECT auth.uid() AS uid)) AND private.can_view_task(depends_on_task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.task_files AS RESTRICTIVE FOR ALL TO authenticated USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_files_delete ON public.task_files AS PERMISSIVE FOR DELETE TO authenticated USING (private.task_file_deletable(task_id, uploaded_by, ( SELECT auth.uid() AS uid)));
CREATE POLICY task_files_insert ON public.task_files AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (storage_path ~~ ((task_id)::text || '/%'::text)) AND private.can_link_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY task_files_select ON public.task_files AS PERMISSIVE FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND private.can_view_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.task_flags AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_flags_delete_own ON public.task_flags AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY task_flags_insert_own ON public.task_flags AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.can_view_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY task_flags_select_own ON public.task_flags AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY task_flags_update_own ON public.task_flags AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_lists AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_lists_insert_participant ON public.task_lists AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'rich'::text)));
CREATE POLICY task_lists_select_participant ON public.task_lists AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY task_lists_update_participant ON public.task_lists AS PERMISSIVE FOR UPDATE TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))) WITH CHECK (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_participants AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_participants_select ON public.task_participants AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR private.can_view_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.task_reminders AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_reminders_delete_own ON public.task_reminders AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY task_reminders_insert_own ON public.task_reminders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.can_view_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY task_reminders_select_own ON public.task_reminders AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY task_reminders_update_own ON public.task_reminders AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_resources AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_resources_delete ON public.task_resources AS PERMISSIVE FOR DELETE TO authenticated USING (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY task_resources_insert ON public.task_resources AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND private.can_link_task(task_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY task_resources_select ON public.task_resources AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_task_private(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY task_resources_update ON public.task_resources AS PERMISSIVE FOR UPDATE TO authenticated USING (private.can_link_task(task_id, ( SELECT auth.uid() AS uid))) WITH CHECK (private.can_link_task(task_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_suggestions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_suggestions_select_participant ON public.task_suggestions AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.task_travel_plans AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY task_travel_plans_select_own ON public.task_travel_plans AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.tasks AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY tasks_delete_own_personal ON public.tasks AS PERMISSIVE FOR DELETE TO authenticated USING (((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY tasks_insert_creator ON public.tasks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((creator_id = ( SELECT auth.uid() AS uid)) AND (((type = 'personal'::text) AND (conversation_id IS NULL) AND (status = 'confirmed'::text)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND (status = 'pending_confirmation'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'rich'::text)));
CREATE POLICY tasks_select_visible ON public.tasks AS PERMISSIVE FOR SELECT TO authenticated USING (((pending_decision_id IS NULL) AND (((type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid))) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.conversation_is_live(conversation_id)))));
CREATE POLICY tasks_update_own_personal ON public.tasks AS PERMISSIVE FOR UPDATE TO authenticated USING (((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid)))) WITH CHECK (((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.think_hub_announcements AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_announcements_select ON public.think_hub_announcements AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_board_opened AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_board_opened_own_select ON public.think_hub_board_opened AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_cell_files AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_cell_files_delete ON public.think_hub_cell_files AS PERMISSIVE FOR DELETE TO authenticated USING (private.think_hub_cell_file_deletable(table_id, uploaded_by, ( SELECT auth.uid() AS uid)));
CREATE POLICY think_hub_cell_files_insert ON public.think_hub_cell_files AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (storage_path ~~ ((((table_id)::text || '/'::text) || (record_id)::text) || '/%'::text)) AND private.think_hub_cell_file_insertable(table_id, record_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY think_hub_cell_files_select ON public.think_hub_cell_files AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_change_log AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_change_log_select ON public.think_hub_change_log AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_conclusions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_conclusions_select ON public.think_hub_conclusions AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_delete_cascade AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avora_session_allowed ON public.think_hub_desk AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_desk_own_select ON public.think_hub_desk AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_nudges AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_nudges_own ON public.think_hub_nudges AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY think_hub_nudges_own_seen ON public.think_hub_nudges AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_record AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_record_select_scope ON public.think_hub_record AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_record_reminders AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_record_reminders_own ON public.think_hub_record_reminders AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_record_stars AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_record_stars_own ON public.think_hub_record_stars AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_record_tasks AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_record_tasks_select ON public.think_hub_record_tasks AS PERMISSIVE FOR SELECT TO authenticated USING ((private.can_view_task(task_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM think_hub_record r
  WHERE ((r.id = think_hub_record_tasks.record_id) AND private.think_hub_table_visible(r.table_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY avora_session_allowed ON public.think_hub_table AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_table_select_scope ON public.think_hub_table AS PERMISSIVE FOR SELECT TO authenticated USING (private.think_hub_scope_visible(owner_user_id, conversation_id, project_id, ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_table_seen AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_table_seen_own ON public.think_hub_table_seen AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY think_hub_table_seen_own_update ON public.think_hub_table_seen AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY think_hub_table_seen_own_write ON public.think_hub_table_seen AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.think_hub_table_visible(table_id, ( SELECT auth.uid() AS uid))));
CREATE POLICY avora_session_allowed ON public.think_hub_template AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_template_read ON public.think_hub_template AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY avora_session_allowed ON public.think_hub_user_template AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY think_hub_user_template_own ON public.think_hub_user_template AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.think_hub_view_row_meta AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY view_row_meta_own_delete ON public.think_hub_view_row_meta AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY view_row_meta_own_insert ON public.think_hub_view_row_meta AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY view_row_meta_own_select ON public.think_hub_view_row_meta AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY view_row_meta_own_update ON public.think_hub_view_row_meta AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.transactions AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY transactions_insert_own ON public.transactions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY transactions_select_own ON public.transactions AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY transactions_update_own ON public.transactions AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked())) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.vault_is_unlocked()));
CREATE POLICY avora_session_allowed ON public.user_aliases AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY user_aliases_own_delete ON public.user_aliases AS PERMISSIVE FOR DELETE TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_aliases_own_insert ON public.user_aliases AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_aliases_own_select ON public.user_aliases AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_aliases_own_update ON public.user_aliases AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.user_blocks AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY user_blocks_delete_own ON public.user_blocks AS PERMISSIVE FOR DELETE TO authenticated USING ((blocker_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_blocks_insert_own ON public.user_blocks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((blocker_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_blocks_select_own ON public.user_blocks AS PERMISSIVE FOR SELECT TO authenticated USING ((blocker_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.user_connections AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY user_connections_select_own ON public.user_connections AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_low) OR (( SELECT auth.uid() AS uid) = user_high)));
CREATE POLICY avora_session_allowed ON public.user_pins AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY user_pins_select_own ON public.user_pins AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.user_reports AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY user_reports_insert_own ON public.user_reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((reporter_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_reports_select_own ON public.user_reports AS PERMISSIVE FOR SELECT TO authenticated USING ((reporter_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY avora_session_allowed ON public.vault_files AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY vault_files_own ON public.vault_files AS PERMISSIVE FOR ALL TO authenticated USING (((owner_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked))) WITH CHECK (((owner_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked) AND (EXISTS ( SELECT 1
   FROM vault_items i
  WHERE ((i.id = vault_files.item_id) AND (i.owner_user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY avora_session_allowed ON public.vault_items AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY vault_items_own ON public.vault_items AS PERMISSIVE FOR ALL TO authenticated USING (((owner_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked))) WITH CHECK (((owner_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked)));
CREATE POLICY avora_session_allowed ON public.vault_keyring AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY avatars_owner_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY avatars_owner_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY avatars_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'avatars'::text) AND private.can_see_avatar(( SELECT auth.uid() AS uid), private.folder_uuid(name))));
CREATE POLICY avora_session_allowed ON storage.objects AS RESTRICTIVE FOR ALL TO public USING (( SELECT private.session_allowed() AS session_allowed)) WITH CHECK (( SELECT private.session_allowed() AS session_allowed));
CREATE POLICY board_files_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'board-files'::text) AND private.think_hub_cell_file_deletable(private.board_file_table(name), COALESCE(private.board_file_uploader(name), ( SELECT auth.uid() AS uid)), ( SELECT auth.uid() AS uid))));
CREATE POLICY board_files_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'board-files'::text) AND private.think_hub_table_visible(private.board_file_table(name), ( SELECT auth.uid() AS uid))));
CREATE POLICY board_files_write ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'board-files'::text) AND private.think_hub_cell_file_insertable(private.board_file_table(name), private.board_file_record(name), ( SELECT auth.uid() AS uid))));
CREATE POLICY chat_attachments_delete_own ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'chat-attachments'::text) AND (owner = ( SELECT auth.uid() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE (a.storage_path = objects.name))))));
CREATE POLICY chat_attachments_read_participants ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'chat-attachments'::text) AND (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE ((a.storage_path = objects.name) AND private.can_act_in(a.conversation_id, ( SELECT auth.uid() AS uid), 'sign'::text))))));
CREATE POLICY chat_attachments_write_participants ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'chat-attachments'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'::text) AND private.can_act_in(((storage.foldername(name))[1])::uuid, ( SELECT auth.uid() AS uid), 'send'::text) AND (NOT private.attachment_blocked(name, COALESCE((metadata ->> 'mimetype'::text), ''::text)))));
CREATE POLICY conversation_icons_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'conversation-icons'::text) AND private.can_act_in(private.folder_uuid(name), ( SELECT auth.uid() AS uid), 'read'::text)));
CREATE POLICY conversation_icons_write ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'conversation-icons'::text) AND (EXISTS ( SELECT 1
   FROM (conversation_participants cp
     JOIN conversations c ON ((c.id = cp.conversation_id)))
  WHERE ((cp.conversation_id = private.folder_uuid(objects.name)) AND (cp.user_id = ( SELECT auth.uid() AS uid)) AND (cp.role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (c.type = 'group'::text))))));
CREATE POLICY feedback_shots_delete_own ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'feedback-shots'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY feedback_shots_read_own_or_ops ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'feedback-shots'::text) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR ( SELECT private.is_ops(auth.uid()) AS is_ops))));
CREATE POLICY feedback_shots_write_own ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'feedback-shots'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (NOT private.attachment_blocked(name, COALESCE((metadata ->> 'mimetype'::text), ''::text)))));
CREATE POLICY keepsakes_owner_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'keepsakes'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY keepsakes_owner_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'keepsakes'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY keepsakes_owner_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'keepsakes'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY meeting_files_delete_own ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'meeting-files'::text) AND (owner = ( SELECT auth.uid() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM meeting_note_files f
  WHERE (f.storage_path = objects.name))))));
CREATE POLICY meeting_files_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'meeting-files'::text) AND (EXISTS ( SELECT 1
   FROM meeting_note_files f
  WHERE ((f.storage_path = objects.name) AND private.is_conversation_participant(f.conversation_id, ( SELECT auth.uid() AS uid)))))));
CREATE POLICY meeting_files_write ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'meeting-files'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'::text) AND ((storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'::text) AND (private.decision_conversation(((storage.foldername(name))[2])::uuid) = ((storage.foldername(name))[1])::uuid) AND private.can_manage_meeting_file(((storage.foldername(name))[2])::uuid, ( SELECT auth.uid() AS uid))));
CREATE POLICY my_book_covers_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'my-book-covers'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY my_book_covers_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'my-book-covers'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY my_book_covers_write ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'my-book-covers'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY note_files_delete_own ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'note-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (NOT (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE (a.storage_path = ('note-files:'::text || objects.name)))))));
CREATE POLICY note_files_read_own ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'note-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY note_files_read_shared ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'note-files'::text) AND (EXISTS ( SELECT 1
   FROM message_attachments a
  WHERE ((a.storage_path = ('note-files:'::text || objects.name)) AND private.can_act_in(a.conversation_id, ( SELECT auth.uid() AS uid), 'sign'::text))))));
CREATE POLICY note_files_write_own ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'note-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY public_domain_books_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'public-domain-books'::text));
CREATE POLICY receipts_delete_own ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'receipts'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND private.vault_is_unlocked()));
CREATE POLICY receipts_read_own ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'receipts'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND private.vault_is_unlocked()));
CREATE POLICY receipts_write_own ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'receipts'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND private.vault_is_unlocked()));
CREATE POLICY task_files_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'task-files'::text) AND private.can_view_task(private.task_file_task(name), ( SELECT auth.uid() AS uid))));
CREATE POLICY task_files_remove ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'task-files'::text) AND private.task_file_deletable(private.task_file_task(name), COALESCE(private.task_file_uploader(name), ( SELECT auth.uid() AS uid)), ( SELECT auth.uid() AS uid))));
CREATE POLICY task_files_write ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'task-files'::text) AND private.can_link_task(private.task_file_task(name), ( SELECT auth.uid() AS uid))));
CREATE POLICY vault_files_rw ON storage.objects AS PERMISSIVE FOR ALL TO authenticated USING (((bucket_id = 'vault-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked))) WITH CHECK (((bucket_id = 'vault-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND ( SELECT private.vault_is_unlocked() AS vault_is_unlocked)));
