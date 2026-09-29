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
  profiles: { level: "personal", domain: "identity", columns: { display_name: "personal", avatar_url: "personal" } },
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
  conversation_participants: { level: "internal", domain: "connect", columns: { last_read_at: "personal" } },
  conversation_groups: { level: "personal", domain: "connect" },
  // Each side's "Đồng ý" inside a verification frame.
  conversation_verification_confirms: { level: "internal", domain: "connect" },
  messages: { level: "sensitive", domain: "connect", columns: { content: "sensitive" } },
  message_attachments: {
    level: "sensitive",
    domain: "connect",
    columns: { file_name: "sensitive", storage_path: "internal" },
  },
  message_reactions: { level: "personal", domain: "connect" },
  message_pins: { level: "personal", domain: "connect" },
  message_recall_request: { level: "personal", domain: "connect" },
  mute_settings: { level: "internal", domain: "connect" },
  group_invite_links: { level: "secret", domain: "connect", columns: { token: "secret" } },
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

  // finance
  accounts: {
    level: "sensitive",
    domain: "finance",
    columns: { balance: "sensitive", opening_balance: "sensitive", other_person_name: "sensitive" },
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
    },
  },
  categories: { level: "personal", domain: "finance" },
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
