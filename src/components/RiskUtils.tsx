// src/components/RiskUtils.tsx
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

export function riskColor(score: number | null): string {
  if (score === null) return "#94A3B8";
  if (score < 40) return "#16A34A";
  if (score < 65) return "#D97706";
  return "#DC2626";
}

export function riskLabel(score: number | null): string {
  if (score === null) return "—";
  if (score < 40) return "LOW";
  if (score < 65) return "MEDIUM";
  return "HIGH";
}

export function riskClass(score: number | null): string {
  if (score === null) return "";
  if (score < 35) return "risk-low";
  if (score < 65) return "risk-medium";
  return "risk-high";
}

export function RecBadge({ rec }: { rec?: string }) {
  const s = rec || "PROCEED_WITH_CAUTION";
  const label = s.replace(/_/g, " ");
  if (s === "PROCEED")
    return <span className="badge badge-green flex items-center gap-1"><CheckCircle2 size={11} />{label}</span>;
  if (s === "DECLINE")
    return <span className="badge badge-red flex items-center gap-1"><XCircle size={11} />{label}</span>;
  return <span className="badge badge-amber flex items-center gap-1"><AlertTriangle size={11} />{label}</span>;
}