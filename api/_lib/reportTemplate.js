// api/_lib/reportTemplate.js
//
// Builds the HTML string that reportGenerator.js renders to PDF via
// Puppeteer. Pure string templating, no dependencies — kept separate from
// reportGenerator.js so the visual design can be iterated on without
// touching the Puppeteer/Chromium plumbing.
//
// Design language is deliberately matched to the web dashboard
// (src/routes/_authenticated/audit.tsx, src/components/RiskUtils.tsx) so a
// contractor who has seen the live report and the PDF recognizes them as
// the same product, not two different tools.

// ─── Color system — identical values to RiskUtils.tsx / audit.tsx ─────────
const RISK_COLORS = {
  none: { hex: "#94A3B8", bg: "#F1F5F9", label: "INSUFFICIENT EVIDENCE" },
  low: { hex: "#16A34A", bg: "#F0FDF4", label: "LOW RISK" },
  medium: { hex: "#D97706", bg: "#FFFBEB", label: "MEDIUM RISK" },
  high: { hex: "#DC2626", bg: "#FEF2F2", label: "HIGH RISK" },
};

const SEVERITY_COLORS = {
  CRITICAL: { hex: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  HIGH: { hex: "#EA580C", bg: "#FFF7ED", border: "#FED7AA" },
  MEDIUM: { hex: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  LOW: { hex: "#64748B", bg: "#F8FAFC", border: "#E2E8F0" },
};

const REC_COLORS = {
  PROCEED: { hex: "#16A34A", bg: "#F0FDF4" },
  DECLINE: { hex: "#DC2626", bg: "#FEF2F2" },
  PROCEED_WITH_CAUTION: { hex: "#D97706", bg: "#FFFBEB" },
};

function riskBand(score) {
  if (score === null || score === undefined) return RISK_COLORS.none;
  if (score < 35) return RISK_COLORS.low;
  if (score < 65) return RISK_COLORS.medium;
  return RISK_COLORS.high;
}

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "ETB " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(1)}%`;
}

function badge(text, colors) {
  return `<span class="badge" style="color:${colors.hex};background:${colors.bg};border:1px solid ${colors.hex}33;">${esc(text)}</span>`;
}

function severityBadge(sev) {
  const c = SEVERITY_COLORS[sev] || SEVERITY_COLORS.LOW;
  return `<span class="sev-badge" style="color:${c.hex};background:${c.bg};border:1px solid ${c.border};">${esc(sev)}</span>`;
}

function section(title, bodyHtml, opts = {}) {
  if (!bodyHtml || (Array.isArray(bodyHtml) && bodyHtml.length === 0)) return "";
  return `
    <section class="report-section" ${opts.pageBreakBefore ? 'style="page-break-before: always;"' : ""}>
      <h2>${esc(title)}</h2>
      ${bodyHtml}
    </section>`;
}

function emptyState(msg) {
  return `<p class="empty-state">${esc(msg)}</p>`;
}

function buildArithmeticTable(errors) {
  if (!errors || errors.length === 0) {
    return emptyState("No arithmetic discrepancies were found in the extracted BOQ line items.");
  }
  const rows = errors.map(e => `
    <tr>
      <td class="mono">${esc(e.location)}</td>
      <td>${esc(e.description)}</td>
      <td>${severityBadge(e.severity)}</td>
      <td class="num">${fmtMoney(e.financial_impact)}</td>
    </tr>`).join("");
  return `
    <table class="data-table">
      <thead><tr><th>Location</th><th>Description</th><th>Severity</th><th class="num">Financial Impact</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildContractualTraps(traps) {
  if (!traps || traps.length === 0) {
    return emptyState("No contractual risk clauses were identified from the supplied document text.");
  }
  return traps.map(t => `
    <div class="finding-card" style="border-left-color:${(SEVERITY_COLORS[t.severity] || SEVERITY_COLORS.LOW).hex};">
      <div class="finding-header">
        <span class="finding-title">${esc(t.clause_type)}</span>
        ${severityBadge(t.severity)}
      </div>
      ${t.fidic_ref ? `<div class="finding-ref">FIDIC ref: ${esc(t.fidic_ref)}</div>` : ""}
      <p class="finding-desc">${esc(t.description)}</p>
      ${t.recommendation ? `<p class="finding-rec"><strong>Recommended action:</strong> ${esc(t.recommendation)}</p>` : ""}
    </div>`).join("");
}

function buildScopeGaps(gaps) {
  if (!gaps || gaps.length === 0) {
    return emptyState("No scope gaps identified.");
  }
  const rows = gaps.map(g => `
    <tr>
      <td>${esc(g.missing_element)}</td>
      <td>${esc(g.risk_impact)}</td>
      <td class="num">${fmtMoney(g.estimated_cost_etb)}</td>
    </tr>`).join("");
  return `
    <table class="data-table">
      <thead><tr><th>Missing Element</th><th>Risk Impact</th><th class="num">Est. Cost Exposure</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildMarketVariance(items, pricingRef) {
  if (!items || items.length === 0) {
    return emptyState("No BOQ line items were available for pricing comparison against the government benchmark.");
  }
  const rows = items.slice(0, 40).map(m => `
    <tr>
      <td class="mono">${esc(m.item_no || "—")}</td>
      <td>${esc(m.item)}</td>
      <td class="num">${m.our_rate != null ? fmtMoney(m.our_rate) : "—"}</td>
      <td class="num">${m.market_rate != null ? fmtMoney(m.market_rate) : "—"}</td>
      <td class="num">${fmtPct(m.variance_pct)}</td>
      <td>${esc(m.confidence || "Unknown")}</td>
    </tr>`).join("");
  const truncNote = items.length > 40
    ? `<p class="table-note">Showing 40 of ${items.length} matched line items.</p>` : "";
  const refNote = pricingRef
    ? `<p class="table-note">Benchmarked against: ${esc(pricingRef.source_document || "")} (${esc(pricingRef.publication_period || "")}). ${esc(pricingRef.disclaimer || "")}</p>`
    : "";
  return `
    ${refNote}
    <table class="data-table">
      <thead><tr><th>Item #</th><th>Description</th><th class="num">Bid Rate</th><th class="num">Benchmark Rate</th><th class="num">Variance</th><th>Confidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${truncNote}`;
}

function buildList(items) {
  if (!items || items.length === 0) return "";
  return `<ul class="finding-list">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function buildCoverPage(analysis, meta) {
  const rec = analysis.recommendation || "PROCEED_WITH_CAUTION";
  const recColor = REC_COLORS[rec] || REC_COLORS.PROCEED_WITH_CAUTION;
  const risk = riskBand(analysis.risk_score);
  const scoreDisplay = analysis.risk_score === null || analysis.risk_score === undefined
    ? "—" : Math.round(analysis.risk_score);

  return `
    <div class="cover-page">
      <div class="cover-brand">BidSwift AI</div>
      <div class="cover-subtitle">Pre-Bid Forensic Audit Report</div>
      <div class="cover-project">${esc(analysis.project_name || meta.fileName || "Untitled Project")}</div>

      <div class="cover-score-block">
        <div class="score-ring" style="border-color:${risk.hex};">
          <div class="score-number" style="color:${risk.hex};">${scoreDisplay}</div>
          <div class="score-of100">/ 100</div>
        </div>
        <div class="score-label" style="color:${risk.hex};">${risk.label}</div>
      </div>

      <div class="cover-rec" style="background:${recColor.bg};border:1px solid ${recColor.hex}55;">
        <span style="color:${recColor.hex};font-weight:700;">${esc((rec || "").replace(/_/g, " "))}</span>
      </div>

      <table class="cover-meta">
        <tr><td>Contract Value</td><td>${fmtMoney(analysis.contract_value)}</td></tr>
        <tr><td>Target Margin</td><td>${analysis.target_margin != null ? analysis.target_margin + "%" : "—"}</td></tr>
        <tr><td>Report Generated</td><td>${esc(meta.generatedAt)}</td></tr>
        <tr><td>Source File</td><td>${esc(meta.fileName || "—")}</td></tr>
      </table>

      <div class="cover-footer">
        Deviation from a verified historical government benchmark — decision support, not decision-maker.
        Confidential — prepared for internal use only.
      </div>
    </div>`;
}

function buildStyles() {
  return `
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        color: #1E293B;
        margin: 0;
        font-size: 10.5px;
        line-height: 1.5;
      }
      .cover-page {
        height: 297mm;
        padding: 60px 56px;
        display: flex;
        flex-direction: column;
        page-break-after: always;
        background: linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 40%);
      }
      .cover-brand { font-size: 15px; font-weight: 700; letter-spacing: 0.08em; color: #0F172A; text-transform: uppercase; }
      .cover-subtitle { font-size: 12px; color: #64748B; margin-top: 4px; margin-bottom: 48px; }
      .cover-project { font-size: 26px; font-weight: 700; color: #0F172A; margin-bottom: 40px; max-width: 480px; }
      .cover-score-block { display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 24px; }
      .score-ring {
        width: 140px; height: 140px; border-radius: 50%; border: 6px solid;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: #FFFFFF;
      }
      .score-number { font-size: 44px; font-weight: 800; line-height: 1; }
      .score-of100 { font-size: 11px; color: #94A3B8; margin-top: 2px; }
      .score-label { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; margin-top: 14px; }
      .cover-rec { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; margin-bottom: 40px; width: fit-content; }
      .cover-meta { border-collapse: collapse; margin-top: auto; font-size: 11px; }
      .cover-meta td { padding: 6px 0; border-top: 1px solid #E2E8F0; }
      .cover-meta td:first-child { color: #64748B; padding-right: 32px; }
      .cover-meta td:last-child { font-weight: 600; color: #0F172A; }
      .cover-footer { font-size: 9px; color: #94A3B8; margin-top: 40px; max-width: 420px; line-height: 1.6; }

      .report-body { padding: 40px 48px; }
      .report-section { margin-bottom: 32px; }
      .report-section h2 {
        font-size: 14px; font-weight: 700; color: #0F172A;
        border-bottom: 2px solid #0F172A; padding-bottom: 8px; margin-bottom: 16px;
        text-transform: uppercase; letter-spacing: 0.03em;
      }
      .report-section p { margin: 0 0 10px 0; color: #334155; }
      .empty-state { color: #94A3B8; font-style: italic; font-size: 10px; }

      .badge, .sev-badge {
        display: inline-block; padding: 2px 9px; border-radius: 4px;
        font-size: 9px; font-weight: 700; letter-spacing: 0.03em;
      }

      .data-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-top: 8px; }
      .data-table th {
        text-align: left; background: #F8FAFC; color: #64748B; font-weight: 700;
        padding: 8px 10px; border-bottom: 2px solid #E2E8F0; text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.03em;
      }
      .data-table td { padding: 8px 10px; border-bottom: 1px solid #F1F5F9; vertical-align: top; }
      .data-table .num { text-align: right; font-variant-numeric: tabular-nums; }
      .data-table .mono { font-family: 'Courier New', monospace; font-size: 9px; }
      .table-note { font-size: 9px; color: #94A3B8; margin-top: 6px; font-style: italic; }

      .finding-card {
        border-left: 4px solid; background: #FAFAFA; padding: 12px 16px;
        margin-bottom: 12px; border-radius: 0 4px 4px 0;
      }
      .finding-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .finding-title { font-weight: 700; font-size: 11px; color: #0F172A; }
      .finding-ref { font-size: 9px; color: #64748B; font-family: 'Courier New', monospace; margin-bottom: 6px; }
      .finding-desc { font-size: 10px; color: #334155; margin: 4px 0; }
      .finding-rec { font-size: 9.5px; color: #475569; margin-top: 6px; }

      .finding-list { margin: 4px 0 0 0; padding-left: 18px; }
      .finding-list li { margin-bottom: 6px; color: #334155; }

      .two-col { display: flex; gap: 24px; }
      .two-col > div { flex: 1; }
      .subhead { font-size: 10px; font-weight: 700; color: #475569; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em; }

      .report-footer {
        text-align: center; font-size: 8px; color: #CBD5E1; margin-top: 40px; padding-top: 16px; border-top: 1px solid #F1F5F9;
      }
    </style>`;
}

function buildReportHtml(analysis, meta) {
  const strengthsWeaknesses = (analysis.methodology_strengths?.length || analysis.methodology_weaknesses?.length)
    ? `
      <div class="two-col">
        <div>
          <div class="subhead">Strengths</div>
          ${buildList(analysis.methodology_strengths) || emptyState("None identified.")}
        </div>
        <div>
          <div class="subhead">Weaknesses</div>
          ${buildList(analysis.methodology_weaknesses) || emptyState("None identified.")}
        </div>
      </div>` : "";

  const body = `
    <div class="report-body">
      ${section("Executive Summary", `<p>${esc(analysis.executive_summary)}</p>`)}
      ${section("Technical Critique", `<p>${esc(analysis.technical_critique)}</p>`)}
      ${section("Methodology Assessment", strengthsWeaknesses)}
      ${section("Key Risks", buildList(analysis.key_risks))}
      ${section("Arithmetic Findings", buildArithmeticTable(analysis.arithmetic_errors), { pageBreakBefore: true })}
      ${section("Contractual Risk Register", buildContractualTraps(analysis.contractual_traps))}
      ${section("Scope Gaps", buildScopeGaps(analysis.scope_gaps))}
      ${section("Market / Pricing Variance", buildMarketVariance(analysis.market_variance, analysis.pricing_reference), { pageBreakBefore: true })}
      ${section("Resource Gap Analysis", analysis.resource_gap_analysis ? `<p>${esc(analysis.resource_gap_analysis)}</p>` : "")}
      ${section("Plant & Equipment Adequacy", analysis.plant_adequacy_assessment ? `<p>${esc(analysis.plant_adequacy_assessment)}</p>` : "")}
      ${section("Regulatory Compliance", analysis.regulatory_compliance ? `<p>${esc(analysis.regulatory_compliance)}</p>` : "")}
      ${section("Financial Risk Summary", analysis.financial_risk_summary ? `<p>${esc(analysis.financial_risk_summary)}</p>` : "")}
      <div class="report-footer">
        Generated by BidSwift AI · ${esc(meta.generatedAt)} · This report is decision support, not a decision-maker.
        Historical benchmark pricing — not live market data. Confidential.
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">${buildStyles()}</head>
<body>
  ${buildCoverPage(analysis, meta)}
  ${body}
</body>
</html>`;
}

export { buildReportHtml };
