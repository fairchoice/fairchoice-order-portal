// src/services/auth.js
import { supabase } from "./supabase";

export async function getCurrentUserProfile() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;

  if (!user) return null;

  const { data, error } = await supabase
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
  return await supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return await supabase.auth.signOut();
}