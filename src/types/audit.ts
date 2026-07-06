// src/types/audit.ts
//
// Shared types for the shape of an audit's stored `analysis` JSON blob.
// This mirrors the JSON structure the forensic-audit LLM prompt (see
// src/routes/_authenticated/audit.tsx) is instructed to return, and that
// gets persisted as-is into the `audits.analysis` jsonb column.

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ContractualTrap = {
  clause_type: string;
  fidic_ref: string;
  severity: Severity;
  description: string;
  recommendation: string;
};

export type MarketVarianceItem = {
  item: string;
  category: string;
  our_rate: number;
  market_rate: number;
  variance_pct: number;
  unit: string;
  note: string;
};

export type ArithmeticError = {
  location: string;
  description: string;
  severity: Exclude<Severity, "CRITICAL">;
  financial_impact: number;
};

export type ScopeGap = {
  missing_element: string;
  risk_impact: string;
  estimated_cost_etb: number;
};

export type Recommendation = "PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE";

// Financial Shield: reuses the Severity scale as its impact rating scale.
export type ImpactLevel = Severity;

export type FinancialShieldRisk = {
  risk_type: string;
  description: string;
  cost_exposure: ImpactLevel;
  schedule_impact: ImpactLevel;
  cashflow_impact: ImpactLevel;
  commercial_risk: ImpactLevel;
  mitigation: string;
};

export type FinancialShield = {
  overall_exposure: ImpactLevel;
  shield_summary: string;
  risks: FinancialShieldRisk[];
  qualification_points: string[];
};

export type AuditAnalysis = {
  risk_score: number;
  recommendation: Recommendation;
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
  financial_shield?: FinancialShield;
};

export type WorkflowStatus = "Draft" | "In Review" | "Approved" | "Rejected";