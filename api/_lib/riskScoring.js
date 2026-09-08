/**
 * BidSwift AI — Risk Scoring v2 (Option C: split Compliance Risk / Pricing Risk)
 *
 * Replaces the old calculateRiskScore() in api/check-analysis.js — a single
 * additive score (baseline 50 + per-finding points, capped 0-100) that:
 *   1. gave scope_gaps a flat +5 regardless of severity (scope_gaps has no
 *      severity field at all in the current LLM schema — see NOTE below)
 *   2. used Math.abs(variance_percent) > 20, conflating underbidding and
 *      overbidding into one signal
 *   3. had no tolerance on arithmetic checks in THIS function (tolerance did
 *      exist correctly in arithmeticValidator.js — that part was already fine)
 *   4. could overshoot 100 before clamping (confirmed: 194 raw on a real bid),
 *      destroying discriminating power between "messy but fine" and "actually
 *      high risk"
 *
 * FIELD SHAPES BELOW ARE CONFIRMED FROM THE REAL CODEBASE, not guessed:
 *   - contractual_traps[]: LLM-generated, confirmed severity values CRITICAL/HIGH
 *     in current live use (schema may allow more; unknown values map to 0 weight
 *     safely rather than throwing).
 *   - scope_gaps[]: { missing_element, risk_impact, estimated_cost_etb }.
 *     NO severity field currently exists in the LLM schema (see
 *     check-analysis.js prompt, ~line 407). Until that schema is extended,
 *     severity is derived deterministically from estimated_cost_etb as a
 *     fraction of total bid price — this is MORE consistent with the
 *     project's deterministic-over-LLM-judgment principle anyway, so the
 *     schema change is optional, not required, for this file to work.
 *   - arithmetic_errors[]: { location, description, severity: HIGH/MEDIUM/LOW,
 *     financial_impact, expected_total, stated_total } — from
 *     api/_lib/arithmeticValidator.js. Tolerance (ABS_TOLERANCE_ETB=1,
 *     PCT_TOLERANCE=0.5%) already applied upstream; this file does not
 *     re-derive it.
 *   - market_variance[]: { variance_percent, tender_price, reference_price,
 *     confidence, match_type, quantity } — from api/_lib/pricingEvidence.js.
 *     `quantity` does NOT exist on the object yet as of this writing — add
 *     `quantity: item.qty ?? null,` to buildPricingEvidence()'s return object
 *     for the underbid/overbid exposure math below to work. Without it, this
 *     file degrades safely (skips exposure aggregation) rather than crashing.
 *
 * CALIBRATION STATUS: severity weights, the neutral band, and the aggregate
 * exposure-ratio bands are STARTING POINTS from manual review of 4 real
 * Ethiopian bids (EFOYTA, Belachew Tulu Abattoir, Edna Construction, Group 2
 * Construction). NOT validated against outcome data. The neutral band below
 * is set to match pricingEvidence.js's existing ruleBasedRecommendation()
 * thresholds (5%/15%) rather than an independently invented number, so the
 * score and the human-readable recommendation text agree with each other —
 * but neither has been checked against real accepted-bid outcomes yet.
 */

// ---------------------------------------------------------------------------
// 1. Severity -> weight mapping (shared by both scores)
// ---------------------------------------------------------------------------
// Weight = P(this finding alone would matter to a real reviewer). Combined via
// noisy-OR: risk = 1 - product(1 - w_i). Bounded to [0,1] by construction —
// no arbitrary cap needed — and repeated similar findings give diminishing
// returns instead of linear pileup (the old bug's exact failure mode).

const SEVERITY_WEIGHT = {
  CRITICAL: 0.75,
  HIGH: 0.50,
  MEDIUM: 0.25,
  LOW: 0.10,
  INFO: 0.03,
};

function weightOf(severity) {
  return SEVERITY_WEIGHT[severity] ?? 0; // unknown/missing severity contributes nothing, never throws
}

function noisyOr(weights) {
  const positive = weights.filter((w) => w > 0);
  if (!positive.length) return 0;
  const survivalProduct = positive.reduce((acc, w) => acc * (1 - w), 1);
  return 1 - survivalProduct; // 0..1
}

function toScore(probability) {
  return Math.round(probability * 100);
}

// ---------------------------------------------------------------------------
// 2. Root-cause de-duplication
// ---------------------------------------------------------------------------
// Prevents N findings that share one underlying cause (e.g. one wrong table
// formula producing 4 "column fails check" findings) from being counted as N
// independent risks in noisy-OR — verified against real Group 2 data: naive
// = 99, correctly de-duplicated = 86.
//
// HONEST LIMITATION: none of the four real finding types above currently
// carry a `sourceRef` field, so this mostly acts as a no-op against today's
// live data (each real finding already has a distinct location/item/
// missing_element, so nothing incorrectly merges) — it is included so this
// module doesn't need to change again once sourceRef tagging is added
// upstream (e.g. to a future eligibility_integrity extractor).

function getRootCauseKey(finding) {
  return (
    finding.sourceRef ||
    finding.clause_type ||
    finding.location ||
    finding.missing_element ||
    finding.item_no ||
    finding.item ||
    finding.description ||
    JSON.stringify(finding)
  );
}

function dedupeByRootCause(findings) {
  const bySource = {};
  for (const f of findings) {
    const key = getRootCauseKey(f);
    if (!bySource[key] || weightOf(f.severity) > weightOf(bySource[key].severity)) {
      bySource[key] = f;
    }
  }
  return Object.values(bySource);
}

// ---------------------------------------------------------------------------
// 3. scope_gaps severity derivation (no severity field exists yet upstream)
// ---------------------------------------------------------------------------

function classifyScopeGap(gap, totalBidPrice) {
  // If the LLM schema is later extended to include severity directly, prefer it.
  if (gap.severity && SEVERITY_WEIGHT[gap.severity] != null) return gap.severity;

  // Otherwise derive from estimated_cost_etb as a fraction of total bid price.
  if (gap.estimated_cost_etb != null && totalBidPrice > 0) {
    const ratio = gap.estimated_cost_etb / totalBidPrice;
    if (ratio > 0.02) return 'CRITICAL';
    if (ratio > 0.005) return 'HIGH';
    if (ratio > 0.001) return 'MEDIUM';
    return 'LOW';
  }

  // No cost estimate and no severity: don't invent certainty. Default LOW,
  // not MEDIUM — an unquantified gap is a real gap, but silence is not
  // evidence of moderate severity, per the canonical model's rule against
  // filling unknowns with invented confidence.
  return 'LOW';
}

// ---------------------------------------------------------------------------
// 4. Market variance — aggregate, direction-separated, neutral-band aware
// ---------------------------------------------------------------------------
// Neutral band matches pricingEvidence.js's ruleBasedRecommendation() bands
// (5% = "review recommended", 15% = "significantly above/below") rather than
// inventing a separate threshold, so the score and the report's human-
// readable text never disagree about what counts as "normal."

const NEUTRAL_BAND_PCT = 0.05; // aligned to existing ruleBasedRecommendation(), not independently calibrated

function computeMarketVarianceExposure(marketVariance, totalBidPrice) {
  let underbidExposure = 0;
  let overbidExposure = 0;
  let skippedNoQuantity = 0;

  for (const item of marketVariance || []) {
    if (item.confidence === 'Unknown' || item.reference_price == null) continue; // no trustworthy match
    if (item.variance_percent == null) continue;

    if (item.quantity == null) {
      // quantity not yet present on market_variance objects — degrade safely
      // by skipping exposure math for this item rather than crashing or
      // guessing a quantity. See file header note on pricingEvidence.js.
      skippedNoQuantity += 1;
      continue;
    }

    const rateDiff = item.tender_price - item.reference_price;
    const pctDiff = item.variance_percent / 100;
    // Cap per-item exposure at the item's own bid value (tender_price x
    // quantity). Without this, a single garbage rate (OCR error, decimal
    // point in the wrong place, wrong unit — all real risks on scanned
    // tender PDFs) can produce an exposure larger than what was actually
    // bid on that line, which is not physically meaningful and was
    // confirmed live to push underbidRatio past 100% of the total bid
    // price (268% observed on a deliberately extreme test case).
    const itemBidValue = item.tender_price * item.quantity;

    if (pctDiff < -NEUTRAL_BAND_PCT) {
      underbidExposure += Math.min(Math.abs(rateDiff) * item.quantity, itemBidValue);
    } else if (pctDiff > NEUTRAL_BAND_PCT) {
      overbidExposure += Math.min(rateDiff * item.quantity, itemBidValue);
    }
  }

  return {
    underbidRatio: totalBidPrice > 0 ? underbidExposure / totalBidPrice : 0,
    overbidRatio: totalBidPrice > 0 ? overbidExposure / totalBidPrice : 0,
    underbidExposure,
    overbidExposure,
    skippedNoQuantity, // surface this so callers/logs can see if quantity is still missing
  };
}

function classifyVarianceRatio(ratio) {
  // NEEDS_CALIBRATION — portfolio-level bands, no empirical basis yet.
  if (ratio > 0.15) return 'CRITICAL';
  if (ratio > 0.08) return 'HIGH';
  if (ratio > 0.03) return 'MEDIUM';
  if (ratio > 0) return 'LOW';
  return null;
}

// ---------------------------------------------------------------------------
// 5. Compliance Risk Score
// ---------------------------------------------------------------------------
// Inputs are the REAL arrays already present on `analysis` in check-analysis.js:
// analysis.contractual_traps, analysis.scope_gaps. (eligibility_integrity does
// not exist yet anywhere in the pipeline — accepted as an optional third input
// so this function is forward-compatible without needing to change again.)

function computeComplianceRisk(analysis, { totalBidPrice } = {}) {
  const contractualTraps = dedupeByRootCause(analysis.contractual_traps || []);
  const scopeGaps = dedupeByRootCause(
    (analysis.scope_gaps || []).map((g) => ({ ...g, severity: classifyScopeGap(g, totalBidPrice) }))
  );
  const eligibilityIntegrity = dedupeByRootCause(analysis.eligibility_integrity || []); // dormant until built

  const weights = [...contractualTraps, ...scopeGaps, ...eligibilityIntegrity].map((f) => weightOf(f.severity));

  return {
    score: toScore(noisyOr(weights)),
    contributingFindings: [...contractualTraps, ...scopeGaps, ...eligibilityIntegrity], // evidence-first UI: never show a bare score
    breakdown: {
      contractual_traps: contractualTraps.length,
      scope_gaps: scopeGaps.length,
      eligibility_integrity: eligibilityIntegrity.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Pricing Risk Score
// ---------------------------------------------------------------------------
// Inputs are the REAL arrays already present on `analysis`:
// analysis.arithmetic_errors, analysis.market_variance.

function computePricingRisk(analysis, totalBidPrice) {
  const arithmeticFindings = dedupeByRootCause(analysis.arithmetic_errors || []);

  const { underbidRatio, overbidRatio, underbidExposure, overbidExposure, skippedNoQuantity } =
    computeMarketVarianceExposure(analysis.market_variance || [], totalBidPrice);

  const underbidSeverity = classifyVarianceRatio(underbidRatio);
  const overbidSeverity = classifyVarianceRatio(overbidRatio);

  const unpricedFindings = dedupeByRootCause(analysis.unpriced_items || []); // dormant until built

  const weights = [
    ...arithmeticFindings.map((f) => weightOf(f.severity)),
    ...unpricedFindings.map((f) => weightOf(f.severity)),
    weightOf(underbidSeverity),
    weightOf(overbidSeverity),
  ];

  return {
    score: toScore(noisyOr(weights)),
    underbidding: { ratio: underbidRatio, exposure: underbidExposure, severity: underbidSeverity },
    overbidding: { ratio: overbidRatio, exposure: overbidExposure, severity: overbidSeverity },
    arithmeticFindings,
    unpricedFindings,
    dataQualityNote:
      skippedNoQuantity > 0
        ? `${skippedNoQuantity} market_variance item(s) skipped in exposure calc — missing quantity field (see pricingEvidence.js fix needed)`
        : null,
  };
}

export {
  SEVERITY_WEIGHT,
  weightOf,
  noisyOr,
  dedupeByRootCause,
  classifyScopeGap,
  computeMarketVarianceExposure,
  classifyVarianceRatio,
  computeComplianceRisk,
  computePricingRisk,
};