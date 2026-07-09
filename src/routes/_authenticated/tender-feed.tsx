import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  Loader2,
  ExternalLink,
  ArrowRight,
  Filter,
  Rss,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/tender-feed")({
  head: () => ({ meta: [{ title: "Tender Feed — BidSwift AI" }] }),
  component: TenderFeed,
});

type MatchScore = "High" | "Medium" | "Low";
type TriageStatus = "New" | "Under Review" | "Shortlisted" | "Passed";

type Tender = {
  id: string;
  title: string;
  source: string;
  location: string;
  value_etb: number;
  deadline: string;
  match_score: MatchScore;
  triage_status: TriageStatus;
  category: string;
};

const TENDERS: Tender[] = [
  {
    id: "T-2026-001",
    title: "Addis Ababa Ring Road Phase IV — Akaki-Kality Section",
    source: "ERA Procurement Portal",
    location: "Addis Ababa",
    value_etb: 2_400_000_000,
    deadline: "2026-07-15",
    match_score: "High",
    triage_status: "New",
    category: "Road & Highway",
  },
  {
    id: "T-2026-002",
    title: "Bole International Airport Terminal Expansion — Phase II",
    source: "ECAA Tender Office",
    location: "Addis Ababa",
    value_etb: 5_800_000_000,
    deadline: "2026-08-01",
    match_score: "Medium",
    triage_status: "New",
    category: "Aviation Infrastructure",
  },
  {
    id: "T-2026-003",
    title: "Lideta Mixed-Use Commercial Complex (30F)",
    source: "PPSA Portal",
    location: "Addis Ababa",
    value_etb: 780_000_000,
    deadline: "2026-07-22",
    match_score: "High",
    triage_status: "New",
    category: "Commercial Building",
  },
  {
    id: "T-2026-004",
    title: "Hawassa Industrial Park — Zone C Water Supply & Drainage",
    source: "IPDC Procurement",
    location: "Hawassa",
    value_etb: 340_000_000,
    deadline: "2026-07-10",
    match_score: "High",
    triage_status: "New",
    category: "Civil & MEP",
  },
  {
    id: "T-2026-005",
    title: "Gondar–Bahir Dar Highway Rehabilitation (145km)",
    source: "ERA Procurement Portal",
    location: "Amhara Region",
    value_etb: 1_920_000_000,
    deadline: "2026-09-05",
    match_score: "Low",
    triage_status: "New",
    category: "Road & Highway",
  },
  {
    id: "T-2026-006",
    title: "Sheger City Phase II — Residential Cluster B (480 Units)",
    source: "AAHCPO",
    location: "Addis Ababa",
    value_etb: 560_000_000,
    deadline: "2026-07-28",
    match_score: "High",
    triage_status: "New",
    category: "Residential",
  },
  {
    id: "T-2026-007",
    title: "Black Lion Hospital Oncology Wing Construction",
    source: "FMOH Procurement",
    location: "Addis Ababa",
    value_etb: 420_000_000,
    deadline: "2026-08-18",
    match_score: "Medium",
    triage_status: "New",
    category: "Healthcare",
  },
];

function fmtEtb(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  return `${Math.round(n).toLocaleString()}`;
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function matchBadge(score: MatchScore) {
  if (score === "High") return <span className="badge badge-green">High match</span>;
  if (score === "Medium") return <span className="badge badge-amber">Medium match</span>;
  return <span className="badge badge-slate">Low match</span>;
}

function triageBadge(status: TriageStatus) {
  if (status === "New") return <span className="badge badge-blue">New</span>;
  if (status === "Under Review") return <span className="badge badge-amber">Under Review</span>;
  if (status === "Shortlisted") return <span className="badge badge-green">Shortlisted</span>;
  return <span className="badge badge-slate">Passed</span>;
}

function TenderFeed() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>(TENDERS);
  const [importing, setImporting] = useState<Record<string, boolean>>({});
  const [filterScore, setFilterScore] = useState<"All" | MatchScore>("All");

  const updateTriage = (id: string, status: TriageStatus) => {
    setTenders((prev) => prev.map((t) => (t.id === id ? { ...t, triage_status: status } : t)));
  };

  const importToAudit = async (tender: Tender) => {
    setImporting((prev) => ({ ...prev, [tender.id]: true }));
    await new Promise((res) => setTimeout(res, 1100));
    setImporting((prev) => ({ ...prev, [tender.id]: false }));
    router.navigate({ to: "/audit", search: { project: tender.title } as any });
  };

  const visible = filterScore === "All" ? tenders : tenders.filter((t) => t.match_score === filterScore);

  const highCount = tenders.filter((t) => t.match_score === "High").length;
  const totalValue = tenders.reduce((s, t) => s + t.value_etb, 0);

  return (
    <div>
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
            <div className="page-title">Tender Feed</div>
            <span className="badge badge-blue" style={{ marginBottom: "2px" }}>
              <Rss size={9} /> Live
            </span>
          </div>
          <div className="page-subtitle">
            {tenders.length} active tenders · {highCount} high-match · {fmtEtb(totalValue)} ETB total pipeline
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Filter size={13} color="#6B7280" />
          <span style={{ fontSize: "0.75rem", color: "#6B7280" }}>Match:</span>
          {(["All", "High", "Medium", "Low"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilterScore(v)}
              className={filterScore === v ? "btn-primary" : "btn-ghost"}
              style={{ padding: "0.3rem 0.625rem", fontSize: "0.75rem" }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "52px" }}>Ref</th>
                <th>Project</th>
                <th>Category</th>
                <th>Source</th>
                <th className="text-right">Value (ETB)</th>
                <th className="text-right">Deadline</th>
                <th>AI Match</th>
                <th>Triage</th>
                <th style={{ width: "120px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const days = daysUntil(t.deadline);
                const urgent = days <= 14;
                return (
                  <tr key={t.id}>
                    <td className="muted" style={{ fontFamily: "monospace", fontSize: "0.6875rem" }}>{t.id}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: "#0D1117", fontSize: "0.8125rem", lineHeight: 1.3 }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#9CA3AF", marginTop: "0.2rem" }}>{t.location}</div>
                    </td>
                    <td><span className="badge badge-navy">{t.category}</span></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "#374151" }}>
                        <ExternalLink size={10} color="#9CA3AF" />
                        {t.source}
                      </div>
                    </td>
                    <td className="text-right" style={{ fontWeight: 600, color: "#0D1117", fontFamily: "monospace", fontSize: "0.8125rem" }}>
                      {fmtEtb(t.value_etb)} ETB
                    </td>
                    <td className="text-right">
                      <div style={{ fontSize: "0.75rem", color: urgent ? "#B91C1C" : "#374151", fontWeight: urgent ? 600 : 400 }}>
                        {new Date(t.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </div>
                      <div style={{ fontSize: "0.625rem", color: urgent ? "#B91C1C" : "#9CA3AF" }}>
                        {days > 0 ? `${days}d left` : "Expired"}
                      </div>
                    </td>
                    <td>{matchBadge(t.match_score)}</td>
                    <td>
                      <select
                        value={t.triage_status}
                        onChange={(e) => updateTriage(t.id, e.target.value as TriageStatus)}
                        className="field-input"
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.6875rem", width: "auto", minWidth: "110px" }}
                      >
                        <option value="New">New</option>
                        <option value="Under Review">Under Review</option>
                        <option value="Shortlisted">Shortlisted</option>
                        <option value="Passed">Passed</option>
                      </select>
                    </td>
                    <td>
                      <button
                        onClick={() => importToAudit(t)}
                        disabled={importing[t.id]}
                        className="btn-accent"
                        style={{ padding: "0.3rem 0.625rem", fontSize: "0.75rem" }}
                      >
                        {importing[t.id] ? (
                          <><Loader2 size={11} className="animate-spin" /> Importing</>
                        ) : (
                          <>Audit <ArrowRight size={11} /></>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "3rem", color: "#9CA3AF", fontSize: "0.8125rem" }}>
                    No tenders match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", fontSize: "0.6875rem", color: "#9CA3AF" }}>
        Data sourced from ERA, PPSA, ECAA, and IPDC procurement portals. Refreshed daily.
      </div>
    </div>
  );
}