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

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Valtor" }] }),
  component: Dashboard,
});

type AuditRow = {
  id: string;
  project_name: string;
  contract_value: number;
  target_margin: number;
  risk_score: number | null;
  status: string;
  created_at: string;
  analysis: any;
};

// 20 historical benchmark data points — Ethiopian construction market
const HISTORICAL_BIDS = [
  { id: 1, project: "Addis Ring Road Ph.1", risk: 28, margin: 18, status: "Won" },
  { id: 2, project: "Bole Sub-City Office Block", risk: 44, margin: 14, status: "Won" },
  { id: 3, project: "Hawassa Industrial Park Ext.", risk: 71, margin: 22, status: "Lost" },
  { id: 4, project: "Adama Wind Farm Access Road", risk: 35, margin: 16, status: "Won" },
  { id: 5, project: "Mekelle Hospital Annex", risk: 58, margin: 19, status: "Lost" },
  { id: 6, project: "Dire Dawa Rail Depot", risk: 62, margin: 12, status: "Lost" },
  { id: 7, project: "Jimma University STEM Block", risk: 22, margin: 15, status: "Won" },
  { id: 8, project: "Bishoftu Water Treatment", risk: 41, margin: 17, status: "Won" },
  { id: 9, project: "Dessie–Kombolcha Bypass", risk: 55, margin: 20, status: "Lost" },
  { id: 10, project: "Lideta Mixed-Use Tower", risk: 67, margin: 25, status: "Won" },
  { id: 11, project: "Sebeta Cement Plant Road", risk: 30, margin: 13, status: "Won" },
  { id: 12, project: "Gondar Heritage Restoration", risk: 49, margin: 21, status: "Lost" },
  { id: 13, project: "Ayat Residential Phase IV", risk: 25, margin: 15, status: "Won" },
  { id: 14, project: "Bole Lemi Industrial B1", risk: 38, margin: 16, status: "Won" },
  { id: 15, project: "Nekemte Health Cluster", risk: 60, margin: 18, status: "Lost" },
  { id: 16, project: "Assosa Airport Expansion", risk: 74, margin: 24, status: "Lost" },
  { id: 17, project: "Modjo–Hawassa Expressway", risk: 80, margin: 28, status: "Lost" },
  { id: 18, project: "Sheger City Phase I", risk: 32, margin: 14, status: "Won" },
  { id: 19, project: "Wonji Bridge Rehabilitation", risk: 47, margin: 17, status: "Won" },
  { id: 20, project: "Arba Minch University Hall", risk: 20, margin: 12, status: "Won" },
];

function formatEtb(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B ETB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ETB`;
  return `${Math.round(n).toLocaleString()} ETB`;
}

function riskClass(score: number | null) {
  if (score === null) return "";
  if (score < 35) return "risk-low";
  if (score < 65) return "risk-medium";
  return "risk-high";
}

function recBadge(rec?: string) {
  if (!rec) return <span className="badge badge-slate">—</span>;
  if (rec === "PROCEED") return <span className="badge badge-green">Proceed</span>;
  if (rec === "DECLINE") return <span className="badge badge-red">Decline</span>;
  return <span className="badge badge-amber">Caution</span>;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="panel" style={{ padding: "0.625rem 0.875rem", fontSize: "0.75rem", minWidth: "160px" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "#0D1117" }}>{d.project}</div>
        <div style={{ color: "#6B7280" }}>Risk: <strong style={{ color: "#0D1117" }}>{d.risk}</strong></div>
        <div style={{ color: "#6B7280" }}>Margin: <strong style={{ color: "#0D1117" }}>{d.margin}%</strong></div>
        <div style={{ marginTop: "0.25rem" }}>
          <span className={`badge ${d.status === "Won" ? "badge-green" : "badge-red"}`}>{d.status}</span>
        </div>
      </div>
    );
  }
  return null;
};

function Dashboard() {
  const { audits, loading } = useAudits();

  const total = audits.length;
  const totalValue = audits.reduce((s, a) => s + Number(a.contract_value || 0), 0);
  const scoredAudits = audits.filter((a) => a.risk_score != null);
  const avgRisk = scoredAudits.length
    ? Math.round(scoredAudits.reduce((s, a) => s + Number(a.risk_score!), 0) / scoredAudits.length)
    : null;
  const avgMargin = scoredAudits.length
    ? parseFloat((scoredAudits.reduce((s, a) => s + Number(a.target_margin), 0) / scoredAudits.length).toFixed(1))
    : null;
  const proceed = audits.filter((a) => a.analysis?.recommendation === "PROCEED").length;

  const wonBids = HISTORICAL_BIDS.filter((b) => b.status === "Won");
  const lostBids = HISTORICAL_BIDS.filter((b) => b.status === "Lost");

  const cards = [
    {
      label: "Total Bids Audited",
      value: total.toString(),
      icon: FileSearch,
      color: "#0F2240",
      delta: "all time",
    },
    {
      label: "Portfolio Value",
      value: formatEtb(totalValue),
      icon: TrendingUp,
      color: "#1D4ED8",
      delta: "under evaluation",
    },
    {
      label: "Avg Risk Score",
      value: avgRisk !== null ? `${avgRisk}/100` : "—",
      icon: AlertTriangle,
      color: avgRisk !== null && avgRisk >= 65 ? "#B91C1C" : avgRisk !== null && avgRisk >= 35 ? "#B45309" : "#15803D",
      delta: "lower is better",
    },
    {
      label: "Recommended",
      value: proceed.toString(),
      icon: CheckCircle2,
      color: "#15803D",
      delta: `${total ? Math.round((proceed / total) * 100) : 0}% approval rate`,
    },
  ];

  return (
    <div>
      {/* Page header */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Portfolio intelligence across all active tenders</div>
        </div>
        <Link to="/audit" className="btn-primary">
          <FileSearch size={14} />
          New Audit
        </Link>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <div className="stat-label">{c.label}</div>
              <div style={{ width: "28px", height: "28px", background: "#F7F8FA", border: "1px solid #E4E7EC", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <c.icon size={14} color={c.color} />
              </div>
            </div>
            <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
            <div className="stat-delta">{c.delta}</div>
          </div>
        ))}
      </div>

      {/* Pipeline table */}
      <div className="panel" style={{ marginBottom: "1.5rem", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E4E7EC", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0D1117" }}>Recent Pipeline</div>
          <Link to="/history" style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "#1D4ED8", textDecoration: "none" }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {loading ? (
          <div className="empty-state">
            <Clock size={24} style={{ margin: "0 auto 0.5rem", opacity: 0.4 }} />
            <p>Loading pipeline…</p>
          </div>
        ) : audits.length === 0 ? (
          <div className="empty-state">
            <FileSearch size={28} style={{ margin: "0 auto 0.5rem", opacity: 0.3 }} />
            <p>No audits yet. <Link to="/audit" style={{ color: "#1D4ED8" }}>Run your first audit →</Link></p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="text-right">Value (ETB)</th>
                  <th className="text-right">Margin</th>
                  <th className="text-right">Risk</th>
                  <th>Recommendation</th>
                  <th className="text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {audits.slice(0, 8).map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.project_name}</td>
                    <td className="text-right muted">{formatEtb(Number(a.contract_value))}</td>
                    <td className="text-right">{a.target_margin}%</td>
                    <td className={`text-right ${riskClass(a.risk_score)}`} style={{ fontWeight: 600 }}>
                      {a.risk_score != null ? `${Math.round(Number(a.risk_score))}` : "—"}
                    </td>
                    <td>{recBadge(a.analysis?.recommendation)}</td>
                    <td className="text-right muted">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Benchmarking scatter chart */}
      <div className="panel" style={{ padding: "1.25rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0D1117" }}>Historical Margin vs Risk</div>
          <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: "0.2rem" }}>20 past bids benchmarked against your current portfolio average</div>
        </div>

        {scoredAudits.length < 2 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#9CA3AF", fontSize: "0.8125rem", background: "#FAFBFC", borderRadius: "4px", border: "1px solid #E4E7EC" }}>
            Run at least 2 audits to see your portfolio benchmark plotted here.
          </div>
        ) : null}

        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 24, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis
              dataKey="risk"
              type="number"
              domain={[0, 100]}
              name="Risk Score"
              label={{ value: "Risk Score", position: "insideBottom", offset: -4, fontSize: 11, fill: "#9CA3AF" }}
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              axisLine={{ stroke: "#E4E7EC" }}
              tickLine={false}
            />
            <YAxis
              dataKey="margin"
              type="number"
              domain={[0, 32]}
              name="Target Margin %"
              label={{ value: "Margin %", angle: -90, position: "insideLeft", offset: 12, fontSize: 11, fill: "#9CA3AF" }}
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              axisLine={{ stroke: "#E4E7EC" }}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: "0.75rem", color: "#6B7280", paddingTop: "0.75rem" }}
              formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
            />
            <Scatter name="Won" data={wonBids} fill="#15803D" fillOpacity={0.65} r={5} />
            <Scatter name="Lost" data={lostBids} fill="#B91C1C" fillOpacity={0.65} r={5} />
            {avgRisk !== null && avgMargin !== null && (
              <ReferenceDot
                x={avgRisk}
                y={avgMargin}
                r={9}
                fill="#0F2240"
                stroke="#FFFFFF"
                strokeWidth={2}
                label={{
                  value: "Portfolio Avg",
                  position: "top",
                  fontSize: 10,
                  fill: "#0F2240",
                  fontWeight: 600,
                }}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
