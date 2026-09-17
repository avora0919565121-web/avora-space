/* eslint-disable */
// AUTO-GENERATED — DO NOT EDIT
// Run migrations to regenerate.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_balance_history: {
        Row: {
          account_id: string
          balance: number
          balance_date: string
          created_at: string
          id: string
        }
        Insert: {
          account_id: string
          balance: number
          balance_date: string
          created_at?: string
          id?: string
        }
        Update: {
          account_id?: string
          balance?: number
          balance_date?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balance_history_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_number: string | null
          balance: number
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          name: string
          opening_balance: number
          other_person_name: string | null
          tags: string[]
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_number?: string | null
          balance?: number
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name: string
          opening_balance?: number
          other_person_name?: string | null
          tags?: string[]
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_number?: string | null
          balance?: number
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name?: string
          opening_balance?: number
          other_person_name?: string | null
          tags?: string[]
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_hub_record: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          extension_fields: Json
          id: string
          next_action_date: string | null
          notes: string | null
          owner_user_id: string
          priority: string
          project_id: string | null
          status: string
          table_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          extension_fields?: Json
          id?: string
          next_action_date?: string | null
          notes?: string | null
          owner_user_id: string
          priority?: string
          project_id?: string | null
          status?: string
          table_id: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          extension_fields?: Json
          id?: string
          next_action_date?: string | null
          notes?: string | null
          owner_user_id?: string
          priority?: string
          project_id?: string | null
          status?: string
          table_id?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_hub_record_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hub_record_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "business_hub_table"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hub_table: {
        Row: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        Insert: {
          column_defs?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_user_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          column_defs?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_user_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          applies_to: Database["public"]["Enums"]["category_scope"]
          color: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          slug: string | null
          sort_order: number
          type: Database["public"]["Enums"]["category_origin"]
          user_id: string
        }
        Insert: {
          applies_to: Database["public"]["Enums"]["category_scope"]
          color?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          slug?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["category_origin"]
          user_id: string
        }
        Update: {
          applies_to?: Database["public"]["Enums"]["category_scope"]
          color?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          slug?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["category_origin"]
          user_id?: string
        }
        Relationships: []
      }
      contact: {
        Row: {
          business_address: string | null
          contact_type: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          employer_contact_id: string | null
          id: string
          industry: string | null
          linked_user_id: string | null
          name: string
          note: string | null
          owner_user_id: string
          phone: string | null
          relationship_tag: string | null
          representative_email: string | null
          representative_name: string | null
          representative_phone: string | null
          tax_code: string | null
          updated_at: string
        }
        Insert: {
          business_address?: string | null
          contact_type: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employer_contact_id?: string | null
          id?: string
          industry?: string | null
          linked_user_id?: string | null
          name: string
          note?: string | null
          owner_user_id: string
          phone?: string | null
          relationship_tag?: string | null
          representative_email?: string | null
          representative_name?: string | null
          representative_phone?: string | null
          tax_code?: string | null
          updated_at?: string
        }
        Update: {
          business_address?: string | null
          contact_type?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employer_contact_id?: string | null
          id?: string
          industry?: string | null
          linked_user_id?: string | null
          name?: string
          note?: string | null
          owner_user_id?: string
          phone?: string | null
          relationship_tag?: string | null
          representative_email?: string | null
          representative_name?: string | null
          representative_phone?: string | null
          tax_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_employer_contact_id_fkey"
            columns: ["employer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_channel: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          kind: string
          label: string | null
          needs_review: boolean
          owner_user_id: string
          source: string
          updated_at: string
          value: string
          value_normalized: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          needs_review?: boolean
          owner_user_id: string
          source?: string
          updated_at?: string
          value: string
          value_normalized?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          needs_review?: boolean
          owner_user_id?: string
          source?: string
          updated_at?: string
          value?: string
          value_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_channel_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_invite: {
        Row: {
          accepted_at: string | null
          contact_id: string
          id: string
          invite_token: string
          invited_at: string
          invited_by: string
          method: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          contact_id: string
          id?: string
          invite_token: string
          invited_at?: string
          invited_by: string
          method: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          contact_id?: string
          id?: string
          invite_token?: string
          invited_at?: string
          invited_by?: string
          method?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_invite_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      context_task_list_settings: {
        Row: {
          conversation_id: string
          task_lists_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          conversation_id: string
          task_lists_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          conversation_id?: string
          task_lists_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "context_task_list_settings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_task_list_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_groups: {
        Row: {
          conversation_id: string
          created_at: string
          name: string | null
          owner_id: string
          project_mode: boolean
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          name?: string | null
          owner_id: string
          project_mode?: boolean
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          name?: string | null
          owner_id?: string
          project_mode?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_groups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          direct_key: string | null
          id: string
          related_group_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          direct_key?: string | null
          id?: string
          related_group_id?: string | null
          type?: string
        }
        Update: {
          created_at?: string
          direct_key?: string | null
          id?: string
          related_group_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_related_group_id_fkey"
            columns: ["related_group_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_opportunity: {
        Row: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          estimated_value: number | null
          id: string
          owner_user_id: string
          project_id: string | null
          stage: string
          title: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          estimated_value?: number | null
          id?: string
          owner_user_id: string
          project_id?: string | null
          stage?: string
          title: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          estimated_value?: number | null
          id?: string
          owner_user_id?: string
          project_id?: string | null
          stage?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunity_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunity_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          minor_units: number
          name: string
          region: string
          sort_order: number
          symbol: string | null
        }
        Insert: {
          code: string
          minor_units?: number
          name: string
          region: string
          sort_order?: number
          symbol?: string | null
        }
        Update: {
          code?: string
          minor_units?: number
          name?: string
          region?: string
          sort_order?: number
          symbol?: string | null
        }
        Relationships: []
      }
      currency_rates: {
        Row: {
          from_currency: string
          id: string
          rate: number
          rate_date: string
          source: string | null
          to_currency: string
          updated_at: string
        }
        Insert: {
          from_currency: string
          id?: string
          rate: number
          rate_date: string
          source?: string | null
          to_currency: string
          updated_at?: string
        }
        Update: {
          from_currency?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string | null
          to_currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "currency_rates_from_currency_fkey"
            columns: ["from_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "currency_rates_to_currency_fkey"
            columns: ["to_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      deliverables: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          objective_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          objective_id: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          objective_id?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_guidance: {
        Row: {
          dismissed_at: string
          guidance_key: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          guidance_key: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          guidance_key?: string
          user_id?: string
        }
        Relationships: []
      }
      family_relations: {
        Row: {
          created_at: string
          related_user_id: string
          relation_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          related_user_id: string
          relation_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          related_user_id?: string
          relation_type?: string
          user_id?: string
        }
        Relationships: []
      }
      group_decision_grants: {
        Row: {
          conversation_id: string
          created_at: string
          granted_by: string
          grantee_id: string
          id: string
          kind: string
          used_at: string | null
          used_decision_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          granted_by: string
          grantee_id: string
          id?: string
          kind: string
          used_at?: string | null
          used_decision_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          granted_by?: string
          grantee_id?: string
          id?: string
          kind?: string
          used_at?: string | null
          used_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_decision_grants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_decision_grants_used_decision_id_fkey"
            columns: ["used_decision_id"]
            isOneToOne: false
            referencedRelation: "group_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_decision_options: {
        Row: {
          decision_id: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          decision_id: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          decision_id?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_decision_options_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "group_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_decision_votes: {
        Row: {
          created_at: string
          decision_id: string
          option_id: string
          voter_id: string
        }
        Insert: {
          created_at?: string
          decision_id: string
          option_id: string
          voter_id: string
        }
        Update: {
          created_at?: string
          decision_id?: string
          option_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_decision_votes_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "group_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_decision_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "group_decision_options"
            referencedColumns: ["id"]
          },
        ]
      }
      group_decisions: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          settled_at: string | null
          settled_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          conversation_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: string
          settled_at?: string | null
          settled_by?: string | null
          status: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          settled_at?: string | null
          settled_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_decisions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invite_links: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by: string
          revoked_at?: string | null
          token?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invite_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_removal_requests: {
        Row: {
          conversation_id: string
          created_at: string | null
          id: string
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          id?: string
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          id?: string
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_removal_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_note_details: {
        Row: {
          absentee_ids: string[]
          action_items: Json
          agenda_items: string[]
          attendee_ids: string[]
          created_at: string
          decision_id: string
          decisions_made: string
          meeting_type: string
          next_meeting_at: string | null
          objective: string
          reference_links: string[]
          risks_issues: string
          updated_at: string
        }
        Insert: {
          absentee_ids?: string[]
          action_items?: Json
          agenda_items?: string[]
          attendee_ids?: string[]
          created_at?: string
          decision_id: string
          decisions_made?: string
          meeting_type?: string
          next_meeting_at?: string | null
          objective?: string
          reference_links?: string[]
          risks_issues?: string
          updated_at?: string
        }
        Update: {
          absentee_ids?: string[]
          action_items?: Json
          agenda_items?: string[]
          attendee_ids?: string[]
          created_at?: string
          decision_id?: string
          decisions_made?: string
          meeting_type?: string
          next_meeting_at?: string | null
          objective?: string
          reference_links?: string[]
          risks_issues?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_note_details_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "group_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pins: {
        Row: {
          conversation_id: string
          id: string
          message_id: string
          pinned_at: string
          pinned_by: string
          scope: string
        }
        Insert: {
          conversation_id: string
          id?: string
          message_id: string
          pinned_at?: string
          pinned_by: string
          scope: string
        }
        Update: {
          conversation_id?: string
          id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          mentioned_user_ids: string[]
          reply_to_message_id: string | null
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          reply_to_message_id?: string | null
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          reply_to_message_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mute_settings: {
        Row: {
          created_at: string
          muted_until: string
          scope: string
          user_id: string
        }
        Insert: {
          created_at?: string
          muted_until: string
          scope: string
          user_id: string
        }
        Update: {
          created_at?: string
          muted_until?: string
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      objectives: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          project_id: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by: string
          id?: string
          project_id?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "objectives_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objectives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          base_currency: string
          created_at: string
          daily_thought_category: string
          display_name: string | null
          hide_typing_signal: boolean
          id: string
          timezone: string
        }
        Insert: {
          avatar_url?: string | null
          base_currency?: string
          created_at?: string
          daily_thought_category?: string
          display_name?: string | null
          hide_typing_signal?: boolean
          id: string
          timezone?: string
        }
        Update: {
          avatar_url?: string | null
          base_currency?: string
          created_at?: string
          daily_thought_category?: string
          display_name?: string | null
          hide_typing_signal?: boolean
          id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      project_tasks: {
        Row: {
          created_at: string
          deliverable_id: string
          linked_by: string
          project_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          deliverable_id: string
          linked_by: string
          project_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          deliverable_id?: string
          linked_by?: string
          project_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          assumptions: string | null
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          purpose: string | null
          scope: string | null
          status: string
          success_criteria: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assumptions?: string | null
          conversation_id: string
          created_at?: string
          created_by: string
          id?: string
          purpose?: string | null
          scope?: string | null
          status?: string
          success_criteria?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assumptions?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          purpose?: string | null
          scope?: string | null
          status?: string
          success_criteria?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_categories: {
        Row: {
          color: string
          created_at: string
          deleted_at: string | null
          id: string
          is_default: boolean
          name: string
          slug: string | null
          sort_order: number
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          slug?: string | null
          sort_order?: number
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          slug?: string | null
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      task_celebration_views: {
        Row: {
          task_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          task_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          task_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_celebration_views_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_celebrations"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_celebration_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_celebrations: {
        Row: {
          burst_count: number
          conversation_id: string
          task_id: string
          triggered_at: string
        }
        Insert: {
          burst_count?: number
          conversation_id: string
          task_id: string
          triggered_at?: string
        }
        Update: {
          burst_count?: number
          conversation_id?: string
          task_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_celebrations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_celebrations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_confirmations: {
        Row: {
          confirmed_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          confirmed_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_confirmations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string
          depends_on_task_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          depends_on_task_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          depends_on_task_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flags: {
        Row: {
          created_at: string
          duration_minutes: number | null
          is_important: boolean
          started_at: string | null
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          is_important?: boolean
          started_at?: string | null
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          is_important?: boolean
          started_at?: string | null
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_flags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_lists: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string
          group_id: string | null
          id: string
          name: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by: string
          group_id?: string | null
          id?: string
          name?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string
          group_id?: string | null
          id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_lists_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_lists_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "conversation_groups"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          created_at: string
          id: string
          is_sent: boolean
          offset_minutes: number | null
          reminder_time: string
          reminder_type: string | null
          reminder_tz: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_sent?: boolean
          offset_minutes?: number | null
          reminder_time: string
          reminder_type?: string | null
          reminder_tz?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_sent?: boolean
          offset_minutes?: number | null
          reminder_time?: string
          reminder_type?: string | null
          reminder_tz?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_suggestions: {
        Row: {
          accepted_task_id: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          proposed_deadline: string
          proposed_deadline_time: string | null
          proposed_deadline_tz: string
          proposed_description: string
          proposed_title: string
          proposer_id: string
          resolved_at: string | null
          skipped_silently: boolean
          status: string
        }
        Insert: {
          accepted_task_id?: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          proposed_deadline: string
          proposed_deadline_time?: string | null
          proposed_deadline_tz?: string
          proposed_description?: string
          proposed_title: string
          proposer_id: string
          resolved_at?: string | null
          skipped_silently?: boolean
          status?: string
        }
        Update: {
          accepted_task_id?: string | null
          assignee_id?: string
          context_snapshot?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          proposed_deadline?: string
          proposed_deadline_time?: string | null
          proposed_deadline_tz?: string
          proposed_description?: string
          proposed_title?: string
          proposer_id?: string
          resolved_at?: string | null
          skipped_silently?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_suggestions_accepted_task_id_fkey"
            columns: ["accepted_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_suggestions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_suggestions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_confirmed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          context_snapshot?: Json | null
          conversation_id?: string | null
          created_at?: string
          creator_id: string
          deadline_date: string
          deadline_time?: string | null
          deadline_tz?: string
          deleted_by_creator?: boolean
          deleted_by_peer?: boolean
          deliverable_id?: string | null
          description?: string
          done_at?: string | null
          id?: string
          is_important?: boolean
          is_milestone?: boolean
          objective_id?: string | null
          opportunity_id?: string | null
          output_value?: string | null
          progress_percent?: number | null
          recurrence?: string
          recurrence_origin_id?: string | null
          recurrence_pattern?: Json | null
          recurrence_spawned_at?: string | null
          skipped_at?: string | null
          skipped_silently?: boolean
          status?: string
          task_category_id?: string | null
          task_list_id?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_confirmed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          context_snapshot?: Json | null
          conversation_id?: string | null
          created_at?: string
          creator_id?: string
          deadline_date?: string
          deadline_time?: string | null
          deadline_tz?: string
          deleted_by_creator?: boolean
          deleted_by_peer?: boolean
          deliverable_id?: string | null
          description?: string
          done_at?: string | null
          id?: string
          is_important?: boolean
          is_milestone?: boolean
          objective_id?: string | null
          opportunity_id?: string | null
          output_value?: string | null
          progress_percent?: number | null
          recurrence?: string
          recurrence_origin_id?: string | null
          recurrence_pattern?: Json | null
          recurrence_spawned_at?: string | null
          skipped_at?: string | null
          skipped_silently?: boolean
          status?: string
          task_category_id?: string | null
          task_list_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_opportunity_fkey"
            columns: ["opportunity_id", "creator_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunity"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "tasks_recurrence_origin_id_fkey"
            columns: ["recurrence_origin_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_category_id_fkey"
            columns: ["task_category_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_list_id_fkey"
            columns: ["task_list_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          amount_in_base_currency: number | null
          amount_settled: number
          base_currency: string | null
          business_purpose: string | null
          business_related: boolean
          category_id: string | null
          contact_id: string | null
          conversion_rate: number | null
          created_at: string
          currency: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          is_recurring: boolean
          receipt_url: string | null
          recurring_frequency:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label: string | null
          status: string
          tax_period_end: string | null
          tax_period_start: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          amount_in_base_currency?: number | null
          amount_settled?: number
          base_currency?: string | null
          business_purpose?: string | null
          business_related?: boolean
          category_id?: string | null
          contact_id?: string | null
          conversion_rate?: number | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          receipt_url?: string | null
          recurring_frequency?:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label?: string | null
          status?: string
          tax_period_end?: string | null
          tax_period_start?: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          amount_in_base_currency?: number | null
          amount_settled?: number
          base_currency?: string | null
          business_purpose?: string | null
          business_related?: boolean
          category_id?: string | null
          contact_id?: string | null
          conversion_rate?: number | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          receipt_url?: string | null
          recurring_frequency?:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label?: string | null
          status?: string
          tax_period_end?: string | null
          tax_period_start?: string | null
          transaction_date?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      accept_task_suggestion: {
        Args: { p_suggestion_id: string; p_task_id?: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_business_hub_column: {
        Args: {
          p_label: string
          p_options?: string[]
          p_table_id: string
          p_type: string
        }
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_contact_channel: {
        Args: {
          p_contact_id: string
          p_kind: string
          p_label?: string
          p_needs_review?: boolean
          p_source?: string
          p_value: string
        }
        Returns: {
          contact_id: string
          created_at: string
          id: string
          kind: string
          label: string | null
          needs_review: boolean
          owner_user_id: string
          source: string
          updated_at: string
          value: string
          value_normalized: string
        }
        SetofOptions: {
          from: "*"
          to: "contact_channel"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_deliverable: {
        Args: { p_objective_id: string; p_title: string }
        Returns: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          objective_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "deliverables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_objective: {
        Args: { p_project_id: string; p_title: string }
        Returns: {
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          project_id: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "objectives"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cast_group_vote: {
        Args: { p_decision_id: string; p_option_id: string }
        Returns: undefined
      }
      close_group_poll: {
        Args: { p_decision_id: string }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          settled_at: string | null
          settled_by: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_1_1_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_1_1_task_completion: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_deliverable: {
        Args: { p_deliverable_id: string }
        Returns: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          objective_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "deliverables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_shared_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contact_invite_timed_out: {
        Args: { p_invited_at: string; p_status: string }
        Returns: boolean
      }
      convert_currency: {
        Args: { p_amount: number; p_from: string; p_on?: string; p_to: string }
        Returns: number
      }
      create_1_1_shared_task: {
        Args: {
          p_category_id?: string
          p_conversation_id: string
          p_deadline: string
          p_deadline_time?: string
          p_deadline_tz?: string
          p_description: string
          p_is_important?: boolean
          p_recurrence?: string
          p_recurrence_pattern?: Json
          p_task_id: string
          p_title: string
        }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_business_hub_record: {
        Args: {
          p_category?: string
          p_extension_fields?: Json
          p_next_action_date?: string
          p_notes?: string
          p_priority?: string
          p_status?: string
          p_table_id: string
          p_tags?: string[]
          p_title: string
        }
        Returns: {
          category: string | null
          created_at: string
          deleted_at: string | null
          extension_fields: Json
          id: string
          next_action_date: string | null
          notes: string | null
          owner_user_id: string
          priority: string
          project_id: string | null
          status: string
          table_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_record"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_business_hub_table: {
        Args: { p_name: string }
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_contact: {
        Args: {
          p_business_address?: string
          p_contact_type: string
          p_date_of_birth?: string
          p_email?: string
          p_industry?: string
          p_name: string
          p_note?: string
          p_phone?: string
          p_relationship_tag?: string
          p_representative_email?: string
          p_representative_name?: string
          p_representative_phone?: string
          p_tax_code?: string
        }
        Returns: {
          business_address: string | null
          contact_type: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          employer_contact_id: string | null
          id: string
          industry: string | null
          linked_user_id: string | null
          name: string
          note: string | null
          owner_user_id: string
          phone: string | null
          relationship_tag: string | null
          representative_email: string | null
          representative_name: string | null
          representative_phone: string | null
          tax_code: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_contact_invite: {
        Args: { p_contact_id: string; p_method: string }
        Returns: string
      }
      create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      create_group_conversation: {
        Args: { p_member_ids?: string[]; p_name: string }
        Returns: string
      }
      create_group_decision: {
        Args: {
          p_body?: string
          p_conversation_id: string
          p_decision_id?: string
          p_kind: string
          p_options?: string[]
          p_title: string
        }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          settled_at: string | null
          settled_by: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_obligation_transaction: {
        Args: {
          p_account_id: string
          p_amount: number
          p_business_related?: boolean
          p_contact_id?: string
          p_description?: string
          p_due_date: string
          p_tax_period_end?: string
          p_tax_period_start?: string
          p_transaction_date?: string
          p_type: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: {
          account_id: string
          amount: number
          amount_in_base_currency: number | null
          amount_settled: number
          base_currency: string | null
          business_purpose: string | null
          business_related: boolean
          category_id: string | null
          contact_id: string | null
          conversion_rate: number | null
          created_at: string
          currency: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          is_recurring: boolean
          receipt_url: string | null
          recurring_frequency:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label: string | null
          status: string
          tax_period_end: string | null
          tax_period_start: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_opportunity: {
        Args: {
          p_contact_id: string
          p_estimated_value?: number
          p_title: string
        }
        Returns: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          estimated_value: number | null
          id: string
          owner_user_id: string
          project_id: string | null
          stage: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_opportunity"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project: {
        Args: {
          p_assumptions?: string
          p_conversation_id: string
          p_first_objective_title: string
          p_purpose?: string
          p_scope?: string
          p_success_criteria?: string
          p_title: string
        }
        Returns: {
          assumptions: string | null
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          purpose: string | null
          scope: string | null
          status: string
          success_criteria: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_shared_task: {
        Args: {
          p_assignee_id?: string
          p_category_id?: string
          p_context_snapshot?: Json
          p_conversation_id: string
          p_deadline: string
          p_deadline_time?: string
          p_deadline_tz?: string
          p_description: string
          p_is_important?: boolean
          p_recurrence?: string
          p_recurrence_pattern?: Json
          p_task_id?: string
          p_title: string
          p_type: string
        }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_task_suggestion: {
        Args: {
          p_assignee_id: string
          p_context_snapshot: Json
          p_conversation_id: string
          p_deadline: string
          p_deadline_time?: string
          p_deadline_tz?: string
          p_description: string
          p_message_id?: string
          p_suggestion_id?: string
          p_title: string
        }
        Returns: {
          accepted_task_id: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          proposed_deadline: string
          proposed_deadline_time: string | null
          proposed_deadline_tz: string
          proposed_description: string
          proposed_title: string
          proposer_id: string
          resolved_at: string | null
          skipped_silently: boolean
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "task_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      currency_rate_at: {
        Args: { p_from: string; p_on?: string; p_to: string }
        Returns: number
      }
      default_finance_categories: {
        Args: never
        Returns: {
          applies_to: Database["public"]["Enums"]["category_scope"]
          color: string
          name: string
          slug: string
          sort_order: number
        }[]
      }
      delete_1_1_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_business_hub_record: {
        Args: { p_record_id: string }
        Returns: {
          category: string | null
          created_at: string
          deleted_at: string | null
          extension_fields: Json
          id: string
          next_action_date: string | null
          notes: string | null
          owner_user_id: string
          priority: string
          project_id: string | null
          status: string
          table_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_record"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_business_hub_table: {
        Args: { p_table_id: string }
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_shared_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      detach_contact_channel: {
        Args: { p_contact_id: string; p_kind: string; p_value: string }
        Returns: {
          business_address: string | null
          contact_type: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          employer_contact_id: string | null
          id: string
          industry: string | null
          linked_user_id: string | null
          name: string
          note: string | null
          owner_user_id: string
          phone: string | null
          relationship_tag: string | null
          representative_email: string | null
          representative_name: string | null
          representative_phone: string | null
          tax_code: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_message: {
        Args: { p_content: string; p_message_id: string }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          mentioned_user_ids: string[]
          reply_to_message_id: string | null
          sender_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_task_suggestion: {
        Args: {
          p_deadline: string
          p_deadline_time?: string
          p_deadline_tz?: string
          p_description: string
          p_suggestion_id: string
          p_title: string
        }
        Returns: {
          accepted_task_id: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          proposed_deadline: string
          proposed_deadline_time: string | null
          proposed_deadline_tz: string
          proposed_description: string
          proposed_title: string
          proposer_id: string
          resolved_at: string | null
          skipped_silently: boolean
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "task_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_default_business_hub_table: {
        Args: never
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_default_categories: {
        Args: never
        Returns: {
          applies_to: Database["public"]["Enums"]["category_scope"]
          color: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          slug: string | null
          sort_order: number
          type: Database["public"]["Enums"]["category_origin"]
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "categories"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ensure_default_task_categories: {
        Args: { p_user: string }
        Returns: undefined
      }
      ensure_personal_journal: { Args: { p_user_id: string }; Returns: string }
      finalize_meeting_note: {
        Args: { p_decision_id: string }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          settled_at: string | null
          settled_by: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_user_by_email: {
        Args: { p_email: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      get_conversation_peer: {
        Args: { p_conversation_id: string }
        Returns: {
          peer_display_name: string
          peer_email: string
          peer_id: string
        }[]
      }
      get_my_journal_conversation: { Args: never; Returns: string }
      get_or_create_direct_conversation_for_group: {
        Args: { group_id: string; target_user_id: string }
        Returns: string
      }
      grant_group_decision_permission: {
        Args: {
          p_conversation_id: string
          p_grantee_id: string
          p_kind: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          granted_by: string
          grantee_id: string
          id: string
          kind: string
          used_at: string | null
          used_decision_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "group_decision_grants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_task_assignee: {
        Args: {
          p_task: Database["public"]["Tables"]["tasks"]["Row"]
          p_user: string
        }
        Returns: boolean
      }
      join_group_with_invite: { Args: { p_token: string }; Returns: string }
      leave_group_conversation: {
        Args: { target_conversation_id: string }
        Returns: undefined
      }
      link_opportunity_conversation: {
        Args: { p_conversation_id: string; p_opportunity_id: string }
        Returns: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          estimated_value: number | null
          id: string
          owner_user_id: string
          project_id: string | null
          stage: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_opportunity"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_task_to_project: {
        Args: { p_deliverable_id: string; p_task_id: string }
        Returns: {
          created_at: string
          deliverable_id: string
          linked_by: string
          project_id: string
          task_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_group_members: {
        Args: { p_conversation_id: string }
        Returns: {
          display_name: string
          email: string
          joined_at: string
          role: string
          user_id: string
        }[]
      }
      list_my_conversations: {
        Args: never
        Returns: {
          conversation_id: string
          conversation_type: string
          group_name: string
          last_message_at: string
          last_message_content: string
          last_message_sender_id: string
          member_count: number
          peer_display_name: string
          peer_email: string
          peer_id: string
          peer_last_read_at: string
          sort_at: string
          unread_count: number
        }[]
      }
      mark_1_1_task_done: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      mark_shared_task_done: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_shared_task_done_with_output: {
        Args: { p_output_value: string; p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      message_edit_window: { Args: never; Returns: string }
      message_pin_limit: { Args: never; Returns: number }
      pin_message: {
        Args: { p_message_id: string; p_scope: string }
        Returns: {
          conversation_id: string
          id: string
          message_id: string
          pinned_at: string
          pinned_by: string
          scope: string
        }
        SetofOptions: {
          from: "*"
          to: "message_pins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_contact_invite: {
        Args: { p_token: string }
        Returns: {
          already_linked: boolean
          inviter_name: string
          is_own_invite: boolean
          status: string
        }[]
      }
      preview_group_invite: {
        Args: { p_token: string }
        Returns: {
          conversation_id: string
          group_name: string
        }[]
      }
      recall_message: {
        Args: { p_message_id: string }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          mentioned_user_ids: string[]
          reply_to_message_id: string | null
          sender_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recompute_account_state: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      refresh_transaction_base_amounts: {
        Args: { p_user: string }
        Returns: number
      }
      remove_group_participant: {
        Args: { target_conversation_id: string; target_user_id: string }
        Returns: undefined
      }
      rename_business_hub_table: {
        Args: { p_name: string; p_table_id: string }
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rename_group_conversation: {
        Args: { p_conversation_id: string; p_name: string }
        Returns: string
      }
      request_remove_participant: {
        Args: { target_conversation_id: string; target_user_id: string }
        Returns: string
      }
      resolve_removal_request: {
        Args: { approve: boolean; target_request_id: string }
        Returns: undefined
      }
      restore_1_1_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_business_hub_record: {
        Args: { p_record_id: string }
        Returns: {
          category: string | null
          created_at: string
          deleted_at: string | null
          extension_fields: Json
          id: string
          next_action_date: string | null
          notes: string | null
          owner_user_id: string
          priority: string
          project_id: string | null
          status: string
          table_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_record"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_business_hub_table: {
        Args: { p_table_id: string }
        Returns: {
          column_defs: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_user_id: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_table"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_shared_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_1_1_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_shared_task: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_shared_task_completion: {
        Args: { p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_group_decision_permission: {
        Args: { p_grant_id: string }
        Returns: undefined
      }
      revoke_group_invite: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      rotate_group_invite: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      save_meeting_note_details: {
        Args: {
          p_absentee_ids: string[]
          p_action_items: Json
          p_agenda_items: string[]
          p_attendee_ids: string[]
          p_decision_id: string
          p_decisions_made: string
          p_meeting_type: string
          p_next_meeting_at: string
          p_objective: string
          p_reference_links: string[]
          p_risks_issues: string
        }
        Returns: {
          absentee_ids: string[]
          action_items: Json
          agenda_items: string[]
          attendee_ids: string[]
          created_at: string
          decision_id: string
          decisions_made: string
          meeting_type: string
          next_meeting_at: string | null
          objective: string
          reference_links: string[]
          risks_issues: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meeting_note_details"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      seed_finance_categories: { Args: { p_user_id: string }; Returns: number }
      set_group_admin: {
        Args: {
          make_admin: boolean
          target_conversation_id: string
          target_user_id: string
        }
        Returns: undefined
      }
      settle_transaction: {
        Args: { p_amount: number; p_transaction_id: string }
        Returns: {
          account_id: string
          amount: number
          amount_in_base_currency: number | null
          amount_settled: number
          base_currency: string | null
          business_purpose: string | null
          business_related: boolean
          category_id: string | null
          contact_id: string | null
          conversion_rate: number | null
          created_at: string
          currency: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          is_recurring: boolean
          receipt_url: string | null
          recurring_frequency:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label: string | null
          status: string
          tax_period_end: string | null
          tax_period_start: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_shared_task: {
        Args: { p_silent?: boolean; p_task_id: string }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_task_suggestion: {
        Args: { p_silent?: boolean; p_suggestion_id: string }
        Returns: {
          accepted_task_id: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          proposed_deadline: string
          proposed_deadline_time: string | null
          proposed_deadline_tz: string
          proposed_description: string
          proposed_title: string
          proposer_id: string
          resolved_at: string | null
          skipped_silently: boolean
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "task_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      suggested_meeting_attendees: {
        Args: { p_conversation_id: string }
        Returns: string[]
      }
      task_deadline_instant: {
        Args: { p_date: string; p_time: string; p_tz: string }
        Returns: string
      }
      transfer_group_ownership: {
        Args: { new_owner_user_id: string; target_conversation_id: string }
        Returns: undefined
      }
      update_business_hub_record: {
        Args: { p_patch: Json; p_record_id: string }
        Returns: {
          category: string | null
          created_at: string
          deleted_at: string | null
          extension_fields: Json
          id: string
          next_action_date: string | null
          notes: string | null
          owner_user_id: string
          priority: string
          project_id: string | null
          status: string
          table_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_hub_record"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_contact: {
        Args: {
          p_business_address?: string
          p_contact_id: string
          p_date_of_birth?: string
          p_email?: string
          p_employer_contact_id?: string
          p_industry?: string
          p_name: string
          p_note?: string
          p_phone?: string
          p_relationship_tag?: string
          p_representative_email?: string
          p_representative_name?: string
          p_representative_phone?: string
          p_tax_code?: string
        }
        Returns: {
          business_address: string | null
          contact_type: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          employer_contact_id: string | null
          id: string
          industry: string | null
          linked_user_id: string | null
          name: string
          note: string | null
          owner_user_id: string
          phone: string | null
          relationship_tag: string | null
          representative_email: string | null
          representative_name: string | null
          representative_phone: string | null
          tax_code: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_meeting_note_draft: {
        Args: { p_body: string; p_decision_id: string; p_title: string }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          settled_at: string | null
          settled_by: string | null
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_opportunity_stage: {
        Args: { p_opportunity_id: string; p_stage: string }
        Returns: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          estimated_value: number | null
          id: string
          owner_user_id: string
          project_id: string | null
          stage: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_opportunity"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_shared_task_details: {
        Args: {
          p_deadline: string
          p_deadline_time?: string
          p_deadline_tz?: string
          p_description: string
          p_task_id: string
          p_title: string
        }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_shared_task_plan: {
        Args: {
          p_clear_progress?: boolean
          p_is_milestone?: boolean
          p_progress_percent?: number
          p_task_id: string
        }
        Returns: {
          assignee_id: string | null
          completed_confirmed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          context_snapshot: Json | null
          conversation_id: string | null
          created_at: string
          creator_id: string
          deadline_date: string
          deadline_time: string | null
          deadline_tz: string
          deleted_by_creator: boolean
          deleted_by_peer: boolean
          deliverable_id: string | null
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          is_milestone: boolean
          objective_id: string | null
          opportunity_id: string | null
          output_value: string | null
          progress_percent: number | null
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
          skipped_at: string | null
          skipped_silently: boolean
          status: string
          task_category_id: string | null
          task_list_id: string | null
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_task_suggestion: {
        Args: { p_suggestion_id: string }
        Returns: {
          accepted_task_id: string | null
          assignee_id: string
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          proposed_deadline: string
          proposed_deadline_time: string | null
          proposed_deadline_tz: string
          proposed_description: string
          proposed_title: string
          proposer_id: string
          resolved_at: string | null
          skipped_silently: boolean
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "task_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_type:
        | "checking"
        | "savings"
        | "credit_card"
        | "cash"
        | "loan"
        | "crypto"
        | "investment"
        | "other"
        | "other_person_holding"
      category_origin: "predefined" | "custom"
      category_scope: "income" | "expense"
      recurring_frequency: "weekly" | "monthly" | "yearly"
      transaction_type:
        | "income"
        | "expense"
        | "vay"
        | "cho_vay"
        | "thue_ca_nhan"
        | "thue_kinh_doanh"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: [
        "checking",
        "savings",
        "credit_card",
        "cash",
        "loan",
        "crypto",
        "investment",
        "other",
        "other_person_holding",
      ],
      category_origin: ["predefined", "custom"],
      category_scope: ["income", "expense"],
      recurring_frequency: ["weekly", "monthly", "yearly"],
      transaction_type: [
        "income",
        "expense",
        "vay",
        "cho_vay",
        "thue_ca_nhan",
        "thue_kinh_doanh",
      ],
    },
  },
} as const
