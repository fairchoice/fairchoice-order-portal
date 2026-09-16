import { createClient } from "@supabase/supabase-js";

// Production safety pin: keep the live app on the FairChoice V3 Supabase project.
// Vite environment values are build-time values and a stale/mismatched deployment
// can otherwise send every browser request to the wrong endpoint.
const SUPABASE_URL = "https://tnwvdmrrpwmfeujbyrxk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DC80W7bdorQWY322b3wV2g_IerFZN-y";

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
