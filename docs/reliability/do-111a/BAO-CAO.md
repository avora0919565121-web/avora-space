# Báo cáo 111-A · Xoá tài khoản trong app (09/11/2026)

ADR-092. Cờ `account_deletion`: `hidden` → **`stable`** (migration `20261109092000_avora111a_feature_stable.sql`, sau khi đạt cổng bên dưới).

**Lỗi mức "Mất dữ liệu" / "Gửi nhầm" còn lại: 0.** Không đẩy GitHub được từ đây (git chỉ đọc; Rork tự commit cuối lượt, không đặt được tên commit theo mã khối).

## 1. Cổng kiểm

| Bộ | Trước 111-A | Sau 111-A |
|---|---|---|
| Browser | 925 / 925 | **933 / 933** (+8: `avora111a-account-deletion.browser.test.tsx`) |
| Unit | 2.351 / 2.351 | **2.360 / 2.360** (+9: `avora111a-deleted-user.test.ts`) |
| SQL | 30 / 30 | **31 / 31** (+`avora111a_account_deletion.sql`, 9 mục) |
| Lint | ≤ 61 cảnh báo | **61** |
| tsc · build · runChecks | sạch | sạch |
| Advisor | bảo mật 318 · hiệu năng 124 | bảo mật **318** (0 mục mới của 111-A) · hiệu năng **114** |

Test cũ phải sửa vì thêm khoá thứ 30: `avora112b.test.ts` (đọc thêm khoá gieo ở migration 111-A), `avora112b.browser.test.tsx` (29 → 30 dòng ở màn quản trị). `scroll-x-guard`: hai vùng cuộn mới có `overflow-x-hidden`, danh sách nền không tăng.

## 2. Đỏ trước, xanh sau

| Lớp | Đỏ (trước) | Xanh (sau) | Tệp |
|---|---|---|---|
| SQL | `PROBE RED · B thấy 1-1=0/5, nhóm=0/5 · nhóm còn sidecar=f` — xoá người dùng kéo theo **mọi tin** họ gửi trong cuộc chung (FK CASCADE), nhóm mất chủ | `AVORA111A failures=0`, 9/9 | `red-before.sql` · `red-before-sql.txt` · `green-after-sql.txt` |
| Unit | 2 failed: `expected 'object' to be 'string'` (tin người gửi null), `expected true to be false` (Chính sách vẫn ghi tự xoá là "sắp có") | 2 passed | `red-before-unit.txt` · `green-after-unit.txt` |
| Browser | Chưa có luồng (không có nút, không có màn chờ) | 8/8 | `web/src/test/avora111a-account-deletion.browser.test.tsx` |

Ghi chú browser: lần đầu 5 bài sau bị đỏ do **chính bài kiểm** (gọi `render` lại sau khi tự `unmount` làm khung test trống) — sửa bằng `rerender` với `key` mới, không phải lỗi app.

## 3. Probe mục 1 / 2 / 3 (SQL test, giao dịch rollback)

- **Mục 1 · tin chung:** B vẫn thấy 5 tin 1-1 + 5 tin nhóm của A, người gửi rỗng → app hiện "Người dùng đã xoá"; tệp đính kèm của A vào hàng đợi xoá Storage; tin hẹn giờ của A bị xoá; báo cáo vi phạm giữ bản sao (người báo / bị báo = null).
- **Mục 2 · nhóm:** quản trị viên nhận chủ (cả `conversation_groups.owner_id` và vai trò thành viên); nhóm chỉ có A và Nhật ký riêng bị xoá; dự án nhóm chuyển cho C, việc nhóm chuyển cho B.
- **Mục 3 · PIN:** PIN của A vào `private.retired_pins`, `check_user_pin` trả `taken`, không còn trong `user_pins`.
- **Quét uuid:** không còn uid cũ ở bất kỳ cột uuid nào.

## 4. Thử đầu-cuối thật (máy chủ live, 09/11)

User tạm `e2e111a` (email để trống để không gửi thư ra ngoài) + 1 ghi chú + yêu cầu đến hạn → `private.call_delete_account()` → pg_net → Edge Function `delete-account`.

1. Lần 1: `{"batch":1,"done":0,"failed":1}` — DB đã xử lý xong (`status=done`, 1 dòng nhật ký) nhưng API quản trị từ chối xoá user. Nguyên nhân: user tạo thẳng bằng SQL có cột token `NULL`, GoTrue không đọc được — chỉ xảy ra với user tạo tay, không với tài khoản đăng ký thật.
2. Điền token rỗng, gọi lại: lô sau **làm tiếp** đúng thiết kế chạy lại an toàn → `auth.users` 0, ghi chú 0, yêu cầu 0, nhật ký vẫn **1 dòng** (không ghi đôi), nhật ký không có uid / email: `{"reason":"self","method":"password","counts":{"conversations_removed":1,...}}`.
3. Probe `probe-after.sql`: quét **367 cột uuid** ở `public`, `private`, `storage` + `storage.objects` theo đường dẫn / owner + `auth.users` + `auth.identities` → `hits=[]` (`probe-after.txt`).

## 5. Bảng · cột · xử lý · probe rỗng

Live có **131** khoá ngoại tới `auth.users` trong `public` / `private` / `storage`: 112 cascade, 16 set null, 3 no action. Cột "Probe rỗng" = probe mục 4 (367 cột uuid, 0 sót).

| Bảng | Cột | Xử lý | Probe rỗng |
|---|---|---|---|
| `messages` | `sender_id` | **Đổi sang SET NULL** (111-A); tin chữ ở lại trong cuộc còn người; tin chỉ có tệp → thu hồi | ✓ |
| `messages` | `origin_sender_id`, `contact_card_user_id` | SET NULL (có từ trước) | ✓ |
| `user_reports` | `reporter_id`, `reported_user_id` | **Đổi sang SET NULL** (111-A); báo cáo giữ bản sao nội dung | ✓ |
| `message_attachments` | `attached_by` | Xoá dòng; file vào `storage_delete_queue` (`account_deleted`) trừ đường dẫn còn bản khác dùng | ✓ |
| `scheduled_messages` | `sender_id` | Xoá | ✓ |
| `conversation_participants` | `user_id` | Rời các cuộc còn người; cuộc không còn ai → xoá cả cuộc | ✓ |
| `conversation_groups` | `owner_id` | Chuyển chủ: quản trị viên → thành viên lâu nhất | ✓ |
| `projects`, `group_decisions`, `task_lists`, `meeting_note_files` | `created_by` / `uploaded_by` | Chuyển cho người kế trong cuộc | ✓ |
| `tasks` | `creator_id` | Việc nhóm → người được giao hoặc người kế; việc riêng → cascade | ✓ |
| `tasks` | `assignee_id`, `confirmed_by` | SET NULL | ✓ |
| `think_hub_table` / `_record` / `_cell_files` / `_conclusions` | `owner_user_id` / `uploaded_by` / `created_by` | Bảng của cuộc / dự án → người kế; bảng riêng → cascade; file → hàng đợi `board-files` | ✓ |
| `project_success_criteria`, `project_tasks`, `think_hub_record_tasks`, `task_files`, `task_resources`, `task_dependencies` | `created_by` / `linked_by` / `uploaded_by` | Chuyển cho chủ dự án / bảng / việc; còn lại xoá | ✓ |
| `group_invite_links` | `created_by` | Xoá (FK no action) | ✓ |
| `group_removal_requests` | `requested_by`, `target_user_id`, `resolved_by` | Xoá / null (FK no action — trước đây chặn xoá user) | ✓ |
| `contact` | `linked_user_id` | SET NULL — danh bạ của người khác chỉ mất liên kết | ✓ |
| `feedback` | `user_id` | SET NULL — góp ý giữ ẩn danh | ✓ |
| `conversation_appearance`, `conversations`, `disappear_proposals`, `group_decisions`, `projects`, `think_hub_change_log`, `think_hub_table` | `updated_by`, `verification_opened_by`, `answered_by`, `settled_by`, `deleted_by`, `record_owner_id`, `archived_by` | SET NULL | ✓ |
| `user_pins` | `user_id` | PIN chép vào `private.retired_pins` trước, rồi cascade | ✓ |
| Không có khoá ngoại: `private.blocked_sessions`, `private.chat_rate_events`, `private.device_alarm_log`, `private.vault_proof_attempts`, `client_errors`, `shared_proposals.target_id` | `user_id` / `target_id` | Xoá trong `account_purge` | ✓ |
| Không có khoá ngoại: `contact_link_changes.linked_user_id`, `user_connections.removed_by`, `app_features.updated_by`, `app_feature_changes.changed_by` | — | Đặt null | ✓ |
| `storage.objects` | `{uid}/…` ở mọi bucket riêng | Edge Function xoá trực tiếp; thumbnail mồ côi bị quét sau 24 giờ | ✓ |
| `auth.users` | `id` | API quản trị (Edge Function) | ✓ |
| 112 bảng cascade còn lại | xem dưới | Xoá theo cascade khi xoá `auth.users` | ✓ |

**Bảng còn sót:** không có (probe 367 cột = 0).

Cascade (112): `private.account_otp_codes.user_id`, `private.account_reauth.user_id`, `private.activity_pruned.user_id`, `private.connection_attempts.user_id`, `private.contact_merge_log.owner_user_id`, `private.contact_not_duplicate.owner_user_id`, `private.device_action_tokens.user_id`, `private.device_challenges.user_id`, `private.password_checks.user_id`, `private.urgent_locks.user_id`, `private.urgent_usage.user_id`, `private.vault_attempts.user_id`, `private.vault_device_shares.user_id`, `private.vault_pass_sessions.user_id`, `private.vault_proofs.user_id`, `private.vault_reset_codes.user_id`, `private.vault_secrets.user_id`, `private.vault_unlocks.user_id`, `private.verification_declines.decliner_id`, `private.verification_declines.opener_id`, `account_deletion_requests.user_id`, `account_device_lock.user_id`, `account_devices.user_id`, `accounts.user_id`, `activity_daily.user_id`, `book_my_covers.user_id`, `book_reading_state.user_id`, `book_text_hits.user_id`, `categories.user_id`, `contact.owner_user_id`, `contact_card_notice.introduced_user_id`, `contact_card_notice.introducer_id`, `contact_channel.owner_user_id`, `contact_invite.invited_by`, `contact_link_changes.owner_user_id`, `conversation_archives.user_id`, `conversation_member_prefs.user_id`, `conversation_participants.user_id`, `conversation_pins.user_id`, `conversation_read_marks.user_id`, `conversation_verification_confirms.user_id`, `crm_opportunity.owner_user_id`, `disappear_proposals.proposed_by`, `dismissed_guidance.user_id`, `family_relations.related_user_id`, `family_relations.user_id`, `group_decision_grants.granted_by`, `group_decision_grants.grantee_id`, `group_decision_votes.voter_id`, `group_decisions.created_by`, `habit_logs.user_id`, `habits.user_id`, `meeting_note_files.uploaded_by`, `message_attachments.attached_by`, `message_deliveries.user_id`, `message_pins.pinned_by`, `message_reactions.user_id`, `message_recall_request.requested_by`, `mute_settings.user_id`, `note_attachments.owner_user_id`, `note_folders.owner_user_id`, `notes.owner_user_id`, `profiles.id`, `project_check_adjust.owner_id`, `project_success_criteria.created_by`, `project_tasks.linked_by`, `projects.created_by`, `push_outbox.user_id`, `push_subscriptions.user_id`, `scheduled_messages.sender_id`, `shared_proposal_votes.user_id`, `shared_proposals.proposed_by`, `storage_usage.user_id`, `task_categories.user_id`, `task_confirmations.user_id`, `task_files.uploaded_by`, `task_flags.user_id`, `task_participants.invited_by`, `task_participants.user_id`, `task_reminders.user_id`, `task_resources.created_by`, `task_suggestions.assignee_id`, `task_suggestions.proposer_id`, `task_travel_plans.user_id`, `tasks.creator_id`, `think_hub_announcements.actor_id`, `think_hub_board_opened.user_id`, `think_hub_cell_files.uploaded_by`, `think_hub_change_log.actor_id`, `think_hub_conclusions.created_by`, `think_hub_desk.user_id`, `think_hub_nudges.actor_id`, `think_hub_nudges.user_id`, `think_hub_record.owner_user_id`, `think_hub_record_reminders.user_id`, `think_hub_record_stars.user_id`, `think_hub_record_tasks.linked_by`, `think_hub_table.owner_user_id`, `think_hub_table_seen.user_id`, `think_hub_user_template.owner_user_id`, `think_hub_view_row_meta.user_id`, `transactions.user_id`, `user_aliases.owner_user_id`, `user_aliases.target_user_id`, `user_blocks.blocked_id`, `user_blocks.blocker_id`, `user_connections.user_high`, `user_connections.user_low`, `user_pins.user_id`, `vault_files.owner_user_id`, `vault_items.owner_user_id`, `vault_keyring.user_id`

## 6. Giới hạn và việc còn lại

- **OTP chỉ qua email.** App chưa có đăng nhập bằng số điện thoại, nên chưa có kênh SMS; mọi tài khoản hiện đều có email.
- **Demo ≤ 5 phút chưa đạt:** cron chạy mỗi giờ. Tài khoản demo (111-C) sẽ có thời gian chờ ngắn và lịch chạy riêng.
- **Chính sách "nhà hoang"** (ADR-019) chưa áp dụng; khi làm thì dùng cùng `account_purge` (lý do `abandoned`), Chính sách ghi "chưa áp dụng".
- Chính sách quyền riêng tư (mục Dữ liệu) đã sửa: tự xoá tài khoản = đã có; chưa đổi `POLICY_VERSION`.
- **LOI-13 đã đóng:** xoá cứng 99 ghi chú lặp (VMT duyệt) — `public.notes` 105 → 6, đã xoá mềm 99 → 0 (sửa dữ liệu thật, ghi ở đây và `LOI.md`).
- Dữ liệu thật khác đã sửa: tạo rồi xoá hẳn user tạm `e2e111a` (không còn dấu vết, probe ở trên).

## 7. Việc VMT cần làm

1. Thử máy thật theo `THU-MAY-THAT.md` mục **D** (D1–D6). D5 cần một tài khoản dùng một lần — đừng xoá testera / testerb.
2. **Thu hồi khoá Supabase** (access token đã dùng trong đợt này) và cấp khoá mới.
