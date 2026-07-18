// src/services/auth.js
import { isSupabaseConfigured, supabase } from "./supabase";

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured for this deployment. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the Vercel Preview environment, then redeploy."
    );
  }
  return supabase;
}

export async function getCurrentUserProfile() {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;

  const user = authData?.user;
  if (!user) return null;

  const { data, error } = await client
    .from("staff_users")
    .select("*")
    .eq("email", user.email)
    .eq("active", true)
    .single();

  if (error) throw error;

  return {
    authUser: user,
    profile: data,
    role: data.role,
    customerAccountId: data.customer_account_id,
  };
}

export async function signIn(email, password) {
  const client = requireSupabase();
  return client.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const client = requireSupabase();
  return client.auth.signOut();
}
