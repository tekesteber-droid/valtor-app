const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

function getConfigError() {
  if (!rawSupabaseUrl || !rawSupabaseAnonKey) {
    return "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.";
  }

  try {
    const url = new URL(rawSupabaseUrl);

    if (!["https:", "http:"].includes(url.protocol)) {
      return "VITE_SUPABASE_URL must start with https://.";
    }

    if (
      url.hostname === "placeholder-project.supabase.co" ||
      url.hostname === "your-project-ref.supabase.co" ||
      url.hostname === "your-project-ref.supabase.co"
    ) {
      return "VITE_SUPABASE_URL is still using the placeholder project.";
    }
  } catch {
    return "VITE_SUPABASE_URL is not a valid URL.";
  }

  if (
    rawSupabaseAnonKey.length < 20 ||
    rawSupabaseAnonKey === "placeholder-anon-key" ||
    rawSupabaseAnonKey === "your-supabase-anon-or-publishable-key"
  ) {
    return "VITE_SUPABASE_ANON_KEY is missing or still using a placeholder value.";
  }

  return null;
}

export const supabaseConfig = {
  url: rawSupabaseUrl || "https://not-configured.supabase.co",
  anonKey: rawSupabaseAnonKey || "not-configured",
  error: getConfigError(),
};

export const isSupabaseConfigured = supabaseConfig.error === null;