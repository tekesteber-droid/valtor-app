import { downloadAuditExcel } from "@/utils/download";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertAudit, dispatchAuditsUpdated } from "@/integrations/supabase/audits";
import {
  motion, AnimatedScore, StaggeredList, StaggerItem,
  Collapsible, ProcessingStages, CleanAuditBeat, useReducedMotion,
} from "@/components/motion";
import {
  UploadCloud, Loader2, FileText, X, CheckCircle2,
  XCircle, AlertTriangle, RotateCcw, ShieldAlert,
  Activity, Calculator, HardHat, Scale, TrendingUp,
  TrendingDown, Minus, BookOpen, Award, AlertCircle,
  ArrowDown, BarChart2
} from "lucide-react";
import logo from "../../assets/logo.png";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

const LOADING_STEPS = [
  "Parsing source documents",
  "Evaluating commercial risk",
  "Cross-checking contract clauses",
  "Scoring opportunity fit",
  "Composing final recommendation",
];

const REPORT_NAV = [
  { id: "methodology", label: "Methodology" },
  { id: "resources", label: "Resources" },
  { id: "arithmetic", label: "Arithmetic" },
  { id: "risk-register", label: "Contractual Risks" },
  { id: "market", label: "Market" },
  { id: "financial", label: "Financial" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type ContractualTrap = {
  clause_type: string;
  fidic_ref: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  recommendation: string;
};

type MarketVarianceItem = {
  item: string;
  category: string;
  our_rate: number;
  market_rate: number;
  variance_pct: number;
  unit: string;
  note: string;
};

type ArithmeticError = {
  location: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  financial_impact: number;
};

type ScopeGap = {
  missing_element: string;
  risk_impact: string;
  estimated_cost_etb: number;
};

type AuditResult = {
  risk_score: number | null;
  data_confidence?: "none" | "low" | "medium" | "high";
  pricing_coverage_percent?: number;
  priced_item_count?: number;
  total_item_count?: number;
  recommendation: string;
  executive_summary: string;
  technical_critique: string;
  methodology_strengths: string[];
  methodology_weaknesses: string[];
  arithmetic_errors: ArithmeticError[];
  contractual_traps: ContractualTrap[];
  market_variance: MarketVarianceItem[];
  scope_gaps: ScopeGap[];
  resource_gap_analysis: string;
  plant_adequacy_assessment: string;
  regulatory_compliance: string;
  financial_risk_summary: string;
  key_risks: string[];
  project_name: string;
  contract_value: number;
  target_margin: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskColor(score: number | null) {
  if (score == null) return { text: "text-slate-500", hex: "#64748B", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-300", label: "INSUFFICIENT DATA" };
  if (score < 35) return { text: "text-emerald-600", hex: "#059669", bg: "bg-emerald-50", border: "border-emerald-200", bar: "bg-emerald-500", label: "LOW RISK" };
  if (score < 65) return { text: "text-amber-600", hex: "#D97706", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-500", label: "MEDIUM RISK" };
  return { text: "text-red-600", hex: "#DC2626", bg: "bg-red-50", border: "border-red-200", bar: "bg-red-600", label: "HIGH RISK" };
}

function severityColor(s: string) {
  if (s === "CRITICAL") return "bg-red-100 text-red-800 border-red-200";
  if (s === "HIGH") return "bg-orange-100 text-orange-800 border-orange-200";
  if (s === "MEDIUM") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function RecBadge({ rec }: { rec?: string }) {
  const s = rec || "PROCEED_WITH_CAUTION";
  const label = s.replace(/_/g, " ");
  if (s === "PROCEED") return <span className="badge badge-green flex items-center gap-1"><CheckCircle2 size={11} /> {label}</span>;
  if (s === "DECLINE") return <span className="badge badge-red flex items-center gap-1"><XCircle size={11} /> {label}</span>;
  return <span className="badge badge-amber flex items-center gap-1"><AlertTriangle size={11} /> {label}</span>;
}

function VarianceIcon({ pct }: { pct: number }) {
  if (pct > 5) return <TrendingUp size={13} className="text-red-500" />;
  if (pct < -5) return <TrendingDown size={13} className="text-emerald-500" />;
  return <Minus size={13} className="text-slate-400" />;
}

// ─── Expandable Section ───────────────────────────────────────────────────────

function ReportSection({ id, title, icon, children, defaultOpen = true }: {
  id: string; title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="panel" style={{ scrollMarginTop: "120px" }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer text-left"
        style={{ padding: "1.25rem 1.5rem" }}
      >
        <h3 className="section-label flex items-center gap-2 m-0">{icon} {title}</h3>
        <span style={{ color: "#9CA3AF", fontSize: "0.6875rem", fontWeight: 700 }}>{open ? "Collapse" : "Expand"}</span>
      </button>
      <Collapsible open={open}>
        <div style={{ padding: "0 1.5rem 1.5rem" }}>{children}</div>
      </Collapsible>
    </section>
  );
}

function LoadingPanel({ stage }: { stage: string }) {
  return (
    <div className="panel" style={{ padding: "3rem 2rem", textAlign: "center" }}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">Assessment in progress</p>
      <ProcessingStages stages={LOADING_STEPS} hint={stage} />
    </div>
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({ result, onReset }: { result: AuditResult; onReset: () => void }) {
  const reduced = useReducedMotion();
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  const risk = riskColor(result.risk_score ?? null);
  const totalArithmeticImpact = (result.arithmetic_errors || []).reduce((s, e) => s + (e.financial_impact || 0), 0);
  const totalScopeGapCost = (result.scope_gaps || []).reduce((s, g) => s + (g.estimated_cost_etb || 0), 0);
  const criticalCount = (result.contractual_traps || []).filter(t => t.severity === "CRITICAL" || t.severity === "HIGH").length;
  const isClean = criticalCount === 0 && result.recommendation === "PROCEED";

  return (
    <StaggeredList className="space-y-5" stagger={0.13}>

      {/* Report masthead */}
      <StaggerItem>
        <div className="panel" style={{ padding: "1.5rem" }}>
          <div className="flex justify-between items-start flex-wrap gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Forensic Audit Complete</p>
              <h2 className="text-xl font-black text-slate-900">{result.project_name}</h2>
            </div>
            <div className="flex gap-2">
              <button onClick={() => downloadAuditExcel(result)} className="btn-primary">
                <FileText size={14} /> Export Professional Excel
              </button>
              <button onClick={onReset} className="btn-ghost"><RotateCcw size={13} /> Reset</button>
            </div>
          </div>
        </div>
      </StaggerItem>

      {isClean && <StaggerItem><CleanAuditBeat /></StaggerItem>}

      {/* Top metrics row */}
      <StaggerItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`panel p-6 ${risk.bg} border ${risk.border}`}>
            <p className="section-label">Risk Index</p>
            <div className={`mt-1 ${risk.text}`}>
              {result.risk_score != null ? (
                <AnimatedScore value={result.risk_score} suffix={<span style={{ fontSize: "0.875rem", color: "#9CA3AF" }}>/100</span>} color={risk.hex} fontSize="3rem" />
              ) : (
                <span style={{ fontSize: "1.5rem", fontWeight: 900 }}>—</span>
              )}
            </div>
            <div className="mt-2 h-2 bg-white/60 rounded-full overflow-hidden">
              <div className={`h-full ${risk.bar} rounded-full transition-all`} style={{ width: result.risk_score != null ? `${result.risk_score}%` : "100%" }} />
            </div>
            <p className={`text-[10px] font-black uppercase tracking-widest mt-2 ${risk.text}`}>{risk.label}</p>
            {result.risk_score == null && (
              <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
                {result.priced_item_count ?? 0}/{result.total_item_count ?? 0} BOQ items had a verified reference price. Too little pricing evidence to compute a reliable score — review pricing manually before relying on this audit.
              </p>
            )}
            <div className="mt-3"><RecBadge rec={result.recommendation} /></div>
          </div>

          <div className="md:col-span-2 panel p-6 bg-white flex flex-col justify-between gap-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Contract Value</p>
                <p className="font-black text-lg">{(result.contract_value || 0).toLocaleString()} ETB</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Target Margin</p>
                <p className="font-black text-lg">{result.target_margin}%</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Arithmetic Exposure</p>
                <p className={`font-black text-lg ${totalArithmeticImpact > 0 ? "text-red-600" : "text-slate-800"}`}>
                  {totalArithmeticImpact > 0 ? `${totalArithmeticImpact.toLocaleString()} ETB` : "None found"}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                <TrendingUp size={12} className="inline mr-1 text-blue-600" />
                {result.executive_summary}
              </p>
            </div>
          </div>
        </div>
      </StaggerItem>

      {/* Section nav */}
      <StaggerItem>
        <div className="panel" style={{ position: "sticky", top: 88, zIndex: 20, padding: "0.5rem 0.75rem", display: "flex", gap: "0.25rem", overflowX: "auto", alignItems: "center" }}>
          {criticalCount > 0 && (
            <button onClick={() => jump("risk-register")} className="badge badge-red" style={{ cursor: "pointer", border: "1px solid #FECACA", flexShrink: 0 }}>
              ⚑ {criticalCount} critical / high — jump to register
            </button>
          )}
          {REPORT_NAV.map((s) => (
            <button key={s.id} onClick={() => jump(s.id)} className="btn-ghost" style={{ fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
              {s.label} <ArrowDown size={11} />
            </button>
          ))}
        </div>
      </StaggerItem>

      {/* Key Risks Banner */}
      {(result.key_risks || []).length > 0 && (
        <StaggerItem>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700 flex items-center gap-1 mb-2">
              <AlertCircle size={12} /> Top Risk Signals
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {result.key_risks.map((riskItem, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-red-800">
                  <span className="text-red-400 mt-0.5">▸</span> {riskItem}
                </div>
              ))}
            </div>
          </div>
        </StaggerItem>
      )}

      {/* Methodology Critique */}
      <StaggerItem>
        <ReportSection id="methodology" title="Methodology Critique" icon={<HardHat size={15} className="text-blue-600" />}>
          <p className="text-[12px] text-slate-600 leading-relaxed mb-4">{result.technical_critique}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(result.methodology_strengths || []).length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase text-emerald-700 mb-2 flex items-center gap-1"><CheckCircle2 size={11} /> Strengths</p>
                <ul className="space-y-1">
                  {result.methodology_strengths.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">✓</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(result.methodology_weaknesses || []).length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase text-red-700 mb-2 flex items-center gap-1"><XCircle size={11} /> Weaknesses</p>
                <ul className="space-y-1">
                  {result.methodology_weaknesses.map((w, i) => (
                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">✗</span> {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ReportSection>
      </StaggerItem>

      <StaggerItem>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ReportSection id="resources" title="Resource Adequacy" icon={<Activity size={15} className="text-indigo-600" />}>
            <p className="text-[12px] text-slate-600 leading-relaxed">{result.resource_gap_analysis}</p>
            {result.plant_adequacy_assessment && (
              <div className="mt-3 p-3 bg-indigo-50 border border-indigo-100 rounded text-[11px] text-indigo-800">
                <span className="font-black uppercase text-[9px] tracking-widest block mb-1">Plant Adequacy</span>
                {result.plant_adequacy_assessment}
              </div>
            )}
            {(result.scope_gaps || []).length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] font-black uppercase text-amber-700 mb-2">Scope Gaps Detected ({result.scope_gaps.length})</p>
                <div className="space-y-2">
                  {result.scope_gaps.map((g, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-100 p-2.5 rounded">
                      <span className="font-black text-[10px] text-amber-800 block">{g.missing_element}</span>
                      <p className="text-[10px] text-slate-600 mt-0.5">{g.risk_impact}</p>
                      {g.estimated_cost_etb > 0 && (
                        <span className="text-[10px] font-bold text-amber-700 mt-1 block">
                          Est. impact: {g.estimated_cost_etb.toLocaleString()} ETB
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {totalScopeGapCost > 0 && (
                  <p className="text-[10px] font-black text-amber-800 mt-2 text-right">
                    Total gap exposure: {totalScopeGapCost.toLocaleString()} ETB
                  </p>
                )}
              </div>
            )}
          </ReportSection>

          <ReportSection id="arithmetic" title="Arithmetic & BoQ Errors" icon={<Calculator size={15} className="text-orange-600" />}>
            {(result.arithmetic_errors || []).length === 0 ? (
              <div className="flex items-center gap-2 text-[12px] text-emerald-700 bg-emerald-50 p-3 rounded border border-emerald-100">
                <CheckCircle2 size={14} /> No arithmetic errors detected in this audit.
              </div>
            ) : (
              <div className="space-y-3">
                {result.arithmetic_errors.map((e, i) => (
                  <div key={i} className="border border-orange-100 bg-orange-50/50 p-3 rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase ${severityColor(e.severity)}`}>{e.severity}</span>
                      {e.financial_impact > 0 && (
                        <span className="text-[10px] font-bold text-red-700">{e.financial_impact.toLocaleString()} ETB exposure</span>
                      )}
                    </div>
                    <p className="text-[10px] font-black text-slate-700">{e.location}</p>
                    <p className="text-[11px] text-slate-600 mt-1">{e.description}</p>
                  </div>
                ))}
                {totalArithmeticImpact > 0 && (
                  <div className="text-right text-[10px] font-black text-red-700 border-t border-orange-100 pt-2">
                    Total financial exposure: {totalArithmeticImpact.toLocaleString()} ETB
                  </div>
                )}
              </div>
            )}
          </ReportSection>
        </div>
      </StaggerItem>

      {/* Legal & FIDIC Traps */}
      <StaggerItem>
        <ReportSection id="risk-register" title="Legal & FIDIC Contractual Risk Analysis" icon={<Scale size={15} className="text-red-600" />}>
          {(result.contractual_traps || []).length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-emerald-700 bg-emerald-50 p-3 rounded border border-emerald-100">
              <CheckCircle2 size={14} /> No significant contractual traps or FIDIC clause violations detected.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500 mb-3">
                {result.contractual_traps.length} contractual risk{result.contractual_traps.length !== 1 ? "s" : ""} identified. FIDIC clause references provided where applicable.
              </p>
              {result.contractual_traps.map((t, i) => {
                const urgent = t.severity === "CRITICAL" || t.severity === "HIGH";
                return (
                  <motion.div key={i}
                    initial={reduced ? false : urgent ? { opacity: 0, x: -16, backgroundColor: "rgba(254,242,242,1)" } : { opacity: 0, y: 8 }}
                    animate={reduced ? {} : urgent ? { opacity: 1, x: 0, backgroundColor: "rgba(254,242,242,0)" } : { opacity: 1, y: 0 }}
                    transition={urgent ? { type: "spring", stiffness: 520, damping: 26, backgroundColor: { duration: 1.4 }, delay: 0.1 + i * 0.12 } : { duration: 0.3, delay: 0.1 + i * 0.12 }}
                    className="border border-red-100 rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center justify-between bg-red-50/70 px-4 py-2.5 border-b border-red-100">
                      <div className="flex items-center gap-3">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase ${severityColor(t.severity)}`}>
                          {t.severity}
                        </span>
                        <span className="font-black text-[11px] text-slate-800 uppercase tracking-wide">{t.clause_type}</span>
                      </div>
                      {t.fidic_ref && (
                        <span className="text-[10px] text-slate-500 font-mono bg-white border border-slate-200 px-2 py-0.5 rounded">
                          FIDIC {t.fidic_ref}
                        </span>
                      )}
                    </div>
                    <div className="p-4 bg-white space-y-2">
                      <p className="text-[12px] text-slate-700 leading-relaxed">{t.description}</p>
                      {t.recommendation && (
                        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded p-2.5">
                          <BookOpen size={12} className="text-blue-500 mt-0.5 flex-shrink-0" />
                          <p className="text-[11px] text-blue-800"><span className="font-black">Recommended Action: </span>{t.recommendation}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </ReportSection>
      </StaggerItem>

      {/* Market Calibration */}
      <StaggerItem>
        <ReportSection id="market" title="Market Rate Calibration" icon={<BarChart2 size={15} className="text-amber-600" />}>
          {(result.market_variance || []).length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-600 bg-slate-50 p-3 rounded border border-slate-200">
              <Minus size={14} /> No market variance data available for this bid.
            </div>
          ) : (
            <div>
              <p className="text-[11px] text-slate-500 mb-4">
                Comparison of bid rates against current Ethiopian construction market benchmarks. Variances &gt;±10% flagged for review.
              </p>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-red-50 border border-red-100 rounded p-3 text-center">
                  <p className="text-[10px] font-black text-red-700 uppercase">Overpriced Items</p>
                  <p className="text-2xl font-black text-red-600">
                    {result.market_variance.filter(m => m.variance_pct > 10).length}
                  </p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded p-3 text-center">
                  <p className="text-[10px] font-black text-slate-500 uppercase">Within Range</p>
                  <p className="text-2xl font-black text-slate-700">
                    {result.market_variance.filter(m => Math.abs(m.variance_pct) <= 10).length}
                  </p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded p-3 text-center">
                  <p className="text-[10px] font-black text-emerald-700 uppercase">Underpriced Items</p>
                  <p className="text-2xl font-black text-emerald-600">
                    {result.market_variance.filter(m => m.variance_pct < -10).length}
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-2.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Item</th>
                      <th className="text-left px-4 py-2.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Category</th>
                      <th className="text-right px-4 py-2.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Bid Rate</th>
                      <th className="text-right px-4 py-2.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Market Rate</th>
                      <th className="text-right px-4 py-2.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.market_variance.map((m, i) => {
                      const isOver = m.variance_pct > 10;
                      const isUnder = m.variance_pct < -10;
                      const urgent = isOver;
                      return (
                        <motion.tr key={i}
                          initial={reduced ? false : urgent ? { opacity: 0, x: -16, backgroundColor: "rgba(254,242,242,1)" } : { opacity: 0, y: 8 }}
                          animate={reduced ? {} : urgent ? { opacity: 1, x: 0, backgroundColor: "rgba(254,242,242,0)" } : { opacity: 1, y: 0 }}
                          transition={urgent ? { type: "spring", stiffness: 520, damping: 26, backgroundColor: { duration: 1.4 }, delay: 0.1 + i * 0.12 } : { duration: 0.3, delay: 0.1 + i * 0.12 }}
                          className={`border-b border-slate-100 last:border-0 ${isOver ? "bg-red-50/30" : isUnder ? "bg-emerald-50/30" : ""}`}
                        >
                          <td className="px-4 py-3 font-bold text-slate-800">{m.item}</td>
                          <td className="px-4 py-3 text-slate-500">{m.category}</td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">
                            {m.our_rate ? `${m.our_rate.toLocaleString()}${m.unit ? ` ETB/${m.unit}` : ""}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-600">
                            {m.market_rate ? `${m.market_rate.toLocaleString()}${m.unit ? ` ETB/${m.unit}` : ""}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <VarianceIcon pct={m.variance_pct} />
                              <span className={`font-black ${isOver ? "text-red-600" : isUnder ? "text-emerald-600" : "text-slate-600"}`}>
                                {m.variance_pct > 0 ? "+" : ""}{m.variance_pct}%
                              </span>
                            </div>
                            {m.note && <p className="text-[10px] text-slate-400 mt-0.5 text-left">{m.note}</p>}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ReportSection>
      </StaggerItem>

      {/* Financial Risk Summary */}
      {result.financial_risk_summary && (
        <StaggerItem>
          <div id="financial" className="panel p-5 border border-slate-200 bg-slate-50/50" style={{ scrollMarginTop: "120px" }}>
            <h4 className="section-label flex items-center gap-2 mb-3"><Award size={14} className="text-blue-600" /> Financial Risk Summary</h4>
            <p className="text-[12px] text-slate-600 leading-relaxed">{result.financial_risk_summary}</p>
          </div>
        </StaggerItem>
      )}

      <StaggerItem>
        <div className="panel p-4 bg-[#0F2240] text-slate-300">
          <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-blue-400 mb-2">
            <ShieldAlert size={12} /> Regulatory & Compliance Assessment
          </p>
          <p className="text-[11px] leading-relaxed italic">"{result.regulatory_compliance}"</p>
        </div>
      </StaggerItem>

    </StaggeredList>
  );
}

// ─── Main Audit Page ──────────────────────────────────────────────────────────

function AuditPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [projectName, setProjectName] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [targetMargin, setTargetMargin] = useState("15.0");
  const [projectType, setProjectType] = useState("construction");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runAudit = async () => {
    if (!projectName || !contractValue) return setError("Project name and contract value are required.");
    setLoading(true);
    setError(null);
    setLoadingStage("Initializing forensic engine...");

    try {
      const fileList = files.map(f => f.name).join(", ") || "No files uploaded (manual entry)";

      setLoadingStage("Running deep risk analysis...");

      const systemPrompt = `You are VLT-Core, a senior forensic construction bid auditor with 20+ years of experience in Ethiopian and East African infrastructure projects. You specialize in FIDIC contract analysis, Ethiopian procurement law (PPA 2011 and ERA specifications), and BoQ validation.

Your task is to produce a DEEP, COMPREHENSIVE forensic audit. Every section MUST contain substantive, specific content — never return empty arrays or vague placeholders.

CRITICAL OUTPUT RULES:
1. Return ONLY valid JSON. No markdown, no code fences, no preamble.
2. Every array must have AT LEAST 2-4 items with realistic, specific data.
3. market_variance MUST contain 4-6 specific line items with actual ETB rates and percentages.
4. contractual_traps MUST contain 2-4 specific FIDIC clause references with real clause numbers.
5. Be specific to Ethiopian construction context (use ETB rates, local material names, ERA/EIC references).

**IMPORTANT**: Do NOT include a "risk_score" field in the JSON. We will calculate it separately from the provided data.

Return this exact JSON structure:
{
  "recommendation": <"PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE">,
  "executive_summary": <2-3 sentence summary with specific financial observations>,
  "financial_risk_summary": <detailed paragraph on financial exposure and margin sustainability>,
  "key_risks": [<4-6 specific risk statements, each one sentence>],
  "technical_critique": <2-3 paragraph detailed methodology assessment>,
  "methodology_strengths": [<3-4 specific strengths observed>],
  "methodology_weaknesses": [<3-4 specific weaknesses or gaps>],
  "plant_adequacy_assessment": <1-2 sentences on plant and equipment sufficiency>,
  "arithmetic_errors": [
    {
      "location": <specific BoQ section or item reference>,
      "description": <what the error is>,
      "severity": <"HIGH" | "MEDIUM" | "LOW">,
      "financial_impact": <estimated ETB value as integer, 0 if unknown>
    }
  ],
  "contractual_traps": [
    {
      "clause_type": <specific contract clause name, e.g. "Liquidated Damages", "Retention Money", "Variation Clause">,
      "fidic_ref": <FIDIC clause number e.g. "Clause 8.7" or "Sub-Clause 14.9">,
      "severity": <"CRITICAL" | "HIGH" | "MEDIUM" | "LOW">,
      "description": <specific risk this clause poses in 2-3 sentences>,
      "recommendation": <specific action to mitigate this risk>
    }
  ],
  "market_variance": [
    {
      "item": <specific material or labor item name>,
      "category": <"Labor" | "Materials" | "Equipment" | "Subcontract">,
      "our_rate": <bid rate as number>,
      "market_rate": <current Ethiopian market rate as number>,
      "variance_pct": <percentage as number, positive = overpriced, negative = underpriced>,
      "unit": <unit of measurement e.g. "m3", "kg", "day">,
      "note": <brief explanation of the variance>
    }
  ],
  "scope_gaps": [
    {
      "missing_element": <specific missing scope item>,
      "risk_impact": <how this gap affects project delivery>,
      "estimated_cost_etb": <estimated cost to cover gap as integer>
    }
  ],
  "resource_gap_analysis": <detailed paragraph on labor, equipment, and subcontractor capacity>,
  "regulatory_compliance": <specific statement on Ethiopian procurement law, EIC, and ERA compliance>
}`;

      const userPrompt = `Conduct a full forensic audit of this construction bid:

Project Name: ${projectName}
Project Type: ${projectType}
Contract Value: ${contractValue} ETB
Target Margin: ${targetMargin}%
Submitted Documents: ${fileList}

Apply Ethiopian construction market context. Flag FIDIC risks, validate BoQ rates against current Addis Ababa/Ethiopian market rates (2024-2025), and assess methodology for ERA specification compliance. Be specific and actionable.`;

      // Route through our own serverless proxy (api/check-analysis.js)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in to run an audit.");

      const res = await fetch("/api/check-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ systemPrompt, userPrompt })
      });

      const analysis = await res.json();
      if (!res.ok) throw new Error(analysis.error || `API Error ${res.status}`);

      setLoadingStage("Processing audit findings...");

      // The risk_score is already computed by the backend via calculateRiskScore().
      // It may be null when pricing coverage was too thin to stand behind a
      // confident score — never substitute a fake default number here, or
      // an "insufficient data" audit silently becomes a fabricated "50/100
      // medium risk" everywhere downstream (history, dashboard averages).
      const finalScore = analysis.risk_score ?? null;

      // Ensure arrays are always arrays (defensive)
      analysis.contractual_traps = Array.isArray(analysis.contractual_traps) ? analysis.contractual_traps : [];
      analysis.market_variance = Array.isArray(analysis.market_variance) ? analysis.market_variance : [];
      analysis.arithmetic_errors = Array.isArray(analysis.arithmetic_errors) ? analysis.arithmetic_errors : [];
      analysis.scope_gaps = Array.isArray(analysis.scope_gaps) ? analysis.scope_gaps : [];
      analysis.methodology_strengths = Array.isArray(analysis.methodology_strengths) ? analysis.methodology_strengths : [];
      analysis.methodology_weaknesses = Array.isArray(analysis.methodology_weaknesses) ? analysis.methodology_weaknesses : [];
      analysis.key_risks = Array.isArray(analysis.key_risks) ? analysis.key_risks : [];

      setLoadingStage("Saving to database...");

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await insertAudit({
          user_id: user.id,
          project_name: projectName,
          file_name: files.map(f => f.name).join(" | ") || "Manual Entry",
          contract_value: Number(contractValue),
          target_margin: Number(targetMargin),
          risk_score: finalScore,
          status: "completed",
          analysis
        });
        dispatchAuditsUpdated();
      }

      setResult({
        ...analysis,
        risk_score: finalScore,
        project_name: projectName,
        contract_value: Number(contractValue),
        target_margin: Number(targetMargin)
      });

    } catch (e: any) {
      setError(e.message || "Audit failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingStage("");
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="page-header">
        <h1 className="page-title uppercase tracking-tighter">Bid Audit Engine</h1>
        <p className="page-subtitle uppercase font-black text-[10px] tracking-widest">Forensic AI v3.0 — Deep Analysis Mode</p>
      </div>

      {result ? (
        <ResultsPanel
          result={result}
          onReset={() => { setResult(null); setFiles([]); setProjectName(""); setContractValue(""); }}
        />
      ) : loading ? (
        <LoadingPanel stage={loadingStage} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Form */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded p-8 space-y-6 shadow-sm">

            <div>
              <label className="section-label">Project Name *</label>
              <input
                className="field-input"
                placeholder="e.g. Addis Ababa Ring Road Phase 3"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
              />
            </div>

            <div>
              <label className="section-label">Project Type</label>
              <select
                className="field-input"
                value={projectType}
                onChange={e => setProjectType(e.target.value)}
              >
                <option value="construction">Building & Civil Construction</option>
                <option value="road">Road & Highway</option>
                <option value="water">Water & Sanitation</option>
                <option value="electromechanical">Electromechanical</option>
                <option value="supply">Supply & Installation</option>
              </select>
            </div>

            <div>
              <label className="section-label">Source Documents (optional)</label>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept=".pdf,.xlsx,.xls,.docx,.doc"
                onChange={e => e.target.files && setFiles([...Array.from(e.target.files)])}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="dropzone cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <UploadCloud size={20} className="text-slate-400 mb-1" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Click to upload BoQ, Specs, Drawings
                </p>
                <p className="text-[9px] text-slate-300 mt-1">PDF, XLSX, DOCX accepted</p>
              </div>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="text-[10px] font-bold bg-slate-50 p-2 border rounded flex justify-between items-center">
                      <span className="flex items-center gap-1.5"><FileText size={11} className="text-blue-500" />{f.name}</span>
                      <X size={12} className="cursor-pointer text-slate-400 hover:text-red-500" onClick={() => setFiles(files.filter((_, idx) => idx !== i))} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="section-label">Contract Value (ETB) *</label>
                <input
                  type="number"
                  className="field-input"
                  placeholder="e.g. 1234567"
                  value={contractValue}
                  onChange={e => setContractValue(e.target.value)}
                />
              </div>
              <div>
                <label className="section-label">Target Margin %</label>
                <input
                  type="number"
                  step="0.1"
                  className="field-input"
                  value={targetMargin}
                  onChange={e => setTargetMargin(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-[11px] text-red-700 bg-red-50 p-3 rounded border border-red-200">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <button
              onClick={runAudit}
              disabled={loading || !projectName || !contractValue}
              className="btn-primary w-full py-4 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} />
                  {loadingStage || "Running forensic audit..."}
                </span>
              ) : (
                "Execute Deep Forensic Audit"
              )}
            </button>

          </div>

          {/* Sidebar */}
          <div className="lg:col-span-5 bg-slate-900 rounded-lg p-8 text-white space-y-5">
            <img src={logo} alt="BidSwift AI" style={{ height: "28px", filter: "brightness(0) invert(1)" }} />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Deep forensic analysis powered by VLT-Core v3. Covers FIDIC compliance, BoQ arithmetic, market calibration, and regulatory risk.
            </p>
            <div className="space-y-3 border-t border-slate-700 pt-4">
              {[
                { icon: Scale, label: "Legal & FIDIC Trap Analysis", desc: "Clause-level risk with remediation steps" },
                { icon: BarChart2, label: "Market Rate Calibration", desc: "Item-by-item vs. Ethiopian market benchmarks" },
                { icon: Calculator, label: "Arithmetic Error Detection", desc: "BoQ extension and total validation" },
                { icon: Activity, label: "Plant & Resource Assessment", desc: "Capacity gaps and scope omissions" },
                { icon: ShieldAlert, label: "Regulatory Compliance", desc: "PPA 2011, ERA specs, EIC standards" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex gap-3">
                  <Icon size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-black text-white">{label}</p>
                    <p className="text-[10px] text-slate-400">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}