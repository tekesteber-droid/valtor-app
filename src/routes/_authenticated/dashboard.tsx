import { createFileRoute, Link } from "@tanstack/react-router";
import { useAudits } from "@/integrations/supabase/audits";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  ArrowRight,
  Clock,
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Valtor" }] }),
  component: DashboardPage,
});

function formatEtb(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B ETB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ETB`;
  return `${Math.round(n).toLocaleString()} ETB`;
}

function DashboardPage() {
  const { audits, loading } = useAudits();

  const total = audits.length;
  const totalValue = audits.reduce((s, a) => s + Number(a.contract_value || 0), 0);
  const scoredAudits = audits.filter((a) => a.risk_score != null);
  const avgRisk = scoredAudits.length
    ? Math.round(scoredAudits.reduce((s, a) => s + Number(a.risk_score!), 0) / scoredAudits.length)
    : null;
  const proceed = audits.filter((a) => a.analysis?.recommendation === "PROCEED").length;

  const cards = [
    { label: "Total Bids Audited", value: loading ? "---" : total.toString(), icon: FileSearch, color: "#0F2240" },
    { label: "Portfolio Value", value: loading ? "---" : formatEtb(totalValue), icon: TrendingUp, color: "#1D4ED8" },
    { label: "Avg Risk Score", value: loading ? "---" : avgRisk !== null ? `${avgRisk}/100` : "—", icon: AlertTriangle, color: "#B45309" },
    { label: "Recommended", value: loading ? "---" : proceed.toString(), icon: CheckCircle2, color: "#15803D" },
  ];

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Real-time portfolio intelligence</div>
        </div>
        <Link to="/audit" className="btn-primary"><FileSearch size={14} /> New Audit</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <div className="stat-label">{c.label}</div>
              <c.icon size={14} color={c.color} />
            </div>
            <div className="stat-value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E4E7EC", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600 }}>Recent Pipeline</div>
          <Link to="/history" style={{ fontSize: "0.75rem", color: "#1D4ED8", display: "flex", alignItems: "center" }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {loading ? (
          <div className="empty-state"><Clock size={24} className="animate-spin" /></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Project</th><th className="text-right">Value</th><th className="text-right">Risk</th></tr>
            </thead>
            <tbody>
              {audits.slice(0, 5).map((a) => (
                <tr key={a.id}>
                  <td>{a.project_name}</td>
                  <td className="text-right">{formatEtb(a.contract_value)}</td>
                  <td className="text-right">{a.risk_score ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}