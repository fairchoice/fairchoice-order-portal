import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://naobitwzrkovmwvzvgvf.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hb2JpdHd6cmtvdm13dnp2Z3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMjI4NzQsImV4cCI6MjA5NTc5ODg3NH0.m89nwIqhvNyMuilQJAmyZIdHrV9eHfS237TwPcJ9hkA";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);