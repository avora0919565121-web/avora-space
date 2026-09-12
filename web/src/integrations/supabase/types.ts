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
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          name?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          name?: string | null
          owner_id?: string
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
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
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
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          base_currency: string
          created_at: string
          daily_thought_category: string
          display_name: string | null
          id: string
          timezone: string
        }
        Insert: {
          avatar_url?: string | null
          base_currency?: string
          created_at?: string
          daily_thought_category?: string
          display_name?: string | null
          id: string
          timezone?: string
        }
        Update: {
          avatar_url?: string | null
          base_currency?: string
          created_at?: string
          daily_thought_category?: string
          display_name?: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description?: string
          done_at?: string | null
          id?: string
          is_important?: boolean
          recurrence?: string
          recurrence_origin_id?: string | null
          recurrence_pattern?: Json | null
          recurrence_spawned_at?: string | null
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
          description?: string
          done_at?: string | null
          id?: string
          is_important?: boolean
          recurrence?: string
          recurrence_origin_id?: string | null
          recurrence_pattern?: Json | null
          recurrence_spawned_at?: string | null
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
          base_currency: string | null
          business_purpose: string | null
          business_related: boolean
          category_id: string
          conversion_rate: number | null
          created_at: string
          currency: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_recurring: boolean
          receipt_url: string | null
          recurring_frequency:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          amount_in_base_currency?: number | null
          base_currency?: string | null
          business_purpose?: string | null
          business_related?: boolean
          category_id: string
          conversion_rate?: number | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_recurring?: boolean
          receipt_url?: string | null
          recurring_frequency?:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label?: string | null
          transaction_date: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          amount_in_base_currency?: number | null
          base_currency?: string | null
          business_purpose?: string | null
          business_related?: boolean
          category_id?: string
          conversion_rate?: number | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_recurring?: boolean
          receipt_url?: string | null
          recurring_frequency?:
            | Database["public"]["Enums"]["recurring_frequency"]
            | null
          recurring_label?: string | null
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
      can_toggle_task_lists: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_task: {
        Args: { p_task: string; p_user: string }
        Returns: boolean
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
      create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      create_group_conversation: {
        Args: { p_member_ids?: string[]; p_name: string }
        Returns: string
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
          p_task_id: string
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
      is_conversation_participant: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
      preview_group_invite: {
        Args: { p_token: string }
        Returns: {
          conversation_id: string
          group_name: string
        }[]
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
          description: string
          done_at: string | null
          id: string
          is_important: boolean
          recurrence: string
          recurrence_origin_id: string | null
          recurrence_pattern: Json | null
          recurrence_spawned_at: string | null
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
      revoke_group_invite: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      rotate_group_invite: {
        Args: { p_conversation_id: string }
        Returns: string
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
      task_deadline_instant: {
        Args: { p_date: string; p_time: string; p_tz: string }
        Returns: string
      }
      transfer_group_ownership: {
        Args: { new_owner_user_id: string; target_conversation_id: string }
        Returns: undefined
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
      transaction_type: "income" | "expense"
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
      transaction_type: ["income", "expense"],
    },
  },
} as const
