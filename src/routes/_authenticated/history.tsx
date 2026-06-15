import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { deleteAudit, useAudits } from "@/integrations/supabase/audits";
import {
  Trash2,
  FileText,
  ChevronDown,
  X,
  Clock,
  History,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Audit History — Valtor" }] }),
  component: HistoryPage,
});

type WorkflowStatus = "Draft" | "In Review" | "Approved" | "Rejected";

type AuditRow = {
  id: string;
  project_name: string;
  file_name: string | null;
  contract_value: number;
  target_margin: number;
  risk_score: number | null;
  status: string;
  analysis: any;
  created_at: string;
};

function workflowBadge(s: WorkflowStatus) {
  if (s === "Draft") return <span className="badge badge-slate">Draft</span>;
  if (s === "In Review") return <span className="badge badge-blue">In Review</span>;
  if (s === "Approved") return <span className="badge badge-green">Approved</span>;
  return <span className="badge badge-red">Rejected</span>;
}

function recBadge(rec?: string) {
  if (!rec) return <span className="badge badge-slate">—</span>;
  if (rec === "PROCEED") return <span className="badge badge-green">Proceed</span>;
  if (rec === "DECLINE") return <span className="badge badge-red">Decline</span>;
  return <span className="badge badge-amber">Caution</span>;
}

function riskClass(score: number | null) {
  if (score === null) return "";
  if (score < 35) return "risk-low";
  if (score < 65) return "risk-medium";
  return "risk-high";
}

// Minimal custom dropdown for the actions menu (no Radix dep needed)
function ActionsMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const items = [
    { label: "Request Director Approval", value: "In Review" },
    { label: "Assign to Estimator", value: "In Review" },
    { label: "Mark Approved", value: "Approved" },
    { label: "Reject", value: "Rejected" },
  ];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn-ghost"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: "0.3rem 0.5rem", gap: "0.2rem" }}
      >
        Actions <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className="panel"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 100,
            minWidth: "195px",
            padding: "0.25rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => { onAction(item.value); setOpen(false); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "0.5rem 0.75rem",
                fontSize: "0.8125rem",
                color: item.value === "Rejected" ? "#B91C1C" : "#374151",
                background: "none",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
                transition: "background 0.08s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F7F8FA")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryPage() {
  const { audits, loading, reload } = useAudits();
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [workflow, setWorkflow] = useState<Record<string, WorkflowStatus>>({});

  useEffect(() => {
    setWorkflow((prev) => {
      const next = { ...prev };
      audits.forEach((r) => { if (!next[r.id]) next[r.id] = "Draft"; });
      return next;
    });
  }, [audits]);

  const remove = async (id: string) => {
    await deleteAudit(id);
    if (selected?.id === id) setSelected(null);
    reload();
  };

  const setStatus = (id: string, status: string) => {
    setWorkflow((prev) => ({ ...prev, [id]: status as WorkflowStatus }));
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Audit History</div>
        <div className="page-subtitle">Complete record of every tender evaluated in your workspace</div>
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        {loading ? (
          <div className="empty-state">
            <Clock size={24} style={{ margin: "0 auto 0.5rem", opacity: 0.3 }} />
            <p>Loading records…</p>
          </div>
        ) : audits.length === 0 ? (
          <div className="empty-state">
            <History size={28} style={{ margin: "0 auto 0.5rem", opacity: 0.25 }} />
            <p>No audits recorded yet. Run your first bid audit to see it here.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Document</th>
                  <th className="text-right">Value (ETB)</th>
                  <th className="text-right">Margin</th>
                  <th className="text-right">Risk</th>
                  <th>AI Recommendation</th>
                  <th>Approval Status</th>
                  <th className="text-right">Date</th>
                  <th style={{ width: "120px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(r)}
                  >
                    <td style={{ fontWeight: 500 }}>{r.project_name}</td>
                    <td className="muted">
                      {r.file_name ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                          <FileText size={12} />
                          {r.file_name.length > 22 ? r.file_name.slice(0, 22) + "…" : r.file_name}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="text-right muted">{Number(r.contract_value).toLocaleString()}</td>
                    <td className="text-right">{r.target_margin}%</td>
                    <td className={`text-right ${riskClass(r.risk_score)}`} style={{ fontWeight: 600 }}>
                      {r.risk_score != null ? Math.round(Number(r.risk_score)) : "—"}
                    </td>
                    <td>{recBadge(r.analysis?.recommendation)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {workflowBadge(workflow[r.id] ?? "Draft")}
                    </td>
                    <td className="text-right muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", justifyContent: "flex-end" }}>
                        <ActionsMenu onAction={(v) => setStatus(r.id, v)} />
                        <button
                          onClick={() => remove(r.id)}
                          className="btn-ghost"
                          style={{ padding: "0.3rem", color: "#9CA3AF" }}
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
            padding: "1rem",
          }}
          onClick={() => setSelected(null)}
        >
          <div
            className="panel"
            style={{ maxWidth: "680px", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: "1.75rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.0625rem", color: "#0D1117", letterSpacing: "-0.02em" }}>
                  {selected.project_name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: "0.2rem" }}>
                  {new Date(selected.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="btn-ghost" style={{ padding: "0.375rem" }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.25rem" }}>
              {[
                { label: "Contract Value", value: `${Number(selected.contract_value).toLocaleString()} ETB` },
                { label: "Target Margin", value: `${selected.target_margin}%` },
                { label: "Risk Score", value: selected.risk_score != null ? `${Math.round(Number(selected.risk_score))}/100` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="stat-card" style={{ padding: "0.875rem" }}>
                  <div className="stat-label">{label}</div>
                  <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0D1117" }}>{value}</div>
                </div>
              ))}
            </div>

            {selected.analysis?.executive_summary && (
              <div style={{ marginBottom: "1.25rem" }}>
                <div className="section-label">Executive Summary</div>
                <p style={{ fontSize: "0.8125rem", lineHeight: 1.65, color: "#374151" }}>
                  {selected.analysis.executive_summary}
                </p>
              </div>
            )}

            <div style={{ marginBottom: "0.75rem" }}>
              <div className="section-label">Approval Status</div>
              {workflowBadge(workflow[selected.id] ?? "Draft")}
            </div>

            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "#9CA3AF", userSelect: "none" }}>
                View raw analysis JSON
              </summary>
              <pre style={{ marginTop: "0.75rem", padding: "0.875rem", background: "#F7F8FA", border: "1px solid #E4E7EC", borderRadius: "4px", fontSize: "0.6875rem", overflowX: "auto", lineHeight: 1.5 }}>
                {JSON.stringify(selected.analysis, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
