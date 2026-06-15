import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertAudit, dispatchAuditsUpdated } from "@/integrations/supabase/audits";
import {
  Upload,
  FileText,
  Archive,
  Sheet,
  FileType,
  File,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Sparkles,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Bid Audit — Valtor" }] }),
  component: AuditPage,
});

type Analysis = {
  executive_summary?: string;
  risk_score?: number;
  recommendation?: string;
  financial_assessment?: {
    estimated_cost_etb?: number;
    projected_margin_pct?: number;
    margin_gap_pct?: number;
    cashflow_risk?: string;
  };
  risk_matrix?: Array<{ category: string; severity: string; likelihood: number; impact: string }>;
  evaluation_matrix?: Array<{ criterion: string; score: number; weight: number; notes: string }>;
  key_risks?: string[];
  opportunities?: string[];
  compliance_flags?: string[];
};

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const cls = { width: 16, height: 16 };
  if (ext === "pdf") return <FileText {...cls} color="#B91C1C" />;
  if (ext === "zip") return <Archive {...cls} color="#B45309" />;
  if (ext === "xlsx" || ext === "xls") return <Sheet {...cls} color="#15803D" />;
  if (ext === "docx" || ext === "doc") return <FileType {...cls} color="#1D4ED8" />;
  return <File {...cls} color="#6B7280" />;
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncName(name: string, max = 40) {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function exportToExcel(analysis: Analysis, projectName: string) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Evaluation Matrix
  if (Array.isArray(analysis.evaluation_matrix) && analysis.evaluation_matrix.length > 0) {
    const evalData = [
      ["Criterion", "Score (0–10)", "Weight (%)", "Weighted Score", "Notes"],
      ...analysis.evaluation_matrix.map((r) => [
        r.criterion,
        r.score,
        `${(r.weight * 100).toFixed(0)}%`,
        (r.score * r.weight).toFixed(2),
        r.notes,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evalData), "Evaluation Matrix");
  }

  // Sheet 2 — Risk Matrix
  if (Array.isArray(analysis.risk_matrix) && analysis.risk_matrix.length > 0) {
    const riskData = [
      ["Category", "Severity", "Likelihood (%)", "Impact"],
      ...analysis.risk_matrix.map((r) => [r.category, r.severity, r.likelihood, r.impact]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskData), "Risk Matrix");
  }

  // Sheet 3 — BoQ Skeleton
  const boqData = [
    ["#", "Item", "Description", "Unit", "Qty", "Unit Rate (ETB)", "Total (ETB)"],
    [1, "Mobilisation", "Site mobilisation & preliminary works", "LS", 1, 2_500_000, 2_500_000],
    [2, "Earthworks", "Bulk excavation & fill", "m³", 8_400, 850, 7_140_000],
    [3, "Concrete Works", "Foundation concrete C25/30", "m³", 1_200, 12_500, 15_000_000],
    [4, "Reinforcement", "Grade 60 rebar supply & fix", "ton", 180, 85_000, 15_300_000],
    [5, "Masonry", "Block wall construction", "m²", 3_600, 4_200, 15_120_000],
    [6, "Roofing", "IBR sheet roofing system", "m²", 2_100, 6_800, 14_280_000],
    [7, "MEP", "Mechanical, electrical & plumbing", "LS", 1, 18_000_000, 18_000_000],
    [8, "Finishes", "Internal & external finishes", "m²", 5_400, 3_500, 18_900_000],
    ["", "", "", "", "", "TOTAL", { f: "SUM(G2:G9)" }],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(boqData), "BoQ Skeleton");

  const date = new Date().toISOString().slice(0, 10);
  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  XLSX.writeFile(wb, `Valtor_BoQ_${safeName}_${date}.xlsx`);
}

function severityBadge(s: string) {
  const k = s?.toUpperCase();
  if (k === "CRITICAL") return <span className="badge badge-red">Critical</span>;
  if (k === "HIGH") return <span className="badge badge-red" style={{ background: "#FEF2F2", color: "#B91C1C" }}>High</span>;
  if (k === "MEDIUM") return <span className="badge badge-amber">Medium</span>;
  return <span className="badge badge-green">Low</span>;
}

function recBadge(r?: string) {
  if (r === "PROCEED") return <span className="badge badge-green" style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}>✓ Proceed</span>;
  if (r === "DECLINE") return <span className="badge badge-red" style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}>✗ Decline</span>;
  return <span className="badge badge-amber" style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}>⚠ Proceed with Caution</span>;
}

function AuditPage() {
  const search = useSearch({ from: "/_authenticated/audit" });
  const prefilledProject = (search as any)?.project ?? "";

  const [files, setFiles] = useState<File[]>([]);
  const [projectName, setProjectName] = useState(prefilledProject);
  const [contractValue, setContractValue] = useState("");
  const [targetMargin, setTargetMargin] = useState("15");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (prefilledProject) setProjectName(prefilledProject);
  }, [prefilledProject]);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const novel = Array.from(incoming).filter((f) => !existing.has(f.name));
      return [...prev, ...novel];
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const runAudit = async () => {
    setError(null);
    setAnalysis(null);
    if (!projectName.trim()) return setError("Project name is required.");
    if (!contractValue) return setError("Contract value is required.");
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) return setError("VITE_GEMINI_API_KEY is not configured in environment.");
    setLoading(true);

    try {
      const firstPdf = files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
      const fileBase64 = firstPdf ? await fileToBase64(firstPdf) : undefined;
      const fileNames = files.length > 0 ? files.map((f) => f.name).join(", ") : "n/a";

      const systemPrompt = `You are Valtor AI, an executive construction tender risk analyst for the Ethiopian market.
Analyze the provided tender data and return ONLY a strict JSON object — no markdown, no commentary.
Required shape:
{
  "executive_summary": string,
  "risk_score": number (0–100, higher = more risk),
  "recommendation": "PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE",
  "financial_assessment": {
    "estimated_cost_etb": number,
    "projected_margin_pct": number,
    "margin_gap_pct": number,
    "cashflow_risk": "LOW" | "MEDIUM" | "HIGH"
  },
  "risk_matrix": [
    { "category": string, "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "likelihood": number (0–100), "impact": string }
  ],
  "evaluation_matrix": [
    { "criterion": string, "score": number (0–10), "weight": number (0–1), "notes": string }
  ],
  "key_risks": string[],
  "opportunities": string[],
  "compliance_flags": string[]
}`;

      const userText = `Project: ${projectName}
Files submitted: ${fileNames}
Contract Value: ${contractValue} ETB
Target Margin: ${targetMargin}%

Perform a thorough executive risk audit: assess financial viability against the contract value and target margin, identify key risks and compliance concerns, and produce a weighted evaluation matrix.`;

      const parts: any[] = [{ text: userText }];
      if (fileBase64 && firstPdf) {
        parts.push({ inline_data: { mime_type: "application/pdf", data: fileBase64 } });
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.15 },
          }),
        },
      );

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`API error (${res.status}): ${txt.slice(0, 200)}`);
      }

      const data = await res.json();
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

      let a: Analysis;
      try {
        a = JSON.parse(text) as Analysis;
      } catch {
        throw new Error("Failed to parse AI response as JSON. Check your Gemini API key and quota.");
      }
      setAnalysis(a);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        throw userError;
      }

      const user = userData.user;
      if (!user) {
        throw new Error("Authenticated user not found.");
      }

      await insertAudit({
        user_id: user.id,
        project_name: projectName,
        file_name: files[0]?.name ?? null,
        contract_value: Number(contractValue),
        target_margin: Number(targetMargin),
        risk_score: a.risk_score ?? null,
        status: "completed",
        analysis: a,
        created_at: new Date().toISOString(),
      });

      dispatchAuditsUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Bid Audit</div>
        <div className="page-subtitle">Upload tender documents, configure financials, and generate a structured AI risk evaluation.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem", alignItems: "start" }}>
        {/* Left — Input panel */}
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Project name */}
            <div>
              <label className="section-label">Project name</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="field-input"
                placeholder="Addis Ring Road Phase III"
              />
            </div>

            {/* Dropzone */}
            <div>
              <label className="section-label">Documents</label>
              <div
                className={`dropzone${dragOver ? " active" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".pdf,.zip,.xlsx,.xls,.docx,.doc"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
                <label htmlFor="file-input" style={{ cursor: "pointer", display: "block" }}>
                  <Upload size={20} color="#9CA3AF" style={{ margin: "0 auto 0.5rem" }} />
                  <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#374151" }}>
                    Drop files or click to browse
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#9CA3AF", marginTop: "0.25rem" }}>
                    PDF, ZIP, XLSX, DOCX accepted
                  </div>
                </label>
              </div>

              {/* File queue */}
              {files.length > 0 && (
                <div className="panel" style={{ marginTop: "0.625rem", overflow: "hidden" }}>
                  {files.map((f, i) => (
                    <div className="file-row" key={i}>
                      <div style={{ flexShrink: 0 }}>{fileIcon(f.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#0D1117", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {truncName(f.name)}
                        </div>
                        <div style={{ fontSize: "0.625rem", color: "#9CA3AF" }}>{fmtSize(f.size)}</div>
                      </div>
                      <button
                        onClick={() => removeFile(i)}
                        className="btn-ghost"
                        style={{ padding: "0.25rem", flexShrink: 0 }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contract value */}
            <div>
              <label className="section-label">Contract value (ETB)</label>
              <input
                type="number"
                value={contractValue}
                onChange={(e) => setContractValue(e.target.value)}
                className="field-input"
                placeholder="125,000,000"
              />
            </div>

            {/* Target margin */}
            <div>
              <label className="section-label">Target margin (%)</label>
              <input
                type="number"
                step="0.1"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
                className="field-input"
              />
            </div>

            {error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "4px", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", color: "#B91C1C" }}>
                {error}
              </div>
            )}

            <button onClick={runAudit} disabled={loading} className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "0.625rem" }}>
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Analysing…</>
              ) : (
                <><Sparkles size={14} /> Run Audit{files.length > 0 ? ` (${files.length} file${files.length > 1 ? "s" : ""})` : ""}</>
              )}
            </button>
          </div>
        </div>

        {/* Right — Results */}
        <div style={{ minHeight: "60vh" }}>
          {!analysis && !loading && (
            <div className="panel" style={{ padding: "4rem 2rem", textAlign: "center", color: "#9CA3AF" }}>
              <Sparkles size={32} style={{ margin: "0 auto 1rem", opacity: 0.3 }} />
              <div style={{ fontWeight: 600, color: "#374151", fontSize: "0.9375rem", marginBottom: "0.375rem" }}>
                Ready for analysis
              </div>
              <div style={{ fontSize: "0.8125rem" }}>Configure a project and click Run Audit to generate your risk report.</div>
            </div>
          )}

          {loading && (
            <div className="panel" style={{ padding: "4rem 2rem", textAlign: "center" }}>
              <Loader2 size={28} className="animate-spin" color="#0F2240" style={{ margin: "0 auto 1rem" }} />
              <div style={{ fontWeight: 600, color: "#0D1117", fontSize: "0.9375rem" }}>Running AI analysis…</div>
              <div style={{ fontSize: "0.8125rem", color: "#6B7280", marginTop: "0.375rem" }}>Evaluating tender package against financial parameters</div>
            </div>
          )}

          {analysis && (
            <Results
              analysis={analysis}
              projectName={projectName}
              onExport={() => exportToExcel(analysis, projectName)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Results({ analysis, projectName, onExport }: { analysis: Analysis; projectName: string; onExport: () => void }) {
  const r = Number(analysis.risk_score) || 0;
  const riskClass = r < 35 ? "risk-low" : r < 65 ? "risk-medium" : "risk-high";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Top actions bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "0.8125rem", color: "#6B7280" }}>
          Analysis for <strong style={{ color: "#0D1117" }}>{projectName}</strong>
        </div>
        <button onClick={onExport} className="btn-secondary">
          <Download size={13} />
          Export BoQ & Risk Matrix
        </button>
      </div>

      {/* Summary + Risk score */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "1rem" }}>
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div className="section-label">Executive Summary</div>
          <p style={{ fontSize: "0.8125rem", lineHeight: 1.6, color: "#374151" }}>
            {analysis.executive_summary ?? "—"}
          </p>
        </div>
        <div className="panel" style={{ padding: "1.25rem", textAlign: "center", minWidth: "140px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div className="section-label">Risk Score</div>
          <div className={riskClass} style={{ fontSize: "3rem", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
            {Math.round(r)}
          </div>
          <div style={{ fontSize: "0.6875rem", color: "#9CA3AF", marginBottom: "0.75rem" }}>out of 100</div>
          {analysis.recommendation && recBadge(analysis.recommendation)}
        </div>
      </div>

      {/* Financial assessment */}
      {analysis.financial_assessment && typeof analysis.financial_assessment === "object" && (
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div className="section-label">Financial Assessment</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.25rem" }}>
            {[
              { label: "Estimated Cost", value: analysis.financial_assessment.estimated_cost_etb ? `${Math.round(Number(analysis.financial_assessment.estimated_cost_etb)).toLocaleString()} ETB` : "—" },
              { label: "Projected Margin", value: analysis.financial_assessment.projected_margin_pct != null ? `${Number(analysis.financial_assessment.projected_margin_pct)}%` : "—" },
              { label: "Margin Gap", value: analysis.financial_assessment.margin_gap_pct != null ? `${Number(analysis.financial_assessment.margin_gap_pct)}%` : "—" },
              { label: "Cashflow Risk", value: String(analysis.financial_assessment.cashflow_risk ?? "—") },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: "0.6875rem", color: "#9CA3AF", marginBottom: "0.25rem" }}>{label}</div>
                <div style={{ fontSize: "1rem", fontWeight: 600, color: "#0D1117" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk matrix */}
      {Array.isArray(analysis.risk_matrix) && analysis.risk_matrix.length > 0 && (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertTriangle size={13} color="#B45309" />
            <div style={{ fontWeight: 600, fontSize: "0.8125rem" }}>Risk Matrix</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Category</th>
                <th>Impact</th>
                <th className="text-right">Likelihood</th>
              </tr>
            </thead>
            <tbody>
              {analysis.risk_matrix.map((row, i) => (
                <tr key={i}>
                  <td>{severityBadge(String(row.severity || ""))}</td>
                  <td style={{ fontWeight: 500 }}>{String(row.category || "—")}</td>
                  <td className="muted">{String(row.impact || "—")}</td>
                  <td className="text-right muted">{Number(row.likelihood) || 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Evaluation matrix */}
      {Array.isArray(analysis.evaluation_matrix) && analysis.evaluation_matrix.length > 0 && (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E4E7EC" }}>
            <div style={{ fontWeight: 600, fontSize: "0.8125rem" }}>Evaluation Matrix</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Notes</th>
                <th className="text-right">Score</th>
                <th className="text-right">Weight</th>
                <th className="text-right">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {analysis.evaluation_matrix.map((row, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{String(row.criterion || "—")}</td>
                  <td className="muted">{String(row.notes || "")}</td>
                  <td className="text-right">{Number(row.score) || 0}/10</td>
                  <td className="text-right muted">{(Number(row.weight || 0) * 100).toFixed(0)}%</td>
                  <td className="text-right" style={{ fontWeight: 600, color: "#0F2240" }}>
                    {(Number(row.score || 0) * Number(row.weight || 0)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Risks & Opportunities */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {Array.isArray(analysis.key_risks) && analysis.key_risks.length > 0 && (
          <div className="panel" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.75rem" }}>
              <XCircle size={13} color="#B91C1C" />
              <div style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#B91C1C" }}>Key Risks</div>
            </div>
            <ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {analysis.key_risks.map((it, i) => (
                <li key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem" }}>
                  <span style={{ color: "#B91C1C", flexShrink: 0 }}>•</span>
                  <span style={{ color: "#374151" }}>{String(it)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(analysis.opportunities) && analysis.opportunities.length > 0 && (
          <div className="panel" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.75rem" }}>
              <CheckCircle2 size={13} color="#15803D" />
              <div style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#15803D" }}>Opportunities</div>
            </div>
            <ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {analysis.opportunities.map((it, i) => (
                <li key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem" }}>
                  <span style={{ color: "#15803D", flexShrink: 0 }}>•</span>
                  <span style={{ color: "#374151" }}>{String(it)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Compliance flags */}
      {Array.isArray(analysis.compliance_flags) && analysis.compliance_flags.length > 0 && (
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.75rem" }}>
            <AlertTriangle size={13} color="#B45309" />
            <div style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#B45309" }}>Compliance Flags</div>
          </div>
          <ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {analysis.compliance_flags.map((it, i) => (
              <li key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem" }}>
                <span style={{ color: "#B45309", flexShrink: 0 }}>⚠</span>
                <span style={{ color: "#374151" }}>{String(it)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


