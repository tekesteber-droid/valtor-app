import { AuditRow } from "@/integrations/supabase/audits";

export const calculateBoQVariance = (audit: AuditRow | null | undefined): number => {
  if (!audit) return 0;

  try {
    const actual = Number(audit.contract_value || 0);
    const analysis = (audit.analysis as any) || {};
    
    // Check multiple potential paths in the JSONB
    const estimated = Number(
      analysis.financial_assessment?.estimated_cost_etb || 
      analysis.estimated_cost_etb || 
      0
    );

    if (estimated === 0) return 0;
    
    const variance = ((actual - estimated) / estimated) * 100;
    return isFinite(variance) ? variance : 0;
  } catch (e) {
    return 0;
  }
};