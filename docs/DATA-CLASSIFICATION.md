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
- `conversation_participants` — internal; `last_read_at` = personal
- `conversation_groups` — personal
- `messages` — sensitive; `content` = sensitive
- `message_attachments` — sensitive; `file_name` = sensitive, `storage_path` = internal
- `message_reactions`, `message_pins`, `message_recall_request` — personal
- `mute_settings` — internal
- `group_invite_links` — secret; `token` = secret
- `group_removal_requests` — personal
- `group_decisions`, `group_decision_options` — sensitive
- `group_decision_votes` — personal
- `group_decision_grants` — internal

**personal** (danh bạ, việc, dự án, ghi chú)
- `contact` — sensitive (email, số điện thoại, địa chỉ, ghi chú của người khác)
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

**finance**
- `accounts` — sensitive; `balance`, `opening_balance`, `other_person_name` = sensitive
- `account_balance_history` — sensitive
- `transactions` — sensitive; `amount`, `amount_in_base_currency`, `amount_settled`, `description`, `receipt_url` = sensitive
- `crm_opportunity` — sensitive; `estimated_value` = sensitive
- `categories` — personal

**system**
- `currencies`, `currency_rates` — public
- `dismissed_guidance` — internal
- `user_reports` — **sensitive**; `reported_content`, `note` = sensitive (người báo cáo chỉ đọc lại báo cáo của mình; AVORA xem qua service role)
