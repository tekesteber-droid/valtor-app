import * as XLSX from 'xlsx';

export const downloadAuditExcel = (result: any) => {
  try {
    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().split('T')[0];
    const safeProjectName = (result.project_name || "Project").replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // --- SHEET 1: EVALUATION MATRIX ---
    const evaluationData = [
      ["VALTOR FORENSIC AUDIT REPORT", ""],
      ["Project Name", result.project_name || "N/A"],
      ["Audit Date", new Date().toLocaleString()],
      ["", ""],
      ["CRITICAL METRICS", ""],
      ["Composite Risk Index", `${result.risk_score ?? 0}/100`],
      ["System Recommendation", result.recommendation || "N/A"],
      ["Contract Value (ETB)", (result.contract_value || 0).toLocaleString()],
      ["Target Margin", `${result.target_margin || 0}%`],
      ["", ""],
      ["EXECUTIVE SUMMARY", ""],
      [result.executive_summary || "No summary provided.", ""]
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(evaluationData);
    ws1['!cols'] = [{ wch: 30 }, { wch: 70 }];

    // --- SHEET 2: RISK REGISTER ---
    const riskRows = [["CATEGORY", "RISK ELEMENT", "SEVERITY", "DESCRIPTION"]];
    
    // Add Contractual Traps (Defensive check)
    (result.contractual_traps || []).forEach((t: any) => {
      riskRows.push(["Contractual", t.clause_type || "Unknown", t.severity || "WATCH", t.description || ""]);
    });
    
    // Add Scope Gaps
    (result.scope_gaps || []).forEach((g: any) => {
      riskRows.push(["Scope Omission", g.missing_element || "Gap", "WATCH", g.risk_impact || ""]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(riskRows);
    ws2['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 60 }];

    // --- SHEET 3: BoQ ANALYSIS ---
    const boqRows = [["ITEM/SECTION", "VARIANCE/ERROR", "TECHNICAL NOTE"]];
    
    (result.arithmetic_errors || []).forEach((e: any) => {
      boqRows.push([`Error: ${e.location}`, e.severity || "HIGH", e.description || ""]);
    });

    (result.market_variance || []).forEach((m: any) => {
      boqRows.push([m.item || "Material", `${m.variance_pct || 0}%`, m.note || ""]);
    });

    const ws3 = XLSX.utils.aoa_to_sheet(boqRows);
    ws3['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 60 }];

    XLSX.utils.book_append_sheet(wb, ws1, "Evaluation Matrix");
    XLSX.utils.book_append_sheet(wb, ws2, "Risk Register");
    XLSX.utils.book_append_sheet(wb, ws3, "BoQ Analysis");

    XLSX.writeFile(wb, `Valtor_Audit_${safeProjectName}_${timestamp}.xlsx`);
  } catch (err) {
    console.error("Excel Export Failed:", err);
    alert("Excel Export failed due to missing data structures.");
  }
};