import { Link, useRouter } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileSearch,
  History,
  LogOut,
  Rss,
  ChevronRight,
  Shield,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/audit", label: "Bid Audit", icon: FileSearch },
  { to: "/tender-feed", label: "Tender Feed", icon: Rss },
  { to: "/history", label: "History", icon: History },
] as const;

export function AppShell({ children, userEmail }: { children: ReactNode; userEmail?: string | null }) {
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex" style={{ background: "#F7F8FA" }}>
      {/* Sidebar */}
      <aside
        className="hidden md:flex flex-col"
        style={{
          width: "220px",
          minHeight: "100vh",
          background: "#FFFFFF",
          borderRight: "1px solid #E4E7EC",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
        }}
      >
        {/* Logo */}
        <div style={{ padding: "1.25rem 1.25rem 1rem", borderBottom: "1px solid #E4E7EC" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: "0.625rem", textDecoration: "none" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                background: "#0F2240",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Shield size={16} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#0D1117", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                Valtor
              </div>
              <div style={{ fontSize: "0.625rem", color: "#9CA3AF", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "1px" }}>
                Bid Intelligence
              </div>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ padding: "0.75rem 0.625rem", flex: 1 }}>
          <div style={{ fontSize: "0.625rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#9CA3AF", padding: "0 0.5rem", marginBottom: "0.375rem" }}>
            Platform
          </div>
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "nav-link active" }}
              inactiveProps={{ className: "nav-link" }}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>

        {/* User footer */}
        <div style={{ padding: "0.875rem 0.625rem", borderTop: "1px solid #E4E7EC" }}>
          {userEmail && (
            <div style={{ fontSize: "0.6875rem", color: "#6B7280", padding: "0 0.5rem", marginBottom: "0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userEmail}
            </div>
          )}
          <button onClick={signOut} className="nav-link" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", justifyContent: "flex-start" }}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header
        className="md:hidden"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          background: "#FFFFFF",
          borderBottom: "1px solid #E4E7EC",
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <div style={{ width: "28px", height: "28px", background: "#0F2240", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shield size={14} color="#FFFFFF" />
          </div>
          <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#0D1117" }}>Valtor</span>
        </Link>
        <nav style={{ display: "flex", gap: "0.25rem" }}>
          {navItems.map(({ to, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ style: { color: "#0F2240", background: "#EEF1F6" } }}
              inactiveProps={{ style: { color: "#6B7280" } }}
              style={{ padding: "0.375rem", borderRadius: "4px", display: "flex" }}
            >
              <Icon size={16} />
            </Link>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          marginLeft: "220px",
          padding: "2rem",
          maxWidth: "1280px",
        }}
        className="md:ml-[220px] ml-0 mt-[52px] md:mt-0"
      >
        {children}
      </main>
    </div>
  );
}
