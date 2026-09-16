import { createClient } from "@supabase/supabase-js";

// Production safety pin: keep the live app on the FairChoice order-system Supabase project.
const SUPABASE_URL = "https://naobitwzrkovmwvzvgvf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dUuIBZqx-emtlO6-NXOXKw_22dONRSH";

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.includes(".supabase.co") &&
  SUPABASE_ANON_KEY.length > 20;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === "undefined" ? undefined : window.localStorage,
  },
});
