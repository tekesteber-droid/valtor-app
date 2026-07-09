// src/types/audit.ts — mirrors the strict JSON returned by the tender-review
// prompt in src/routes/_authenticated/audit.tsx, stored in audits.analysis.

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Recommendation = "GO" | "CONDITIONAL_GO" | "NO_GO";
export type CompetitionLevel = "LOW" | "MODERATE" | "HIGH";

export const RISK_CATEGORIES = [
  "Commercial", "Contractual", "Financial", "Pricing", "Timeline", "Execution",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export type RiskItem = {
  category: string;
  severity: Severity;
  finding: string;
  action: string;
};

export type BoqItem = {
  item_no: string;
  description: string;
  qty: number;
  unit: string;
};

export type AuditAnalysis = {
  executive_summary: string;
  recommendation: Recommendation;
  confidence_score: number;   // 0-100
  risk_score: number;         // 0-10
  opportunity_score: number;  // 0-10
  competition_level: CompetitionLevel;
  risks: RiskItem[];
  missing_information: string[];
  clarification_requests: string[];
  critical_actions: string[];
  boq_items: BoqItem[];
};

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string; ts: string };
export type WorkflowStatus = "Draft" | "In Review" | "Approved" | "Rejected";