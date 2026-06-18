import { createFileRoute, Link } from "@tanstack/react-router";
import { useAudits } from "@/integrations/supabase/audits";
import { useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  AlertTriangle, FileSearch, CheckCircle2,
  Shield, AlertOctagon, TrendingUp, ChevronRight, FileText,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Valtor" }] }),
  component: Dashboard,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtEtb(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return Math.round(n).toLocaleString();
}

function riskColor(score: number | null) {
  if (score === null) return "#94A3B8";
  if (score < 40) return "#16A34A";
  if (score < 65) return "#D97706";
  return "#DC2626";
}

function riskLabel(score: number | null) {
  if (score === null) return "—";
  if (score < 40) return "LOW";
  if (score < 65) return "MEDIUM";
  return "HIGH";
}

// ─── Contract Flags ───────────────────────────────────────────────────────────

function ContractFlags({ analysis }: { analysis: any }) {
  const traps = analysis?.contractual_traps ?? [];

  const hasLD = traps.some((t: any) =>
    String(t.type || t).toLowerCase().includes("ld") ||
    String(t.clause || t).toLowerCase().includes("liquidat")
  );
  const hasRetention = traps.some((t: any) =>
    String(t.type || t).toLowerCase().includes("retain")
  );
  const hasEscalation = traps.some((t: any) =>
    String(t.type || t).toLowerCase().includes("escal")
  );

  const badges: { icon: React.ReactNode; label: string; color: string; bg: string; border: string }[] = [];
  if (hasLD || traps.length > 0)
    badges.push({ icon: <AlertOctagon size={11} />, label: "LD Exposure", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" });
  if (hasRetention)
    badges.push({ icon: <Shield size={11} />, label: "Retention Gap", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" });
  if (hasEscalation)
    badges.push({ icon: <TrendingUp size={11} />, label: "No Escalation", color: "#0369A1", bg: "#EFF6FF", border: "#BFDBFE" });
  if (!badges.length && traps.length > 0)
    traps.slice(0, 3).forEach((t: any) =>
      badges.push({ icon: <AlertTriangle size={11} />, label: String(t.clause || t.description || t).slice(0, 24), color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" })
    );

  if (!badges.length)
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#16A34A" }}>
        <CheckCircle2 size={14} /> No contractual traps detected
      </div>
    );

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {badges.map(b => (
        <div key={b.label} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: b.bg, border: `1px solid ${b.border}`,
          color: b.color, fontSize: 11, padding: "4px 10px", borderRadius: 20, fontWeight: 600,
        }}>
          {b.icon} {b.label}
        </div>
      ))}
    </div>
  );
}

// ─── BoQ Variance (real data only) ───────────────────────────────────────────

function BoqVarianceBars({ analysis }: { analysis: any }) {
  const variance = analysis?.market_variance ?? [];
  if (!variance.length)
    return <div style={{ fontSize: 12, color: "#94A3B8" }}>No variance data extracted for this project.</div>;

  const data = variance.slice(0, 6).map((v: any) => ({
    item: String(v.item || v.description || "Bill").slice(0, 14),
    variance: Number(v.variance_percent ?? v.percentage ?? 0),
  }));

  return (
    <div>
      <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 10 }}>
        Your rates vs market avg. <span style={{ color: "#DC2626" }}>Red = &gt;15% above market</span>
      </div>
      {data.map(d => {
        const pct = Math.round(d.variance);
        const isWarn = Math.abs(pct) > 15;
        const color = pct > 15 ? "#DC2626" : pct > 0 ? "#D97706" : "#16A34A";
        const w = Math.min(Math.abs(pct) * 2.5, 100);
        return (
          <div key={d.item} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "#64748B", width: 90, flexShrink: 0 }}>{d.item}</div>
            <div style={{ flex: 1, height: 10, background: "#F1F5F9", borderRadius: 2, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: pct < 0 ? `${50 - w / 2}%` : "50%", width: `${w / 2}%`, height: "100%", background: color, borderRadius: 2 }} />
              <div style={{ position: "absolute", left: "50%", width: 1, height: "100%", background: "#CBD5E1" }} />
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: isWarn ? color : "#64748B", fontWeight: isWarn ? 700 : 400, width: 40, textAlign: "right" }}>
              {pct > 0 ? "+" : ""}{pct}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Risk Scatter ─────────────────────────────────────────────────────────────

function RiskScatter({ audits }: { audits: any[] }) {
  const data = audits.map(a => ({
    name: a.project_name,
    risk: Number(a.risk_score ?? 50),
    value: Number(a.contract_value ?? 0) / 1_000_000,
    fill: riskColor(Number(a.risk_score ?? 50)),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ScatterChart margin={{ top: 10, right: 12, bottom: 20, left: 8 }}>
        <CartesianGrid stroke="#F1F5F9" />
        <XAxis dataKey="risk" type="number" domain={[0, 100]} name="Risk"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          label={{ value: "Risk Score →", position: "insideBottom", offset: -10, fontSize: 10, fill: "#94A3B8" }} />
        <YAxis dataKey="value" name="Value (M ETB)"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          label={{ value: "M ETB", angle: -90, position: "insideLeft", offset: 12, fontSize: 10, fill: "#94A3B8" }} />
        <Tooltip
          contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", fontSize: 11, borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
          formatter={(value: number, name: string) => [name === "value" ? `${Math.round(value)}M ETB` : Math.round(value), name === "value" ? "Contract Value" : "Risk Score"]}
          labelFormatter={() => ""}
        />
        <ReferenceLine x={65} stroke="#FECACA" strokeDasharray="4 2" />
        <Scatter data={data} fill="#3B82F6">
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { audits, loading } = useAudits();
  const [selectedAudit, setSelectedAudit] = useState<any | null>(null);

  const total = audits.length;
  const totalValue = audits.reduce((s, a) => s + Number(a.contract_value || 0), 0);
  const scored = audits.filter(a => a.risk_score != null);
  const avgRisk = scored.length ? Math.round(scored.reduce((s, a) => s + Number(a.risk_score!), 0) / scored.length) : null;
  const highRisk = audits.filter(a => Number(a.risk_score ?? 0) > 65).length;
  const proceed = audits.filter(a => a.analysis?.recommendation === "PROCEED").length;

  const card = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" as const, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
  const cardHdr = { display: "flex" as const, alignItems: "center" as const, justifyContent: "space-between" as const, padding: "12px 18px", borderBottom: "1px solid #F1F5F9" };
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "1px", color: "#94A3B8" };
  const mono = { fontFamily: "'JetBrains Mono','Fira Code',monospace" };

  return (
    <div style={{ background: "#F8FAFC", minHeight: "100vh", color: "#0F172A", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13 }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 52, background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ ...mono, fontSize: 15, fontWeight: 800, letterSpacing: 2 }}>VALTOR</div>
          <div style={{ width: 1, height: 20, background: "#E2E8F0" }} />
          <div style={{ fontSize: 12, color: "#64748B" }}>{total} {total === 1 ? "project" : "projects"} audited</div>
          {totalValue > 0 && (
            <>
              <div style={{ width: 1, height: 20, background: "#E2E8F0" }} />
              <div style={{ fontSize: 12, color: "#64748B" }}>
                Total exposure: <span style={{ ...mono, color: "#0F172A", fontWeight: 600 }}>{fmtEtb(totalValue)} ETB</span>
              </div>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {highRisk > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", fontSize: 11, padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>
              <AlertTriangle size={12} /> {highRisk} high-risk
            </div>
          )}
          <Link to="/audit" style={{ background: "#0F172A", color: "#fff", padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <FileSearch size={13} /> New Audit
          </Link>
        </div>
      </div>

      {/* Grid */}
      <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>

        {/* ── Left ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Portfolio Value", value: totalValue > 0 ? `${fmtEtb(totalValue)} ETB` : "—", sub: "across all audits", accent: undefined as string | undefined },
              { label: "Projects", value: String(total || "—"), sub: "in workspace", accent: undefined as string | undefined },
              { label: "Avg Risk Score", value: avgRisk !== null ? String(avgRisk) : "—", sub: avgRisk !== null ? riskLabel(avgRisk) : "no scored projects", accent: avgRisk !== null ? riskColor(avgRisk) : undefined },
              { label: "AI: Proceed", value: String(proceed || "—"), sub: "recommended bids", accent: proceed > 0 ? "#16A34A" : undefined as string | undefined },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: "14px 16px" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.8px", color: "#94A3B8", marginBottom: 6 }}>{k.label}</div>
                <div style={{ ...mono, fontSize: 22, fontWeight: 700, color: k.accent ?? "#0F172A", lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Scatter */}
          <div style={card}>
            <div style={cardHdr}>
              <div style={lbl}>Risk vs Value</div>
              {highRisk > 0 && <div style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>⚠ {highRisk} above threshold</div>}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              {loading ? (
                <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8", fontSize: 12 }}>Loading…</div>
              ) : audits.length === 0 ? (
                <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8", fontSize: 12, textAlign: "center" }}>No audits yet.<br />Run your first bid audit to populate this chart.</div>
              ) : <RiskScatter audits={audits} />}
            </div>
          </div>

          {/* Reports */}
          <div style={card}>
            <div style={cardHdr}><div style={lbl}>Reports</div></div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {["Board-Ready PDF Report", "Excel Export"].map(name => (
                <Link key={name} to="/history" style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#0F172A", fontSize: 12, fontWeight: 500, padding: "10px 14px", borderRadius: 8, textDecoration: "none" }}>
                  <FileText size={14} color="#64748B" /> {name}
                </Link>
              ))}
            </div>
          </div>

        </div>

        {/* ── Right ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Pipeline table */}
          <div style={card}>
            <div style={cardHdr}>
              <div style={lbl}>Active Pipeline</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{total} projects</div>
                <Link to="/history" style={{ fontSize: 11, color: "#3B82F6", display: "flex", alignItems: "center", gap: 2, textDecoration: "none" }}>View all <ChevronRight size={11} /></Link>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 80px 90px", padding: "8px 18px", borderBottom: "1px solid #F1F5F9", fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.8px", color: "#94A3B8" }}>
              <div>Project</div>
              <div style={{ textAlign: "right" }}>Value (ETB)</div>
              <div style={{ textAlign: "center" }}>Risk</div>
              <div style={{ textAlign: "center" }}>Decision</div>
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {loading ? (
                <div style={{ padding: "28px", textAlign: "center", color: "#94A3B8", fontSize: 12 }}>Loading pipeline…</div>
              ) : audits.length === 0 ? (
                <div style={{ padding: "40px 24px", textAlign: "center", color: "#94A3B8", fontSize: 12 }}>
                  No audits yet. <Link to="/audit" style={{ color: "#3B82F6", textDecoration: "none", fontWeight: 600 }}>Run your first bid audit →</Link>
                </div>
              ) : audits.map(a => {
                const isSelected = selectedAudit?.id === a.id;
                const rec = a.analysis?.recommendation;
                const recColor = rec === "PROCEED" ? "#16A34A" : rec === "DECLINE" ? "#DC2626" : "#D97706";
                const recBg = rec === "PROCEED" ? "#F0FDF4" : rec === "DECLINE" ? "#FEF2F2" : "#FFFBEB";
                const score = a.risk_score != null ? Math.round(Number(a.risk_score)) : null;
                return (
                  <div key={a.id}
                    onClick={() => setSelectedAudit(isSelected ? null : a)}
                    style={{ display: "grid", gridTemplateColumns: "1fr 130px 80px 90px", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid #F8FAFC", cursor: "pointer", background: isSelected ? "#EFF6FF" : "transparent", transition: "background 0.1s" }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F8FAFC"; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{a.project_name}</div>
                    <div style={{ ...mono, fontSize: 12, color: "#64748B", textAlign: "right" }}>{fmtEtb(Number(a.contract_value ?? 0))}</div>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      {score !== null ? (
                        <div style={{ ...mono, fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: `${riskColor(score)}15`, color: riskColor(score), border: `1px solid ${riskColor(score)}30` }}>
                          {score}
                        </div>
                      ) : <span style={{ color: "#94A3B8" }}>—</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      {rec ? (
                        <div style={{ fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: recBg, color: recColor, border: `1px solid ${recColor}30` }}>
                          {rec}
                        </div>
                      ) : <span style={{ color: "#94A3B8" }}>—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Analysis panel */}
          <div style={card}>
            <div style={cardHdr}>
              <div style={lbl}>{selectedAudit ? `Analysis — ${selectedAudit.project_name}` : "Project Analysis"}</div>
              {selectedAudit && selectedAudit.risk_score != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: riskColor(Number(selectedAudit.risk_score)) }}>
                    {Math.round(Number(selectedAudit.risk_score))}/100
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: `${riskColor(Number(selectedAudit.risk_score))}12`, color: riskColor(Number(selectedAudit.risk_score)), border: `1px solid ${riskColor(Number(selectedAudit.risk_score))}30` }}>
                    {riskLabel(Number(selectedAudit.risk_score))} RISK
                  </div>
                </div>
              )}
            </div>

            {!selectedAudit ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "#94A3B8", fontSize: 12, lineHeight: 1.7 }}>
                Click any project above to see its BoQ variance analysis,<br />contract flags, and AI findings.
              </div>
            ) : (
              <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
                <div>
                  <div style={{ ...lbl, marginBottom: 14 }}>BoQ Variance vs Market</div>
                  <BoqVarianceBars analysis={selectedAudit.analysis} />
                </div>
                <div>
                  <div style={{ ...lbl, marginBottom: 14 }}>Contract Flags</div>
                  <ContractFlags analysis={selectedAudit.analysis} />
                  {selectedAudit.analysis?.key_findings?.length > 0 && (
                    <div style={{ marginTop: 22 }}>
                      <div style={{ ...lbl, marginBottom: 12 }}>Key Findings</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {selectedAudit.analysis.key_findings.slice(0, 4).map((f: string, i: number) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#334155", lineHeight: 1.6 }}>
                            <div style={{ color: "#CBD5E1", flexShrink: 0, marginTop: 2 }}>›</div>
                            <div>{f}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
