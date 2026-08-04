import { downloadAuditExcel } from "@/utils/download";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertAudit, dispatchAuditsUpdated } from "@/integrations/supabase/audits";
import { AuditChatSidebar } from "@/components/AuditChatSidebar";
import {
  UploadCloud, Loader2, FileText, X, CheckCircle2, XCircle, AlertTriangle,
  RotateCcw, ShieldAlert, Activity, Scale, HardHat, Banknote, Users,
  ChevronLeft, ChevronRight, AlertCircle, TrendingUp, MessageSquareText, Table2,
} from "lucide-react";
import logo from "../../assets/logo.png";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

// ─── Types (new flat payload from VLT-Core v4) ───────────────────────────────

export type BoqItem = {
  item_no: string;
  description: string;
  qty: number;
  unit: string;
};

export type AuditResult = {
  risk_score: number;        // 0-10
  opportunity_score: number; // 0-10
  recommendation: "PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE";
  summary: string;
  risks: string[];           // "Payment: ...", "Legal: ...", "Execution: ...", "Competition: ..."
  boq_items: BoqItem[];
  project_name: string;
  contract_value: number;
  target_margin: number;
};

// ─── Core AI Audit Prompt (token-efficient, Groq/Ollama compatible) ──────────

export const AUDIT_SYSTEM_PROMPT = `You are VLT-Core, an expert construction tender auditor. Analyze the tender data and return ONLY one flat JSON object. No markdown, no code fences, no text outside the JSON.

Schema (exact keys, exact types):
{"risk_score":<int 0-10>,"opportunity_score":<int 0-10>,"recommendation":"PROCEED"|"PROCEED_WITH_CAUTION"|"DECLINE","summary":"<max 2 sentences>","risks":["<Category>: <specific risk, one sentence>"],"boq_items":[{"item_no":"<string>","description":"<max 12 words>","qty":<number>,"unit":"<string>"}]}

Rules:
- Every entry in "risks" MUST start with exactly one of: "Payment: ", "Legal: ", "Execution: ", "Competition: ". Include at least 1 entry per category when evidence exists.
- risk_score: 10 = extreme exposure (payment terms, liquidated damages, penalties, scope ambiguity). opportunity_score: 10 = large budget + strong strategic fit.
- boq_items: extract every measurable line item found in the tender text. qty must be numeric. Use [] if none are present. Never invent items, rates, or clauses.
- Scores are integers. Output must parse with JSON.parse.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore10(v: unknown): number {
  let n = Number(v ?? 0);
  if (!isFinite(n)) n = 0;
  if (n > 10) n = n / 10; // model returned 0-100
  return Math.round(Math.max(0, Math.min(10, n)));
}

function riskTone(score: number) {
  if (score <= 3) return { text: "text-emerald-600", bar: "bg-emerald-500", bg: "bg-emerald-50", border: "border-emerald-200", label: "LOW RISK" };
  if (score <= 6) return { text: "text-amber-600", bar: "bg-amber-500", bg: "bg-amber-50", border: "border-amber-200", label: "MEDIUM RISK" };
  return { text: "text-red-600", bar: "bg-red-600", bg: "bg-red-50", border: "border-red-200", label: "HIGH RISK" };
}

function oppTone(score: number) {
  if (score >= 7) return { text: "text-emerald-600", bar: "bg-emerald-500", bg: "bg-emerald-50", border: "border-emerald-200", label: "STRONG FIT" };
  if (score >= 4) return { text: "text-amber-600", bar: "bg-amber-500", bg: "bg-amber-50", border: "border-amber-200", label: "MODERATE FIT" };
  return { text: "text-slate-500", bar: "bg-slate-400", bg: "bg-slate-50", border: "border-slate-200", label: "WEAK FIT" };
}

function RecBadge({ rec }: { rec?: string }) {
  const s = rec || "PROCEED_WITH_CAUTION";
  const label = s.replace(/_/g, " ");
  if (s === "PROCEED") return <span className="badge badge-green flex items-center gap-1"><CheckCircle2 size={11} /> {label}</span>;
  if (s === "DECLINE") return <span className="badge badge-red flex items-center gap-1"><XCircle size={11} /> {label}</span>;
  return <span className="badge badge-amber flex items-center gap-1"><AlertTriangle size={11} /> {label}</span>;
}

// ─── Risk categorization (parses the "Category: text" prefix contract) ───────

const RISK_CATEGORIES = [
  { key: "Payment", title: "Payment Risk", icon: <Banknote size={14} className="text-red-600" />, accent: "border-l-red-600" },
  { key: "Legal", title: "Legal / Contractual Risk", icon: <Scale size={14} className="text-orange-600" />, accent: "border-l-orange-500" },
  { key: "Execution", title: "Execution Risk", icon: <HardHat size={14} className="text-indigo-600" />, accent: "border-l-indigo-600" },
  { key: "Competition", title: "Competition Risk", icon: <Users size={14} className="text-blue-600" />, accent: "border-l-blue-600" },
] as const;

function groupRisks(risks: string[]) {
  const grouped: Record<string, string[]> = { Payment: [], Legal: [], Execution: [], Competition: [], Other: [] };
  (risks || []).forEach(r => {
    const match = /^(Payment|Legal|Execution|Competition)\s*:\s*(.+)$/i.exec(String(r));
    if (match) grouped[match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()].push(match[2]);
    else grouped.Other.push(String(r));
  });
  return grouped;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function ScoreCard({ label, score, tone, icon }: {
  label: string; score: number;
  tone: { text: string; bar: string; bg: string; border: string; label: string };
  icon: React.ReactNode;
}) {
  return (
    <div className={`panel p-6 ${tone.bg} border ${tone.border}`}>
      <p className="section-label flex items-center gap-2">{icon} {label}</p>
      <div className={`text-5xl font-black mt-1 ${tone.text}`}>
        {score}<span className="text-2xl text-slate-400">/10</span>
      </div>
      <div className="mt-3 h-2 bg-white/60 rounded-full overflow-hidden">
        <div className={`h-full ${tone.bar} rounded-full transition-all`} style={{ width: `${score * 10}%` }} />
      </div>
      <p className={`text-[10px] font-black uppercase tracking-widest mt-2 ${tone.text}`}>{tone.label}</p>
    </div>
  );
}

// ─── Paginated BoQ table ──────────────────────────────────────────────────────

const BOQ_PAGE_SIZE = 10;

function BoqTable({ items }: { items: BoqItem[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / BOQ_PAGE_SIZE));
  const rows = useMemo(
    () => items.slice(page * BOQ_PAGE_SIZE, page * BOQ_PAGE_SIZE + BOQ_PAGE_SIZE),
    [items, page]
  );

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-slate-600 bg-slate-50 p-3 rounded border border-slate-200">
        <Table2 size={14} /> No BoQ line items were extracted from the submitted documents.
      </div>
    );
  }

  const from = page * BOQ_PAGE_SIZE + 1;
  const to = Math.min(items.length, (page + 1) * BOQ_PAGE_SIZE);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "72px" }}>No.</th>
              <th>Description</th>
              <th className="text-right" style={{ width: "110px" }}>Qty</th>
              <th style={{ width: "90px" }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={`${b.item_no}-${i}`}>
                <td className="muted" style={{ fontFamily: "monospace", fontSize: "0.6875rem" }}>{b.item_no || "—"}</td>
                <td style={{ fontWeight: 500 }}>{b.description}</td>
                <td className="text-right" style={{ fontFamily: "monospace" }}>
                  {Number(b.qty ?? 0).toLocaleString()}
                </td>
                <td className="muted">{b.unit || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-200">
        <span className="text-[11px] text-slate-500">
          Showing {from}–{to} of {items.length} items
        </span>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost"
            style={{ padding: "0.25rem 0.5rem" }}
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            <ChevronLeft size={13} /> Prev
          </button>
          <span className="text-[11px] font-bold text-slate-600 px-1">{page + 1} / {pageCount}</span>
          <button
            className="btn-ghost"
            style={{ padding: "0.25rem 0.5rem" }}
            disabled={page >= pageCount - 1}
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
          >
            Next <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({ result, onReset, onOpenChat }: {
  result: AuditResult; onReset: () => void; onOpenChat: () => void;
}) {
  const risk = riskTone(result.risk_score);
  const opp = oppTone(result.opportunity_score);
  const grouped = groupRisks(result.risks);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Audit Complete</p>
          <h2 className="text-xl font-black text-slate-900">{result.project_name}</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenChat} className="btn-accent">
            <MessageSquareText size={14} /> Ask the Estimator
          </button>
          <button onClick={() => downloadAuditExcel(result)} className="btn-primary">
            <FileText size={14} /> Export Excel
          </button>
          <button onClick={onReset} className="btn-ghost"><RotateCcw size={13} /> Reset</button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard label="Risk Score" score={result.risk_score} tone={risk} icon={<ShieldAlert size={13} className="text-slate-400" />} />
        <ScoreCard label="Opportunity Score" score={result.opportunity_score} tone={opp} icon={<TrendingUp size={13} className="text-slate-400" />} />
        <div className="panel p-6 bg-white flex flex-col justify-between gap-3">
          <div>
            <p className="section-label flex items-center gap-2"><Activity size={13} className="text-slate-400" /> Deal Snapshot</p>
            <div className="mt-2 space-y-2.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Contract Value</span>
                <span className="font-black">{(result.contract_value || 0).toLocaleString()} ETB</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Target Margin</span>
                <span className="font-black">{result.target_margin}%</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-400 font-bold uppercase text-[10px]">BoQ Items</span>
                <span className="font-black">{(result.boq_items || []).length}</span>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100"><RecBadge rec={result.recommendation} /></div>
        </div>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="panel p-4 bg-slate-50/50 border border-slate-200">
          <p className="text-[12px] text-slate-600 leading-relaxed">
            <TrendingUp size={12} className="inline mr-1 text-blue-600" />
            {result.summary}
          </p>
        </div>
      )}

      {/* Categorized risks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {RISK_CATEGORIES.map(cat => (
          <div key={cat.key} className={`panel p-5 shadow-sm border-l-4 ${cat.accent}`}>
            <h4 className="section-label flex items-center gap-2">{cat.icon} {cat.title}</h4>
            {grouped[cat.key].length === 0 ? (
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-1">
                <CheckCircle2 size={12} className="text-emerald-500" /> No material risks identified.
              </p>
            ) : (
              <ul className="space-y-1.5 mt-1">
                {grouped[cat.key].map((r, i) => (
                  <li key={i} className="text-[11px] text-slate-600 flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-300 mt-0.5">▸</span> {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Uncategorized fallback */}
      {grouped.Other.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1 mb-2">
            <AlertCircle size={12} /> Additional Findings
          </p>
          {grouped.Other.map((r, i) => (
            <p key={i} className="text-[11px] text-amber-800">▸ {r}</p>
          ))}
        </div>
      )}

      {/* BoQ table */}
      <div className="panel p-5 shadow-sm border-l-4 border-l-slate-900">
        <h4 className="section-label flex items-center gap-2 mb-3">
          <Table2 size={14} className="text-slate-700" /> Extracted Bill of Quantities
        </h4>
        <BoqTable items={result.boq_items || []} />
      </div>

    </div>
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
  const [auditId, setAuditId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runAudit = async () => {
    if (!projectName || !contractValue) return setError("Project name and contract value are required.");
    setLoading(true);
    setError(null);
    setLoadingStage("Initializing audit engine...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in to run an audit.");
      const fileList = files.map(f => f.name).join(", ") || "No files uploaded (manual entry)";

      setLoadingStage("Running risk & BoQ extraction...");

      const userPrompt = `Audit this construction tender:
Project: ${projectName}
Type: ${projectType}
Contract Value: ${contractValue} ETB
Target Margin: ${targetMargin}%
Documents: ${fileList}

Context: Ethiopian construction market (Addis Ababa, 2024-2025), FIDIC-based contracts, ERA/PPA 2011 procurement rules. Return the JSON object only.`;

      const res = await fetch("/api/check-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ systemPrompt: AUDIT_SYSTEM_PROMPT, userPrompt })
      });

      const analysis = await res.json();
      if (!res.ok) throw new Error(analysis.error || `API Error ${res.status}`);

      setLoadingStage("Processing audit findings...");

      // Normalize and harden the payload
      analysis.risk_score = clampScore10(analysis.risk_score);
      analysis.opportunity_score = clampScore10(analysis.opportunity_score);
      analysis.risks = Array.isArray(analysis.risks) ? analysis.risks.map(String) : [];
      analysis.boq_items = (Array.isArray(analysis.boq_items) ? analysis.boq_items : [])
        .map((b: any) => ({
          item_no: String(b?.item_no ?? ""),
          description: String(b?.description ?? ""),
          qty: Number(b?.qty ?? 0) || 0,
          unit: String(b?.unit ?? ""),
        }));
      analysis.summary = String(analysis.summary ?? "");
      if (!["PROCEED", "PROCEED_WITH_CAUTION", "DECLINE"].includes(analysis.recommendation)) {
        analysis.recommendation = "PROCEED_WITH_CAUTION";
      }

      setLoadingStage("Saving to database...");

      const { data: { user } } = await supabase.auth.getUser();
      let savedId: string | null = null;
      if (user) {
        const saved = await insertAudit({
          user_id: user.id,
          project_name: projectName,
          file_name: files.map(f => f.name).join(" | ") || "Manual Entry",
          contract_value: Number(contractValue),
          target_margin: Number(targetMargin),
          risk_score: analysis.risk_score * 10, // DB column is constrained to 0-100
          status: "completed",
          analysis
        });
        savedId = saved.id;
        dispatchAuditsUpdated();
      }

      setAuditId(savedId);
      setResult({
        ...analysis,
        project_name: projectName,
        contract_value: Number(contractValue),
        target_margin: Number(targetMargin)
      });
      setChatOpen(false); // panel becomes available; opened via button or floating tab

    } catch (e: any) {
      setError(e.message || "Audit failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingStage("");
    }
  };

  const reset = () => {
    setResult(null);
    setAuditId(null);
    setChatOpen(false);
    setFiles([]);
    setProjectName("");
    setContractValue("");
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="page-header">
        <h1 className="page-title uppercase tracking-tighter">Bid Audit Engine</h1>
        <p className="page-subtitle uppercase font-black text-[10px] tracking-widest">VLT-Core v4 — Risk, Opportunity & BoQ Extraction</p>
      </div>

      {result ? (
        <>
          <ResultsPanel result={result} onReset={reset} onOpenChat={() => setChatOpen(true)} />
          <AuditChatSidebar
            auditId={auditId}
            open={chatOpen}
            onToggle={() => setChatOpen(v => !v)}
          />
        </>
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
                  {loadingStage || "Running audit..."}
                </span>
              ) : (
                "Execute Tender Audit"
              )}
            </button>

          </div>

          {/* Sidebar */}
          <div className="lg:col-span-5 bg-slate-900 rounded-lg p-8 text-white space-y-5">
            <img src={logo} alt="Valtor" style={{ height: "28px", filter: "brightness(0) invert(1)" }} />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              VLT-Core v4 scores every tender on Risk and Opportunity (0-10), extracts a clean structured BoQ, and unlocks the post-audit Estimator chat.
            </p>
            <div className="space-y-3 border-t border-slate-700 pt-4">
              {[
                { icon: Banknote, label: "Payment Risk", desc: "Cashflow, retention, and payment-term exposure" },
                { icon: Scale, label: "Legal / Contractual Risk", desc: "FIDIC clauses, LDs, and penalty traps" },
                { icon: HardHat, label: "Execution Risk", desc: "Scope ambiguity, logistics, and capacity gaps" },
                { icon: Users, label: "Competition Risk", desc: "Bid landscape and win-probability signals" },
                { icon: MessageSquareText, label: "Post-Audit Estimator Chat", desc: "Interrogate the audited tender in plain language" },
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
