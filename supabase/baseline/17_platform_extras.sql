-- auth.users triggers from prod (app-owned, not Supabase internals)
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER on_auth_user_created_invite AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.redeem_invite_on_signup();
CREATE TRIGGER on_auth_user_created_seed_categories AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION seed_finance_categories_for_new_user();
CREATE TRIGGER on_auth_user_created_task_categories AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION seed_task_categories_for_new_user();
-- storage.* triggers on prod are Supabase-internal (lifecycle/versioning) and are not reproduced.
-- RLS on platform tables + realtime policies from prod
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY avora_rt_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT private.session_allowed() AS session_allowed) AND private.realtime_topic_ok(( SELECT realtime.topic() AS topic))));
CREATE POLICY avora_rt_write ON realtime.messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT private.session_allowed() AS session_allowed) AND private.realtime_topic_ok(( SELECT realtime.topic() AS topic))));
-- cron job registry (stub table only; jobs never run locally)
INSERT INTO cron.job (jobname, schedule, command) VALUES
 ('avora_deliver_scheduled_messages','* * * * *','select private.deliver_due_scheduled_messages()'),
 ('avora_sweep_shared_proposals','7 * * * *','select private.sweep_shared_proposals()'),
 ('avora_sweep_dead_ends','17 * * * *','select private.sweep_dead_ends()'),
 ('avora_send_push','* * * * *','select private.call_send_push()'),
 ('avora_board_hourly','3 * * * *','select private.board_hourly()'),
 ('avora_device_sweep','*/15 * * * *','select private.device_sweep()'),
 ('avora_vault_daily','20 0 * * *','select private.vault_daily()'),
 ('avora_think_hub_trash_purge','40 0 * * *','select private.think_hub_trash_purge()'),
 ('avora_storage_sweep','27 * * * *','select private.call_storage_sweep()'),
 ('avora_book_covers','* * * * *','select private.call_book_covers()'),
 ('avora_sweep_expired_messages','* * * * *','select private.sweep_expired_messages()')
ON CONFLICT (jobname) DO NOTHING;
-- storage bucket config (bucket definitions only; no objects)
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('avatars','avatars','f',262144,'{image/jpeg}'),('board-files','board-files','f',26214400,NULL),
 ('book-covers','book-covers','t',204800,'{image/webp}'),('chat-attachments','chat-attachments','f',52428800,NULL),
 ('conversation-icons','conversation-icons','f',1048576,'{image/jpeg,image/png,image/webp}'),
 ('feedback-shots','feedback-shots','f',5242880,'{image/webp,image/jpeg,image/png}'),
 ('keepsakes','keepsakes','f',3145728,'{image/webp,image/jpeg}'),
 ('meeting-files','meeting-files','f',26214400,'{application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}'),
 ('my-book-covers','my-book-covers','f',512000,'{image/webp,image/jpeg}'),('note-files','note-files','f',26214400,NULL),
 ('picture-books','picture-books','t',5242880,'{image/jpeg,image/png,image/webp,image/gif}'),
 ('public-domain-books','public-domain-books','f',NULL,NULL),
 ('receipts','receipts','f',10485760,'{image/png,image/jpeg,image/webp,image/heic,application/pdf}'),
 ('task-files','task-files','f',26214400,NULL),('vault-files','vault-files','f',21000000,'{application/octet-stream}')
ON CONFLICT DO NOTHING;
-- realtime publication (prod: supabase_realtime, insert/update/delete/truncate)
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE public.conversation_participants, public.conversation_read_marks,
  public.group_removal_requests, public.message_deliveries, public.messages, public.shared_proposal_votes,
  public.shared_proposals, public.task_suggestions, public.tasks;
