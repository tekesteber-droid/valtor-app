import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
  auth: {
    flowType: "pkce",
    storageKey: "bidswift-ai.auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      "X-Client-Info": "bidswift-ai-web",
    },
  },
});