import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://naobitwzrkovmwvzvgvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hb2JpdHd6cmtvdm13dnp2Z3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMjI4NzQsImV4cCI6MjA5NTc5ODg3NH0.m89nwIqhvNyMuilQJAmyZIdHrV9eHfS237TwPcJ9hkA";



export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.includes(".supabase.co") &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY_HERE");

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;