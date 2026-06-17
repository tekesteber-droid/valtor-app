import { createFileRoute, useSearch, useRouter } from "@tanstack/react-router";
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

  if (Array.isArray(analysis.risk_matrix) && analysis.risk_matrix.length > 0) {
    const riskData = [
      ["Category", "Severity", "Likelihood (%)", "Impact"],
      ...analysis.risk_matrix.map((r) => [r.category, r.severity, r.likelihood, r.impact]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskData), "Risk Matrix");
  }

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
  const router = useRouter();
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
    if (!apiKey) return setError("VITE_GEMINI_API_KEY is not configured.");
    
    setLoading(true);

    try {
      const firstPdf = files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
      const fileBase64 = firstPdf ? await fileToBase64(firstPdf) : undefined;
      const fileNames = files.length > 0 ? files.map((f) => f.name).join(", ") : "n/a";

      const systemPrompt = `You are Valtor AI, an executive construction tender risk analyst. Return ONLY a strict JSON object.
Required shape:
{
  "executive_summary": string,
  "risk_score": number,
  "recommendation": "PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE",
  "financial_assessment": {
    "estimated_cost_etb": number,
    "projected_margin_pct": number,
    "margin_gap_pct": number,
    "cashflow_risk": "LOW" | "MEDIUM" | "HIGH"
  },
  "risk_matrix": [
    { "category": string, "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "likelihood": number, "impact": string }
  ],
  "evaluation_matrix": [
    { "criterion": string, "score": number, "weight": number, "notes": string }
  ],
  "key_risks": string[],
  "opportunities": string[],
  "compliance_flags": string[]
}`;

      const userText = `Project: ${projectName}
Files: ${fileNames}
Value: ${contractValue} ETB
Target Margin: ${targetMargin}%`;

      const parts: any[] = [{ text: userText }];
      if (fileBase64 && firstPdf) {
        parts.push({ inline_data: { mime_type: "application/pdf", data: fileBase64 } });
      }

      // Fix: Correct model version
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

      const a = JSON.parse(text) as Analysis;
      setAnalysis(a);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Authenticated user not found.");

      await insertAudit({
        user_id: userData.user.id,
        project_name: projectName,
        file_name: files[0]?.name ?? null,
        contract_value: Number(contractValue),
        target_margin: Number(targetMargin),
        risk_score: a.risk_score ?? null,
        status: "completed",
        analysis: a,
        created_at: new Date().toISOString(),
      });

      // Fix: Dispatch event to notify Dashboard/History
      dispatchAuditsUpdated();
      
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "An error occurred during analysis.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Bid Audit</div>
        <div className="page-subtitle">Upload tender documents and generate AI risk evaluation.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem", alignItems: "start" }}>
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label className="section-label">Project name</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="field-input"
                placeholder="Project Name"
              />
            </div>

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
                </label>
              </div>

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
                      <button onClick={() => removeFile(i)} className="btn-ghost" style={{ padding: "0.25rem" }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="section-label">Contract value (ETB)</label>
              <input
                type="number"
                value={contractValue}
                onChange={(e) => setContractValue(e.target.value)}
                className="field-input"
              />
            </div>

            <div>
              <label className="section-label">Target margin (%)</label>
              <input
                type="number"
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

            <button onClick={runAudit} disabled={loading} className="btn-primary" style={{ width: "100%", justifyContent: "center" }}>
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Analysing…</>
              ) : (
                <><Sparkles size={14} /> Run Audit</>
              )}
            </button>
          </div>
        </div>

        <div style={{ minHeight: "60vh" }}>
          {!analysis && !loading && (
            <div className="panel" style={{ padding: "4rem 2rem", textAlign: "center", color: "#9CA3AF" }}>
              <Sparkles size={32} style={{ margin: "0 auto 1rem", opacity: 0.3 }} />
              <div style={{ fontWeight: 600, color: "#374151" }}>Ready for analysis</div>
              <div style={{ fontSize: "0.8125rem" }}>Configure a project and click Run Audit.</div>
            </div>
          )}

          {loading && (
            <div className="panel" style={{ padding: "4rem 2rem", textAlign: "center" }}>
              <Loader2 size={28} className="animate-spin" color="#0F2240" style={{ margin: "0 auto 1rem" }} />
              <div style={{ fontWeight: 600, color: "#0D1117" }}>Running AI analysis…</div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "0.8125rem", color: "#6B7280" }}>
          Analysis for <strong style={{ color: "#0D1117" }}>{projectName}</strong>
        </div>
        <button onClick={onExport} className="btn-secondary">
          <Download size={13} />
          Export Analysis
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "1rem" }}>
        <div className="panel" style={{ padding: "1.25rem" }}>
          <div className="section-label">Executive Summary</div>
          <p style={{ fontSize: "0.8125rem", lineHeight: 1.6, color: "#374151" }}>{analysis.executive_summary}</p>
        </div>
        <div className="panel" style={{ padding: "1.25rem", textAlign: "center", minWidth: "140px" }}>
          <div className="section-label">Risk Score</div>
          <div className={riskClass} style={{ fontSize: "3rem", fontWeight: 800 }}>{Math.round(r)}</div>
          {analysis.recommendation && recBadge(analysis.recommendation)}
        </div>
      </div>

      {Array.isArray(analysis.risk_matrix) && (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E4E7EC", fontWeight: 600 }}>Risk Matrix</div>
          <table className="data-table">
            <thead>
              <tr><th>Severity</th><th>Category</th><th>Impact</th><th className="text-right">Likelihood</th></tr>
            </thead>
            <tbody>
              {analysis.risk_matrix.map((row, i) => (
                <tr key={i}>
                  <td>{severityBadge(row.severity)}</td>
                  <td>{row.category}</td>
                  <td className="muted">{row.impact}</td>
                  <td className="text-right">{row.likelihood}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}