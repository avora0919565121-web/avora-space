/**
 * Data classification (RFC-AVORA-TRUST-001 §24.3).
 *
 * Every table in `integrations/supabase/types.ts` has a level and a domain here. A test reads
 * the generated types and fails when a table is missing, so a new table cannot ship without
 * someone deciding how sensitive it is. The human-readable copy lives in
 * `docs/DATA-CLASSIFICATION.md`.
 *
 * Levels, lowest to highest:
 *  - public:    safe for anyone (reference data).
 *  - internal:  identifiers and settings; harmless alone, not for strangers (ADR-019: a PIN is
 *               an identifier, not a secret).
 *  - personal:  about a person or their own organisation of work.
 *  - sensitive: what people say, own or owe — message text, money, contact details.
 *  - secret:    grants access by itself (bearer tokens). Never logged, never shown twice.
 */
export type DataLevel = "public" | "internal" | "personal" | "sensitive" | "secret";

export type DataDomain = "identity" | "connect" | "personal" | "finance" | "vault" | "system";

export type TableClassification = {
  level: DataLevel;
  domain: DataDomain;
  /** Columns that sit above (or, rarely, below) the table's own level. */
  columns?: Readonly<Record<string, DataLevel>>;
};

export const DATA_CLASSIFICATION = {
  // identity
  profiles: {
    level: "personal",
    domain: "identity",
    columns: { display_name: "personal", avatar_url: "personal", push_show_content: "internal", push_reminders: "internal", focus_mode: "internal", focus_until: "internal" },
  },
  user_pins: { level: "internal", domain: "identity", columns: { pin: "internal" } },
  family_relations: { level: "personal", domain: "identity" },
  dismissed_guidance: { level: "internal", domain: "system" },
  // Who blocked whom is visible only to the blocker; the blocked person must never learn it.
  user_blocks: { level: "personal", domain: "identity" },
  // Who is bạn with whom (ADR-029). `removed_by` is never readable by the client.
  user_connections: { level: "personal", domain: "identity", columns: { removed_by: "sensitive" } },
  // Reports carry a copy of the reported message, read only by AVORA (service role).
  user_reports: {
    level: "sensitive",
    domain: "system",
    columns: { reported_content: "sensitive", note: "sensitive" },
  },

  // connect
  conversations: { level: "internal", domain: "connect" },
  conversation_participants: { level: "internal", domain: "connect" },
  // Đợt gộp 2 · B3: read marks, owner-only RLS (ADR-028). Replaces conversation_participants.last_read_at.
  conversation_read_marks: { level: "personal", domain: "connect" },
  conversation_groups: { level: "personal", domain: "connect" },
  // Each side's "Đồng ý" inside a verification frame.
  conversation_verification_confirms: { level: "internal", domain: "connect" },
  // B2: messages waiting to be sent — the sender's only until delivery (owner-only RLS).
  scheduled_messages: { level: "personal", domain: "connect", columns: { content: "sensitive" } },
  // B1: forward_bundle carries forwarded words + public names only.
  // AVORA-44 · A.5: trashed_at = a journal entry in the bin (30 days).
  messages: { level: "sensitive", domain: "connect", columns: { content: "sensitive", forward_bundle: "sensitive", trashed_at: "internal" } },
  message_attachments: {
    level: "sensitive",
    domain: "connect",
    columns: { file_name: "sensitive", storage_path: "internal" },
  },
  message_reactions: { level: "personal", domain: "connect" },
  message_pins: { level: "personal", domain: "connect" },
  // Đợt gộp 2 · D4: an ask closes itself after 30 days or when the two people block each other.
  message_recall_request: { level: "personal", domain: "connect", columns: { close_reason: "internal" } },
  mute_settings: { level: "internal", domain: "connect" },
  // AVORA-47 · E: when a 1-1 message reached the other device; only the sender reads it (ADR-028).
  message_deliveries: { level: "personal", domain: "connect" },
  // AVORA-47 · F: which conversations I tucked away; only I see my own rows.
  conversation_archives: { level: "personal", domain: "connect" },
  // Vá 29/09: links expire after 7 days; the expiry itself is harmless metadata.
  group_invite_links: { level: "secret", domain: "connect", columns: { token: "secret", expires_at: "internal" } },
  group_removal_requests: { level: "personal", domain: "connect" },
  group_decisions: { level: "sensitive", domain: "connect", columns: { title: "sensitive", body: "sensitive" } },
  group_decision_options: { level: "sensitive", domain: "connect" },
  group_decision_votes: { level: "personal", domain: "connect" },
  group_decision_grants: { level: "internal", domain: "connect" },

  // contacts & CRM (people the user knows — their details are someone else's personal data)
  contact: {
    level: "sensitive",
    domain: "personal",
    columns: {
      email: "sensitive",
      phone: "sensitive",
      business_address: "sensitive",
      representative_email: "sensitive",
      representative_phone: "sensitive",
      note: "sensitive",
      // Đợt gộp 2 · D5: a name-only contact made from a picker, listed under Cần xem lại.
      needs_details: "internal",
    },
  },
  contact_channel: { level: "sensitive", domain: "personal", columns: { value: "sensitive", value_normalized: "sensitive" } },
  contact_invite: { level: "secret", domain: "personal", columns: { invite_token: "secret" } },
  crm_opportunity: { level: "sensitive", domain: "finance", columns: { estimated_value: "sensitive" } },

  // personal work: tasks, projects, notes
  tasks: {
    level: "personal",
    domain: "personal",
    columns: { description: "sensitive", context_snapshot: "sensitive", output_value: "sensitive" },
  },
  task_suggestions: {
    level: "personal",
    domain: "personal",
    columns: {
      proposed_description: "sensitive",
      context_snapshot: "sensitive",
      // AVORA-39 Phần 3 · D4: where the proposer wants the person to be.
      proposed_location: "sensitive",
    },
  },
  // AVORA-39 Phần 3 · D3: the assignee's own travel for a task from a suggestion. Owner-only RLS.
  task_travel_plans: { level: "personal", domain: "personal" },
  task_participants: { level: "internal", domain: "personal" },
  task_confirmations: { level: "internal", domain: "personal" },
  task_dependencies: { level: "internal", domain: "personal" },
  task_reminders: { level: "personal", domain: "personal" },
  task_resources: { level: "personal", domain: "personal", columns: { content: "sensitive" } },
  task_flags: { level: "personal", domain: "personal" },
  task_categories: { level: "personal", domain: "personal" },
  task_lists: { level: "personal", domain: "personal" },
  task_celebrations: { level: "internal", domain: "personal" },
  task_celebration_views: { level: "internal", domain: "personal" },
  checklist_items: { level: "personal", domain: "personal" },
  context_task_list_settings: { level: "internal", domain: "personal" },
  projects: { level: "personal", domain: "personal" },
  project_tasks: { level: "internal", domain: "personal" },
  project_success_criteria: { level: "personal", domain: "personal" },
  project_check_adjust: { level: "personal", domain: "personal" },
  meeting_note_details: { level: "sensitive", domain: "personal" },
  meeting_note_files: { level: "sensitive", domain: "personal", columns: { storage_path: "internal" } },
  think_hub_table: { level: "personal", domain: "personal" },
  think_hub_record: { level: "personal", domain: "personal", columns: { notes: "sensitive" } },
  think_hub_record_tasks: { level: "internal", domain: "personal" },
  // Đợt gộp 2 · C: system templates are public structure; "Mẫu của tôi" is structure only, owner-only.
  think_hub_template: { level: "public", domain: "personal" },
  think_hub_user_template: { level: "personal", domain: "personal" },
  // Each person's own ★, never shown to anyone else.
  think_hub_record_stars: { level: "personal", domain: "personal" },
  // Which tasks a table deletion binned — server-only bookkeeping, no client access.
  think_hub_delete_cascade: { level: "internal", domain: "personal" },
  // AVORA-44 · B: Ghi chép — owner-only, what the person writes to read again.
  note_folders: { level: "personal", domain: "personal" },
  notes: { level: "personal", domain: "personal", columns: { blocks: "sensitive", title: "sensitive", search_text: "sensitive", tags: "personal" } },
  note_attachments: { level: "personal", domain: "personal", columns: { file_name: "sensitive", storage_path: "internal" } },
  // AVORA-46: this device's push address, and the queue of what will be sent.
  push_subscriptions: { level: "personal", domain: "system", columns: { endpoint: "secret", p256dh: "secret", auth: "secret" } },
  push_outbox: { level: "internal", domain: "system", columns: { payload: "personal" } },
  // ADR-031 proposals: readable by the conversation they belong to; the reason is free text.
  shared_proposals: { level: "internal", domain: "connect", columns: { reason: "sensitive" } },
  shared_proposal_votes: { level: "internal", domain: "connect", columns: { reason: "sensitive" } },

  // finance
  accounts: {
    level: "sensitive",
    domain: "finance",
    columns: { balance: "sensitive", opening_balance: "sensitive", other_person_name: "sensitive", removed_at: "internal" },
  },
  account_balance_history: { level: "sensitive", domain: "finance", columns: { balance: "sensitive" } },
  transactions: {
    level: "sensitive",
    domain: "finance",
    columns: {
      amount: "sensitive",
      amount_in_base_currency: "sensitive",
      amount_settled: "sensitive",
      description: "sensitive",
      receipt_url: "sensitive",
      // Đợt gộp 2 · D2: the finance bin.
      removed_at: "internal",
      removed_with_account: "internal",
    },
  },
  categories: { level: "personal", domain: "finance" },

  // AVORA-51 · Két sắt lock (ADR-034). Schema `private`: no grant to any client role, read only by
  // SECURITY DEFINER functions. Listed here so the classification covers them even though
  // they never appear in the generated public types.
  vault_secrets: { level: "secret", domain: "vault", columns: { code_hash: "secret" } },
  vault_unlocks: { level: "secret", domain: "vault", columns: { session_id: "secret" } },
  vault_attempts: { level: "secret", domain: "vault" },
  vault_reset_codes: { level: "secret", domain: "vault", columns: { code_hash: "secret" } },
  password_checks: { level: "internal", domain: "identity" },
  currencies: { level: "public", domain: "system" },
  currency_rates: { level: "public", domain: "system" },
} as const satisfies Readonly<Record<string, TableClassification>>;

export type ClassifiedTable = keyof typeof DATA_CLASSIFICATION;

/** Table names under `public.Tables` in a generated Supabase types file. */
export function tablesInGeneratedTypes(source: string): string[] {
  const publicBlock = source.split(/\n {2}public: \{/)[1] ?? "";
  const tablesBlock = publicBlock.split("Tables: {")[1]?.split(/\n {4}Views: \{/)[0] ?? "";
  const names: string[] = [];
  const pattern = /^ {6}([a-z_0-9]+): \{\n {8}Row: \{/gm;
  let match: RegExpExecArray | null = pattern.exec(tablesBlock);
  while (match !== null) {
    names.push(match[1]);
    match = pattern.exec(tablesBlock);
  }
  return names;
}

/** Tables present in the generated types but missing from the classification. */
export function unclassifiedTables(
  source: string,
  classification: Readonly<Record<string, TableClassification>> = DATA_CLASSIFICATION,
): string[] {
  return tablesInGeneratedTypes(source).filter((name) => !(name in classification));
}
