import { createClient } from "@supabase/supabase-js";

const LIVE_PROJECT_REF = "naobitwzrkovmwvzvgvf";
const TEST_PROJECT_REF = "tnwvdmrrpwmfeujbyrxk";

const LIVE_SUPABASE_URL = `https://${LIVE_PROJECT_REF}.supabase.co`;
const LIVE_SUPABASE_ANON_KEY = "sb_publishable_dUuIBZqx-emtlO6-NXOXKw_22dONRSH";

const TEST_SUPABASE_URL = `https://${TEST_PROJECT_REF}.supabase.co`;
const TEST_SUPABASE_ANON_KEY = "sb_publishable_DC80W7bdorQWY322b3wV2g_IerFZN-y";

const hostname =
  typeof window === "undefined"
    ? ""
    : String(window.location.hostname || "").trim().toLowerCase();

const isLiveOrderHost = hostname === "order.fairchoice.co.uk";

const envUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const envKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Hard environment boundary:
// - order.fairchoice.co.uk is ALWAYS the live order-system database.
// - localhost, local network hosts, Vercel previews, and every non-live host
//   are NEVER allowed to use the live project, even if an old .env points there.
const requestedNonLiveUrl =
  envUrl && !envUrl.includes(LIVE_PROJECT_REF) ? envUrl : TEST_SUPABASE_URL;
const requestedNonLiveKey =
  envUrl && !envUrl.includes(LIVE_PROJECT_REF) && envKey
    ? envKey
    : TEST_SUPABASE_ANON_KEY;

const SUPABASE_URL = isLiveOrderHost ? LIVE_SUPABASE_URL : requestedNonLiveUrl;
const SUPABASE_ANON_KEY = isLiveOrderHost
  ? LIVE_SUPABASE_ANON_KEY
  : requestedNonLiveKey;

export const supabaseEnvironment = isLiveOrderHost ? "live" : "test";
export const supabaseProjectRef = isLiveOrderHost
  ? LIVE_PROJECT_REF
  : TEST_PROJECT_REF;

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.includes(".supabase.co") &&
  SUPABASE_ANON_KEY.length > 20;

if (!isLiveOrderHost && SUPABASE_URL.includes(LIVE_PROJECT_REF)) {
  throw new Error(
    "Safety stop: a non-live FairChoice build attempted to connect to the live Supabase project."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === "undefined" ? undefined : window.localStorage,
  },
});
