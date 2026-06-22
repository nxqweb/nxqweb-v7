import { createClient } from "@supabase/supabase-js";

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabaseUrl = rawSupabaseUrl?.trim();
const supabaseAnonKey = rawSupabaseAnonKey?.trim();

export const supabaseDebug = {
  url: supabaseUrl || "",
  hasUrl: Boolean(supabaseUrl),
  hasAnonKey: Boolean(supabaseAnonKey),
  anonKeyPreview: supabaseAnonKey
    ? `${supabaseAnonKey.slice(0, 8)}...${supabaseAnonKey.slice(-6)}`
    : "missing",
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;
