# Phân loại dữ liệu AVORA (RFC-AVORA-TRUST-001 §24.3)

Nguồn chuẩn: `web/src/lib/data-classification.ts`. Test `data-classification.test.ts` đỏ khi
`integrations/supabase/types.ts` có bảng chưa được phân loại. File này là bản đọc cho người —
khi hai bên lệch nhau, file code là đúng.

## Mức

- **public** — ai xem cũng được (dữ liệu tham chiếu).
- **internal** — định danh, cài đặt. Vô hại khi đứng riêng, nhưng không cho người lạ. PIN thuộc mức này (ADR-019: PIN là định danh, không phải bí mật).
- **personal** — về một người hoặc cách họ sắp xếp việc của mình.
- **sensitive** — điều người ta nói, sở hữu hoặc nợ: nội dung tin nhắn, tiền, thông tin liên hệ.
- **secret** — tự nó cấp được quyền truy cập (token mời). Không bao giờ ghi log.

## Miền

`identity` · `connect` · `personal` · `finance` · `vault` · `system`

## Bảng

**identity**
- `profiles` — personal
- `user_pins` — internal; `pin` = internal
- `family_relations` — personal
- `user_blocks` — personal (chỉ người chặn đọc được; người bị chặn không bao giờ biết)

**connect**
- `conversations` — internal
- `conversation_participants` — internal (cột `last_read_at` đã bỏ, Đợt gộp 2 · B3)
- `conversation_read_marks` — personal (RLS chỉ dòng của chính mình, ADR-028)
- `scheduled_messages` — personal; `content` = sensitive (chỉ người gửi thấy trước giờ gửi)
- `shared_proposals`, `shared_proposal_votes` — internal; `reason` = sensitive (ADR-031, đọc theo cuộc trò chuyện)
- `conversation_groups` — personal
- `messages` — sensitive; `content` = sensitive; `trashed_at` = internal (Thùng rác Nhật ký, 30 ngày)
- `message_attachments` — sensitive; `file_name` = sensitive, `storage_path` = internal
- `message_reactions`, `message_pins`, `message_recall_request` — personal; `message_recall_request.close_reason` = internal (hết hạn 30 ngày / tự khép khi chặn)
- `mute_settings` — internal
- `group_invite_links` — secret; `token` = secret; `expires_at` = internal (hết hạn 7 ngày)
- `group_removal_requests` — personal
- `group_decisions`, `group_decision_options` — sensitive
- `group_decision_votes` — personal
- `group_decision_grants` — internal

**personal** (danh bạ, việc, dự án, ghi chú)
- `contact` — sensitive (email, số điện thoại, địa chỉ, ghi chú của người khác); `needs_details` = internal
- `contact_channel` — sensitive; `value` = sensitive
- `contact_invite` — secret; `invite_token` = secret
- `tasks` — personal; `description`, `context_snapshot`, `output_value` = sensitive
- `task_suggestions` — personal; `proposed_description`, `context_snapshot` = sensitive
- `task_resources` — personal; `content` = sensitive
- `task_reminders`, `task_flags`, `task_categories`, `task_lists`, `checklist_items` — personal
- `task_participants`, `task_confirmations`, `task_dependencies`, `task_celebrations`, `task_celebration_views`, `context_task_list_settings` — internal
- `projects`, `project_success_criteria`, `project_check_adjust` — personal
- `project_tasks` — internal
- `meeting_note_details`, `meeting_note_files` — sensitive (`storage_path` = internal)
- `think_hub_table`, `think_hub_record` — personal; `think_hub_record.notes` = sensitive
- `think_hub_record_tasks` — internal
- `think_hub_template` — public (mẫu hệ thống); `think_hub_user_template` — personal ("Mẫu của tôi", chỉ cấu trúc, chỉ chủ đọc)
- `note_folders`, `notes`, `note_attachments` — personal, chỉ chủ (Ghi chép, AVORA-44); `notes.blocks/title/search_text`, `note_attachments.file_name` = sensitive; tệp ở bucket riêng tư `note-files` (thư mục của chủ)
- `think_hub_record_stars` — personal (sao chỉ của người đánh)
- `think_hub_cell_files` — personal, thành viên Bảng đọc; chỉ người tải lên hoặc chủ Bảng xoá; `file_name` = sensitive; tệp ở bucket riêng tư `board-files` (AVORA-61 · D)
- `think_hub_change_log` — personal, chỉ thành viên Bảng chung đọc, giữ 90 ngày; `before/after` = sensitive (AVORA-62)
- `think_hub_record_reminders` — personal, chỉ người đặt nhắc đọc (AVORA-69)
- `user_aliases` — personal, chỉ chủ đọc/ghi, không vào realtime; `alias` = sensitive (AVORA-71 · E)
- `think_hub_record.contact_labels` — tên liên hệ người chọn đưa vào Bảng chung (chỉ tên + người chọn, không số/email; server ghi) (AVORA-65 · E)
- `think_hub_announcements`, `think_hub_nudges` — personal (thẻ báo nhóm; dòng nhắc riêng chỉ người nhận đọc); `think_hub_table_seen` — internal (lần cuối mỗi người mở Bảng)
- `think_hub_delete_cascade` — internal (sổ ghi việc đi theo khi xoá Bảng, để khôi phục)
- `think_hub_conclusions` — personal, `body` = sensitive; thành viên Bảng đọc, chỉ thêm qua `set_board_conclusion` (AVORA-77 · A4). `think_hub_table.thinking_type / lifecycle` — internal
- `book_catalog` — public (danh mục sách công cộng; chỉ service_role ghi). `book_reading_state` — personal, chỉ chủ đọc. `book_text_hits` — internal (giới hạn 30 lần/giờ, không client nào đọc, xoá sau 1 ngày). Storage `public-domain-books` — public-domain text đã làm sạch, không bao giờ lưu bản dịch (AVORA-77 · D)
- `think_hub_view_row_meta` — personal, chỉ chủ; `note` sensitive, `note_sealed` (bảng Két sắt) mã hoá trên máy, máy chủ không đọc được (AVORA-81 · 78). `think_hub_desk` — personal, chỉ chủ (Bàn nghĩ, tối đa 5). `profiles.prefs` — personal (bảng ẩn, cách bày, cài đặt đọc). `profiles.quiet_reading_until` — personal. `book_catalog.title_vi` — public.
- `think_hub_board_opened` — personal, chỉ chủ (lần mở cuối của từng Bảng, AVORA-89 · 1.5). `contact_card_notice` — personal, chỉ người được giới thiệu đọc (`@@`, AVORA-89). `messages.refs` (id tệp/Hạng mục cùng bối cảnh) và `messages.contact_card_user_id` (chỉ id; tên + PIN đọc lúc xem) — theo mức của `messages`.
- `think_hub_table.sync_source / hidden_in_list / sync_hidden`, `think_hub_record.opportunity_id` — internal (bảng đồng bộ AVORA-72)

**identity — thiết bị (AVORA-67)**
- `account_devices` — **confidential/personal**, chỉ chủ đọc, không ai ghi trực tiếp; `device_public_key` không trả về client
- `account_device_lock` — personal, chỉ chủ đọc
- `private.device_action_tokens` — **secret** (băm SHA-256, dùng 1 lần); `private.device_challenges`, `private.blocked_sessions`, `private.retired_pins` — internal, không client nào đọc

**vault — mã hoá (AVORA-68)**
- `vault_keyring`, `vault_items`, `vault_files`, bucket `vault-files` — **secret** (chỉ ciphertext + bản bọc); `vault_items.reminder_title` = sensitive (chỉ khi chủ bật), `remind_on` = personal
- `private.vault_device_shares`, `private.vault_proofs` — **secret**, không client nào đọc
- `private.argon_bench` — internal, ẩn danh (không gắn tài khoản)
- `message_attachments.capture_source` — internal (AVORA-73)

**finance**
- `accounts` — sensitive; `balance`, `opening_balance`, `other_person_name` = sensitive; `removed_at` = internal (Thùng rác)
- `account_balance_history` — sensitive
- `transactions` — sensitive; `amount`, `amount_in_base_currency`, `amount_settled`, `description`, `receipt_url` = sensitive; `removed_at`, `removed_with_account` = internal
- `crm_opportunity` — sensitive; `estimated_value`, `next_action_note` = sensitive; `removed_at`, `last_contact_at` = internal; `contact_snapshot` (tên khi liên hệ đã xoá) = sensitive
- `categories` — personal

**system**
- `currencies`, `currency_rates` — public
- `dismissed_guidance` — internal
- `user_reports` — **sensitive**; `reported_content`, `note` = sensitive (người báo cáo chỉ đọc lại báo cáo của mình; AVORA xem qua service role)
- `push_subscriptions` — personal, chỉ chủ đọc / gỡ; `endpoint`, `p256dh`, `auth` = secret (AVORA-46)
- `push_outbox` — internal, chỉ chủ đọc; ghi và gửi chỉ qua server (service role)
- `profiles.push_show_content`, `profiles.push_reminders` — internal
- `profiles.color_scheme`, `profiles.accent_tone` — internal (AVORA-74: Sắc màu / Tông màu; không suy từ tuổi)

- `activity_daily` — personal, chỉ chủ (lần mở + giây dùng thật theo ngày, 180 ngày, AVORA-93 · ADR-058). `notes.book_locator` — theo mức của `notes`. `app_config` — internal (cờ dịch). `book_edition_link` — public (cặp ấn bản phạm vi công cộng).
- `think_hub_record.archived_at` — personal (theo mức của `think_hub_record`; mục đã cất, AVORA-100 · V). `think_hub_template.is_foundation` — public (mẫu hệ thống). `profiles.prefs.template_audiences` — personal (vai trò người dùng tự chọn; chỉ dùng xếp mẫu, không hiện ở hồ sơ, không chia sẻ, không suy đoán). `profiles.prefs.cleanup_seen_week` — internal. `my_storage_usage()` — chỉ trả số và tên file của chính người gọi.
