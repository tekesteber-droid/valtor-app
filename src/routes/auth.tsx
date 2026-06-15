import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isSupabaseConfigured, supabaseConfig } from "@/integrations/supabase/config";
import { ArrowRight, Loader2, Lock, Mail, Shield } from "lucide-react";

type AuthSearch = {
  redirect?: string;
  reason?: "config" | "network" | "session";
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    reason:
      search.reason === "config" || search.reason === "network" || search.reason === "session"
        ? search.reason
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in - Valtor" },
      {
        name: "description",
        content: "Sign in to Valtor - construction bid intelligence platform.",
      },
    ],
  }),
  component: AuthPage,
});

const PASSWORD_MIN_LENGTH = 12;

function cleanEmail(value: string) {
  return value.trim().toLowerCase();
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include uppercase, lowercase, and a number.";
  }

  return null;
}

function getSafeRedirect(redirect?: string) {
  if (!redirect) return "/";

  try {
    const url = new URL(redirect, window.location.origin);

    if (url.origin !== window.location.origin || url.pathname === "/auth") {
      return "/";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/failed to fetch|networkerror|load failed|fetch/i.test(message)) {
    return "Cannot reach Supabase. Check .env.local, your Supabase project URL/key, and Auth URL Configuration.";
  }

  if (/invalid login credentials/i.test(message)) {
    return "Invalid email or password.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Confirm your email before signing in.";
  }

  return message || "Authentication failed. Please try again.";
}

function AuthPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError(supabaseConfig.error);
      return;
    }

    if (search.reason === "network") {
      setError("Your session could not be verified because Supabase was unreachable.");
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        if (data.session) router.navigate({ to: "/", replace: true });
      })
      .catch((authError) => setError(friendlyAuthError(authError)));
  }, [router, search.reason]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!isSupabaseConfigured) {
      setError(supabaseConfig.error);
      return;
    }

    const normalizedEmail = cleanEmail(email);

    if (!normalizedEmail) {
      setError("Work email is required.");
      return;
    }

    if (mode === "signup") {
      const passwordError = validatePassword(password);

      if (passwordError) {
        setError(passwordError);
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });

        if (error) throw error;

        if (data.session) {
          window.location.replace(getSafeRedirect(search.redirect));
          return;
        }

        setInfo("Account created. Check your email to confirm your sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;

        window.location.replace(getSafeRedirect(search.redirect));
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError(isSupabaseConfigured ? null : supabaseConfig.error);
    setInfo(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "#F7F8FA",
      }}
    >
      <div
        style={{
          width: "420px",
          background: "#0F2240",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "3rem",
          flexShrink: 0,
        }}
        className="hidden lg:flex"
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "3.5rem" }}>
            <div style={{ width: "36px", height: "36px", background: "#FFFFFF", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Shield size={18} color="#0F2240" />
            </div>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em" }}>Valtor</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Bid Intelligence</div>
            </div>
          </div>

          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#FFFFFF", lineHeight: 1.2, letterSpacing: "-0.03em", marginBottom: "1rem" }}>
            Construction risk intelligence for the enterprise.
          </div>
          <div style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.65 }}>
            Valtor analyses tender documents, quantifies bid risk, and surfaces the data your estimating team needs to make the right call - faster.
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "1.5rem" }}>
          {[
            "Multi-format tender ingestion",
            "AI risk scoring & evaluation matrix",
            "Live tender feed with match scoring",
            "One-click BoQ export to Excel",
            "Enterprise approval workflows",
          ].map((feat) => (
            <div key={feat} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#1D4ED8", flexShrink: 0 }} />
              <span style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.65)" }}>{feat}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <div className="lg:hidden" style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "2rem" }}>
            <div style={{ width: "32px", height: "32px", background: "#0F2240", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Shield size={16} color="#FFFFFF" />
            </div>
            <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0D1117" }}>Valtor</div>
          </div>

          <div style={{ marginBottom: "2rem" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0D1117", letterSpacing: "-0.02em" }}>
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "#6B7280", marginTop: "0.375rem" }}>
              {mode === "signin" ? "Sign in to access your workspace." : "Use a strong password to protect bid data."}
            </div>
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label className="section-label">Work email</label>
              <div style={{ position: "relative" }}>
                <Mail size={14} color="#9CA3AF" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="field-input"
                  style={{ paddingLeft: "2.25rem" }}
                  placeholder="you@firm.com"
                />
              </div>
            </div>
            <div>
              <label className="section-label">Password</label>
              <div style={{ position: "relative" }}>
                <Lock size={14} color="#9CA3AF" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type="password"
                  required
                  minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="field-input"
                  style={{ paddingLeft: "2.25rem" }}
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            {error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "4px", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", color: "#B91C1C", lineHeight: 1.45 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "4px", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", color: "#15803D", lineHeight: 1.45 }}>
                {info}
              </div>
            )}

            <button type="submit" disabled={loading || !isSupabaseConfigured} className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "0.6875rem" }}>
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Signing in...</>
              ) : (
                <>{mode === "signin" ? "Sign in" : "Create account"} <ArrowRight size={14} /></>
              )}
            </button>
          </form>

          <button
            onClick={switchMode}
            style={{ marginTop: "1.25rem", width: "100%", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "#6B7280" }}
          >
            {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
