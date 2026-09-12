import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

const supabaseUrl: string = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey: string = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

/** Single Supabase client for the whole app. supabase-js owns the session. */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
